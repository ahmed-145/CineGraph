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
import argparse
import concurrent.futures
import json
import time
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

import numpy as np
from fastembed import TextEmbedding
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct

from config import settings
import vibe as vibe_mod
import review_sources as rs


BATCH_LOG = 100              # log every N films
REVIEW_FETCH_WORKERS = 16    # parallel TMDB review fetches per batch
BATCH_SIZE = 64              # films per batch — fetch reviews in parallel, embed sequentially
IDF_PATH = Path(__file__).parent / "vibe_idf_blocklist.json"


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


def _all_tmdb_ids(client: QdrantClient) -> list[int]:
    """Scroll v1 collection just for the tmdb_id list (cheap)."""
    ids: list[int] = []
    offset = None
    while True:
        result, offset = client.scroll(
            collection_name=settings.qdrant_collection,
            limit=512,
            offset=offset,
            with_payload=["tmdb_id"],
            with_vectors=False,
        )
        for p in result:
            tid = p.payload.get("tmdb_id")
            if tid is not None:
                ids.append(tid)
        if offset is None:
            break
    return ids


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--tfidf", action="store_true",
        help="Run an extra pass first to compute the TF-IDF high-DF blocklist "
             "(PRD §6.1 stage 3). Saves to vibe_idf_blocklist.json.",
    )
    args = parser.parse_args()

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
    print(f"NER scrubber: {'spaCy ' + (nlp.meta['name'] if nlp else '(unavailable, regex fallback)')}")

    sources = rs.default_sources(settings.tmdb_api_key)
    avail = rs.availability_report(sources)
    print(f"Review sources: {avail}\n")

    # Optional pass-1: TF-IDF blocklist
    blocklist: set[str] = set()
    if args.tfidf:
        if IDF_PATH.exists():
            try:
                blocklist = set(json.loads(IDF_PATH.read_text()))
                print(f"Loaded TF-IDF blocklist from disk: {len(blocklist)} tokens\n")
            except Exception:
                blocklist = set()
        if not blocklist:
            print("Running TF-IDF pre-pass (collecting global document frequency)...")
            all_ids = _all_tmdb_ids(client)
            t0 = time.time()
            def _iter():
                for i, tid in enumerate(all_ids):
                    if i % 250 == 0 and i:
                        elapsed = time.time() - t0
                        print(f"  TF-IDF pass: {i}/{len(all_ids)} "
                              f"({i / max(elapsed,1e-6):.2f} films/s)")
                    yield tid, rs.cascading_reviews(tid, sources)
            blocklist = vibe_mod.compute_tfidf_blocklist(
                _iter(), df_threshold=0.80, min_doc_count=50,
                spacy_model=settings.spacy_model,
            )
            IDF_PATH.write_text(json.dumps(sorted(blocklist), indent=0))
            print(f"  → {len(blocklist)} tokens blocklisted, saved to {IDF_PATH.name}\n")
    elif IDF_PATH.exists():
        # If a previous run computed it, reuse silently
        try:
            blocklist = set(json.loads(IDF_PATH.read_text()))
            print(f"Using existing TF-IDF blocklist: {len(blocklist)} tokens\n")
        except Exception:
            blocklist = set()

    total_count = client.count(settings.qdrant_collection).count
    print(f"Phase-1 collection has {total_count} films. Processing...\n")

    processed = 0
    skipped = 0
    confident = 0
    started = time.time()

    review_pool = concurrent.futures.ThreadPoolExecutor(max_workers=REVIEW_FETCH_WORKERS)

    def _fetch(tid: int) -> list[str]:
        try:
            return rs.cascading_reviews(tid, sources)
        except Exception:
            return []

    def _flush_batch(batch: list[tuple[int, dict, list[float]]]):
        nonlocal processed, confident, skipped
        if not batch:
            return
        # Phase 1: parallel review fetch (I/O-bound — TMDB API)
        future_to_idx = {review_pool.submit(_fetch, tid): i for i, (tid, _, _) in enumerate(batch)}
        reviews_by_idx: dict[int, list[str]] = {}
        for fut in concurrent.futures.as_completed(future_to_idx):
            reviews_by_idx[future_to_idx[fut]] = fut.result()

        # Phase 2: sequential embed + payload assembly (CPU-bound)
        points: list[PointStruct] = []
        for i, (tid, payload, vec) in enumerate(batch):
            reviews = reviews_by_idx.get(i, [])
            result = vibe_mod.build_vibe_vector(
                reviews,
                embedder=vibe_embedder,
                vibe_dim=settings.vibe_dim,
                spacy_model=settings.spacy_model,
                chunk_words_max=settings.vibe_chunk_words,
                tfidf_blocklist=blocklist or None,
            )
            text_part, visual_part = split_v1_vector(vec)
            combined = text_part + result.vector + visual_part
            new_payload = {
                **payload,
                "vibe_confident": result.confident,
                "vibe_chunks": result.chunk_count,
                "vibe_tokens": result.raw_token_count,
            }
            points.append(PointStruct(id=tid, vector=combined, payload=new_payload))
            if result.confident:
                confident += 1
            else:
                skipped += 1
            processed += 1

        # Phase 3: one upsert per batch
        client.upsert(collection_name=settings.qdrant_collection_v2, points=points)

        if processed and (processed // BATCH_LOG) != ((processed - len(batch)) // BATCH_LOG):
            rate = processed / max(time.time() - started, 1e-6)
            eta_min = max(0, (total_count - len(done) - processed)) / max(rate, 1e-6) / 60
            print(f"  {processed} done | {confident} confident | {skipped} sparse | "
                  f"{rate:.2f} films/s | ETA {eta_min:.1f} min")

    batch: list[tuple[int, dict, list[float]]] = []
    for tid, payload, vec in scroll_v1_points(client):
        if tid in done:
            continue
        batch.append((tid, payload, vec))
        if len(batch) >= BATCH_SIZE:
            _flush_batch(batch)
            batch = []
    if batch:
        _flush_batch(batch)

    review_pool.shutdown(wait=False)

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
