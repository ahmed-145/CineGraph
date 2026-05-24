import asyncio
import io
import concurrent.futures
from contextlib import asynccontextmanager
from typing import Optional

import httpx
import numpy as np
from PIL import Image
from groq import Groq
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, BackgroundTasks, Query
from fastapi.middleware.cors import CORSMiddleware
from fastembed import TextEmbedding, ImageEmbedding
from pydantic import BaseModel
from qdrant_client import QdrantClient
from qdrant_client.models import Filter, FieldCondition, MatchAny, PointStruct, VectorParams, Distance

load_dotenv()
from config import settings
from ingest import build_film_text, build_payload, fetch_tmdb_metadata, download_poster
import db
import vibe as vibe_mod
from constellations import router as constellations_router


# Active collection — picked at startup. v2 (3-axis) preferred when present;
# falls back to v1 (text+visual only).
ACTIVE_COLLECTION: str | None = None
ACTIVE_DIM: int = settings.embedding_dim
HAS_VIBE: bool = False

TMDB_BASE = "https://api.themoviedb.org/3"

# ── module-level singletons ────────────────────────────────────────────────────
qdrant: QdrantClient = None
groq_client: Groq | None = None
text_model: TextEmbedding | None = None
vibe_model: TextEmbedding | None = None
image_model: ImageEmbedding | None = None
embed_executor = concurrent.futures.ThreadPoolExecutor(max_workers=2)

FILM_INDEX: dict[int, dict] = {}
TITLE_INDEX: dict[str, list[int]] = {}   # lowercase title word → [tmdb_ids]
EXPLAIN_CACHE: dict[tuple, str] = {}
EXPLAIN_CACHE_MAX = 500
qdrant_executor = concurrent.futures.ThreadPoolExecutor(max_workers=8)


# ── startup / shutdown ──────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    global qdrant, groq_client, text_model, image_model, vibe_model, FILM_INDEX
    global ACTIVE_COLLECTION, ACTIVE_DIM, HAS_VIBE

    qdrant = QdrantClient(url=settings.qdrant_url)

    await db.init_pool()

    if settings.groq_api_key:
        groq_client = Groq(api_key=settings.groq_api_key)
        print(f"Groq enabled (model: {settings.llm_model})")
    else:
        print("Groq disabled — /explain will no-op")

    # Pick the most capable collection available
    existing = {c.name for c in qdrant.get_collections().collections}
    if settings.qdrant_collection_v2 in existing:
        ACTIVE_COLLECTION = settings.qdrant_collection_v2
        ACTIVE_DIM = settings.embedding_dim_v2
        HAS_VIBE = True
        print(f"Active collection: {ACTIVE_COLLECTION} (3-axis, {ACTIVE_DIM}-d)")
    else:
        ACTIVE_COLLECTION = settings.qdrant_collection
        ACTIVE_DIM = settings.embedding_dim
        HAS_VIBE = False
        print(f"Active collection: {ACTIVE_COLLECTION} (2-axis, {ACTIVE_DIM}-d)")
        print(f"  (run `python ingest_vibe.py` to enable the vibe axis)")

    print(f"Loading embedding models...")
    text_model = TextEmbedding(model_name=settings.embedding_model)
    image_model = ImageEmbedding(model_name=settings.clip_model)
    if HAS_VIBE:
        vibe_model = TextEmbedding(model_name=settings.vibe_model)
        print(f"  Text: {settings.embedding_model} | Vibe: {settings.vibe_model} | Visual: {settings.clip_model}")
    else:
        print(f"  Text: {settings.embedding_model} | Visual: {settings.clip_model}")

    await _build_film_index()
    print(f"Film index loaded: {len(FILM_INDEX)} films")
    yield
    qdrant.close()
    embed_executor.shutdown(wait=False)
    await db.close_pool()


async def _build_film_index():
    global TITLE_INDEX
    offset = None
    while True:
        result, offset = qdrant.scroll(
            collection_name=ACTIVE_COLLECTION,
            limit=250,
            offset=offset,
            with_payload=True,
            with_vectors=False,
        )
        for point in result:
            payload = point.payload
            tid = payload["tmdb_id"]
            FILM_INDEX[tid] = payload
            for word in payload.get("title", "").lower().split():
                if word not in TITLE_INDEX:
                    TITLE_INDEX[word] = []
                TITLE_INDEX[word].append(tid)
        if offset is None:
            break


app = FastAPI(title="CineGraph", lifespan=lifespan)

app.include_router(constellations_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── schemas ────────────────────────────────────────────────────────────────────
class ExpandRequest(BaseModel):
    tmdb_id: int
    limit: int = 10
    offset: int = 0
    exclude_ids: list[int] = []


class IntersectRequest(BaseModel):
    seed_ids: list[int]
    limit: int = 12
    weights: dict[int, float] = {}
    exclude_ids: list[int] = []


class ExplainRequest(BaseModel):
    film_id: int
    seed_ids: list[int]


# ── helpers ────────────────────────────────────────────────────────────────────
def _make_exclude_filter(exclude_ids: list[int]) -> Optional[Filter]:
    if not exclude_ids:
        return None
    return Filter(must_not=[FieldCondition(key="tmdb_id", match=MatchAny(any=exclude_ids))])


def _payload_to_film(payload: dict, score: float = 0.0, scores: dict = None) -> dict:
    return {
        "tmdb_id": payload.get("tmdb_id"),
        "title": payload.get("title", ""),
        "year": payload.get("year"),
        "poster_path": payload.get("poster_path", ""),
        "overview": payload.get("overview", ""),
        "director": payload.get("director", ""),
        "genres": payload.get("genres", []),
        "cast": payload.get("cast", []),
        "runtime": payload.get("runtime"),
        "vote_average": payload.get("vote_average"),
        "score": score,
        **({"scores": scores} if scores is not None else {}),
    }


def _embed_film_sync(data: dict) -> tuple[list[float], dict]:
    """Generate combined embedding for one film. Layout depends on HAS_VIBE.

    v1 layout: [text(768) | visual(512)] = 1280d
    v2 layout: [text(768) | vibe(768) | visual(512)] = 2048d

    Returns (vector, vibe_payload_extras).
    """
    text = build_film_text(data)
    text_vec = list(text_model.embed([text]))[0].tolist()

    poster_path = data.get("poster_path", "")
    img = download_poster(poster_path) if poster_path else None
    if img is not None:
        visual_vec = list(image_model.embed([img]))[0].tolist()
    else:
        visual_vec = [0.0] * settings.visual_dim

    if HAS_VIBE and vibe_model is not None:
        try:
            reviews = vibe_mod.fetch_tmdb_reviews(
                data["id"], settings.tmdb_api_key,
                max_pages=settings.vibe_review_max_pages,
            )
            result = vibe_mod.build_vibe_vector(
                reviews,
                embedder=vibe_model,
                vibe_dim=settings.vibe_dim,
                spacy_model=settings.spacy_model,
                chunk_words_max=settings.vibe_chunk_words,
            )
            extras = {
                "vibe_confident": result.confident,
                "vibe_chunks": result.chunk_count,
                "vibe_tokens": result.raw_token_count,
            }
            return text_vec + result.vector + visual_vec, extras
        except Exception as e:
            print(f"  vibe build failed for {data.get('id')}: {e}")
            zero_vibe = [0.0] * settings.vibe_dim
            return text_vec + zero_vibe + visual_vec, {"vibe_confident": False}

    return text_vec + visual_vec, {}


# ── routes ─────────────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {
        "status": "ok",
        "film_count": len(FILM_INDEX),
        "collection": ACTIVE_COLLECTION,
        "embedding_dim": ACTIVE_DIM,
        "axes": ["text", "vibe", "visual"] if HAS_VIBE else ["text", "visual"],
    }


@app.get("/search")
async def search(q: str = Query(..., min_length=1), limit: int = 8):
    q_lower = q.lower().strip()
    words = q_lower.split()

    # Fast path via word index — O(hits) not O(10k)
    candidate_ids: set[int] = set()
    for word in words:
        if word in TITLE_INDEX:
            candidate_ids.update(TITLE_INDEX[word])

    if candidate_ids:
        results = [
            _payload_to_film(FILM_INDEX[tid])
            for tid in candidate_ids
            if tid in FILM_INDEX and q_lower in FILM_INDEX[tid].get("title", "").lower()
        ]
    else:
        # Partial-word fallback (e.g. "Incep")
        results = [
            _payload_to_film(film)
            for film in FILM_INDEX.values()
            if q_lower in film.get("title", "").lower()
        ]

    results.sort(key=lambda f: (
        not f["title"].lower().startswith(q_lower),
        f["title"].lower(),
    ))
    local = results[:limit]

    # Fall back to TMDB search for films not yet in the index
    if len(local) < 4:
        tmdb_hits = await _tmdb_search(q, limit)
        local_ids = {f["tmdb_id"] for f in local}
        for film in tmdb_hits:
            if film["tmdb_id"] not in local_ids:
                film["unindexed"] = True
                local.append(film)
                if len(local) >= limit:
                    break

    return local[:limit]


async def _tmdb_search(q: str, limit: int) -> list[dict]:
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{TMDB_BASE}/search/movie",
                params={"api_key": settings.tmdb_api_key, "query": q, "page": 1},
                timeout=5,
            )
        if resp.status_code != 200:
            return []
        return [
            {
                "tmdb_id": r["id"],
                "title": r.get("title", ""),
                "year": int((r.get("release_date") or "0")[:4] or 0),
                "poster_path": r.get("poster_path", ""),
                "overview": r.get("overview", ""),
                "director": "",
                "genres": [],
                "cast": [],
                "runtime": None,
                "vote_average": r.get("vote_average"),
                "score": 0.0,
            }
            for r in resp.json().get("results", [])[:limit]
        ]
    except Exception:
        return []


@app.post("/lazy_embed/{tmdb_id}")
async def lazy_embed(tmdb_id: int):
    """Embed a cold-miss film on demand and add it to the index. Target < 6s."""
    if tmdb_id in FILM_INDEX:
        return {"status": "already_indexed", "film": _payload_to_film(FILM_INDEX[tmdb_id])}

    data = fetch_tmdb_metadata(tmdb_id, settings.tmdb_api_key)
    if not data:
        raise HTTPException(404, f"TMDB film {tmdb_id} not found")

    loop = asyncio.get_event_loop()
    combined_vec, extras = await loop.run_in_executor(embed_executor, _embed_film_sync, data)

    payload = {**build_payload(data), **extras}
    qdrant.upsert(
        collection_name=ACTIVE_COLLECTION,
        points=[PointStruct(id=data["id"], vector=combined_vec, payload=payload)],
    )
    FILM_INDEX[tmdb_id] = payload
    return {"status": "indexed", "film": _payload_to_film(payload)}


@app.post("/expand")
def expand(req: ExpandRequest):
    if req.tmdb_id not in FILM_INDEX:
        raise HTTPException(404, f"Film {req.tmdb_id} not in index")

    blocked = list(set(req.exclude_ids + [req.tmdb_id]))
    results = qdrant.recommend(
        collection_name=ACTIVE_COLLECTION,
        positive=[req.tmdb_id],
        limit=req.limit + req.offset,
        with_payload=True,
        query_filter=_make_exclude_filter(blocked),
    )
    return [_payload_to_film(r.payload, r.score) for r in results[req.offset:]]


@app.post("/intersect")
async def intersect(req: IntersectRequest):
    if len(req.seed_ids) < 2:
        raise HTTPException(400, "Need at least 2 seeds")

    blocked = list(set(req.seed_ids + req.exclude_ids))
    exclude_filter = _make_exclude_filter(blocked)
    valid_seeds = [sid for sid in req.seed_ids if sid in FILM_INDEX]

    loop = asyncio.get_event_loop()

    def _query(seed_id):
        return qdrant.recommend(
            collection_name=ACTIVE_COLLECTION,
            positive=[seed_id],
            limit=50,
            with_payload=True,
            query_filter=exclude_filter,
        )

    all_results = await asyncio.gather(
        *[loop.run_in_executor(qdrant_executor, _query, sid) for sid in valid_seeds]
    )

    candidates: dict[int, dict] = {}
    for seed_id, results in zip(valid_seeds, all_results):
        for r in results:
            tid = r.payload["tmdb_id"]
            if tid not in candidates:
                candidates[tid] = {"payload": r.payload, "scores": {}}
            candidates[tid]["scores"][seed_id] = r.score

    scored = []
    for tid, data in candidates.items():
        weight_sum = sum(req.weights.get(sid, 1.0) for sid in req.seed_ids)
        score = sum(
            req.weights.get(sid, 1.0) * data["scores"].get(sid, 0.0)
            for sid in req.seed_ids
        ) / max(weight_sum, 1e-9)
        scored.append(_payload_to_film(data["payload"], score, data["scores"]))

    scored.sort(key=lambda x: x["score"], reverse=True)
    return scored[: req.limit]


@app.post("/explain")
def explain(req: ExplainRequest):
    if not groq_client:
        return {"explanation": None, "disabled": True}

    cache_key = (req.film_id, tuple(sorted(req.seed_ids)))
    if cache_key in EXPLAIN_CACHE:
        return {"explanation": EXPLAIN_CACHE[cache_key]}

    film = FILM_INDEX.get(req.film_id)
    if not film:
        raise HTTPException(404, f"Film {req.film_id} not in index")
    seeds = [FILM_INDEX[sid] for sid in req.seed_ids if sid in FILM_INDEX]

    seed_lines = "\n".join(
        f"- {s['title']} ({s.get('year','')}): {s.get('overview','')[:120]}"
        for s in seeds
    )
    prompt = (
        f"You are explaining why a film appears in a semantic intersection.\n\n"
        f"Target film: {film['title']} ({film.get('year','')})\n"
        f"Overview: {film.get('overview','')[:200]}\n"
        f"Genres: {', '.join(film.get('genres',[]))}\n"
        f"Director: {film.get('director','')}\n\n"
        f"Seed films:\n{seed_lines}\n\n"
        f"Write ONE sentence (max 25 words) explaining exactly why '{film['title']}' sits at the "
        f"intersection of the seed films. Be specific about shared themes, tone, or style. "
        f"Do not start with 'This film' or 'It'. Respond with only the sentence."
    )

    response = groq_client.chat.completions.create(
        model=settings.llm_model,
        max_tokens=80,
        temperature=0.6,
        messages=[{"role": "user", "content": prompt}],
    )
    explanation = response.choices[0].message.content.strip()
    if len(EXPLAIN_CACHE) >= EXPLAIN_CACHE_MAX:
        del EXPLAIN_CACHE[next(iter(EXPLAIN_CACHE))]
    EXPLAIN_CACHE[cache_key] = explanation
    return {"explanation": explanation}


@app.get("/film/{tmdb_id}")
def get_film(tmdb_id: int):
    film = FILM_INDEX.get(tmdb_id)
    if not film:
        raise HTTPException(404, f"Film {tmdb_id} not found")
    return _payload_to_film(film)


@app.get("/watch_providers/{tmdb_id}")
async def watch_providers(tmdb_id: int):
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{TMDB_BASE}/movie/{tmdb_id}/watch/providers",
                params={"api_key": settings.tmdb_api_key},
                timeout=5,
            )
        if resp.status_code != 200:
            return {"providers": []}
        us = resp.json().get("results", {}).get("US", {})
        # Prefer flatrate (subscription), fall back to rent, then buy
        services = us.get("flatrate") or us.get("rent") or us.get("buy") or []
        return {
            "providers": [
                {"name": p["provider_name"], "logo": p.get("logo_path", "")}
                for p in services[:5]
            ],
            "type": "flatrate" if us.get("flatrate") else ("rent" if us.get("rent") else "buy"),
        }
    except Exception:
        return {"providers": []}
