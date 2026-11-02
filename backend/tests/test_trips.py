"""F2/F12 trips API: CRUD, ownership, validation."""

from datetime import date

from sqlalchemy import func, select

from app.database import get_db
from app.main import app
from app.models import Activity, CostItem, TripDay
from conftest import register


VALID_TRIP = {
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


def test_delete_trip_removes_saved_plan(client):
    register(client)

    created = client.post("/api/trips", json=VALID_TRIP)
    assert created.status_code == 201
    trip_id = created.json()["id"]

    deleted = client.delete(f"/api/trips/{trip_id}")
    assert deleted.status_code == 204

    # Deleted trips and their plans should no longer be accessible.
    assert client.get(f"/api/trips/{trip_id}").status_code == 404
    assert client.get(f"/api/trips/{trip_id}/plan").status_code == 404


def test_delete_trip_cleans_up_related_records(client):
    register(client)

    created = client.post("/api/trips", json=VALID_TRIP)
    assert created.status_code == 201
    trip_id = created.json()["id"]

    # Use the same test database as the API.
    db = next(app.dependency_overrides[get_db]())

    try:
        day = TripDay(
            trip_id=trip_id,
            day_number=1,
            trip_date=date(2026, 10, 10),
        )

        db.add(day)
        db.flush()

        day_id = day.id

        db.add(
            Activity(
                trip_day_id=day_id,
                name="Museum Visit",
            )
        )

        db.add(
            CostItem(
                trip_id=trip_id,
                category="food",
                amount=50,
                source="user",
            )
        )

        db.commit()

        deleted = client.delete(f"/api/trips/{trip_id}")
        assert deleted.status_code == 204

        # Verify that all related database records are removed.
        assert db.scalar(
            select(func.count())
            .select_from(TripDay)
            .where(TripDay.trip_id == trip_id)
        ) == 0

        assert db.scalar(
            select(func.count())
            .select_from(Activity)
            .where(Activity.trip_day_id == day_id)
        ) == 0

        assert db.scalar(
            select(func.count())
            .select_from(CostItem)
            .where(CostItem.trip_id == trip_id)
        ) == 0

    finally:
        db.close()