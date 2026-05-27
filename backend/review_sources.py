"""
Cascading review-source pipeline (PRD v2 §6.1, Axis 2).

Each source implements `reviews_for(tmdb_id)`. `cascading_reviews()` queries
them in PRD-defined priority order — RT Kaggle, HuggingFace, Stanford, Ebert,
TMDB — and concatenates results up to a soft cap. Sources whose data files
are not present declare themselves unavailable and are skipped without error.

To activate each source, drop its data into `backend/review_data/` and rerun
ingest_vibe.py with `REVIEW_SOURCES=full` in the environment.

Data file layout (place by hand — too large to commit):
    backend/review_data/
        rt_critics.csv              # RT Kaggle (stefanoleone992)
        rt_critics_processed.parquet # HuggingFace frankier/...
        stanford_imdb/              # Stanford Large Movie Review tree
        ebert.sqlite                # Roger Ebert archive (GitHub SQLite)

Each source maintains its own in-memory index keyed by TMDB id (after
mapping from IMDB id / RT slug). Loaded lazily on first query.
"""

from __future__ import annotations
import csv
import hashlib
import json
import os
import re
import sqlite3
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Iterable

import httpx


def _normalise_title(s: str) -> str:
    """Match prep_review_sources._normalise_title — alphanumerics lowercase."""
    return "".join(c.lower() for c in s if c.isalnum())


REVIEW_DATA_DIR = Path(__file__).parent / "review_data"
TMDB_BASE = "https://api.themoviedb.org/3"


class ReviewSource(ABC):
    name: str = "abstract"

    @abstractmethod
    def is_available(self) -> bool:
        ...

    @abstractmethod
    def reviews_for(self, tmdb_id: int) -> list[str]:
        ...


# ── Source 1: Rotten Tomatoes Kaggle (stefanoleone992) ──────────────────────


class RTKaggleSource(ReviewSource):
    """
    Loads `rotten_tomatoes_critic_reviews.csv` from the public Kaggle dataset.
    Columns: rotten_tomatoes_link, critic_name, top_critic, publisher_name,
             review_type, review_score, review_date, review_content.
    Needs an external slug-to-TMDB-id mapping file (`rt_to_tmdb.json`).
    """
    name = "rt_kaggle"

    def __init__(self, csv_path: Path | None = None, map_path: Path | None = None):
        self.csv_path = csv_path or (REVIEW_DATA_DIR / "rt_critics.csv")
        self.map_path = map_path or (REVIEW_DATA_DIR / "rt_to_tmdb.json")
        self._index: dict[int, list[str]] | None = None

    def is_available(self) -> bool:
        return self.csv_path.exists() and self.map_path.exists()

    def _load(self) -> dict[int, list[str]]:
        if self._index is not None:
            return self._index
        with open(self.map_path) as f:
            slug_to_tmdb: dict[str, int] = json.load(f)
        out: dict[int, list[str]] = {}
        with open(self.csv_path, newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                slug = row.get("rotten_tomatoes_link", "").strip("/")
                tid = slug_to_tmdb.get(slug)
                if not tid:
                    continue
                content = (row.get("review_content") or "").strip()
                if not content:
                    continue
                out.setdefault(int(tid), []).append(content)
        self._index = out
        return out

    def reviews_for(self, tmdb_id: int) -> list[str]:
        if not self.is_available():
            return []
        return self._load().get(int(tmdb_id), [])


# ── Source 2: HuggingFace frankier/processed_multiscale_rt_critics ──────────


class HuggingFaceRTSource(ReviewSource):
    """
    Loads HuggingFace dataset `frankier/processed_multiscale_rt_critics`.
    Either a saved parquet (offline path) or pulled via `datasets` library.
    """
    name = "huggingface_rt"

    def __init__(self, parquet_path: Path | None = None,
                 map_path: Path | None = None,
                 use_hf_hub: bool = False):
        self.parquet_path = parquet_path or (REVIEW_DATA_DIR / "rt_critics_processed.parquet")
        self.map_path = map_path or (REVIEW_DATA_DIR / "rt_to_tmdb.json")
        self.use_hf_hub = use_hf_hub
        self._index: dict[int, list[str]] | None = None

    def is_available(self) -> bool:
        if self.parquet_path.exists() and self.map_path.exists():
            return True
        return self.use_hf_hub and self.map_path.exists()

    def _load(self) -> dict[int, list[str]]:
        if self._index is not None:
            return self._index
        try:
            import pandas as pd  # type: ignore
        except ImportError:
            self._index = {}
            return {}
        if self.parquet_path.exists():
            df = pd.read_parquet(self.parquet_path)
        elif self.use_hf_hub:
            try:
                from datasets import load_dataset  # type: ignore
                df = load_dataset("frankier/processed_multiscale_rt_critics",
                                  split="train").to_pandas()
            except Exception:
                self._index = {}
                return {}
        else:
            self._index = {}
            return {}
        with open(self.map_path) as f:
            key_to_tmdb: dict[str, int] = json.load(f)
        out: dict[int, list[str]] = {}
        # Schema variants:
        #   - older RT Kaggle: movie_slug + review_content
        #   - HF processed_multiscale_rt_critics: movie_title + review_content
        slug_col = next((c for c in df.columns if "slug" in c.lower()), None)
        title_col = next((c for c in df.columns if c.lower() in ("movie_title", "title")), None)
        text_col = next((c for c in df.columns if "review" in c.lower() and "content" in c.lower()),
                        None) or next((c for c in df.columns if "text" in c.lower()), None)
        if not text_col or (not slug_col and not title_col):
            self._index = {}
            return {}
        # When the dataset has no slug we use the normalised title as the key,
        # which is what prep_review_sources.py builds into rt_to_tmdb.json.
        key_col = slug_col or title_col
        normalise = (slug_col is None)
        for raw_key, txt in zip(df[key_col], df[text_col]):
            if not txt:
                continue
            key = _normalise_title(str(raw_key)) if normalise else str(raw_key)
            tid = key_to_tmdb.get(key)
            if tid:
                out.setdefault(int(tid), []).append(str(txt))
        self._index = out
        return out

    def reviews_for(self, tmdb_id: int) -> list[str]:
        if not self.is_available():
            return []
        return self._load().get(int(tmdb_id), [])


# ── Source 3: Stanford Large Movie Review Dataset ───────────────────────────


class StanfordIMDBSource(ReviewSource):
    """
    Stanford ACL dataset. Folder tree: train/pos, train/neg, test/pos, test/neg.
    Each .txt is one review. Filename encodes IMDB id (`{movie}_{rating}.txt`).
    Needs an `imdb_to_tmdb.json` mapping.
    """
    name = "stanford_imdb"

    def __init__(self, root: Path | None = None, map_path: Path | None = None):
        self.root = root or (REVIEW_DATA_DIR / "stanford_imdb")
        self.map_path = map_path or (REVIEW_DATA_DIR / "imdb_to_tmdb.json")
        self._index: dict[int, list[str]] | None = None

    def is_available(self) -> bool:
        return self.root.exists() and self.map_path.exists()

    def _load(self) -> dict[int, list[str]]:
        if self._index is not None:
            return self._index
        with open(self.map_path) as f:
            imdb_to_tmdb: dict[str, int] = json.load(f)
        out: dict[int, list[str]] = {}
        for split in ("train", "test"):
            for sentiment in ("pos", "neg"):
                d = self.root / split / sentiment
                if not d.exists():
                    continue
                for fname in d.iterdir():
                    if fname.suffix != ".txt":
                        continue
                    # Stanford filenames are `{id}_{rating}.txt` where id is
                    # opaque; the dataset ships urls.txt that maps id → IMDB.
                    # We rely on the user having a precomputed imdb_to_tmdb.
                    stem = fname.stem.split("_")[0]
                    tid = imdb_to_tmdb.get(stem)
                    if not tid:
                        continue
                    try:
                        txt = fname.read_text(encoding="utf-8").strip()
                    except Exception:
                        continue
                    if txt:
                        out.setdefault(int(tid), []).append(txt)
        self._index = out
        return out

    def reviews_for(self, tmdb_id: int) -> list[str]:
        if not self.is_available():
            return []
        return self._load().get(int(tmdb_id), [])


# ── Source 4: Roger Ebert archive (GitHub SQLite) ───────────────────────────


class EbertSource(ReviewSource):
    """
    SQLite from https://github.com/(community-maintained)/ebert-archive.
    Expected schema: a `reviews` table with at least `imdb_id` and `body`.
    Mapping file `imdb_to_tmdb.json` translates to TMDB ids.
    """
    name = "ebert"

    def __init__(self, db_path: Path | None = None, map_path: Path | None = None):
        self.db_path = db_path or (REVIEW_DATA_DIR / "ebert.sqlite")
        self.map_path = map_path or (REVIEW_DATA_DIR / "imdb_to_tmdb.json")
        self._index: dict[int, list[str]] | None = None

    def is_available(self) -> bool:
        return self.db_path.exists() and self.map_path.exists()

    def _load(self) -> dict[int, list[str]]:
        if self._index is not None:
            return self._index
        with open(self.map_path) as f:
            imdb_to_tmdb: dict[str, int] = json.load(f)
        out: dict[int, list[str]] = {}
        conn = sqlite3.connect(self.db_path)
        try:
            cur = conn.cursor()
            cur.execute("SELECT imdb_id, body FROM reviews")
            for imdb_id, body in cur.fetchall():
                tid = imdb_to_tmdb.get(str(imdb_id))
                if not tid or not body:
                    continue
                out.setdefault(int(tid), []).append(body)
        finally:
            conn.close()
        self._index = out
        return out

    def reviews_for(self, tmdb_id: int) -> list[str]:
        if not self.is_available():
            return []
        return self._load().get(int(tmdb_id), [])


# ── Source 5: TMDB (always available) ───────────────────────────────────────


class TMDBSource(ReviewSource):
    name = "tmdb"

    def __init__(self, api_key: str, max_pages: int = 2, timeout: float = 8.0):
        self.api_key = api_key
        self.max_pages = max_pages
        self.timeout = timeout

    def is_available(self) -> bool:
        return bool(self.api_key)

    def reviews_for(self, tmdb_id: int) -> list[str]:
        if not self.is_available():
            return []
        out: list[str] = []
        for page in range(1, self.max_pages + 1):
            try:
                resp = httpx.get(
                    f"{TMDB_BASE}/movie/{tmdb_id}/reviews",
                    params={"api_key": self.api_key, "page": page},
                    timeout=self.timeout,
                )
                if resp.status_code != 200:
                    break
                results = resp.json().get("results", [])
                if not results:
                    break
                for r in results:
                    c = (r.get("content") or "").strip()
                    if c:
                        out.append(c)
                if len(results) < 20:
                    break
            except Exception:
                break
        return out


# ── Cascade ─────────────────────────────────────────────────────────────────


def default_sources(tmdb_api_key: str) -> list[ReviewSource]:
    """PRD-defined priority order. Sources without data files declare unavailable."""
    return [
        RTKaggleSource(),
        HuggingFaceRTSource(),
        StanfordIMDBSource(),
        EbertSource(),
        TMDBSource(tmdb_api_key),
    ]


def _content_fingerprint(text: str) -> str:
    """Stable hash over the first 200 chars of normalised text. Used to
    dedup reviews that appear in multiple sources (e.g. RT Kaggle and the
    HuggingFace `frankier/processed_multiscale_rt_critics` dataset are both
    RT-sourced and share the same critic blurbs)."""
    normalised = " ".join(text.lower().split())[:200]
    return hashlib.md5(normalised.encode("utf-8")).hexdigest()


def cascading_reviews(
    tmdb_id: int,
    sources: Iterable[ReviewSource],
    max_total: int = 60,
) -> list[str]:
    """Query each source in PRD priority order. Dedups reviews by content
    fingerprint so RT-sourced overlap between Kaggle and HuggingFace doesn't
    double-weight a critic's voice in the mean-pool."""
    out: list[str] = []
    seen: set[str] = set()
    for src in sources:
        if not src.is_available():
            continue
        try:
            chunk = src.reviews_for(tmdb_id)
        except Exception:
            continue
        for review in chunk:
            if not review or len(review.strip()) < 20:
                continue
            fp = _content_fingerprint(review)
            if fp in seen:
                continue
            seen.add(fp)
            out.append(review)
            if len(out) >= max_total:
                return out
    return out


def availability_report(sources: Iterable[ReviewSource]) -> dict:
    return {src.name: bool(src.is_available()) for src in sources}
