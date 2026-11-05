
"""A11: Tests for the trip weather endpoint."""

from datetime import date, timedelta

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
    monkeypatch.setattr(weather, "_historical_cache", {})  # no archive answers left over from another test


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
        "seasonal_averages",
        lambda latitude, longitude, travel_dates: {
            travel_date: {
                "date": travel_date,
                "type": "seasonal_average",
                "temperature_max": 27.8,
                "temperature_min": 16.5,
                "unit": "°C",
                "years_used": 5,
                "label": "Historical average (not a forecast)",
            }
            for travel_date in travel_dates
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


def archive_by_year(params):
    """A fake archive answer for any date range: the high is the year's last two digits, the low 10 less."""
    start = date.fromisoformat(params["start_date"])
    end = date.fromisoformat(params["end_date"])
    days = [start + timedelta(days=offset) for offset in range((end - start).days + 1)]
    return {
        "daily": {
            "time": [day.isoformat() for day in days],
            "temperature_2m_max": [day.year % 100 for day in days],
            "temperature_2m_min": [day.year % 100 - 10 for day in days],
        }
    }


def far_trip(client, monkeypatch, start, end, archive=archive_by_year):
    """A trip outside the forecast. Returns (its weather, the archive requests made)."""
    register(client)
    trip_id = client.post("/api/trips", json={**TRIP, "start_date": start, "end_date": end}).json()["id"]
    calls = fake_open_meteo(
        monkeypatch,
        {
            weather.GEOCODING_URL: {"results": [place("Chicago", "Illinois", "United States", "US")]},
            weather.FORECAST_URL: {"daily": {"time": []}},
            weather.HISTORICAL_URL: archive,
        },
    )
    data = client.get(f"/api/trips/{trip_id}/weather").json()
    return data, [params for url, params in calls if url == weather.HISTORICAL_URL]


def test_far_future_days_take_one_archive_call_per_past_year(client, monkeypatch):
    data, archive_calls = far_trip(client, monkeypatch, "2027-06-15", "2027-06-19")

    years = range(date.today().year - 3, date.today().year)
    assert [(call["start_date"], call["end_date"]) for call in archive_calls] == [
        (f"{year}-06-15", f"{year}-06-19") for year in years
    ]
    average = round(sum(year % 100 for year in years) / 3, 1)
    assert [day["date"] for day in data["days"]] == [f"2027-06-{n}" for n in range(15, 20)]
    for day in data["days"]:
        assert day["type"] == "seasonal_average"
        assert day["label"] == "Historical average (not a forecast)"
        assert (day["temperature_max"], day["temperature_min"], day["years_used"]) == (average, average - 10, 3)


def test_february_29_uses_february_28_in_other_years(client, monkeypatch):
    data, archive_calls = far_trip(client, monkeypatch, "2028-02-28", "2028-03-01")

    assert len(archive_calls) == 3
    assert [day["date"] for day in data["days"]] == ["2028-02-28", "2028-02-29", "2028-03-01"]
    assert all(day["type"] == "seasonal_average" and day["years_used"] == 3 for day in data["days"])


def test_a_past_year_without_data_is_left_out_of_the_average(client, monkeypatch):
    failing_year = date.today().year - 1

    def archive(params):
        return None if params["start_date"].startswith(str(failing_year)) else archive_by_year(params)

    data, archive_calls = far_trip(client, monkeypatch, "2027-06-15", "2027-06-16", archive)

    assert len(archive_calls) == 3
    assert all(day["years_used"] == 2 for day in data["days"])


ARCHIVE_ARGS = (41.85, -87.65, "2025-06-15", "2025-06-16")


def test_a_failed_archive_lookup_is_tried_again(monkeypatch):
    answers = iter([None, archive_by_year({"start_date": "2025-06-15", "end_date": "2025-06-16"})])
    calls = fake_open_meteo(monkeypatch, {weather.HISTORICAL_URL: lambda params: next(answers)})

    assert weather.fetch_historical_weather(*ARCHIVE_ARGS) is None
    data = weather.fetch_historical_weather(*ARCHIVE_ARGS)

    assert data["daily"]["time"] == ["2025-06-15", "2025-06-16"]
    assert len(calls) == 2


def test_a_successful_archive_lookup_is_kept(monkeypatch):
    calls = fake_open_meteo(monkeypatch, {weather.HISTORICAL_URL: archive_by_year})

    first = weather.fetch_historical_weather(*ARCHIVE_ARGS)

    assert weather.fetch_historical_weather(*ARCHIVE_ARGS) == first
    assert len(calls) == 1


def test_the_archive_cache_drops_the_oldest_answer_when_full(monkeypatch):
    monkeypatch.setattr(weather, "HISTORICAL_CACHE_SIZE", 2)
    calls = fake_open_meteo(monkeypatch, {weather.HISTORICAL_URL: archive_by_year})
    ranges = [("2025-06-15", "2025-06-15"), ("2025-06-16", "2025-06-16"), ("2025-06-17", "2025-06-17")]

    for start, end in ranges:
        weather.fetch_historical_weather(41.85, -87.65, start, end)
    weather.fetch_historical_weather(41.85, -87.65, *ranges[2])  # still kept
    weather.fetch_historical_weather(41.85, -87.65, *ranges[0])  # dropped: asked again

    assert len(calls) == 4
    assert len(weather._historical_cache) == 2
