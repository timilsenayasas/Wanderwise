
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


def test_transport_endpoint_returns_three_modes(monkeypatch):
    """Verify all three travel modes are returned with estimates."""
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
    assert len(result["options"]) == 3

    modes = {option["mode"] for option in result["options"]}
    assert modes == {"DRIVE", "WALK", "TRANSIT"}

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
    assert len(result["options"]) == 3

    for option in result["options"]:
        assert option["available"] is False
        assert option["message"] == "Transportation estimate unavailable."


def test_transit_cost_estimate():
    result = estimate_transport_cost("TRANSIT", 5, 2.50, "USD")

    assert result["estimated_cost_usd"] == 2.50
    assert result["transit_currency"] == "USD"


def test_transit_missing_fare():
    result = estimate_transport_cost("TRANSIT", 5)

    assert result["estimated_cost_usd"] is None
    assert result["cost_basis"] == "Public transit fare unavailable."


def test_transit_foreign_currency():
    result = estimate_transport_cost("TRANSIT", 5, 3.50, "EUR")

    assert result["estimated_cost_usd"] is None
    assert result["transit_fare"] == 3.50
    assert result["transit_currency"] == "EUR"


def test_transit_route_with_fare(monkeypatch):
    from app.services import routes

    class FakeResponse:
        def raise_for_status(self):
            pass

        def json(self):
            return {
                "routes": [{
                    "duration": "1800s",
                    "distanceMeters": 12000,
                    "travelAdvisory": {
                        "transitFare": {
                            "currencyCode": "USD",
                            "units": "2",
                            "nanos": 500000000,
                        }
                    },
                }]
            }

    def fake_post(*args, **kwargs):
        assert kwargs["json"]["travelMode"] == "TRANSIT"
        assert "transitFare" in kwargs["headers"]["X-Goog-FieldMask"]
        return FakeResponse()

    monkeypatch.setattr(routes.httpx, "post", fake_post)
    monkeypatch.setattr(routes.settings, "routes_api_key", "test-key")

    fetch_route.cache_clear()

    try:
        result = fetch_route(
            33.0, -97.0, 33.1, -97.1, "TRANSIT"
        )

        assert result["duration_minutes"] == 30.0
        assert result["distance_km"] == 12.0
        assert result["transit_fare"] == 2.50
        assert result["transit_currency"] == "USD"
    finally:
        fetch_route.cache_clear()


def test_no_transit_route(monkeypatch):
    import pytest
    from app.services import routes

    class FakeResponse:
        def raise_for_status(self):
            pass

        def json(self):
            return {"routes": []}

    monkeypatch.setattr(
        routes.httpx,
        "post",
        lambda *args, **kwargs: FakeResponse(),
    )
    monkeypatch.setattr(routes.settings, "routes_api_key", "test-key")

    fetch_route.cache_clear()

    try:
        with pytest.raises(routes.NoRouteFoundError):
            fetch_route(
                33.0, -97.0, 40.7, -74.0, "TRANSIT"
            )
    finally:
        fetch_route.cache_clear()


def test_getting_there_returns_routes(monkeypatch):
    from types import SimpleNamespace
    from app.routers import transport

    trip = SimpleNamespace(
        origin="Dallas, TX",
        destination="Austin, TX",
    )

    monkeypatch.setattr(
        transport, "get_own_trip",
        lambda *args: trip,
    )
    monkeypatch.setattr(
        transport.settings, "maps_api_key", "test-key"
    )
    monkeypatch.setattr(
        transport, "geocode",
        lambda city: (32.77, -96.79)
        if city == trip.origin else (30.26, -97.74),
    )

    def fake_fetch_route(*args):
        mode = args[-1]

        return {
            "mode": mode,
            "duration_minutes": 180.0,
            "distance_km": 315.0,
            "transit_fare": 25.0 if mode == "TRANSIT" else None,
            "transit_currency": "USD" if mode == "TRANSIT" else None,
        }

    monkeypatch.setattr(
        transport, "fetch_route", fake_fetch_route
    )

    result = transport.get_getting_there(
        trip_id=1, user=object(), db=object()
    )

    assert result["origin"] == "Dallas, TX"
    assert result["destination"] == "Austin, TX"
    assert len(result["options"]) == 2
    assert result["options"][0]["mode"] == "DRIVE"
    assert result["options"][1]["mode"] == "TRANSIT"
    assert result["options"][1]["estimated_cost_usd"] == 25.0


def test_getting_there_no_transit(monkeypatch):
    from types import SimpleNamespace
    from app.routers import transport

    monkeypatch.setattr(
        transport, "get_own_trip",
        lambda *args: SimpleNamespace(
            origin="Dallas, TX",
            destination="Chicago, IL",
        ),
    )
    monkeypatch.setattr(
        transport.settings, "maps_api_key", "test-key"
    )
    monkeypatch.setattr(
        transport, "geocode",
        lambda city: (33.0, -97.0),
    )

    def fake_fetch_route(*args):
        mode = args[-1]

        if mode == "TRANSIT":
            raise transport.NoRouteFoundError("No route found.")

        return {
            "mode": mode,
            "duration_minutes": 900.0,
            "distance_km": 1500.0,
        }

    monkeypatch.setattr(
        transport, "fetch_route", fake_fetch_route
    )

    result = transport.get_getting_there(
        trip_id=1, user=object(), db=object()
    )

    assert result["options"][0]["mode"] == "DRIVE"
    assert result["options"][1]["available"] is False
    assert result["options"][1]["message"] == (
        "No public transit route available."
    )


def test_getting_there_geocoding_failure(monkeypatch):
    from types import SimpleNamespace
    from app.routers import transport

    monkeypatch.setattr(
        transport, "get_own_trip",
        lambda *args: SimpleNamespace(
            origin="Dallas, TX",
            destination="Unknown City",
        ),
    )
    monkeypatch.setattr(
        transport.settings, "maps_api_key", "test-key"
    )
    monkeypatch.setattr(
        transport, "geocode", lambda city: None
    )

    result = transport.get_getting_there(
        trip_id=1, user=object(), db=object()
    )

    assert result["options"] == []
    assert result["message"] == (
        "Could not locate the starting city or destination."
    )
