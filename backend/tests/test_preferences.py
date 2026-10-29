"""F1 profile preferences API."""

from conftest import register


def test_preferences_get_and_put(client):
    register(client)

    # No preferences saved yet — should return empty defaults
    r = client.get("/api/me/preferences")
    assert r.status_code == 200
    assert r.json() == {
        "id": 0,
        "user_id": 1,
        "home_city": "",
        "interests": [],
        "default_budget": None,
        "travel_style": "",
    }

    # Save preferences
    preferences = {
        "home_city": "Fort Worth",
        "interests": ["food", "sightseeing"],
        "default_budget": 1500.0,
        "travel_style": "relaxed",
    }

    r = client.put("/api/me/preferences", json=preferences)
    assert r.status_code == 200
    assert r.json() == {
        "id": 1,
        "user_id": 1,
        **preferences,
    }

    # GET should now return the saved preferences
    r = client.get("/api/me/preferences")
    assert r.status_code == 200
    assert r.json() == {
        "id": 1,
        "user_id": 1,
        **preferences,
    }
