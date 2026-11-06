
"""A6: Authentication and ownership tests for trip refinement."""

from conftest import register
from copy import deepcopy
from test_plan import FIRST_PLAN, create_trip, use_fake_gemini


def test_refinement_requires_login(client):
    response = client.post(
        "/api/trips/1/plan/refine",
        json={"message": "Make day two cheaper."},
    )

    assert response.status_code == 401


def test_refinement_missing_trip_returns_404(client):
    register(client)

    response = client.post(
        "/api/trips/999999/plan/refine",
        json={"message": "Add more museums."},
    )

    assert response.status_code == 404


def test_refinement_requires_existing_plan(client):
    register(client)
    trip_id = create_trip(client)

    response = client.post(
        f"/api/trips/{trip_id}/plan/refine",
        json={"message": "Make day two cheaper."},
    )

    assert response.status_code == 404
    assert response.json()["detail"] == (
        "This trip does not have a saved itinerary."
    )


def test_refinement_rejects_another_users_trip(client):
    register(client)
    trip_id = create_trip(client)

    client.post("/api/auth/logout")
    register(client, email="second@example.com")

    response = client.post(
        f"/api/trips/{trip_id}/plan/refine",
        json={"message": "Add more museums."},
    )

    assert response.status_code == 404


def test_refinement_rejects_blank_message(client):
    register(client)
    trip_id = create_trip(client)

    response = client.post(
        f"/api/trips/{trip_id}/plan/refine",
        json={"message": "   "},
    )

    assert response.status_code == 422


def test_refinement_updates_saved_plan(client, monkeypatch):
    revised_plan = deepcopy(FIRST_PLAN)
    revised_plan["days"][1]["activities"][1]["name"] = "Free evening walk"
    revised_plan["days"][1]["activities"][1]["estimated_cost"] = 0
    revised_plan["total_estimated_cost"] = 57.0

    prompts = use_fake_gemini(monkeypatch, FIRST_PLAN, revised_plan)

    register(client)
    trip_id = create_trip(client)

    original = client.post(f"/api/trips/{trip_id}/plan")
    assert original.status_code == 200

    response = client.post(
        f"/api/trips/{trip_id}/plan/refine",
        json={"message": "Make day two cheaper."},
    )

    assert response.status_code == 200

    updated = response.json()
    assert updated["days"][1]["activities"][1]["name"] == "Free evening walk"
    assert updated["total_estimated_cost"] == 57.0

    # Unchanged activities should still be present.
    assert updated["days"][0]["activities"][0]["name"] == "Art Institute"

    # The revised itinerary must be saved in the database.
    saved = client.get(f"/api/trips/{trip_id}/plan")
    assert saved.status_code == 200
    assert saved.json() == updated

    # The refinement prompt should contain the user's instruction.
    assert "Make day two cheaper." in prompts[1]


def test_invalid_gemini_response_preserves_original(client, monkeypatch):
    use_fake_gemini(monkeypatch, FIRST_PLAN, "not valid JSON")

    register(client)
    trip_id = create_trip(client)

    original = client.post(f"/api/trips/{trip_id}/plan").json()

    response = client.post(
        f"/api/trips/{trip_id}/plan/refine",
        json={"message": "Add more museums."},
    )

    assert response.status_code == 503
    assert response.json()["detail"]["retry"] is True

    # A failed refinement must not overwrite the existing itinerary.
    saved = client.get(f"/api/trips/{trip_id}/plan")
    assert saved.json() == original


def test_refinement_rejects_changed_dates(client, monkeypatch):
    changed = deepcopy(FIRST_PLAN)
    changed["days"][0]["date"] = "2026-10-15"

    use_fake_gemini(monkeypatch, FIRST_PLAN, changed)

    register(client)
    trip_id = create_trip(client)

    original = client.post(f"/api/trips/{trip_id}/plan").json()

    response = client.post(
        f"/api/trips/{trip_id}/plan/refine",
        json={"message": "Add another activity."},
    )

    assert response.status_code == 503
    assert client.get(f"/api/trips/{trip_id}/plan").json() == original


def test_refinement_rejects_overlapping_activities(client, monkeypatch):
    revised_plan = deepcopy(FIRST_PLAN)

    # The first activity starts at 09:00 and lasts 120 minutes.
    # Starting another activity at 10:00 creates an overlap.
    revised_plan["days"][0]["activities"][1]["start_time"] = "10:00"

    use_fake_gemini(monkeypatch, FIRST_PLAN, revised_plan)

    register(client)
    trip_id = create_trip(client)

    original = client.post(f"/api/trips/{trip_id}/plan").json()

    response = client.post(
        f"/api/trips/{trip_id}/plan/refine",
        json={"message": "Move lunch to 10 AM."},
    )

    assert response.status_code == 503
    assert response.json()["detail"]["retry"] is True

    # The original itinerary must remain unchanged.
    saved = client.get(f"/api/trips/{trip_id}/plan")
    assert saved.json() == original
