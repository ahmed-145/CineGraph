"""
Letterboxd import endpoints (PRD v2 §5.7, §7.4).

POST /letterboxd/import        upload one or more CSVs → kicks off a background
                               resolve+store job, returns a job id
GET  /letterboxd/import/{job}  poll job progress
GET  /letterboxd/films         the signed-in user's watched films + ratings
DELETE /letterboxd/films       clear the user's imported library
"""

from __future__ import annotations
import asyncio
import uuid

from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from fastapi import BackgroundTasks

import db
import letterboxd as lb
from auth import require_auth

router = APIRouter()

# In-memory job store. Fine for single-instance V1; jobs are short-lived.
_JOBS: dict[str, dict] = {}


async def _store_films(user_id: str, films: list[lb.LbFilm]) -> int:
    """Upsert resolved films into the letterboxd_films table."""
    matched = [f for f in films if f.tmdb_id]
    if not matched:
        return 0
    rows = [{
        "user_id": user_id,
        "tmdb_id": f.tmdb_id,
        "rating": f.rating,
        "watched_date": f.watched_date,
        "rewatch": f.rewatch,
    } for f in matched]
    # Supabase upsert: POST with Prefer: resolution=merge-duplicates
    # db.rest_post does single-row; do a bulk upsert via the REST client.
    await _bulk_upsert("letterboxd_films", rows)
    return len(matched)


async def _bulk_upsert(table: str, rows: list[dict]):
    if not rows or db._client is None:
        return
    headers = {**db._headers(), "Prefer": "resolution=merge-duplicates,return=minimal"}
    # Chunk to keep payloads reasonable
    for i in range(0, len(rows), 500):
        chunk = rows[i:i + 500]
        r = await db._client.post(
            db._url(table) + "?on_conflict=user_id,tmdb_id",
            headers=headers, json=chunk,
        )
        r.raise_for_status()


async def _run_import(job_id: str, user_id: str, csv_texts: list[str]):
    job = _JOBS[job_id]
    try:
        parsed = [lb.parse_letterboxd_csv(t) for t in csv_texts]
        films = lb.merge_csvs(*parsed)
        job["total"] = len(films)
        job["status"] = "resolving"

        def progress(done, total):
            job["resolved"] = done

        await lb.resolve_tmdb_ids(films, concurrency=8, progress_cb=progress)
        job["resolved"] = len(films)
        job["status"] = "storing"

        stored = await _store_films(user_id, films)
        job["matched"] = stored
        job["unmatched"] = len(films) - stored
        job["status"] = "done"
    except Exception as e:
        job["status"] = "error"
        job["error"] = str(e)


@router.post("/letterboxd/import")
async def import_letterboxd(
    background: BackgroundTasks,
    files: list[UploadFile] = File(...),
    user_id: str = Depends(require_auth),
):
    if db._client is None:
        raise HTTPException(503, "Database not configured")
    csv_texts = []
    for f in files:
        content = await f.read()
        try:
            csv_texts.append(content.decode("utf-8"))
        except UnicodeDecodeError:
            csv_texts.append(content.decode("latin-1", errors="ignore"))

    job_id = uuid.uuid4().hex[:12]
    _JOBS[job_id] = {
        "status": "parsing", "total": 0, "resolved": 0,
        "matched": 0, "unmatched": 0, "error": None,
    }
    background.add_task(_run_import, job_id, user_id, csv_texts)
    return {"job_id": job_id}


@router.get("/letterboxd/import/{job_id}")
async def import_status(job_id: str, user_id: str = Depends(require_auth)):
    job = _JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return job


@router.get("/letterboxd/films")
async def list_films(user_id: str = Depends(require_auth)):
    rows = await db.rest_get("letterboxd_films", {
        "user_id": f"eq.{user_id}",
        "select": "tmdb_id,rating,rewatch,watched_date",
        "limit": "5000",
    })
    return rows


@router.delete("/letterboxd/films")
async def clear_films(user_id: str = Depends(require_auth)):
    count = await db.rest_delete("letterboxd_films", {"user_id": f"eq.{user_id}"})
    return {"deleted": count}
