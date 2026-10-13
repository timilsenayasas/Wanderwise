"""App settings, read from environment variables or backend/.env."""

import logging
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger("wanderwise")

# The backend/ folder. .env, alembic.ini and the SQLite file are resolved from
# here, so the server behaves the same no matter which directory you start it from.
BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BASE_DIR / ".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = "sqlite:///./wanderwise.db"
    jwt_secret: str = "change-me"
    jwt_expire_minutes: int = 60
    cookie_secure: bool = False
    # Comma-separated list, e.g. "http://localhost:5173,https://wanderwise.app"
    cors_origins: str = "http://localhost:5173"

    # API keys for LLM, maps, and weather integrations.
    llm_api_key: str = ""
    maps_api_key: str = ""
    weather_api_key: str = ""

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()

if settings.jwt_secret == "change-me":
    logger.warning("JWT_SECRET is the default 'change-me'. Set a real secret in backend/.env.")
