

import json

from conftest import register
from app.routers import packing as packing_router
from app.services import llm, packing


VALID_TRIP = {
    "origin": "Dallas, TX",
    "destination": "Chicago, IL",
    "start_date": "2026-10-10",
    "end_date": "2026-10-11",
    "travelers": 2,
    "budget": 1200,
    "interests": ["food", "museums"],
}


VALID_PLAN = {
    "destination": "Chicago, IL",
    "currency": "USD",
    "total_estimated_cost": 57.0,
    "days": [
        {
            "date": "2026-10-10",
            "activities": [
                {
                    "start_time": "09:00",
                    "duration_minutes": 120,
                    "name": "Art Institute",
                    "category": "sightseeing",
                    "location": "Chicago",
                    "description": "Visit the museum.",
                    "estimated_cost": 32,
                    "travel_time_to_next_minutes": 15,
                },
                {
                    "start_time": "12:00",
                    "duration_minutes": 60,
                    "name": "Deep-dish lunch",
                    "category": "meal",
                    "location": "Chicago",
                    "description": "Have lunch.",
                    "estimated_cost": 25,
                    "travel_time_to_next_minutes": 0,
                },
            ],
        },
        {
            "date": "2026-10-11",
            "activities": [
                {
                    "start_time": "10:00",
                    "duration_minutes": 60,
                    "name": "Lakefront walk",
                    "category": "nature",
                    "location": "Chicago",
                    "description": "Walk along the lake.",
                    "estimated_cost": 0,
                    "travel_time_to_next_minutes": 0,
                }
            ],
        },
    ],
}


WEATHER = {
    "destination": "Chicago, IL",
    "days": [
        {
            "date": "2026-10-10",
            "type": "forecast",
            "temperature_max": 20,
            "temperature_min": 10,
            "precipitation_probability": 40,
        }
    ],
}


PACKING_LIST = {
    "trip_id": 1,
    "destination": "Chicago, IL",
    "sections": {
        "clothing": ["Comfortable walking shoes", "Jacket"],
        "weather_essentials": ["Umbrella"],
        "activity_gear": ["Camera"],
        "personal_essentials": ["Passport"],
    },
}


class FakeGeminiResponse:
    def __init__(self, text):
        self.text = text
        self.usage_metadata = None


def use_fake_gemini(monkeypatch):
    """Fake Gemini so itinerary generation never uses the real API."""

    class FakeModels:
        def generate_content(self, **kwargs):
            return FakeGeminiResponse(json.dumps(VALID_PLAN))

    class FakeClient:
        models = FakeModels()

    monkeypatch.setattr(llm, "get_gemini_client", lambda: FakeClient())
    llm.itinerary_cache.clear()


def create_trip(client):
    response = client.post("/api/trips", json=VALID_TRIP)
    assert response.status_code == 201
    return response.json()["id"]


def create_trip_with_plan(client, monkeypatch):
    """Create a trip and save a fake itinerary."""
    use_fake_gemini(monkeypatch)

    trip_id = create_trip(client)

    response = client.post(f"/api/trips/{trip_id}/plan")
    assert response.status_code == 200

    return trip_id




def test_packing_list_requires_login(client):
    response = client.post("/api/trips/1/packing-list")

    assert response.status_code == 401


def test_packing_list_rejects_another_users_trip(client, monkeypatch):
    register(client)
    trip_id = create_trip(client)

    client.post("/api/auth/logout")
    register(client, email="second@example.com")

    response = client.post(f"/api/trips/{trip_id}/packing-list")

    assert response.status_code == 404




def test_packing_list_requires_a_saved_plan(client):
    register(client)
    trip_id = create_trip(client)

    response = client.post(f"/api/trips/{trip_id}/packing-list")

    assert response.status_code == 404
    assert "Generate a trip itinerary" in response.json()["detail"]


def test_packing_list_requires_weather(client, monkeypatch):
    register(client)
    trip_id = create_trip_with_plan(client, monkeypatch)

    monkeypatch.setattr(
        packing_router,
        "get_trip_weather",
        lambda trip_id, user, db: {"days": []},
    )

    response = client.post(f"/api/trips/{trip_id}/packing-list")

    assert response.status_code == 503
    assert "Weather information is unavailable" in response.json()["detail"]


def test_packing_list_rejects_unavailable_weather(client, monkeypatch):
    register(client)
    trip_id = create_trip_with_plan(client, monkeypatch)

    monkeypatch.setattr(
        packing_router,
        "get_trip_weather",
        lambda trip_id, user, db: {
            "days": [{"type": "unavailable"}]
        },
    )

    response = client.post(f"/api/trips/{trip_id}/packing-list")

    assert response.status_code == 503




def test_packing_list_uses_saved_activities_and_weather(client, monkeypatch):
    register(client)
    trip_id = create_trip_with_plan(client, monkeypatch)

    monkeypatch.setattr(
        packing_router,
        "get_trip_weather",
        lambda trip_id, user, db: WEATHER,
    )

    captured = {}

    def fake_generate(trip_id, destination, weather, activities):
        captured["trip_id"] = trip_id
        captured["destination"] = destination
        captured["weather"] = weather
        captured["activities"] = activities

        return {
            **PACKING_LIST,
            "trip_id": trip_id,
        }

    monkeypatch.setattr(
        packing,
        "generate_packing_list",
        fake_generate,
    )

    response = client.post(f"/api/trips/{trip_id}/packing-list")

    assert response.status_code == 200

    data = response.json()

    assert data["trip_id"] == trip_id
    assert data["destination"] == "Chicago, IL"
    assert data["sections"]["clothing"] == [
        "Comfortable walking shoes",
        "Jacket",
    ]

    assert captured["trip_id"] == trip_id
    assert captured["destination"] == "Chicago, IL"
    assert captured["weather"] == WEATHER["days"]
    assert captured["activities"] == ["meal", "nature", "sightseeing"]



def test_gemini_service_error_returns_503(client, monkeypatch):
    register(client)
    trip_id = create_trip_with_plan(client, monkeypatch)

    monkeypatch.setattr(
        packing_router,
        "get_trip_weather",
        lambda trip_id, user, db: WEATHER,
    )

    def fake_generate(*args, **kwargs):
        raise llm.LLMServiceError(
            "The packing list service is temporarily unavailable. Please retry."
        )

    monkeypatch.setattr(
        packing,
        "generate_packing_list",
        fake_generate,
    )

    response = client.post(f"/api/trips/{trip_id}/packing-list")

    assert response.status_code == 503
    assert response.json()["detail"]["retry"] is True




def test_packing_prompt_includes_trip_information():
    prompt = packing.build_packing_prompt(
        "Chicago, IL",
        WEATHER["days"],
        ["sightseeing", "nature"],
    )

    assert "Chicago, IL" in prompt
    assert "sightseeing" in prompt
    assert "nature" in prompt
    assert "temperature_max" in prompt
    assert "clothing" in prompt
    assert "weather_essentials" in prompt
    assert "activity_gear" in prompt
    assert "personal_essentials" in prompt


def test_packing_prompt_uses_general_sightseeing_when_no_activities():
    prompt = packing.build_packing_prompt(
        "Chicago, IL",
        WEATHER["days"],
        [],
    )

    assert "General sightseeing" in prompt
