"""Shared test setup. Run from backend/:  python -m pytest

Each test gets a fresh temporary SQLite database, so tests never touch
wanderwise.db and don't depend on each other.
"""

import os
import sys
import tempfile
from pathlib import Path

import pytest

# Configure the app for tests *before* importing it.
# Point the app's own engine at a throwaway DB so startup never creates wanderwise.db.
os.environ["DATABASE_URL"] = f"sqlite:///{Path(tempfile.mkdtemp()) / 'startup.db'}"
os.environ["JWT_SECRET"] = "test-secret-not-for-production-use-only"
os.environ["COOKIE_SECURE"] = "false"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app.database import Base, get_db  # noqa: E402
from app.main import app  # noqa: E402

VALID_USER = {"email": "Ada@Example.com", "password": "correct-horse-battery", "name": "Ada"}


@pytest.fixture()
def client(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'test.db'}", connect_args={"check_same_thread": False})
    TestingSession = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    Base.metadata.create_all(bind=engine)

    def override_get_db():
        db = TestingSession()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()
    engine.dispose()


def register(client, **overrides):
    return client.post("/api/auth/register", json={**VALID_USER, **overrides})
