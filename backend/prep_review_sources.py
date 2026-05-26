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
    except ImportError:
        print("[hf] `pip install datasets pyarrow pandas` then rerun")
        return False
    target = DATA / "rt_critics_processed.parquet"
    if target.exists():
        print(f"[hf] already present at {target}")
        return True
    print("[hf] loading frankier/processed_multiscale_rt_critics from the hub...")
    ds = load_dataset("frankier/processed_multiscale_rt_critics", split="train")
    df = ds.to_pandas()
    df.to_parquet(target)
    print(f"[hf] wrote {len(df)} rows → {target}")
    return True


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

    Approach: scroll the existing Qdrant collection to find tmdb_ids we
    already know about, then call TMDB external_ids for each to get imdb_id.
    RT slug mapping is best-effort via TMDB's `find/{imdb_id}` reverse lookup
    or by matching the slug against titles.
    """
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
            if tid is not None:
                tmdb_ids.append(tid)
        if offset is None:
            break
    print(f"[mappings] {len(tmdb_ids)} films total")

    # Pull IMDB id per TMDB id — TMDB rate limit is generous; we still pace.
    started = time.time()
    fetched = 0
    for tid in tmdb_ids:
        if str(tid) in imdb_map.values():
            continue  # already mapped
        existing_imdb = next((k for k, v in imdb_map.items() if v == tid), None)
        if existing_imdb:
            continue
        imdb = _imdb_id_from_tmdb_payload(tid)
        if imdb:
            imdb_map[imdb] = tid
        fetched += 1
        if fetched % 100 == 0:
            rate = fetched / max(time.time() - started, 1e-6)
            print(f"[mappings] {fetched} / {len(tmdb_ids)} ({rate:.1f}/s)")
            imdb_path.write_text(json.dumps(imdb_map, indent=0))
        time.sleep(0.04)

    imdb_path.write_text(json.dumps(imdb_map, indent=0))
    print(f"[mappings] wrote {len(imdb_map)} imdb→tmdb → {imdb_path}")

    # RT slug mapping uses the title-year heuristic on top of imdb→tmdb.
    # We rely on the Kaggle CSV having both slug + title (we can populate
    # this lazily on first ingest). Stub a tiny file here.
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
