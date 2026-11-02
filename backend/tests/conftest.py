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
# Ignore any real key in backend/.env, so tests never make billed Geocoding calls.
os.environ["MAPS_API_KEY"] = ""
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app.database import Base, get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.rate_limit import login_limiter  # noqa: E402
from app.services import geocoding, places  # noqa: E402

VALID_USER = {"email": "Ada@Example.com", "password": "correct-horse-battery", "name": "Ada"}


@pytest.fixture(autouse=True)
def no_real_geocoding(monkeypatch):
    """A test that reaches Google fails. Tests that need lookups swap in a fake _fetch."""

    def refuse(query):
        # pytest.fail, not assert: geocode() swallows ordinary exceptions, but not this one.
        pytest.fail(f"Test tried to call the real Geocoding API for {query!r}")

    monkeypatch.setattr(geocoding, "_fetch", refuse)


@pytest.fixture(autouse=True)
def no_real_places(monkeypatch):
    """A test that reaches Google Places fails. Tests that need hotels swap in a fake _fetch."""

    def refuse(method, url, **kwargs):
        # pytest.fail, not assert: the places service swallows ordinary exceptions, but not this one.
        pytest.fail(f"Test tried to call the real Places API: {method} {url}")

    monkeypatch.setattr(places, "_fetch", refuse)


@pytest.fixture(autouse=True)
def fresh_login_limiter():
    """Failed-login counts are kept in memory, so clear them between tests."""
    login_limiter.reset()
    yield
    login_limiter.reset()


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
