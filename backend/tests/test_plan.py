"""F3 AI plan endpoint, with Gemini faked so no API key is needed."""

from conftest import register

from app.config import settings
from app.services import llm

VALID_TRIP_PLAN = {
    "origin": "Dallas, TX",
    "destination": "Chicago, IL",
    "start_date": "2026-10-10",
    "end_date": "2026-10-12",
    "travelers": 2,
    "budget": 1200,
    "interests": ["food", "museums"],
}


def test_plan_trip_requires_login(client):
    r = client.post("/api/trips/plan", json=VALID_TRIP_PLAN)

    assert r.status_code == 401
    assert r.json()["detail"] == "Not authenticated"

def test_plan_trip_without_api_key_returns_503(client, monkeypatch):
    register(client)

    monkeypatch.setattr(settings, "llm_api_key", "")

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

    monkeypatch.setattr(llm, "get_gemini_client", lambda: FakeClient())
    llm.itinerary_cache.clear()

    r = client.post("/api/trips/plan", json=VALID_TRIP_PLAN)

    assert r.status_code == 200
    assert r.json()["destination"] == "Chicago, IL"
    assert r.json()["currency"] == "USD"
    assert r.json()["total_estimated_cost"] == 250.0

def test_plan_trip_gemini_error(client, monkeypatch):
    register(client)

    def fake_generate(_trip):
        raise llm.LLMServiceError(
            "The itinerary service is temporarily unavailable. Please retry."
        )

    monkeypatch.setattr(llm, "generate_itinerary", fake_generate)

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

    monkeypatch.setattr(llm, "get_gemini_client", lambda: FakeClient())
    llm.itinerary_cache.clear()

    r = client.post("/api/trips/plan", json=VALID_TRIP_PLAN)

    assert r.status_code == 503
    assert r.json()["detail"] == {
        "message": "The itinerary service returned invalid data. Please retry.",
        "retry": True,
    } 
