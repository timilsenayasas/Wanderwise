
"""A11: Tests for the trip weather endpoint."""

import httpx
import pytest

from conftest import register
from app.services import weather


@pytest.fixture(autouse=True)
def no_real_open_meteo(monkeypatch):
    """Tests never call Open-Meteo: a request that isn't faked fails the test."""

    def refuse(*args, **kwargs):
        raise AssertionError("A test tried to call the real Open-Meteo API.")

    monkeypatch.setattr(weather.httpx, "get", refuse)


class FakeResponse:
    def __init__(self, body):
        self.body = body

    def raise_for_status(self):
        if self.body is None:
            raise httpx.HTTPStatusError("failed", request=None, response=None)

    def json(self):
        return self.body


def fake_open_meteo(monkeypatch, answers):
    """Answer Open-Meteo by URL (a body, None for a failure, or a function of the params).

    Returns the list of (url, params) requests made.
    """
    calls = []

    def get(url, params=None, timeout=None):
        calls.append((url, params))
        answer = answers[url]
        return FakeResponse(answer(params) if callable(answer) else answer)

    monkeypatch.setattr(weather.httpx, "get", get)
    return calls


def place(name, admin1, country, country_code, latitude=41.85, longitude=-87.65):
    """A geocoding result as Open-Meteo gives it."""
    return {
        "name": name,
        "latitude": latitude,
        "longitude": longitude,
        "admin1": admin1,
        "country": country,
        "country_code": country_code,
    }


TRIP = {
    "origin": "Dallas, TX",
    "destination": "Chicago, IL",
    "start_date": "2026-10-30",
    "end_date": "2026-10-31",
    "travelers": 2,
    "budget": 1200,
    "interests": ["food", "museums"],
}


def test_weather_requires_login(client):
    response = client.get("/api/trips/1/weather")
    assert response.status_code == 401


def test_weather_rejects_another_users_trip(client):
    register(client)
    trip_id = client.post("/api/trips", json=TRIP).json()["id"]

    client.post("/api/auth/logout")
    register(client, email="second@example.com")

    response = client.get(f"/api/trips/{trip_id}/weather")
    assert response.status_code == 404


def test_weather_returns_forecast(client, monkeypatch):
    register(client)
    trip_id = client.post("/api/trips", json=TRIP).json()["id"]

    monkeypatch.setattr(
        weather,
        "find_destination",
        lambda destination: {
            "latitude": 41.85,
            "longitude": -87.65,
        },
    )

    monkeypatch.setattr(
        weather,
        "fetch_forecast",
        lambda latitude, longitude: {
            "daily": {
                "time": ["2026-10-30", "2026-10-31"],
                "temperature_2m_max": [20, 21],
                "temperature_2m_min": [10, 11],
                "precipitation_probability_max": [30, 40],
                "weather_code": [1, 3],
            }
        },
    )

    response = client.get(f"/api/trips/{trip_id}/weather")

    assert response.status_code == 200

    data = response.json()

    assert data["destination"] == "Chicago, IL"
    assert len(data["days"]) == 2
    assert data["days"][0]["type"] == "forecast"
    assert data["days"][0]["temperature_max"] == 20
    assert data["days"][1]["temperature_min"] == 11
    assert "Open-Meteo" in data["attribution"]


def test_weather_returns_seasonal_average(client, monkeypatch):
    register(client)

    future_trip = {
        **TRIP,
        "start_date": "2027-06-15",
        "end_date": "2027-06-15",
    }

    trip_id = client.post("/api/trips", json=future_trip).json()["id"]

    monkeypatch.setattr(
        weather,
        "find_destination",
        lambda destination: {
            "latitude": 41.85,
            "longitude": -87.65,
        },
    )

    monkeypatch.setattr(
        weather,
        "fetch_forecast",
        lambda latitude, longitude: {"daily": {"time": []}},
    )

    monkeypatch.setattr(
        weather,
        "seasonal_average",
        lambda latitude, longitude, travel_date: {
            "date": travel_date,
            "type": "seasonal_average",
            "temperature_max": 27.8,
            "temperature_min": 16.5,
            "unit": "°C",
            "years_used": 5,
            "label": "Historical average (not a forecast)",
        },
    )

    response = client.get(f"/api/trips/{trip_id}/weather")

    assert response.status_code == 200

    day = response.json()["days"][0]

    assert day["type"] == "seasonal_average"
    assert day["temperature_max"] == 27.8
    assert day["years_used"] == 5
    assert day["label"] == "Historical average (not a forecast)"


def test_weather_unavailable_does_not_crash(client, monkeypatch):
    register(client)

    trip_id = client.post("/api/trips", json=TRIP).json()["id"]

    # Simulate Open-Meteo being unavailable.
    monkeypatch.setattr(
        weather,
        "find_destination",
        lambda destination: None,
    )

    response = client.get(f"/api/trips/{trip_id}/weather")

    assert response.status_code == 200

    data = response.json()

    assert data["days"] == []
    assert data["message"] == "Weather information is unavailable."

    # The trip itself must still be accessible.
    trip_response = client.get(f"/api/trips/{trip_id}")

    assert trip_response.status_code == 200


def test_city_and_state_destination_is_found(client, monkeypatch):
    """"Chicago, IL" is searched as "Chicago" (the search only matches place names)."""
    register(client)
    trip_id = client.post("/api/trips", json=TRIP).json()["id"]
    calls = fake_open_meteo(
        monkeypatch,
        {
            weather.GEOCODING_URL: {"results": [place("Chicago", "Illinois", "United States", "US")]},
            weather.FORECAST_URL: {
                "daily": {
                    "time": ["2026-10-30", "2026-10-31"],
                    "temperature_2m_max": [20, 21],
                    "temperature_2m_min": [10, 11],
                    "precipitation_probability_max": [30, None],
                    "weather_code": [1, 3],
                }
            },
        },
    )

    data = client.get(f"/api/trips/{trip_id}/weather").json()

    assert calls[0] == (weather.GEOCODING_URL, {"name": "Chicago", "count": 5})
    assert "message" not in data
    assert [day["date"] for day in data["days"]] == ["2026-10-30", "2026-10-31"]
    assert data["days"][1]["precipitation_probability"] is None


SPRINGFIELDS = [
    place("Springfield", "Missouri", "United States", "US"),
    place("Springfield", "Illinois", "United States", "US"),
]


@pytest.mark.parametrize(
    "destination, admin1",
    [
        ("Springfield, IL", "Illinois"),
        ("Springfield, illinois", "Illinois"),
        ("Springfield, IL, USA", "Illinois"),
        ("Springfield", "Missouri"),  # nothing to choose by: the first result
        ("Springfield, Narnia", "Missouri"),  # no match: the first result
    ],
)
def test_the_rest_of_the_destination_picks_the_result(monkeypatch, destination, admin1):
    fake_open_meteo(monkeypatch, {weather.GEOCODING_URL: {"results": SPRINGFIELDS}})

    assert weather.find_destination(destination)["admin1"] == admin1


def test_a_country_or_country_code_picks_the_result(monkeypatch):
    results = [place("Paris", "Texas", "United States", "US"), place("Paris", "Île-de-France", "France", "FR")]
    fake_open_meteo(monkeypatch, {weather.GEOCODING_URL: {"results": results}})

    assert weather.find_destination("Paris, France")["country_code"] == "FR"
    assert weather.find_destination("Paris, fr")["country_code"] == "FR"


def test_no_geocoding_results_is_no_destination(monkeypatch):
    fake_open_meteo(monkeypatch, {weather.GEOCODING_URL: {}})  # Open-Meteo leaves "results" out

    assert weather.find_destination("Nowhere, ZZ") is None
