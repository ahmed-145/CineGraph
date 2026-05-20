"""
Phase 1 catalog harvester.
Run once: python catalog_fetch.py
Pulls ~10k films from TMDB sorted by vote_count descending.
Output: films_catalog.json
"""

import json
import time
import httpx
from dotenv import load_dotenv

load_dotenv()
from config import settings

TMDB_BASE = "https://api.themoviedb.org/3"
PAGES = 500  # 500 × 20 = 10,000 films


def fetch_page(client: httpx.Client, page: int) -> list[dict]:
    try:
        resp = client.get(
            f"{TMDB_BASE}/discover/movie",
            params={
                "api_key": settings.tmdb_api_key,
                "sort_by": "vote_count.desc",
                "vote_count.gte": 200,
                "page": page,
            },
            timeout=15,
        )
        if resp.status_code == 200:
            return resp.json().get("results", [])
        print(f"  Page {page}: HTTP {resp.status_code}")
    except Exception as e:
        print(f"  Page {page}: {e}")
    return []


def main():
    print("=== CineGraph Phase 1 — Catalog Fetch ===\n")
    all_films: list[dict] = []
    seen_ids: set[int] = set()

    with httpx.Client() as client:
        for page in range(1, PAGES + 1):
            results = fetch_page(client, page)
            if not results:
                print(f"Empty page {page} — stopping early at {len(all_films)} films.")
                break

            for r in results:
                tid = r.get("id")
                if tid and tid not in seen_ids:
                    seen_ids.add(tid)
                    all_films.append({
                        "tmdb_id": tid,
                        "title": r.get("title", ""),
                    })

            if page % 50 == 0:
                print(f"  Page {page}/{PAGES} — {len(all_films)} films collected")

            time.sleep(0.04)  # ~25 req/s — well under TMDB's soft cap

    out_path = "films_catalog.json"
    with open(out_path, "w") as f:
        json.dump(all_films, f)

    print(f"\nSaved {len(all_films)} films → {out_path}")


if __name__ == "__main__":
    main()
