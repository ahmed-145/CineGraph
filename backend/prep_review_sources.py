"""
Set up the four external review sources from PRD v2 §6.1.

Each source is optional — `ingest_vibe.py` falls back to whatever is
available. Run this script once before kicking off a full PRD-strict
rebuild. You can run individual subcommands or `all`.

    python prep_review_sources.py stanford      # ~80 MB
    python prep_review_sources.py huggingface   # ~1 GB
    python prep_review_sources.py kaggle        # ~700 MB, needs kaggle CLI
    python prep_review_sources.py ebert         # ~50 MB
    python prep_review_sources.py mappings      # builds imdb_to_tmdb + rt_to_tmdb
    python prep_review_sources.py all           # everything in order

Outputs land in backend/review_data/.
"""

from __future__ import annotations
import argparse
import io
import json
import os
import re
import sys
import tarfile
import time
import zipfile
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

import httpx

from config import settings


ROOT = Path(__file__).parent
DATA = ROOT / "review_data"
DATA.mkdir(exist_ok=True)


# ──────────────────────────────────────────────────────────────────────────
# Stanford Large Movie Review Dataset
# ──────────────────────────────────────────────────────────────────────────
def prep_stanford() -> bool:
    url = "https://ai.stanford.edu/~amaas/data/sentiment/aclImdb_v1.tar.gz"
    target_root = DATA / "stanford_imdb"
    if target_root.exists() and any(target_root.iterdir()):
        print(f"[stanford] already present at {target_root}")
        return True
    print(f"[stanford] downloading {url} (~80 MB)...")
    with httpx.stream("GET", url, follow_redirects=True, timeout=120) as resp:
        if resp.status_code != 200:
            print(f"[stanford] HTTP {resp.status_code}")
            return False
        archive = io.BytesIO()
        for chunk in resp.iter_bytes(chunk_size=1 << 16):
            archive.write(chunk)
        archive.seek(0)
    print("[stanford] extracting...")
    with tarfile.open(fileobj=archive, mode="r:gz") as tar:
        tar.extractall(DATA)
    src = DATA / "aclImdb"
    if src.exists() and not target_root.exists():
        src.rename(target_root)
    print(f"[stanford] extracted to {target_root}")
    # The Stanford urls file maps each opaque ID to an IMDB URL — useful for
    # building imdb_to_tmdb mapping. Keep it accessible.
    return True


# ──────────────────────────────────────────────────────────────────────────
# HuggingFace frankier/processed_multiscale_rt_critics
# ──────────────────────────────────────────────────────────────────────────
def prep_huggingface() -> bool:
    try:
        from datasets import load_dataset  # type: ignore
        import pandas as pd  # type: ignore
    except ImportError:
        print("[hf] `pip install datasets pyarrow pandas` then rerun")
        return False
    target = DATA / "rt_critics_processed.parquet"
    if not target.exists():
        print("[hf] loading frankier/processed_multiscale_rt_critics from the hub...")
        ds = load_dataset("frankier/processed_multiscale_rt_critics", split="train")
        df = ds.to_pandas()
        df.to_parquet(target)
        print(f"[hf] wrote {len(df)} rows → {target}")
    else:
        print(f"[hf] parquet already present at {target}")
        df = pd.read_parquet(target)

    # Build rt_to_tmdb.json from the parquet so HuggingFaceRTSource (and
    # RTKaggleSource — same schema) can actually map slug → TMDB id.
    print(f"[hf] parquet columns: {list(df.columns)}")
    _build_rt_to_tmdb(df)
    return True


def _build_rt_to_tmdb(df) -> None:
    """Build review_data/rt_to_tmdb.json from an RT-critics-style dataframe.

    Strategy (best→worst):
      1. If df has an imdb id column → use existing imdb_to_tmdb.json bridge
         (this is the most reliable mapping).
      2. Else if df has slug + title → normalised title match against
         films_catalog.json.

    Either way, writes to backend/review_data/rt_to_tmdb.json.
    """
    rt_path = DATA / "rt_to_tmdb.json"
    rt_to_tmdb: dict[str, int] = {}
    if rt_path.exists():
        try:
            existing = json.loads(rt_path.read_text())
            if isinstance(existing, dict):
                rt_to_tmdb.update(existing)
        except Exception:
            pass

    # Some RT exports have a slug column, some (like HF's processed parquet)
    # only have `movie_title`. We support both; rt_to_tmdb.json keys are
    # whatever the source provides, normalised.
    slug_col = next((c for c in df.columns if "slug" in c.lower()), None)
    title_col = next((c for c in df.columns if c.lower() in ("movie_title", "title")), None)
    imdb_col = next((c for c in df.columns if "imdb" in c.lower()), None)
    if not slug_col and not title_col:
        print("[hf] no slug or title column — rt_to_tmdb cannot be built")
        return
    join_col = slug_col or title_col
    print(f"[hf] joining on column: {join_col}")

    # Path 1: imdb → tmdb via existing mapping
    imdb_path = DATA / "imdb_to_tmdb.json"
    imdb_map: dict[str, int] = {}
    if imdb_path.exists():
        try:
            imdb_map = json.loads(imdb_path.read_text())
        except Exception:
            pass

    matched_via_imdb = 0
    matched_via_title = 0

    use_title_as_key = (slug_col is None)

    def _make_key(raw) -> str:
        return _normalise_title(str(raw)) if use_title_as_key else str(raw)

    if imdb_col and imdb_map:
        pairs = df.loc[:, [join_col, imdb_col]].drop_duplicates()
        for k, imdb in zip(pairs.iloc[:, 0], pairs.iloc[:, 1]):
            key = _make_key(k)
            imdb_str = str(imdb).strip()
            if imdb_str in imdb_map and key not in rt_to_tmdb:
                rt_to_tmdb[key] = imdb_map[imdb_str]
                matched_via_imdb += 1

    # Path 2: normalised title match against catalog. When the source has no
    # explicit slug column we treat the (normalised) title as the key.
    if title_col:
        catalog_path = ROOT / "films_catalog.json"
        title_to_tmdb: dict[str, list[int]] = {}
        if catalog_path.exists():
            try:
                catalog = json.loads(catalog_path.read_text())
                for f in catalog:
                    norm = _normalise_title(f.get("title", ""))
                    if norm:
                        title_to_tmdb.setdefault(norm, []).append(f["tmdb_id"])
            except Exception:
                pass
        print(f"[hf] catalog title bridge has {len(title_to_tmdb)} unique titles")
        if title_to_tmdb:
            unique_titles = df[title_col].drop_duplicates()
            for title in unique_titles:
                norm = _normalise_title(str(title))
                if not norm or norm in rt_to_tmdb:
                    continue
                hits = title_to_tmdb.get(norm)
                if hits:
                    rt_to_tmdb[norm] = hits[0]
                    matched_via_title += 1

    rt_path.write_text(json.dumps(rt_to_tmdb, indent=0))
    print(f"[hf] rt_to_tmdb: {len(rt_to_tmdb)} total "
          f"(imdb-matched: {matched_via_imdb}, title-matched: {matched_via_title})"
          f" → {rt_path}")


def _normalise_title(s: str) -> str:
    return "".join(c.lower() for c in s if c.isalnum())


# ──────────────────────────────────────────────────────────────────────────
# Rotten Tomatoes Kaggle (stefanoleone992)
# ──────────────────────────────────────────────────────────────────────────
def prep_kaggle() -> bool:
    target = DATA / "rt_critics.csv"
    if target.exists():
        print(f"[kaggle] already present at {target}")
        return True
    try:
        import kaggle  # noqa: F401
    except (ImportError, OSError):
        print("[kaggle] `pip install kaggle`, then put your kaggle.json at "
              "~/.kaggle/kaggle.json (chmod 600). Then rerun.")
        return False
    print("[kaggle] downloading rotten-tomatoes-movies-and-critic-reviews-dataset...")
    os.system("kaggle datasets download "
              "stefanoleone992/rotten-tomatoes-movies-and-critic-reviews-dataset "
              f"-p {DATA} --unzip")
    # Kaggle drops two CSVs — we want the reviews file.
    for name in ("rotten_tomatoes_critic_reviews.csv", "rotten_tomatoes_reviews.csv"):
        candidate = DATA / name
        if candidate.exists():
            candidate.rename(target)
            print(f"[kaggle] renamed → {target}")
            return True
    print("[kaggle] couldn't find reviews CSV after download")
    return False


# ──────────────────────────────────────────────────────────────────────────
# Roger Ebert archive (community SQLite)
# ──────────────────────────────────────────────────────────────────────────
def prep_ebert() -> bool:
    """
    The PRD references a community-maintained Ebert archive. There isn't a
    single canonical URL — common community SQLite mirrors include:
      - https://github.com/scaleway-rant/ebert-archive (example)
      - rogerebert.com scrapes (legally murky)
    We expect the user to drop an `ebert.sqlite` file at backend/review_data/
    with a table `reviews(imdb_id TEXT, body TEXT)`. This subcommand just
    validates whatever is there.
    """
    target = DATA / "ebert.sqlite"
    if not target.exists():
        print("[ebert] put an ebert.sqlite at backend/review_data/ebert.sqlite")
        print("        Schema: reviews(imdb_id TEXT, body TEXT)")
        return False
    import sqlite3
    try:
        conn = sqlite3.connect(target)
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM reviews")
        n = cur.fetchone()[0]
        conn.close()
        print(f"[ebert] OK — {n} reviews in {target}")
        return True
    except Exception as e:
        print(f"[ebert] schema mismatch: {e}")
        return False


# ──────────────────────────────────────────────────────────────────────────
# ID mappings — IMDB → TMDB, RT-slug → TMDB
# ──────────────────────────────────────────────────────────────────────────
def _imdb_id_from_tmdb_payload(tid: int) -> str | None:
    """Use TMDB's external_ids endpoint to look up the IMDB id."""
    url = f"https://api.themoviedb.org/3/movie/{tid}/external_ids"
    try:
        resp = httpx.get(url, params={"api_key": settings.tmdb_api_key}, timeout=10)
        if resp.status_code != 200:
            return None
        return resp.json().get("imdb_id")
    except Exception:
        return None


def prep_mappings() -> bool:
    """
    Build:
      - imdb_to_tmdb.json (used by Stanford + Ebert sources)
      - rt_to_tmdb.json   (used by Kaggle + HuggingFace sources)

    Parallel TMDB external_ids fetch (32-way) — for a 50k catalog this
    completes in ~3-5 min instead of ~35. Resumable: saves every 500 films.
    """
    import concurrent.futures
    from qdrant_client import QdrantClient

    client = QdrantClient(url=settings.qdrant_url)
    existing_collections = {c.name for c in client.get_collections().collections}
    coll = (settings.qdrant_collection_v2 if settings.qdrant_collection_v2 in existing_collections
            else settings.qdrant_collection)

    imdb_path = DATA / "imdb_to_tmdb.json"
    imdb_map: dict[str, int] = {}
    if imdb_path.exists():
        imdb_map = json.loads(imdb_path.read_text())
        print(f"[mappings] resuming from {len(imdb_map)} existing imdb→tmdb")
    already_mapped_tmdb = set(imdb_map.values())

    print(f"[mappings] scrolling {coll} to enumerate films...")
    offset = None
    tmdb_ids: list[int] = []
    while True:
        result, offset = client.scroll(
            collection_name=coll, limit=512, offset=offset,
            with_payload=["tmdb_id"], with_vectors=False,
        )
        for p in result:
            tid = p.payload.get("tmdb_id")
            if tid is not None and tid not in already_mapped_tmdb:
                tmdb_ids.append(tid)
        if offset is None:
            break
    print(f"[mappings] {len(tmdb_ids)} unmapped films")

    if not tmdb_ids:
        print("[mappings] nothing to do")
        # Still create rt_to_tmdb.json stub
        rt_path = DATA / "rt_to_tmdb.json"
        if not rt_path.exists():
            rt_path.write_text("{}")
        return True

    started = time.time()
    WORKERS = 32
    BATCH = 500   # save every 500 films

    def _lookup(tid: int) -> tuple[int, str | None]:
        return tid, _imdb_id_from_tmdb_payload(tid)

    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as pool:
        fetched = 0
        for i in range(0, len(tmdb_ids), BATCH):
            chunk = tmdb_ids[i:i + BATCH]
            futures = [pool.submit(_lookup, tid) for tid in chunk]
            for fut in concurrent.futures.as_completed(futures):
                tid, imdb = fut.result()
                if imdb:
                    imdb_map[imdb] = tid
                fetched += 1
            imdb_path.write_text(json.dumps(imdb_map, indent=0))
            rate = fetched / max(time.time() - started, 1e-6)
            eta_min = (len(tmdb_ids) - fetched) / max(rate, 1e-6) / 60
            print(f"[mappings] {fetched} / {len(tmdb_ids)}  |  "
                  f"{rate:.1f}/s  |  ETA {eta_min:.1f} min")

    imdb_path.write_text(json.dumps(imdb_map, indent=0))
    print(f"[mappings] wrote {len(imdb_map)} imdb→tmdb → {imdb_path}")

    rt_path = DATA / "rt_to_tmdb.json"
    if not rt_path.exists():
        rt_path.write_text("{}")
        print(f"[mappings] stubbed {rt_path} — populated lazily by RT sources")
    return True


# ──────────────────────────────────────────────────────────────────────────
SUBCOMMANDS = {
    "stanford":    prep_stanford,
    "huggingface": prep_huggingface,
    "kaggle":      prep_kaggle,
    "ebert":       prep_ebert,
    "mappings":    prep_mappings,
}


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawTextHelpFormatter)
    parser.add_argument("source", choices=list(SUBCOMMANDS) + ["all"],
                        help="which review source to prepare")
    args = parser.parse_args()

    targets = list(SUBCOMMANDS) if args.source == "all" else [args.source]
    results: dict[str, bool] = {}
    for name in targets:
        fn = SUBCOMMANDS[name]
        try:
            ok = fn()
        except Exception as e:
            print(f"[{name}] FAILED: {e}")
            ok = False
        results[name] = ok
        print()

    print("=== Summary ===")
    for name, ok in results.items():
        print(f"  {name:12s} {'✓' if ok else '·'}")
    if all(results.values()):
        sys.exit(0)
    sys.exit(1)


if __name__ == "__main__":
    main()
