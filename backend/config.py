from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    tmdb_api_key: str
    groq_api_key: str = ""
    qdrant_url: str = "http://localhost:6333"
    # Phase-1 collection (text + visual). Suffix encodes the active model
    # family so a model flip uses a fresh collection rather than appending to
    # a mismatched one.
    qdrant_collection: str = "films_phase1"
    qdrant_collection_v2: str = "films_v2"

    # Default models match what's actually ingested. To run the PRD-strict
    # path, set in .env:
    #   EMBEDDING_MODEL=BAAI/bge-large-en-v1.5
    #   TEXT_DIM=1024
    #   VIBE_MODEL=BAAI/bge-large-en-v1.5
    #   VIBE_DIM=1024
    #   QDRANT_COLLECTION=films_phase1_large
    #   QDRANT_COLLECTION_V2=films_v2_large
    # then run ingest.py + ingest_vibe.py --tfidf. The backend auto-detects
    # the active collection so the smaller bge-base collections remain a
    # working fallback.
    embedding_model: str = "BAAI/bge-base-en-v1.5"
    text_dim: int = 768
    vibe_model: str = "BAAI/bge-base-en-v1.5"
    vibe_dim: int = 768
    # Visual embedding (Axis 3: CLIP)
    clip_model: str = "Qdrant/clip-ViT-B-32-vision"
    visual_dim: int = 512

    @property
    def embedding_dim(self) -> int:
        """v1 vector layout: [text | visual]."""
        return self.text_dim + self.visual_dim

    @property
    def embedding_dim_v2(self) -> int:
        """v2 vector layout: [text | vibe | visual] — full PRD 3-axis."""
        return self.text_dim + self.vibe_dim + self.visual_dim
    # NLP / vibe pipeline
    spacy_model: str = "en_core_web_lg"
    vibe_review_max_pages: int = 2
    vibe_chunk_words: int = 380   # ~512 BERT tokens
    vibe_min_tokens: int = 80     # below this a film is "sparse" (metadata-only)
    llm_model: str = "llama-3.3-70b-versatile"
    # Supabase
    supabase_jwt_secret: str = ""
    supabase_url: str = ""
    supabase_service_key: str = ""

    class Config:
        env_file = ".env"


settings = Settings()
