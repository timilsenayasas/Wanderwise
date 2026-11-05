
"""Tests for A8 transportation cost estimates and route caching."""

from app.services.routes import estimate_transport_cost, fetch_route


def test_driving_cost_estimate():
    result = estimate_transport_cost("DRIVE", 100)

    assert result["estimated_cost_usd"] == 7.46
    assert "25 MPG" in result["cost_basis"]


def test_walking_cost_estimate():
    result = estimate_transport_cost("WALK", 100)

    assert result["estimated_cost_usd"] == 0.0


def test_unsupported_transport_mode():
    import pytest

    with pytest.raises(ValueError):
        estimate_transport_cost("FLY", 100)


def test_route_caching(monkeypatch):
    """Identical route requests should use the cached response."""
    from app.services import routes

    class FakeResponse:
        def raise_for_status(self):
            pass

        def json(self):
            return {
                "routes": [
                    {
                        "duration": "600s",
                        "distanceMeters": 5000,
                    }
                ]
            }

    calls = []

    def fake_post(*args, **kwargs):
        calls.append((args, kwargs))
        return FakeResponse()

    monkeypatch.setattr(routes.httpx, "post", fake_post)
    monkeypatch.setattr(routes.settings, "routes_api_key", "test-key")

    fetch_route.cache_clear()

    try:
        first = fetch_route(33.0, -97.0, 33.1, -97.1, "DRIVE")
        second = fetch_route(33.0, -97.0, 33.1, -97.1, "DRIVE")

        assert first == second
        assert first["duration_minutes"] == 10.0
        assert first["distance_km"] == 5.0
        assert len(calls) == 1
    finally:
        fetch_route.cache_clear()


def test_routes_api_failure(monkeypatch):
    """A Google Routes API failure should produce a controlled error."""
    import httpx
    import pytest

    from app.services import routes

    def fake_post(*args, **kwargs):
        raise httpx.ConnectError("Simulated connection failure")

    monkeypatch.setattr(routes.httpx, "post", fake_post)
    monkeypatch.setattr(routes.settings, "routes_api_key", "test-key")

    routes.fetch_route.cache_clear()

    try:
        with pytest.raises(routes.RoutesServiceError):
            routes.fetch_route(
                33.0, -97.0,
                33.1, -97.1,
                "DRIVE",
            )
    finally:
        routes.fetch_route.cache_clear()


def test_transport_endpoint_returns_two_modes(monkeypatch):
    """Verify both travel modes are returned with estimates."""
    from app.routers import transport

    def fake_fetch_route(
        origin_lat,
        origin_lng,
        destination_lat,
        destination_lng,
        mode,
    ):
        return {
            "mode": mode,
            "duration_minutes": 10.0 if mode == "DRIVE" else 45.0,
            "distance_km": 5.0,
        }

    monkeypatch.setattr(transport, "fetch_route", fake_fetch_route)

    # Replace the ownership check for this isolated unit test.
    monkeypatch.setattr(
        transport,
        "get_own_trip",
        lambda trip_id, user, db: object(),
    )

    result = transport.get_transport_options(
        trip_id=1,
        origin_lat=33.0,
        origin_lng=-97.0,
        destination_lat=33.1,
        destination_lng=-97.1,
        user=object(),
        db=object(),
    )

    assert result["trip_id"] == 1
    assert len(result["options"]) == 2

    modes = {option["mode"] for option in result["options"]}
    assert modes == {"DRIVE", "WALK"}

    for option in result["options"]:
        assert option["is_estimate"] is True
        assert "estimated_cost_usd" in option
        assert "cost_basis" in option


def test_transport_endpoint_handles_api_failure(monkeypatch):
    """Transport failures should not crash the endpoint."""
    from app.routers import transport
    from app.services.routes import RoutesServiceError

    def fake_fetch_route(*args, **kwargs):
        raise RoutesServiceError("Simulated API failure")

    monkeypatch.setattr(transport, "fetch_route", fake_fetch_route)

    # Simulate a successful trip ownership check.
    monkeypatch.setattr(
        transport,
        "get_own_trip",
        lambda trip_id, user, db: object(),
    )

    result = transport.get_transport_options(
        trip_id=1,
        origin_lat=33.0,
        origin_lng=-97.0,
        destination_lat=33.1,
        destination_lng=-97.1,
        user=object(),
        db=object(),
    )

    assert result["trip_id"] == 1
    assert len(result["options"]) == 2

    for option in result["options"]:
        assert option["available"] is False
        assert option["message"] == "Transportation estimate unavailable."
