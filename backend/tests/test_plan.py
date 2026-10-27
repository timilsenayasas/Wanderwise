"""F3/A1 trip plan: generate, save, reload, replace. Gemini is faked so no API key is needed."""

import json

from conftest import register
from sqlalchemy import func, select

from app.config import settings
from app.database import get_db
from app.main import app
from app.models import Activity, CostItem, TripDay
from app.plans import duration_minutes, end_time
from app.services import llm

VALID_TRIP = {
    "origin": "Dallas, TX",
    "destination": "Chicago, IL",
    "start_date": "2026-10-10",
    "end_date": "2026-10-11",
    "travelers": 2,
    "budget": 1200,
    "interests": ["food", "museums"],
}


def activity(name, category, cost, start="09:00", minutes=60, travel=0):
    return {
        "start_time": start,
        "duration_minutes": minutes,
        "name": name,
        "category": category,
        "location": f"{name} address",
        "description": f"About {name}.",
        "estimated_cost": cost,
        "travel_time_to_next_minutes": travel,
    }


FIRST_PLAN = {
    "destination": "Chicago, IL",
    "currency": "USD",
    "total_estimated_cost": 97.0,
    "days": [
        {
            "date": "2026-10-10",
            "activities": [
                activity("Art Institute", "sightseeing", 32, start="9:00", minutes=120, travel=15),
                activity("Deep-dish lunch", "meal", 25, start="12:00"),
            ],
        },
        {
            "date": "2026-10-11",
            "activities": [
                activity("Lakefront walk", "nature", 0, start="10:00"),
                activity("Jazz club", "Meal", 40, start="23:00", minutes=120),
            ],
        },
    ],
}

SECOND_PLAN = {
    "destination": "Chicago, IL",
    "currency": "USD",
    "total_estimated_cost": 30.0,
    "days": [
        {"date": "2026-10-10", "activities": [activity("Field Museum", "sightseeing", 30)]},
        {"date": "2026-10-11", "activities": [activity("Hot dog stand", "meal", 0)]},
    ],
}


class FakeGeminiResponse:
    def __init__(self, text):
        self.text = text
        self.usage_metadata = None


def use_fake_gemini(monkeypatch, *responses):
    """Gemini returns these plans (dicts) or raw strings in order. Returns the prompts it received."""
    remaining = iter(responses)
    prompts = []

    class FakeModels:
        def generate_content(self, **kwargs):
            prompts.append(kwargs["contents"])
            response = next(remaining)
            text = response if isinstance(response, str) else json.dumps(response)
            return FakeGeminiResponse(text)

    class FakeClient:
        models = FakeModels()

    monkeypatch.setattr(llm, "get_gemini_client", lambda: FakeClient())
    llm.itinerary_cache.clear()
    return prompts


def count_rows(model) -> int:
    db = next(app.dependency_overrides[get_db]())
    try:
        return db.scalar(select(func.count()).select_from(model))
    finally:
        db.close()


def plan_row_counts() -> tuple[int, int, int]:
    return count_rows(TripDay), count_rows(Activity), count_rows(CostItem)


def create_trip(client, **overrides) -> int:
    return client.post("/api/trips", json={**VALID_TRIP, **overrides}).json()["id"]


def add_user_line(trip_id: int, category="lodging", amount=300.0, trip_date=None) -> None:
    """A traveler's own cost line, written straight to the database."""
    db = next(app.dependency_overrides[get_db]())
    try:
        db.add(CostItem(trip_id=trip_id, source="user", category=category, amount=amount, trip_date=trip_date))
        db.commit()
    finally:
        db.close()


# --- Access ---------------------------------------------------------------
def test_plan_requires_login(client):
    assert client.get("/api/trips/1/plan").status_code == 401
    assert client.post("/api/trips/1/plan").status_code == 401


def test_another_users_plan_returns_404(client, monkeypatch):
    use_fake_gemini(monkeypatch, FIRST_PLAN)
    register(client)
    trip_id = create_trip(client)
    client.post(f"/api/trips/{trip_id}/plan")

    client.post("/api/auth/logout")
    register(client, email="second@example.com")

    assert client.get(f"/api/trips/{trip_id}/plan").status_code == 404
    assert client.post(f"/api/trips/{trip_id}/plan").status_code == 404
    assert plan_row_counts() == (2, 4, 2)  # first user's plan untouched


def test_missing_trip_returns_404(client):
    register(client)

    assert client.get("/api/trips/999/plan").status_code == 404


# --- Save and reload ------------------------------------------------------
def test_new_trip_has_no_plan(client):
    register(client)
    trip_id = create_trip(client)

    r = client.get(f"/api/trips/{trip_id}/plan")

    assert r.status_code == 200
    assert r.json() is None


def test_generate_saves_the_plan(client, monkeypatch):
    use_fake_gemini(monkeypatch, FIRST_PLAN)
    register(client)
    trip_id = create_trip(client)

    r = client.post(f"/api/trips/{trip_id}/plan")

    assert r.status_code == 200
    plan = r.json()
    assert plan["trip_id"] == trip_id
    assert plan["currency"] == "USD"
    assert [day["day_number"] for day in plan["days"]] == [1, 2]
    assert [day["date"] for day in plan["days"]] == ["2026-10-10", "2026-10-11"]

    museum = plan["days"][0]["activities"][0]
    assert museum["name"] == "Art Institute"
    assert museum["start_time"] == "09:00"  # "9:00" normalised
    assert museum["end_time"] == "11:00"
    assert museum["duration_minutes"] == 120
    assert museum["travel_time_to_next_minutes"] == 15
    assert museum["location"] == "Art Institute address"
    assert museum["latitude"] is None and museum["longitude"] is None

    jazz = plan["days"][1]["activities"][1]
    assert jazz["end_time"] == "01:00"  # wraps past midnight
    assert jazz["duration_minutes"] == 120

    assert plan_row_counts() == (2, 4, 2)


def test_saved_plan_is_returned_after_reload(client, monkeypatch):
    use_fake_gemini(monkeypatch, FIRST_PLAN)
    register(client)
    trip_id = create_trip(client)
    generated = client.post(f"/api/trips/{trip_id}/plan").json()

    r = client.get(f"/api/trips/{trip_id}/plan")

    assert r.status_code == 200
    assert r.json() == generated


def test_cost_items_match_the_plan(client, monkeypatch):
    use_fake_gemini(monkeypatch, FIRST_PLAN)
    register(client)
    trip_id = create_trip(client)

    plan = client.post(f"/api/trips/{trip_id}/plan").json()

    lines = {item["category"]: (item["amount"], item["description"]) for item in plan["cost_items"]}
    # "meal" and "Meal" -> food; sightseeing and the $0 nature walk -> activities.
    assert lines == {"activities": (32.0, "2 activities"), "food": (65.0, "2 activities")}
    assert {item["source"] for item in plan["cost_items"]} == {"plan"}
    assert plan["total_estimated_cost"] == 97.0


def test_prompt_asks_for_costs_for_the_whole_group(client, monkeypatch):
    prompts = use_fake_gemini(monkeypatch, FIRST_PLAN)
    register(client)
    trip_id = create_trip(client)

    client.post(f"/api/trips/{trip_id}/plan")

    assert "estimated_cost is the total for all travelers, not per person." in prompts[0]


# --- Replace --------------------------------------------------------------
def test_regenerate_replaces_the_plan(client, monkeypatch):
    prompts = use_fake_gemini(monkeypatch, FIRST_PLAN, SECOND_PLAN)
    register(client)
    trip_id = create_trip(client)
    client.post(f"/api/trips/{trip_id}/plan")

    r = client.post(f"/api/trips/{trip_id}/plan")

    assert r.status_code == 200
    assert len(prompts) == 2  # asked Gemini again instead of reusing the cached plan
    names = [a["name"] for day in r.json()["days"] for a in day["activities"]]
    assert names == ["Field Museum", "Hot dog stand"]
    assert plan_row_counts() == (2, 2, 1)
    assert client.get(f"/api/trips/{trip_id}/plan").json() == r.json()


def test_regenerate_keeps_user_cost_lines(client, monkeypatch):
    use_fake_gemini(monkeypatch, FIRST_PLAN, SECOND_PLAN)
    register(client)
    trip_id = create_trip(client)
    client.post(f"/api/trips/{trip_id}/plan")
    add_user_line(trip_id)

    plan = client.post(f"/api/trips/{trip_id}/plan").json()

    lines = [(item["source"], item["amount"]) for item in plan["cost_items"]]
    assert sorted(lines) == [("plan", 30.0), ("user", 300.0)]  # old plan lines gone, user line kept
    assert count_rows(CostItem) == 2


def test_plans_for_two_trips_are_kept_apart(client, monkeypatch):
    use_fake_gemini(monkeypatch, FIRST_PLAN, SECOND_PLAN)
    register(client)
    first = create_trip(client)
    second = create_trip(client, destination="Milwaukee, WI")
    client.post(f"/api/trips/{first}/plan")
    client.post(f"/api/trips/{second}/plan")

    assert len(client.get(f"/api/trips/{first}/plan").json()["days"][0]["activities"]) == 2
    assert len(client.get(f"/api/trips/{second}/plan").json()["days"][0]["activities"]) == 1


def test_gemini_error_keeps_the_old_plan(client, monkeypatch):
    use_fake_gemini(monkeypatch, FIRST_PLAN, "this is not valid JSON")
    register(client)
    trip_id = create_trip(client)
    saved = client.post(f"/api/trips/{trip_id}/plan").json()

    r = client.post(f"/api/trips/{trip_id}/plan")

    assert r.status_code == 503
    assert r.json()["detail"] == {
        "message": "The itinerary service returned invalid data. Please retry.",
        "retry": True,
    }
    assert client.get(f"/api/trips/{trip_id}/plan").json() == saved


def test_deleting_a_trip_deletes_its_plan_and_cost_lines(client, monkeypatch):
    use_fake_gemini(monkeypatch, FIRST_PLAN)
    register(client)
    trip_id = create_trip(client)
    client.post(f"/api/trips/{trip_id}/plan")
    add_user_line(trip_id)

    client.delete(f"/api/trips/{trip_id}")

    assert plan_row_counts() == (0, 0, 0)


# --- Errors ---------------------------------------------------------------
def test_trip_without_budget_or_interests_returns_422(client, monkeypatch):
    prompts = use_fake_gemini(monkeypatch)
    register(client)
    trip_id = create_trip(client, budget=None, interests=[])

    r = client.post(f"/api/trips/{trip_id}/plan")

    assert r.status_code == 422
    assert r.json()["detail"] == "Add a budget and at least one interest to this trip to generate a plan."
    assert prompts == []


def test_without_api_key_returns_503(client, monkeypatch):
    register(client)
    trip_id = create_trip(client)
    monkeypatch.setattr(settings, "llm_api_key", "")
    llm.itinerary_cache.clear()

    r = client.post(f"/api/trips/{trip_id}/plan")

    assert r.status_code == 503
    assert r.json()["detail"] == {
        "message": "AI planning isn't configured.",
        "retry": False,
    }


def test_gemini_service_error_returns_503(client, monkeypatch):
    register(client)
    trip_id = create_trip(client)

    def fake_generate(_trip, use_cache=True):
        raise llm.LLMServiceError("The itinerary service is temporarily unavailable. Please retry.")

    monkeypatch.setattr(llm, "generate_itinerary", fake_generate)

    r = client.post(f"/api/trips/{trip_id}/plan")

    assert r.status_code == 503
    assert r.json()["detail"]["retry"] is True
    assert plan_row_counts() == (0, 0, 0)


def test_bad_start_time_is_rejected(client, monkeypatch):
    bad_plan = {
        **SECOND_PLAN,
        "days": [{"date": "2026-10-10", "activities": [activity("Brunch", "meal", 20, start="9am")]}],
    }
    use_fake_gemini(monkeypatch, bad_plan)
    register(client)
    trip_id = create_trip(client)

    r = client.post(f"/api/trips/{trip_id}/plan")

    assert r.status_code == 503
    assert r.json()["detail"]["message"] == "The itinerary service returned an invalid itinerary. Please retry."
    assert plan_row_counts() == (0, 0, 0)


# --- Time helpers ---------------------------------------------------------

def test_end_time_and_duration_round_trip():
    assert end_time("22:30", 120) == "00:30"
    assert duration_minutes("22:30", "00:30") == 120
    assert duration_minutes("08:00", "08:00") == 24 * 60


# --- A5: Prevent repeated activities ----------------------------------------

def test_duplicate_attractions_are_detected():
    """The same attraction on different days should be detected."""

    duplicate_plan = {
        **FIRST_PLAN,
        "days": [
            {
                "date": "2026-10-10",
                "activities": [
                    activity("Art Institute", "sightseeing", 32),
                ],
            },
            {
                "date": "2026-10-11",
                "activities": [
                    activity("Art Institute", "sightseeing", 32),
                ],
            },
        ],
    }

    itinerary = llm.ItineraryResponse.model_validate(duplicate_plan)
    duplicates = llm.find_duplicate_activities(itinerary)

    assert duplicates == ["Art Institute"]


def test_repeated_meals_and_transportation_are_allowed():
    """Meals and transportation can repeat across itinerary days."""

    repeated_plan = {
        **FIRST_PLAN,
        "days": [
            {
                "date": "2026-10-10",
                "activities": [
                    activity("Breakfast", "meal", 15),
                    activity("Airport transfer", "transportation", 30),
                ],
            },
            {
                "date": "2026-10-11",
                "activities": [
                    activity("Breakfast", "Meal", 15),
                    activity("Airport transfer", "Transportation", 30),
                ],
            },
        ],
    }

    itinerary = llm.ItineraryResponse.model_validate(repeated_plan)
    duplicates = llm.find_duplicate_activities(itinerary)

    assert duplicates == []


def test_duplicate_itinerary_is_rejected_before_saving(client, monkeypatch):
    """Repeated attractions should prevent an itinerary from being saved."""

    duplicate_plan = {
        **FIRST_PLAN,
        "days": [
            {
                "date": "2026-10-10",
                "activities": [
                    activity("Art Institute", "sightseeing", 32),
                ],
            },
            {
                "date": "2026-10-11",
                "activities": [
                    activity("Art Institute", "sightseeing", 32),
                ],
            },
        ],
    }

    use_fake_gemini(monkeypatch, duplicate_plan, duplicate_plan)

    register(client)
    trip_id = create_trip(client)

    response = client.post(f"/api/trips/{trip_id}/plan")

    assert response.status_code == 503
    assert response.json()["detail"]["message"] == (
        "The generated itinerary contains repeated attractions. Please regenerate."
    )

    assert plan_row_counts() == (0, 0, 0)
    assert llm.itinerary_cache == {}


def test_duplicate_itinerary_succeeds_after_retry(client, monkeypatch):
    """A valid second Gemini response should be saved successfully."""

    duplicate_plan = {
        **FIRST_PLAN,
        "days": [
            {
                "date": "2026-10-10",
                "activities": [
                    activity("Art Institute", "sightseeing", 32),
                ],
            },
            {
                "date": "2026-10-11",
                "activities": [
                    activity("Art Institute", "sightseeing", 32),
                ],
            },
        ],
    }

    prompts = use_fake_gemini(monkeypatch, duplicate_plan, FIRST_PLAN)

    register(client)
    trip_id = create_trip(client)

    response = client.post(f"/api/trips/{trip_id}/plan")

    assert response.status_code == 200
    assert len(prompts) == 2
    assert "Art Institute" in prompts[1]
    assert plan_row_counts() == (2, 4, 2)