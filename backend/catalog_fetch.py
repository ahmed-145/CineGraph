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

# Year sweep buckets for the long-tail (PRD §6.5 — festival/awards titles)
SWEEP_YEAR_RANGES = [
    (1900, 1959),   # classic cinema
    (1960, 1979),   # new wave / new hollywood
    (1980, 1994),   # 80s and early 90s
    (1995, 2009),   # 90s + early 2000s
    (2010, 2019),
    (2020, 2026),
]


def fetch_page(client: httpx.Client, page: int, vote_gte: int = 200,
               year_lte: int | None = None, year_gte: int | None = None) -> list[dict]:
    params = {
        "api_key": settings.tmdb_api_key,
        "sort_by": "vote_count.desc",
        "vote_count.gte": vote_gte,
        "page": page,
    }
    if year_lte is not None: params["primary_release_date.lte"] = f"{year_lte}-12-31"
    if year_gte is not None: params["primary_release_date.gte"] = f"{year_gte}-01-01"
    try:
        resp = client.get(f"{TMDB_BASE}/discover/movie", params=params, timeout=15)
        if resp.status_code == 200:
            return resp.json().get("results", [])
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

        # Phase 2 — year-bucket sweep for the long tail (festival / awards
        # films below the popularity threshold). Iterate decades to dodge
        # TMDB's 500-page-per-query limit.
        if len(all_films) < target:
            print(f"\nSwitching to year-bucket sweep for long tail "
                  f"({target - len(all_films)} more needed)")
            for (year_gte, year_lte) in SWEEP_YEAR_RANGES:
                if len(all_films) >= target: break
                for page in range(1, 500):
                    if len(all_films) >= target: break
                    results = fetch_page(client, page, vote_gte=30,
                                         year_gte=year_gte, year_lte=year_lte)
                    if not results: break
                    for r in results:
                        add(r)
                    if page % 50 == 0:
                        print(f"  Year {year_gte}-{year_lte} page {page} — "
                              f"{len(all_films)} films")
                    time.sleep(0.04)

    CATALOG_PATH.write_text(json.dumps(all_films))
    print(f"\nSaved {len(all_films)} films → {CATALOG_PATH}")


if __name__ == "__main__":
    main()
