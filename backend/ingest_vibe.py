"""
Phase 2 ingest — adds the vibe axis (PRD v2 §6.1, Axis 2).

Reads every film from the existing Phase-1 collection, fetches reviews,
runs the vibe pipeline, and writes a NEW collection containing the full
3-axis combined vector [text(768) | vibe(768) | visual(512)] = 2048d.

The Phase-1 collection is left untouched as a fallback. The backend
auto-detects the v2 collection if it exists.

Usage:
    cd backend
    source venv/bin/activate
    # Optional but recommended for proper NER scrubbing:
    pip install spacy
    python -m spacy download en_core_web_lg
    python ingest_vibe.py
    # Resume after interruption: just rerun — it skips already-processed films.

Performance notes:
- ~1–2 seconds per film on CPU once models are loaded (review fetch dominates).
- For 10k films expect ~3–6 hours total. Idempotent — safe to ctrl-C and resume.
"""

from __future__ import annotations
import time
from dotenv import load_dotenv

load_dotenv()

import numpy as np
from fastembed import TextEmbedding
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct

from config import settings
import vibe as vibe_mod


BATCH_LOG = 25  # log every N films


def get_qdrant() -> QdrantClient:
    return QdrantClient(url=settings.qdrant_url)


def ensure_v2_collection(client: QdrantClient):
    existing = {c.name for c in client.get_collections().collections}
    name = settings.qdrant_collection_v2
    expected_dim = settings.embedding_dim_v2

    if name in existing:
        info = client.get_collection(name)
        cur = getattr(info.config.params.vectors, "size", expected_dim)
        if cur != expected_dim:
            print(f"Collection '{name}' has dim={cur}, need {expected_dim}. Recreating...")
            client.delete_collection(name)
        else:
            print(f"Collection '{name}' exists (dim={cur}) — resuming.")
            return
    client.create_collection(
        collection_name=name,
        vectors_config=VectorParams(size=expected_dim, distance=Distance.COSINE),
    )
    print(f"Created '{name}' (dim={expected_dim}).")


def scroll_v1_points(client: QdrantClient):
    """Yield every (id, payload, vector) tuple from the Phase-1 collection."""
    offset = None
    while True:
        result, offset = client.scroll(
            collection_name=settings.qdrant_collection,
            limit=128,
            offset=offset,
            with_payload=True,
            with_vectors=True,
        )
        for p in result:
            yield p.id, p.payload, p.vector
        if offset is None:
            break


def get_v2_processed_ids(client: QdrantClient) -> set[int]:
    if settings.qdrant_collection_v2 not in {c.name for c in client.get_collections().collections}:
        return set()
    out: set[int] = set()
    offset = None
    while True:
        result, offset = client.scroll(
            collection_name=settings.qdrant_collection_v2,
            limit=256,
            offset=offset,
            with_payload=["tmdb_id"],
            with_vectors=False,
        )
        for p in result:
            out.add(p.payload.get("tmdb_id"))
        if offset is None:
            break
    return out


def split_v1_vector(vec: list[float]) -> tuple[list[float], list[float]]:
    """Phase-1 vector layout is [text(text_dim) | visual(visual_dim)]."""
    td = settings.text_dim
    return vec[:td], vec[td : td + settings.visual_dim]


def main():
    print("=== CineGraph Phase 2 (vibe axis) ===\n")
    client = get_qdrant()

    if settings.qdrant_collection not in {c.name for c in client.get_collections().collections}:
        raise SystemExit(
            f"Phase-1 collection '{settings.qdrant_collection}' not found. "
            f"Run `python ingest.py` first."
        )

    ensure_v2_collection(client)

    done = get_v2_processed_ids(client)
    print(f"Already in v2: {len(done)} films.\n")

    print("Loading vibe embedding model...")
    vibe_embedder = TextEmbedding(model_name=settings.vibe_model)
    print(f"  {settings.vibe_model} ({settings.vibe_dim}-d)\n")

    nlp = vibe_mod._load_spacy(settings.spacy_model)
    print(f"NER scrubber: {'spaCy ' + (nlp.meta['name'] if nlp else '(unavailable, regex fallback)')}\n")

    total_count = client.count(settings.qdrant_collection).count
    print(f"Phase-1 collection has {total_count} films. Processing...\n")

    processed = 0
    skipped = 0
    confident = 0
    started = time.time()
    buffer: list[PointStruct] = []
    BUFFER_FLUSH = 32

    for tid, payload, vec in scroll_v1_points(client):
        if tid in done:
            continue

        try:
            reviews = vibe_mod.fetch_tmdb_reviews(
                tid, settings.tmdb_api_key, max_pages=settings.vibe_review_max_pages
            )
        except Exception as e:
            print(f"  [{tid}] review fetch failed: {e}")
            reviews = []

        result = vibe_mod.build_vibe_vector(
            reviews,
            embedder=vibe_embedder,
            vibe_dim=settings.vibe_dim,
            spacy_model=settings.spacy_model,
            chunk_words_max=settings.vibe_chunk_words,
        )

        text_part, visual_part = split_v1_vector(vec)
        combined = text_part + result.vector + visual_part
        assert len(combined) == settings.embedding_dim_v2, \
            f"Bad combined length {len(combined)} != {settings.embedding_dim_v2}"

        new_payload = {
            **payload,
            "vibe_confident": result.confident,
            "vibe_chunks": result.chunk_count,
            "vibe_tokens": result.raw_token_count,
        }
        buffer.append(PointStruct(id=tid, vector=combined, payload=new_payload))

        if result.confident:
            confident += 1
        else:
            skipped += 1
        processed += 1

        if len(buffer) >= BUFFER_FLUSH:
            client.upsert(collection_name=settings.qdrant_collection_v2, points=buffer)
            buffer.clear()

        if processed % BATCH_LOG == 0:
            rate = processed / max(time.time() - started, 1e-6)
            print(f"  {processed} done | {confident} confident | {skipped} sparse | {rate:.2f} films/s")

        # TMDB rate-limit hygiene
        time.sleep(0.04)

    if buffer:
        client.upsert(collection_name=settings.qdrant_collection_v2, points=buffer)

    elapsed = time.time() - started
    final = client.count(settings.qdrant_collection_v2).count
    print(
        f"\n=== Done. Processed {processed} | "
        f"confident {confident} | sparse {skipped} | "
        f"{elapsed/60:.1f} min. "
        f"v2 now has {final} films. ==="
    )


if __name__ == "__main__":
    main()
