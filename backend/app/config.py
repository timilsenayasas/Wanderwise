"""App settings, read from environment variables or backend/.env."""

import hashlib
import logging
from pathlib import Path

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger("wanderwise")

# The backend/ folder. .env, alembic.ini and the SQLite file are resolved from
# here, so the server behaves the same no matter which directory you start it from.
BASE_DIR = Path(__file__).resolve().parent.parent

MIN_JWT_SECRET_LENGTH = 32
# SHA-256 of the JWT secret committed in the repo's first commit (Sep 24). That value
# is public in git history, so it's refused everywhere. Only the hash is kept here.
LEAKED_JWT_SECRET_SHA256 = "79c0da78c5f9a88d4d9fa5e6cd4dff0c04c60ca3b45ea2b5411d8001248bbabf"
NEW_SECRET_HINT = 'Generate one with: python -c "import secrets; print(secrets.token_urlsafe(48))"'


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BASE_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
        # Keep secrets and API keys out of startup error messages and logs.
        hide_input_in_errors=True,
    )

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

    @model_validator(mode="after")
    def check_jwt_secret(self) -> "Settings":
        """Refuse the leaked secret always, and a weak one when deployed (COOKIE_SECURE=true)."""
        if hashlib.sha256(self.jwt_secret.encode()).hexdigest() == LEAKED_JWT_SECRET_SHA256:
            raise ValueError(
                f"JWT_SECRET is the old secret from the repo's git history. Set a new one in backend/.env. {NEW_SECRET_HINT}"
            )
        # The length check also catches the "change-me" default.
        if len(self.jwt_secret) < MIN_JWT_SECRET_LENGTH:
            problem = f"JWT_SECRET is the default 'change-me' or shorter than {MIN_JWT_SECRET_LENGTH} characters."
            if self.cookie_secure:
                raise ValueError(f"{problem} Refusing to start with COOKIE_SECURE=true. {NEW_SECRET_HINT}")
            logger.warning("%s OK for local dev only. %s", problem, NEW_SECRET_HINT)
        return self


settings = Settings()
