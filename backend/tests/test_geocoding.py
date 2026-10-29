"""A12 geocoding: saved plans get map coordinates. Google is faked; no real lookups are made."""

import logging

import httpx
import pytest
from conftest import register
from test_plan import FIRST_PLAN, SECOND_PLAN, activity, create_trip, plan_row_counts, use_fake_gemini

from app.config import settings
from app.services import geocoding

ART = (41.8796, -87.6237)
JAZZ = (41.8902, -87.6262)


def found(lat: float, lng: float) -> dict:
    return {"status": "OK", "results": [{"geometry": {"location": {"lat": lat, "lng": lng}}}]}


def fake_google(monkeypatch, answers: dict) -> list[str]:
    """Geocoding answers each query from `answers` (a body or an exception); anything else has no match.

    Returns the list of queries Google was asked.
    """
    monkeypatch.setattr(settings, "maps_api_key", "test-key")
    asked = []

    def fake_fetch(query):
        asked.append(query)
        answer = answers.get(query, {"status": "ZERO_RESULTS", "results": []})
        if isinstance(answer, Exception):
            raise answer
        return answer

    monkeypatch.setattr(geocoding, "_fetch", fake_fetch)
    return asked


def at(location: str, name: str = "Stop", start: str = "09:00") -> dict:
    return {**activity(name, "sightseeing", 0, start=start), "location": location}


def one_day_plan(*activities) -> dict:
    return {
        "destination": "Chicago, IL",
        "currency": "USD",
        "total_estimated_cost": 0,
        "days": [{"date": "2026-10-10", "activities": list(activities)}],
    }


def coordinates(plan: dict) -> dict[str, tuple]:
    """Activity name -> (latitude, longitude) from a saved-plan response."""
    return {a["name"]: (a["latitude"], a["longitude"]) for day in plan["days"] for a in day["activities"]}


# --- Saving a plan --------------------------------------------------------
def test_saving_a_plan_fills_coordinates(client, monkeypatch):
    use_fake_gemini(monkeypatch, FIRST_PLAN)
    fake_google(
        monkeypatch,
        {
            "Art Institute address, Chicago, IL": found(*ART),
            "Deep-dish lunch address, Chicago, IL": found(41.89, -87.63),
            "Lakefront walk address, Chicago, IL": found(41.88, -87.61),
            "Jazz club address, Chicago, IL": found(*JAZZ),
        },
    )
    register(client)
    trip_id = create_trip(client)

    plan = client.post(f"/api/trips/{trip_id}/plan").json()

    assert coordinates(plan)["Art Institute"] == ART
    assert coordinates(plan)["Jazz club"] == JAZZ
    assert None not in {value for pair in coordinates(plan).values() for value in pair}
    assert client.get(f"/api/trips/{trip_id}/plan").json() == plan  # saved, not just returned


def test_each_location_is_looked_up_once(client, monkeypatch):
    use_fake_gemini(
        monkeypatch,
        one_day_plan(
            at("Navy Pier", "Ferris wheel"),
            at("Willis Tower", "Skydeck", start="12:00"),
            at(" Navy Pier ", "Boat tour", start="15:00"),  # same place, stray spaces
        ),
    )
    asked = fake_google(monkeypatch, {"Navy Pier, Chicago, IL": found(41.8917, -87.6086)})
    register(client)
    trip_id = create_trip(client)

    plan = client.post(f"/api/trips/{trip_id}/plan").json()

    assert sorted(asked) == ["Navy Pier, Chicago, IL", "Willis Tower, Chicago, IL"]
    assert coordinates(plan)["Ferris wheel"] == coordinates(plan)["Boat tour"] == (41.8917, -87.6086)


def test_failed_lookups_leave_only_those_activities_empty(client, monkeypatch):
    use_fake_gemini(monkeypatch, FIRST_PLAN)
    fake_google(
        monkeypatch,
        {
            "Art Institute address, Chicago, IL": httpx.ConnectError("no network"),
            # Deep-dish lunch: no match (ZERO_RESULTS)
            "Lakefront walk address, Chicago, IL": {"status": "REQUEST_DENIED", "error_message": "bad key"},
            "Jazz club address, Chicago, IL": found(*JAZZ),
        },
    )
    register(client)
    trip_id = create_trip(client)

    r = client.post(f"/api/trips/{trip_id}/plan")

    assert r.status_code == 200
    assert coordinates(r.json()) == {
        "Art Institute": (None, None),
        "Deep-dish lunch": (None, None),
        "Lakefront walk": (None, None),
        "Jazz club": JAZZ,
    }
    assert plan_row_counts() == (2, 4, 2)


def test_without_a_key_nothing_is_looked_up(client, monkeypatch):
    use_fake_gemini(monkeypatch, FIRST_PLAN)
    asked = fake_google(monkeypatch, {})
    monkeypatch.setattr(settings, "maps_api_key", "")
    register(client)
    trip_id = create_trip(client)

    r = client.post(f"/api/trips/{trip_id}/plan")

    assert r.status_code == 200
    assert asked == []
    assert set(coordinates(r.json()).values()) == {(None, None)}


def test_regenerate_fills_the_new_activities(client, monkeypatch):
    use_fake_gemini(monkeypatch, FIRST_PLAN, SECOND_PLAN)
    fake_google(
        monkeypatch,
        {
            "Art Institute address, Chicago, IL": found(*ART),
            "Field Museum address, Chicago, IL": found(41.8663, -87.6170),
            "Hot dog stand address, Chicago, IL": found(41.88, -87.64),
        },
    )
    register(client)
    trip_id = create_trip(client)
    client.post(f"/api/trips/{trip_id}/plan")

    plan = client.post(f"/api/trips/{trip_id}/plan").json()

    assert coordinates(plan) == {"Field Museum": (41.8663, -87.6170), "Hot dog stand": (41.88, -87.64)}


def test_another_users_trip_returns_404_without_lookups(client, monkeypatch):
    use_fake_gemini(monkeypatch, FIRST_PLAN)
    register(client)
    trip_id = create_trip(client)
    client.post("/api/auth/logout")
    register(client, email="second@example.com")
    asked = fake_google(monkeypatch, {})

    assert client.post(f"/api/trips/{trip_id}/plan").status_code == 404
    assert asked == []


# --- Which places are looked up -------------------------------------------
@pytest.mark.parametrize(
    ("location", "query"),
    [
        ("Navy Pier", "Navy Pier, Chicago, IL"),
        ("111 S Michigan Ave, Chicago, IL", "111 S Michigan Ave, Chicago, IL"),  # already names the city
        ("Millennium Park, chicago, il", "Millennium Park, chicago, il"),
    ],
)
def test_destination_is_added_to_the_query(location, query):
    assert geocoding.build_query(location, "Chicago, IL") == query


def test_blank_locations_are_skipped(monkeypatch):
    asked = fake_google(monkeypatch, {})
    itinerary = geocoding.ItineraryResponse(**one_day_plan(at("   "), at("Navy Pier")))

    geocoding.locate_activities(itinerary, "Chicago, IL")

    assert asked == ["Navy Pier, Chicago, IL"]


def test_lookups_per_plan_are_capped(monkeypatch):
    asked = fake_google(monkeypatch, {})
    stops = [at(f"Place {n}", start=f"{n % 24:02d}:00") for n in range(geocoding.MAX_LOOKUPS_PER_PLAN + 5)]
    itinerary = geocoding.ItineraryResponse(**one_day_plan(*stops))

    geocoding.locate_activities(itinerary, "Chicago, IL")

    assert len(asked) == geocoding.MAX_LOOKUPS_PER_PLAN


# --- Reading Google's answer ----------------------------------------------
@pytest.mark.parametrize(
    "answer",
    [
        {"status": "ZERO_RESULTS", "results": []},
        {"status": "OVER_QUERY_LIMIT"},
        {"status": "OK", "results": []},
        {"status": "OK", "results": [{"geometry": {}}]},
        ["not", "an", "object"],
        ValueError("not JSON"),
    ],
)
def test_no_usable_answer_gives_none(monkeypatch, answer):
    fake_google(monkeypatch, {"Navy Pier": answer})

    assert geocoding.geocode("Navy Pier") is None


def test_first_match_is_used(monkeypatch):
    body = found(*ART)
    body["results"].append({"geometry": {"location": {"lat": 0, "lng": 0}}})
    fake_google(monkeypatch, {"Art Institute": body})

    assert geocoding.geocode("Art Institute") == ART


def test_failed_request_does_not_log_the_key(monkeypatch, caplog):
    url = "https://maps.googleapis.com/maps/api/geocode/json?address=Navy+Pier&key=test-key"
    error = httpx.HTTPStatusError(
        f"Client error '403 Forbidden' for url '{url}'",
        request=httpx.Request("GET", url),
        response=httpx.Response(403),
    )
    fake_google(monkeypatch, {"Navy Pier": error})

    with caplog.at_level(logging.WARNING, logger="wanderwise"):
        assert geocoding.geocode("Navy Pier") is None

    assert "HTTPStatusError" in caplog.text
    assert "test-key" not in caplog.text
