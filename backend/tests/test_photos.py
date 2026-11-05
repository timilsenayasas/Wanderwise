
"""B3: Tests for destination photos and Pexels caching."""

from unittest.mock import Mock

from app.config import settings
from app.services import pexels


def fake_pexels_response(photos):
    response = Mock()
    response.raise_for_status.return_value = None
    response.json.return_value = {"photos": photos}
    return response


def test_missing_api_key_returns_null(client, monkeypatch):
    monkeypatch.setattr(settings, "pexels_api_key", "")

    response = client.get("/api/photos", params={"query": "Chicago"})

    assert response.status_code == 200
    assert response.json() == {
        "photo_url": None,
        "photographer": None,
        "photographer_url": None,
    }


def test_photo_is_saved_and_cached(client, monkeypatch):
    monkeypatch.setattr(settings, "pexels_api_key", "test-key")

    calls = []

    def fake_get(url, **kwargs):
        calls.append((url, kwargs))
        return fake_pexels_response([
            {
                "src": {"large": "https://example.com/chicago.jpg"},
                "photographer": "Test Photographer",
                "photographer_url": "https://example.com/photographer",
            }
        ])

    monkeypatch.setattr(pexels.httpx, "get", fake_get)

    first = client.get("/api/photos", params={"query": "Chicago"})
    second = client.get("/api/photos", params={"query": "  CHICAGO  "})

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json() == second.json()
    assert first.json()["photo_url"] == "https://example.com/chicago.jpg"
    assert first.json()["photographer"] == "Test Photographer"
    assert len(calls) == 1
    assert calls[0][0] == pexels.PEXELS_SEARCH_URL
    assert calls[0][1]["headers"]["Authorization"] == "test-key"


def test_no_photo_returns_null(client, monkeypatch):
    monkeypatch.setattr(settings, "pexels_api_key", "test-key")
    monkeypatch.setattr(
        pexels.httpx,
        "get",
        lambda *args, **kwargs: fake_pexels_response([]),
    )

    response = client.get("/api/photos", params={"query": "Unknown Place"})

    assert response.status_code == 200
    assert response.json()["photo_url"] is None


def test_pexels_failure_returns_null(client, monkeypatch):
    import httpx

    monkeypatch.setattr(settings, "pexels_api_key", "test-key")

    def fake_get(*args, **kwargs):
        raise httpx.ConnectError("Simulated connection failure")

    monkeypatch.setattr(pexels.httpx, "get", fake_get)

    response = client.get("/api/photos", params={"query": "Dallas"})

    assert response.status_code == 200
    assert response.json()["photo_url"] is None
