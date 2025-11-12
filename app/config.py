from __future__ import annotations
import os
from functools import lru_cache
from pydantic_settings import BaseSettings
from pydantic import Field

class Settings(BaseSettings):
    # App
    app_name: str = Field(default="Scribbit Backend")
    environment: str = Field(default=os.getenv("ENVIRONMENT", "dev"))

    # OpenAI
    openai_api_key: str | None = Field(default=os.getenv("OPENAI_API_KEY"))
    openai_model: str = Field(default=os.getenv("OPENAI_MODEL", "gpt-4o-mini"))

    # Limits
    max_input_chars: int = 200_000

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        case_sensitive = False

@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()

settings = get_settings()
