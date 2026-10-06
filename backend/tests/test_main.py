"""Backend tests. Run from backend/:  python -m pytest

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

import main  # noqa: E402

VALID_USER = {"email": "Ada@Example.com", "password": "correct-horse-battery", "name": "Ada"}


@pytest.fixture()
def client(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'test.db'}", connect_args={"check_same_thread": False})
    TestingSession = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    main.Base.metadata.create_all(bind=engine)

    def override_get_db():
        db = TestingSession()
        try:
            yield db
        finally:
            db.close()

    main.app.dependency_overrides[main.get_db] = override_get_db
    with TestClient(main.app) as c:
        yield c
    main.app.dependency_overrides.clear()
    engine.dispose()


def register(client, **overrides):
    return client.post("/api/auth/register", json={**VALID_USER, **overrides})


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_register_success(client):
    r = register(client)
    assert r.status_code == 201
    body = r.json()
    assert body["email"] == "ada@example.com"  # stored lowercase
    assert body["name"] == "Ada"
    assert set(body) == {"id", "email", "name"}
    assert main.SESSION_COOKIE in r.cookies  # registering also logs in


def test_register_duplicate_email_returns_409(client):
    register(client)
    r = register(client, email="ADA@example.com")  # case-insensitive duplicate
    assert r.status_code == 409
    assert r.json()["detail"] == "This email is already registered"


@pytest.mark.parametrize(
    "payload",
    [
        {"email": "not-an-email"},
        {"password": "short"},
        {"name": "   "},
    ],
)
def test_register_validation(client, payload):
    assert register(client, **payload).status_code == 422


def test_login_sets_cookie(client):
    register(client)
    client.cookies.clear()
    r = client.post("/api/auth/login", json={"email": "ada@example.com", "password": VALID_USER["password"]})
    assert r.status_code == 200
    assert main.SESSION_COOKIE in r.cookies
    set_cookie = r.headers["set-cookie"].lower()
    assert "httponly" in set_cookie
    assert "samesite=lax" in set_cookie


def test_login_wrong_password_returns_401(client):
    register(client)
    client.cookies.clear()
    r = client.post("/api/auth/login", json={"email": VALID_USER["email"], "password": "wrong-password"})
    assert r.status_code == 401
    assert main.SESSION_COOKIE not in r.cookies


def test_login_unknown_email_same_error_as_wrong_password(client):
    register(client)
    client.cookies.clear()
    wrong_pw = client.post("/api/auth/login", json={"email": VALID_USER["email"], "password": "wrong-password"})
    no_user = client.post("/api/auth/login", json={"email": "nobody@example.com", "password": "wrong-password"})
    assert no_user.status_code == wrong_pw.status_code == 401
    assert no_user.json() == wrong_pw.json()


def test_me_without_cookie_returns_401(client):
    assert client.get("/api/auth/me").status_code == 401


def test_me_with_invalid_cookie_returns_401(client):
    client.cookies.set(main.SESSION_COOKIE, "not-a-jwt")
    assert client.get("/api/auth/me").status_code == 401


def test_me_with_cookie(client):
    register(client)
    r = client.get("/api/auth/me")
    assert r.status_code == 200
    assert r.json()["email"] == "ada@example.com"


def test_logout_clears_cookie(client):
    register(client)
    r = client.post("/api/auth/logout")
    assert r.status_code == 204
    set_cookie = r.headers["set-cookie"]
    assert main.SESSION_COOKIE in set_cookie
    assert "Max-Age=0" in set_cookie or "expires=Thu, 01 Jan 1970" in set_cookie.lower()
    assert main.SESSION_COOKIE not in client.cookies
    assert client.get("/api/auth/me").status_code == 401


def test_password_hash_never_in_responses(client):
    responses = [
        register(client),
        register(client),  # 409
        client.post("/api/auth/login", json={"email": VALID_USER["email"], "password": VALID_USER["password"]}),
        client.post("/api/auth/login", json={"email": VALID_USER["email"], "password": "wrong-password"}),
        client.get("/api/auth/me"),
        client.post("/api/auth/logout"),
    ]
    for r in responses:
        text = r.text
        assert "password_hash" not in text
        assert "$argon2" not in text
        assert VALID_USER["password"] not in text


def test_password_is_hashed_with_argon2id(client):
    register(client)
    db = next(main.app.dependency_overrides[main.get_db]())
    user = db.query(main.User).one()
    assert user.password_hash.startswith("$argon2id$")
    assert user.password_hash != VALID_USER["password"]

VALID_TRIP = {
VALID_TRIP_PLAN = {
    "origin": "Dallas, TX",
    "destination": "Chicago, IL",
    "start_date": "2026-10-10",
    "end_date": "2026-10-12",
    "travelers": 2,
    "budget": 1200,
    "interests": ["food", "museums"],
}


def test_create_trip(client):
    register(client)

    r = client.post("/api/trips", json=VALID_TRIP)

    assert r.status_code == 201

    data = r.json()
    assert data["origin"] == "Dallas, TX"
    assert data["destination"] == "Chicago, IL"
    assert data["start_date"] == "2026-10-10"
    assert data["end_date"] == "2026-10-12"
    assert data["travelers"] == 2
    assert data["budget"] == 1200
    assert data["interests"] == ["food", "museums"]
    assert isinstance(data["id"], int)
    assert "created_at" in data


def test_create_trip_requires_login(client):
    r = client.post("/api/trips", json=VALID_TRIP)

    assert r.status_code == 401


def test_list_trips(client):
    register(client)

    first_trip = {
        **VALID_TRIP,
        "destination": "Chicago, IL",
    }
    second_trip = {
        **VALID_TRIP,
        "destination": "New York, NY",
    }

    client.post("/api/trips", json=first_trip)
    client.post("/api/trips", json=second_trip)

    r = client.get("/api/trips")

    assert r.status_code == 200

    data = r.json()
    assert len(data) == 2
    assert data[0]["destination"] == "New York, NY"
    assert data[1]["destination"] == "Chicago, IL"


def test_list_trips_requires_login(client):
    r = client.get("/api/trips")

    assert r.status_code == 401


def test_get_trip(client):
    register(client)

    created = client.post("/api/trips", json=VALID_TRIP)
    trip_id = created.json()["id"]

    r = client.get(f"/api/trips/{trip_id}")

    assert r.status_code == 200

    data = r.json()
    assert data["id"] == trip_id
    assert data["origin"] == "Dallas, TX"
    assert data["destination"] == "Chicago, IL"
    assert data["interests"] == ["food", "museums"]


def test_get_missing_trip_returns_404(client):
    register(client)

    r = client.get("/api/trips/999999")

    assert r.status_code == 404
    assert r.json()["detail"] == "Trip not found"


def test_get_another_users_trip_returns_404(client):
    # First user creates a trip.
    register(client)
    created = client.post("/api/trips", json=VALID_TRIP)
    trip_id = created.json()["id"]

    # Log out the first user.
    client.post("/api/auth/logout")

    # Register a second user.
    register(client, email="second@example.com")

    # The second user must not be able to access the first user's trip.
    r = client.get(f"/api/trips/{trip_id}")

    assert r.status_code == 404
    assert r.json()["detail"] == "Trip not found"


def test_get_trip_requires_login(client):
    r = client.get("/api/trips/1")

    assert r.status_code == 401


def test_update_trip(client):
    register(client)

    created = client.post("/api/trips", json=VALID_TRIP)
    trip_id = created.json()["id"]

    updated_trip = {
        **VALID_TRIP,
        "destination": "Seattle, WA",
        "travelers": 4,
        "budget": 2000,
        "interests": ["coffee", "museums"],
    }

    r = client.put(f"/api/trips/{trip_id}", json=updated_trip)

    assert r.status_code == 200

    data = r.json()
    assert data["id"] == trip_id
    assert data["destination"] == "Seattle, WA"
    assert data["travelers"] == 4
    assert data["budget"] == 2000
    assert data["interests"] == ["coffee", "museums"]


def test_update_missing_trip_returns_404(client):
    register(client)

    r = client.put("/api/trips/999999", json=VALID_TRIP)

    assert r.status_code == 404
    assert r.json()["detail"] == "Trip not found"


def test_update_another_users_trip_returns_404(client):
    # First user creates a trip.
    register(client)
    created = client.post("/api/trips", json=VALID_TRIP)
    trip_id = created.json()["id"]

    # Switch to a second user.
    client.post("/api/auth/logout")
    register(client, email="second@example.com")

    updated_trip = {
        **VALID_TRIP,
        "destination": "Seattle, WA",
    }

    r = client.put(f"/api/trips/{trip_id}", json=updated_trip)

    assert r.status_code == 404
    assert r.json()["detail"] == "Trip not found"


def test_update_trip_requires_login(client):
    r = client.put("/api/trips/1", json=VALID_TRIP)

    assert r.status_code == 401


def test_delete_trip(client):
    register(client)

    created = client.post("/api/trips", json=VALID_TRIP)
    trip_id = created.json()["id"]

    r = client.delete(f"/api/trips/{trip_id}")

    assert r.status_code == 204
    assert r.content == b""

    # Confirm the trip is actually gone.
    r = client.get(f"/api/trips/{trip_id}")
    assert r.status_code == 404


def test_delete_missing_trip_returns_404(client):
    register(client)

    r = client.delete("/api/trips/999999")

    assert r.status_code == 404
    assert r.json()["detail"] == "Trip not found"


def test_delete_another_users_trip_returns_404(client):
    # First user creates a trip.
    register(client)
    created = client.post("/api/trips", json=VALID_TRIP)
    trip_id = created.json()["id"]

    # Switch to a second user.
    client.post("/api/auth/logout")
    register(client, email="second@example.com")

    r = client.delete(f"/api/trips/{trip_id}")

    assert r.status_code == 404
    assert r.json()["detail"] == "Trip not found"


def test_delete_trip_requires_login(client):
    r = client.delete("/api/trips/1")

    assert r.status_code == 401


def test_create_trip_rejects_bad_dates(client):
    register(client)

    bad_trip = {
        **VALID_TRIP,
        "start_date": "2026-10-12",
        "end_date": "2026-10-10",
    }

    r = client.post("/api/trips", json=bad_trip)

    assert r.status_code == 422


def test_create_trip_rejects_too_few_travelers(client):
    register(client)

    bad_trip = {
        **VALID_TRIP,
        "travelers": 0,
    }

    r = client.post("/api/trips", json=bad_trip)

    assert r.status_code == 422


def test_create_trip_rejects_too_many_travelers(client):
    register(client)

    bad_trip = {
        **VALID_TRIP,
        "travelers": 21,
    }

    r = client.post("/api/trips", json=bad_trip)

    assert r.status_code == 422


def test_create_trip_rejects_negative_budget(client):
    register(client)

    bad_trip = {
        **VALID_TRIP,
        "budget": -1,
    }

    r = client.post("/api/trips", json=bad_trip)

    assert r.status_code == 422


def test_create_trip_rejects_empty_destination(client):
    register(client)

    bad_trip = {
        **VALID_TRIP,
        "destination": "",
    }

    r = client.post("/api/trips", json=bad_trip)

    assert r.status_code == 422


def test_create_trip_rejects_destination_over_120_chars(client):
    register(client)

    bad_trip = {
        **VALID_TRIP,
        "destination": "A" * 121,
    }

    r = client.post("/api/trips", json=bad_trip)

    assert r.status_code == 422
def test_plan_trip_requires_login(client):
    r = client.post("/api/trips/plan", json=VALID_TRIP_PLAN)

    assert r.status_code == 401
    assert r.json()["detail"] == "Not authenticated"

def test_plan_trip_without_api_key_returns_503(client, monkeypatch):
    register(client)

    monkeypatch.setattr(main.settings, "llm_api_key", "")

    r = client.post("/api/trips/plan", json=VALID_TRIP_PLAN)

    assert r.status_code == 503
    assert r.json()["detail"] == {
        "message": "AI planning isn't configured.",
        "retry": False,
    }

class FakeGeminiResponse:
    def __init__(self, text):
        self.text = text
        self.usage_metadata = None

def test_plan_trip_success(client, monkeypatch):
    register(client)

    fake_response = FakeGeminiResponse(
        """
        {
            "destination": "Chicago, IL",
            "currency": "USD",
            "total_estimated_cost": 250.00,
            "days": [
                {
                    "date": "2026-10-10",
                    "activities": [
                        {
                            "start_time": "09:00",
                            "duration_minutes": 120,
                            "name": "Visit the Art Institute",
                            "category": "sightseeing",
                            "location": "Art Institute of Chicago",
                            "description": "Explore the museum.",
                            "estimated_cost": 32.00,
                            "travel_time_to_next_minutes": 15
                        }
                    ]
                }
            ]
        }
        """
    )

    class FakeModels:
        def generate_content(self, **kwargs):
            return fake_response

    class FakeClient:
        models = FakeModels()

    monkeypatch.setattr(main, "get_gemini_client", lambda: FakeClient())
    main.itinerary_cache.clear()

    r = client.post("/api/trips/plan", json=VALID_TRIP_PLAN)

    assert r.status_code == 200
    assert r.json()["destination"] == "Chicago, IL"
    assert r.json()["currency"] == "USD"
    assert r.json()["total_estimated_cost"] == 250.0

def test_plan_trip_gemini_error(client, monkeypatch):
    register(client)

    def fake_generate(_trip):
        raise main.LLMServiceError(
            "The itinerary service is temporarily unavailable. Please retry."
        )

    monkeypatch.setattr(main, "generate_itinerary", fake_generate)

    r = client.post("/api/trips/plan", json=VALID_TRIP_PLAN)

    assert r.status_code == 503
    assert r.json()["detail"] == {
        "message": "The itinerary service is temporarily unavailable. Please retry.",
        "retry": True,
    }

def test_plan_trip_invalid_json(client, monkeypatch):
    register(client)

    fake_response = FakeGeminiResponse("this is not valid JSON")

    class FakeModels:
        def generate_content(self, **kwargs):
            return fake_response

    class FakeClient:
        models = FakeModels()

    monkeypatch.setattr(main, "get_gemini_client", lambda: FakeClient())
    main.itinerary_cache.clear()

    r = client.post("/api/trips/plan", json=VALID_TRIP_PLAN)

    assert r.status_code == 503
    assert r.json()["detail"] == {
        "message": "The itinerary service returned invalid data. Please retry.",
        "retry": True,
    } 
