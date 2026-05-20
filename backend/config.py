from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    tmdb_api_key: str
    groq_api_key: str = ""
    qdrant_url: str = "http://localhost:6333"
    qdrant_collection: str = "films_phase1"
    # Text embedding (BGE)
    embedding_model: str = "BAAI/bge-base-en-v1.5"
    text_dim: int = 768
    # Visual embedding (CLIP)
    clip_model: str = "Qdrant/clip-ViT-B-32-vision"
    visual_dim: int = 512
    # Combined dimension stored in Qdrant
    embedding_dim: int = 1280  # text_dim + visual_dim
    llm_model: str = "llama-3.3-70b-versatile"
    # Supabase
    supabase_jwt_secret: str = ""
    supabase_url: str = ""
    supabase_service_key: str = ""

    class Config:
        env_file = ".env"


settings = Settings()
