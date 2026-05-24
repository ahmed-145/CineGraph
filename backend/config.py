from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    tmdb_api_key: str
    groq_api_key: str = ""
    qdrant_url: str = "http://localhost:6333"
    # Phase-1 collection (text + visual)
    qdrant_collection: str = "films_phase1"
    # Phase-2 collection (text + vibe + visual). Optional — backend falls back
    # to qdrant_collection if this one does not exist.
    qdrant_collection_v2: str = "films_v2"
    # Text embedding (Axis 1: metadata)
    embedding_model: str = "BAAI/bge-base-en-v1.5"
    text_dim: int = 768
    # Vibe embedding (Axis 2: review-derived). Same model family; can be
    # upgraded to bge-large-en-v1.5 by changing model + vibe_dim to 1024.
    vibe_model: str = "BAAI/bge-base-en-v1.5"
    vibe_dim: int = 768
    # Visual embedding (Axis 3: CLIP)
    clip_model: str = "Qdrant/clip-ViT-B-32-vision"
    visual_dim: int = 512
    # Combined dimensions
    embedding_dim: int = 1280     # v1: text + visual
    embedding_dim_v2: int = 2048  # v2: text + vibe + visual
    # NLP / vibe pipeline
    spacy_model: str = "en_core_web_lg"
    vibe_review_max_pages: int = 2
    vibe_chunk_words: int = 380   # ~512 BERT tokens
    llm_model: str = "llama-3.3-70b-versatile"
    # Supabase
    supabase_jwt_secret: str = ""
    supabase_url: str = ""
    supabase_service_key: str = ""

    class Config:
        env_file = ".env"


settings = Settings()
