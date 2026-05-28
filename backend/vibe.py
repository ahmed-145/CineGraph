"""
Vibe embedding pipeline (PRD v2 §6.1, Axis 2).

Stages per film:
1. Fetch reviews from cascading sources (TMDB primary; other sources pluggable).
2. NER scrubbing — strip PERSON / WORK_OF_ART / GPE / LOC / ORG entities so
   the model clusters on atmosphere, not on names. Uses spaCy if available,
   regex fallback otherwise.
3. Cinematic stopwords — drop boilerplate film vocabulary that drowns out
   stylistic adjectives.
4. Token chunking — split into ~512-token chunks (PRD limit).
5. Embed each chunk with BGE, mean-pool into one vibe vector per film.

Films with too little review text (fewer than `MIN_TOKENS` after cleaning)
return a zero-vector and `confident=False`, matching the PRD's degraded path.
"""

from __future__ import annotations
import re
from dataclasses import dataclass
from typing import Iterable

import httpx
import numpy as np


TMDB_BASE = "https://api.themoviedb.org/3"
MIN_TOKENS = 80  # Below this the film falls back to metadata-only confidence

# Boilerplate film vocabulary — strip before embedding so the vector reflects
# vibe/atmosphere rather than scaffolding language.
CINEMATIC_STOPWORDS = {
    "film", "films", "movie", "movies", "cinema", "cinematic",
    "director", "directors", "directed", "directing", "direction",
    "cinematography", "cinematographer", "screenplay", "screenwriter",
    "actor", "actress", "actors", "actresses", "acting", "performance",
    "performances", "cast", "casting", "starring", "stars", "lead",
    "supporting", "ensemble",
    "scene", "scenes", "shot", "shots", "frame", "frames", "sequence",
    "sequences", "montage",
    "plot", "story", "storyline", "narrative", "subplot",
    "character", "characters",
    "review", "reviews", "reviewer", "critic", "critics", "criticism",
    "rating", "rated", "score", "thumbs", "stars",
    "watch", "watched", "watching", "viewer", "viewers", "audience",
    "theater", "theaters", "theatre", "screen", "screening", "ticket",
    "box", "office", "gross", "budget", "release", "released", "premiere",
    "oscar", "oscars", "award", "awards", "nominated", "nomination", "won",
    "minute", "minutes", "hour", "hours", "runtime",
    "produce", "produced", "production", "studio", "studios",
    "written", "writer", "writers", "wrote",
    "shot", "filming", "filmed", "feature",
    "masterpiece", "masterful", "brilliant",  # too generic
    "imdb", "tmdb", "rotten", "tomatoes",
}

# Spacy entity labels we want to remove (proper nouns that bias the embedding)
_SCRUB_LABELS = {"PERSON", "ORG", "GPE", "LOC", "WORK_OF_ART", "PRODUCT", "EVENT", "FAC"}

# Lazy-loaded spaCy pipeline. None ⇒ regex fallback.
_nlp = None
_spacy_loaded = False


def _load_spacy(model_name: str):
    """Try once to load spaCy. If it fails we fall back to regex scrubbing."""
    global _nlp, _spacy_loaded
    if _spacy_loaded:
        return _nlp
    _spacy_loaded = True
    try:
        import spacy  # type: ignore
        try:
            _nlp = spacy.load(model_name, disable=["parser", "tagger", "lemmatizer"])
        except OSError:
            # Model not downloaded — try smaller one
            try:
                _nlp = spacy.load("en_core_web_sm", disable=["parser", "tagger", "lemmatizer"])
            except OSError:
                _nlp = None
    except ImportError:
        _nlp = None
    return _nlp


# ── Review sources ──────────────────────────────────────────────────────────


def fetch_tmdb_reviews(tmdb_id: int, api_key: str, max_pages: int = 2,
                       timeout: float = 8.0) -> list[str]:
    """Fetch user reviews from TMDB. Each film has 0–N reviews; we cap pages."""
    out: list[str] = []
    for page in range(1, max_pages + 1):
        try:
            resp = httpx.get(
                f"{TMDB_BASE}/movie/{tmdb_id}/reviews",
                params={"api_key": api_key, "page": page},
                timeout=timeout,
            )
            if resp.status_code != 200:
                break
            results = resp.json().get("results", [])
            if not results:
                break
            for r in results:
                content = (r.get("content") or "").strip()
                if content:
                    out.append(content)
            if len(results) < 20:  # last page
                break
        except Exception:
            break
    return out


# ── Text preprocessing ──────────────────────────────────────────────────────


_PROPER_NOUN_RE = re.compile(r"\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}\b")
_HTML_TAG_RE = re.compile(r"<[^>]+>")
_URL_RE = re.compile(r"https?://\S+")
_MULTISPACE_RE = re.compile(r"\s+")
_NON_LETTER_RE = re.compile(r"[^a-zA-Z\s'-]")


def _regex_scrub(text: str) -> str:
    """Fallback NER scrubber: yank multi-word capitalised sequences."""
    return _PROPER_NOUN_RE.sub(" ", text)


def scrub_entities(text: str, spacy_model: str = "en_core_web_lg") -> str:
    """Remove named entities (people, places, titles) from the text."""
    nlp = _load_spacy(spacy_model)
    if nlp is None:
        return _regex_scrub(text)
    # spaCy has a 1M char hard limit per doc; truncate defensively.
    doc = nlp(text[:900_000])
    keep: list[str] = []
    cursor = 0
    for ent in doc.ents:
        if ent.label_ in _SCRUB_LABELS:
            keep.append(text[cursor:ent.start_char])
            cursor = ent.end_char
    keep.append(text[cursor:])
    return " ".join(keep)


def clean_text(text: str, extra_stopwords: set[str] | None = None) -> str:
    """Strip HTML, URLs, punctuation, stopwords, lowercase, collapse whitespace.

    `extra_stopwords`: additional tokens to drop. Used to apply the TF-IDF
    high-DF blocklist computed across the full review corpus.
    """
    text = _HTML_TAG_RE.sub(" ", text)
    text = _URL_RE.sub(" ", text)
    text = _NON_LETTER_RE.sub(" ", text)
    text = text.lower()
    blocklist = CINEMATIC_STOPWORDS if extra_stopwords is None else (CINEMATIC_STOPWORDS | extra_stopwords)
    tokens = [t for t in text.split() if t and t not in blocklist and len(t) > 1]
    return " ".join(tokens)


def compute_tfidf_blocklist(film_review_iter, df_threshold: float = 0.80,
                            min_doc_count: int = 50,
                            spacy_model: str = "en_core_web_lg") -> set[str]:
    """Pass-1 stage of the TF-IDF pipeline (PRD §6.1 stage 3).

    Given an iterable yielding `(tmdb_id, list_of_reviews)` per film, compute
    document frequency for every token (where a "document" is one film's
    concatenated review text). Returns the set of tokens whose DF exceeds
    `df_threshold` × N — those will be dropped in pass 2 to amplify rare
    stylistic adjectives ("hallucinatory", "cozy", "liminal").

    Only tokens that appear in ≥ `min_doc_count` films are considered for the
    blocklist — prevents accidentally banning long-tail vocabulary that just
    happened to land in a few corpus samples.
    """
    df: dict[str, int] = {}
    n_films = 0
    for tmdb_id, reviews in film_review_iter:
        n_films += 1
        joined = " ".join(r for r in reviews if r)
        if not joined.strip():
            continue
        # Skip NER scrubbing here — DF only needs to find words present in
        # >80% of films, and proper nouns are never that frequent. clean_text
        # alone keeps the pre-pass fast (no per-film spaCy cost).
        cleaned = clean_text(joined)
        unique = set(cleaned.split())
        for t in unique:
            df[t] = df.get(t, 0) + 1
    if n_films == 0:
        return set()
    threshold_count = max(int(n_films * df_threshold), 1)
    return {
        token for token, count in df.items()
        if count >= threshold_count and count >= min_doc_count
    }


def chunk_words(text: str, max_words: int = 380) -> list[str]:
    """Split into chunks of ~max_words words. ~380 words ≈ 512 BERT tokens."""
    words = text.split()
    if not words:
        return []
    return [" ".join(words[i : i + max_words]) for i in range(0, len(words), max_words)]


@dataclass
class VibeResult:
    vector: list[float]
    confident: bool       # False if we had to fall back to a zero vector
    chunk_count: int      # how many text chunks contributed
    raw_token_count: int  # words after cleaning


def build_vibe_vector(
    reviews: Iterable[str],
    embedder,                 # fastembed.TextEmbedding instance
    vibe_dim: int,
    spacy_model: str = "en_core_web_lg",
    chunk_words_max: int = 380,
    tfidf_blocklist: set[str] | None = None,
    min_tokens: int = MIN_TOKENS,
) -> VibeResult:
    """Full pipeline: scrub → clean (with optional TF-IDF blocklist) → chunk → embed → mean-pool."""
    joined = " ".join(r for r in reviews if r)
    if not joined.strip():
        return VibeResult(vector=[0.0] * vibe_dim, confident=False,
                          chunk_count=0, raw_token_count=0)

    scrubbed = scrub_entities(joined, spacy_model)
    cleaned = clean_text(scrubbed, extra_stopwords=tfidf_blocklist)
    token_count = len(cleaned.split())

    if token_count < min_tokens:
        return VibeResult(vector=[0.0] * vibe_dim, confident=False,
                          chunk_count=0, raw_token_count=token_count)

    chunks = chunk_words(cleaned, chunk_words_max)
    if not chunks:
        return VibeResult(vector=[0.0] * vibe_dim, confident=False,
                          chunk_count=0, raw_token_count=token_count)

    chunk_vecs = list(embedder.embed(chunks, batch_size=8))
    pooled = np.mean(np.stack([np.asarray(v) for v in chunk_vecs]), axis=0)
    # L2-normalize so cosine similarity behaves correctly when mixed with the
    # other axes inside the combined vector.
    norm = float(np.linalg.norm(pooled))
    if norm > 0:
        pooled = pooled / norm
    return VibeResult(
        vector=pooled.astype(np.float32).tolist(),
        confident=True,
        chunk_count=len(chunks),
        raw_token_count=token_count,
    )
