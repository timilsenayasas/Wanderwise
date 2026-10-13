"""Database engine, sessions, and the declarative Base every model inherits from."""

from pathlib import Path
from typing import Annotated, Generator

from fastapi import Depends
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import BASE_DIR, settings


def _normalize_db_url(url: str) -> str:
    """Anchor relative SQLite paths to backend/ and use psycopg (v3) for postgresql:// URLs."""
    sqlite_prefix = "sqlite:///"
    if url.startswith(sqlite_prefix) and url != "sqlite:///:memory:":
        db_path = Path(url[len(sqlite_prefix):])
        if not db_path.is_absolute():
            url = sqlite_prefix + str(BASE_DIR / db_path)
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://"):]
    return url


DATABASE_URL = _normalize_db_url(settings.database_url)

engine = create_engine(
    DATABASE_URL,
    # SQLite only: allow the connection to be used across FastAPI's worker threads.
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {},
    pool_pre_ping=True,
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency: one DB session per request, always closed."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


DbSession = Annotated[Session, Depends(get_db)]
