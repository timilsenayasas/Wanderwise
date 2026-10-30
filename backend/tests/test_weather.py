
"""A11: Tests for the trip weather endpoint."""

from conftest import register
from app.services import weather


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
