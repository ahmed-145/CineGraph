"""
Letterboxd CSV import (PRD v2 §5.7).

Reads a user's exported CSV (ratings.csv / watched.csv / diary.csv), then
resolves each Letterboxd film URI to a TMDB id by scraping the film page:

  Primary:  <... data-tmdb-id="550" ...>
  Fallback: <a href="https://www.themoviedb.org/movie/550/" data-track-action="TMDb">

For diary.csv the URI points at a diary entry, not the film page, so we
follow the redirect first (httpx follow_redirects handles this).

Letterboxd blocks datacenter IPs (PRD note), so this is designed to run from
the user's own residential connection. Politeness: capped concurrency + a
realistic User-Agent + no retry storms.
"""

from __future__ import annotations
import asyncio
import csv
import io
import re
from dataclasses import dataclass, field

import httpx


UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")

_TMDB_ATTR_RE = re.compile(r'data-tmdb-id="(\d+)"')
_TMDB_HREF_RE = re.compile(r'themoviedb\.org/movie/(\d+)')


@dataclass
class LbFilm:
    name: str
    year: int | None
    uri: str
    rating: float | None = None          # 0.5–5.0
    watched_date: str | None = None      # ISO date
    rewatch: bool = False
    tmdb_id: int | None = None           # filled after scraping


def parse_letterboxd_csv(text: str) -> list[LbFilm]:
    """Parse any of ratings/watched/diary CSV. Column presence varies."""
    reader = csv.DictReader(io.StringIO(text))
    films: list[LbFilm] = []
    for row in reader:
        # Letterboxd headers: Date, Name, Year, Letterboxd URI, Rating,
        # Rewatch, Tags, Watched Date (diary). Be tolerant of missing cols.
        name = (row.get("Name") or "").strip()
        uri = (row.get("Letterboxd URI") or "").strip()
        if not uri:
            continue
        year = None
        try:
            year = int(row["Year"]) if row.get("Year") else None
        except (ValueError, TypeError):
            year = None
        rating = None
        try:
            rating = float(row["Rating"]) if row.get("Rating") else None
        except (ValueError, TypeError):
            rating = None
        watched_date = (row.get("Watched Date") or row.get("Date") or "").strip() or None
        rewatch = (row.get("Rewatch") or "").strip().lower() in ("yes", "true", "1")
        films.append(LbFilm(
            name=name, year=year, uri=uri, rating=rating,
            watched_date=watched_date, rewatch=rewatch,
        ))
    return films


def merge_csvs(*film_lists: list[LbFilm]) -> list[LbFilm]:
    """Merge ratings/watched/diary by URI. ratings wins on rating conflicts
    (PRD §5.7 data-integrity rule); rewatch counts collapse into one entry."""
    by_uri: dict[str, LbFilm] = {}
    for films in film_lists:
        for f in films:
            existing = by_uri.get(f.uri)
            if not existing:
                by_uri[f.uri] = f
                continue
            # Prefer a non-null rating; if both present keep the larger source's.
            if f.rating is not None:
                existing.rating = f.rating
            if f.watched_date and not existing.watched_date:
                existing.watched_date = f.watched_date
            if f.rewatch:
                existing.rewatch = True
    return list(by_uri.values())


async def _scrape_one(client: httpx.AsyncClient, film: LbFilm, sem: asyncio.Semaphore) -> LbFilm:
    async with sem:
        try:
            resp = await client.get(film.uri, follow_redirects=True,
                                    headers={"User-Agent": UA}, timeout=12)
            if resp.status_code != 200:
                return film
            html = resp.text
            m = _TMDB_ATTR_RE.search(html) or _TMDB_HREF_RE.search(html)
            if m:
                film.tmdb_id = int(m.group(1))
        except Exception:
            pass
        return film


async def resolve_tmdb_ids(films: list[LbFilm], concurrency: int = 8,
                           progress_cb=None) -> list[LbFilm]:
    """Scrape every film's URI for its TMDB id, capped concurrency."""
    sem = asyncio.Semaphore(concurrency)
    done = 0
    async with httpx.AsyncClient() as client:
        tasks = [asyncio.ensure_future(_scrape_one(client, f, sem)) for f in films]
        for coro in asyncio.as_completed(tasks):
            await coro
            done += 1
            if progress_cb and done % 25 == 0:
                progress_cb(done, len(films))
    return films
