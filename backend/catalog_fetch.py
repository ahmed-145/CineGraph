"""
Catalog harvester.
Run: python catalog_fetch.py              # default 10k films
     python catalog_fetch.py --target 50000  # PRD §6.5 — full V1 scope
Pulls films from TMDB by descending vote_count, then sweeps year buckets
to add festival / awards titles outside the popularity head.
Output: films_catalog.json (idempotent — merges with existing).
"""

import argparse
import json
import time
import httpx
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()
from config import settings

TMDB_BASE = "https://api.themoviedb.org/3"
CATALOG_PATH = Path(__file__).parent / "films_catalog.json"
PER_PAGE = 20

# Year sweep buckets for the long-tail. Narrower windows + multiple sort
# orders bypass TMDB's per-query 500-page cap and surface different long-tail
# slices the popularity sweep misses.
SWEEP_YEAR_RANGES = [
    (1900, 1949),
    (1950, 1969),
    (1970, 1979),
    (1980, 1989),
    (1990, 1999),
    (2000, 2009),
    (2010, 2014),
    (2015, 2019),
    (2020, 2022),
    (2023, 2026),
]

# Each sort returns a *different* ordering — popularity, revenue, release_date
# all rank the same year-bucket differently, so each gets its own 500-page
# allowance with non-overlapping long-tail at the bottom.
SWEEP_SORTS = [
    "vote_count.desc",
    "popularity.desc",
    "revenue.desc",
    "primary_release_date.desc",
    "vote_average.desc",
]


def fetch_page(client: httpx.Client, page: int, vote_gte: int = 200,
               year_lte: int | None = None, year_gte: int | None = None,
               sort_by: str = "vote_count.desc") -> list[dict]:
    params = {
        "api_key": settings.tmdb_api_key,
        "sort_by": sort_by,
        "vote_count.gte": vote_gte,
        "page": page,
    }
    if year_lte is not None: params["primary_release_date.lte"] = f"{year_lte}-12-31"
    if year_gte is not None: params["primary_release_date.gte"] = f"{year_gte}-01-01"
    try:
        resp = client.get(f"{TMDB_BASE}/discover/movie", params=params, timeout=15)
        if resp.status_code == 200:
            return resp.json().get("results", [])
        if resp.status_code != 400:  # 400 = past page 500 cap; expected
            print(f"  Page {page}: HTTP {resp.status_code}")
    except Exception as e:
        print(f"  Page {page}: {e}")
    return []


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", type=int, default=10000,
                        help="Total films to collect (default 10k, PRD §6.5 calls for 50k)")
    args = parser.parse_args()
    target = args.target

    print(f"=== CineGraph Catalog Fetch — target {target} films ===\n")

    # Resume from existing catalog if present
    all_films: list[dict] = []
    seen_ids: set[int] = set()
    if CATALOG_PATH.exists():
        try:
            existing = json.loads(CATALOG_PATH.read_text())
            for f in existing:
                tid = f.get("tmdb_id")
                if tid and tid not in seen_ids:
                    seen_ids.add(tid)
                    all_films.append(f)
            print(f"Resuming from {len(all_films)} existing films")
        except Exception:
            pass

    def add(r: dict):
        tid = r.get("id")
        if tid and tid not in seen_ids:
            seen_ids.add(tid)
            all_films.append({"tmdb_id": tid, "title": r.get("title", "")})

    with httpx.Client() as client:
        # Phase 1 — popularity head sweep
        max_pages = max(1, (target // PER_PAGE) + 50)
        for page in range(1, max_pages + 1):
            if len(all_films) >= target: break
            results = fetch_page(client, page, vote_gte=200)
            if not results:
                print(f"Popularity sweep exhausted at page {page} "
                      f"with {len(all_films)} films.")
                break
            for r in results:
                add(r)
            if page % 50 == 0:
                print(f"  Popularity page {page} — {len(all_films)} films")
            time.sleep(0.04)

        # Phase 2 — year-bucket × sort-order matrix for the long tail. Each
        # (bucket, sort) pair gets its own 500-page allowance, surfacing
        # non-overlapping long-tail films TMDB ranks differently per sort.
        if len(all_films) < target:
            print(f"\nSwitching to year-bucket × sort-order sweep "
                  f"({target - len(all_films)} more needed)")
            before_phase2 = len(all_films)
            for (year_gte, year_lte) in SWEEP_YEAR_RANGES:
                if len(all_films) >= target: break
                for sort_by in SWEEP_SORTS:
                    if len(all_films) >= target: break
                    pre = len(all_films)
                    for page in range(1, 501):
                        if len(all_films) >= target: break
                        results = fetch_page(client, page, vote_gte=20,
                                             year_gte=year_gte, year_lte=year_lte,
                                             sort_by=sort_by)
                        if not results: break
                        for r in results:
                            add(r)
                        time.sleep(0.03)
                    added = len(all_films) - pre
                    if added > 0:
                        print(f"  {year_gte}-{year_lte}, sort={sort_by}: "
                              f"+{added} (total {len(all_films)})")
            print(f"Year-bucket sweep added {len(all_films) - before_phase2} films")

    CATALOG_PATH.write_text(json.dumps(all_films))
    print(f"\nSaved {len(all_films)} films → {CATALOG_PATH}")


if __name__ == "__main__":
    main()
