"""
Phase 1 ingestion pipeline.
Run: python ingest.py
TMDB metadata → BGE text (768-d) + CLIP visual (512-d) → 1280-d → Qdrant.
Idempotent: skips films already in the collection.
Loads catalog from films_catalog.json if present, falls back to films_seed.py.
"""

import io
import json
import os
import time
import concurrent.futures
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

import httpx
import numpy as np
from PIL import Image
from fastembed import TextEmbedding, ImageEmbedding
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct

from config import settings
from films_seed import SEED_FILMS

TMDB_BASE = "https://api.themoviedb.org/3"
TMDB_IMG = "https://image.tmdb.org/t/p/w185"
POSTER_WORKERS = 12


def get_qdrant() -> QdrantClient:
    return QdrantClient(url=settings.qdrant_url, timeout=120)


def ensure_collection(client: QdrantClient):
    existing_names = {c.name for c in client.get_collections().collections}
    if settings.qdrant_collection in existing_names:
        col_info = client.get_collection(settings.qdrant_collection)
        vectors_config = col_info.config.params.vectors
        # vectors_config may be a VectorParams or a dict of named vectors
        if hasattr(vectors_config, "size"):
            current_dim = vectors_config.size
        else:
            current_dim = settings.embedding_dim  # unknown — assume OK

        if current_dim != settings.embedding_dim:
            print(
                f"Collection '{settings.qdrant_collection}' has dim={current_dim}, "
                f"need {settings.embedding_dim}. Recreating..."
            )
            client.delete_collection(settings.qdrant_collection)
        else:
            print(f"Collection exists (dim={current_dim}): {settings.qdrant_collection}")
            return

    client.create_collection(
        collection_name=settings.qdrant_collection,
        vectors_config=VectorParams(size=settings.embedding_dim, distance=Distance.COSINE),
    )
    print(f"Created collection '{settings.qdrant_collection}' (dim={settings.embedding_dim})")


def get_existing_ids(client: QdrantClient) -> set[int]:
    existing: set[int] = set()
    offset = None
    while True:
        result, offset = client.scroll(
            collection_name=settings.qdrant_collection,
            limit=250,
            offset=offset,
            with_payload=["tmdb_id"],
            with_vectors=False,
        )
        for point in result:
            existing.add(point.payload["tmdb_id"])
        if offset is None:
            break
    return existing


def load_catalog() -> list[dict]:
    catalog_path = Path("films_catalog.json")
    if catalog_path.exists():
        with open(catalog_path) as f:
            catalog = json.load(f)
        print(f"Loaded {len(catalog)} films from films_catalog.json")
        return catalog
    print("films_catalog.json not found — using films_seed.py fallback")
    return SEED_FILMS


def fetch_tmdb_metadata(tmdb_id: int, api_key: str) -> dict | None:
    url = f"{TMDB_BASE}/movie/{tmdb_id}"
    try:
        resp = httpx.get(
            url,
            params={"api_key": api_key, "append_to_response": "credits,keywords"},
            timeout=15,
        )
        if resp.status_code == 200:
            return resp.json()
        print(f"  TMDB {tmdb_id}: HTTP {resp.status_code}")
    except Exception as e:
        print(f"  TMDB {tmdb_id}: {e}")
    return None


def download_poster(poster_path: str) -> Image.Image | None:
    if not poster_path:
        return None
    try:
        resp = httpx.get(TMDB_IMG + poster_path, timeout=10)
        if resp.status_code == 200:
            return Image.open(io.BytesIO(resp.content)).convert("RGB")
    except Exception:
        pass
    return None


def build_film_text(data: dict) -> str:
    title = data.get("title", "")
    year = (data.get("release_date") or "")[:4]
    overview = data.get("overview", "")
    genres = ", ".join(g["name"] for g in data.get("genres", []))
    credits = data.get("credits", {})
    directors = [c["name"] for c in credits.get("crew", []) if c.get("job") == "Director"]
    director = directors[0] if directors else ""
    cast = [c["name"] for c in credits.get("cast", [])[:6]]
    keywords = [k["name"] for k in data.get("keywords", {}).get("keywords", [])[:12]]

    parts = [f"{title} ({year})."]
    if director:
        parts.append(f"Directed by {director}.")
    if cast:
        parts.append(f"Starring {', '.join(cast)}.")
    if genres:
        parts.append(f"Genres: {genres}.")
    if overview:
        parts.append(overview)
    if keywords:
        parts.append(f"Themes: {', '.join(keywords)}.")
    return " ".join(parts)


def build_payload(data: dict) -> dict:
    credits = data.get("credits", {})
    directors = [c["name"] for c in credits.get("crew", []) if c.get("job") == "Director"]
    cast = [c["name"] for c in credits.get("cast", [])[:6]]
    genres = [g["name"] for g in data.get("genres", [])]
    return {
        "tmdb_id": data["id"],
        "title": data.get("title", ""),
        "year": int((data.get("release_date") or "0000")[:4] or 0),
        "overview": data.get("overview", ""),
        "poster_path": data.get("poster_path", ""),
        "genres": genres,
        "director": directors[0] if directors else "",
        "cast": cast,
        "runtime": data.get("runtime"),
        "vote_average": data.get("vote_average"),
        "original_language": data.get("original_language", ""),
    }


def combine_embeddings(text_vec: np.ndarray, visual_vec: np.ndarray | None) -> list[float]:
    text_part = text_vec.tolist()
    visual_part = visual_vec.tolist() if visual_vec is not None else [0.0] * settings.visual_dim
    return text_part + visual_part


BATCH_SIZE = 100  # process in batches to show progress and avoid OOM


def main():
    print("=== CineGraph Phase 1 Ingestion ===\n")

    qdrant = get_qdrant()
    api_key = settings.tmdb_api_key

    ensure_collection(qdrant)
    existing_ids = get_existing_ids(qdrant)
    print(f"Already embedded: {len(existing_ids)} films\n")

    catalog = load_catalog()
    to_process = [f for f in catalog if f["tmdb_id"] not in existing_ids]
    if not to_process:
        count = qdrant.count(settings.qdrant_collection).count
        print(f"All films already embedded. Collection has {count} films.")
        return

    print(f"Need to embed: {len(to_process)} films")
    print(f"\nLoading embedding models...")
    text_model = TextEmbedding(model_name=settings.embedding_model)
    image_model = ImageEmbedding(model_name=settings.clip_model)
    print(f"  Text: {settings.embedding_model} ({settings.text_dim}-d)")
    print(f"  Visual: {settings.clip_model} ({settings.visual_dim}-d)")
    print(f"  Combined: {settings.embedding_dim}-d\n")

    total_inserted = 0
    num_batches = (len(to_process) + BATCH_SIZE - 1) // BATCH_SIZE

    for batch_idx in range(num_batches):
        batch = to_process[batch_idx * BATCH_SIZE : (batch_idx + 1) * BATCH_SIZE]
        print(f"--- Batch {batch_idx + 1}/{num_batches} ({len(batch)} films) ---")

        # 1. Fetch TMDB metadata — parallel (network-bound, was the bottleneck)
        with concurrent.futures.ThreadPoolExecutor(max_workers=16) as mpool:
            results = list(mpool.map(
                lambda f: fetch_tmdb_metadata(f["tmdb_id"], api_key), batch
            ))
        films_data = [d for d in results if d]
        print(f"  Fetched metadata for {len(films_data)}/{len(batch)} films")

        if not films_data:
            continue

        # 2. Text embeddings
        texts = [build_film_text(d) for d in films_data]
        print(f"  Generating text embeddings for {len(texts)} films...")
        text_embeddings = list(text_model.embed(texts, batch_size=16))

        # 3. Download posters concurrently
        print(f"  Downloading posters ({POSTER_WORKERS} concurrent)...")
        poster_paths = [d.get("poster_path", "") for d in films_data]
        with concurrent.futures.ThreadPoolExecutor(max_workers=POSTER_WORKERS) as pool:
            poster_images = list(pool.map(download_poster, poster_paths))
        n_posters = sum(1 for p in poster_images if p is not None)
        print(f"  Downloaded {n_posters}/{len(films_data)} posters")

        # 4. CLIP embeddings (only for films with posters)
        visual_vecs: list[list[float]] = [[0.0] * settings.visual_dim] * len(films_data)
        indexed_images = [(i, img) for i, img in enumerate(poster_images) if img is not None]
        if indexed_images:
            indices = [i for i, _ in indexed_images]
            imgs = [img for _, img in indexed_images]
            print(f"  Generating CLIP embeddings for {len(imgs)} posters...")
            clip_vecs = list(image_model.embed(imgs, batch_size=8))
            for idx, vec in zip(indices, clip_vecs):
                visual_vecs[idx] = vec.tolist()

        # 5. Combine and upsert
        points = []
        for i, data in enumerate(films_data):
            combined = text_embeddings[i].tolist() + visual_vecs[i]
            points.append(
                PointStruct(
                    id=data["id"],
                    vector=combined,
                    payload=build_payload(data),
                )
            )

        qdrant.upsert(collection_name=settings.qdrant_collection, points=points)
        total_inserted += len(points)
        count = qdrant.count(settings.qdrant_collection).count
        print(f"  Upserted {len(points)} points. Collection total: {count}\n")

    print(f"=== Done. Inserted {total_inserted} films. ===")
    final_count = qdrant.count(settings.qdrant_collection).count
    print(f"Collection '{settings.qdrant_collection}' now has {final_count} films.")


if __name__ == "__main__":
    main()
