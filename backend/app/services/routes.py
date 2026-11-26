
"""A8/A22: Google Routes API integration for trip transportation options."""

import httpx

from app.config import logger, settings
from functools import lru_cache

ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes"
TIMEOUT_SECONDS = 8

SUPPORTED_MODES = ("DRIVE", "WALK","TRANSIT")


class RoutesServiceError(Exception):
    """Raised when Google Routes cannot provide a route."""


class NoRouteFoundError(RoutesServiceError):
    """Raised when no route exists for the requested mode."""


@lru_cache(maxsize=256)
def fetch_route(
    origin_lat: float,
    origin_lng: float,
    destination_lat: float,
    destination_lng: float,
    mode: str,
) -> dict:
    """Fetch distance and travel duration for one transportation mode."""

    if mode not in SUPPORTED_MODES:
        raise ValueError(f"Unsupported transportation mode: {mode}")

    if not settings.routes_api_key:
        raise RoutesServiceError("Routes API is not configured.")

    payload = {
        "origin": {
            "location": {
                "latLng": {
                    "latitude": origin_lat,
                    "longitude": origin_lng,
                }
            }
        },
        "destination": {
            "location": {
                "latLng": {
                    "latitude": destination_lat,
                    "longitude": destination_lng,
                }
            }
        },
        "travelMode": mode,
        "computeAlternativeRoutes": False,
        "languageCode": "en-US",
        "units": "METRIC",
    }

    field_mask = "routes.duration,routes.distanceMeters"

    if mode == "TRANSIT":
            field_mask += ",routes.travelAdvisory.transitFare"

    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": settings.routes_api_key,
        "X-Goog-FieldMask": field_mask,
    }

    try:
        response = httpx.post(
            ROUTES_URL,
            json=payload,
            headers=headers,
            timeout=TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        data = response.json()

        routes = data.get("routes", [])
        if not routes:
            raise NoRouteFoundError("No route found.")

        route = routes[0]
        duration_seconds = float(route["duration"].removesuffix("s"))
        distance_meters = int(route["distanceMeters"])

        result = {
            "mode": mode,
            "duration_minutes": round(duration_seconds / 60, 1),
            "distance_km": round(distance_meters / 1000, 2),
        }

        if mode == "TRANSIT":
            fare = route.get("travelAdvisory", {}).get("transitFare")

            result["transit_fare"] = None
            result["transit_currency"] = None

            if fare and fare.get("currencyCode"):
                units = int(fare.get("units", 0))
                nanos = int(fare.get("nanos", 0))

                result["transit_fare"] = round(
                    units + nanos / 1_000_000_000, 2
                )
                result["transit_currency"] = fare["currencyCode"]

        return result

    except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
        # Never log the request headers or API key.
        logger.warning(
            "Routes API request failed: %s",
            type(exc).__name__,
        )
        raise RoutesServiceError(
            "Unable to retrieve transportation information."
        ) from exc


def estimate_transport_cost(
    mode: str,
    distance_km: float,
    transit_fare: float | None = None,
    transit_currency: str | None = None,
) -> dict:
    """Estimate transportation costs using simple assumptions."""

    if mode == "WALK":
        return {
            "estimated_cost_usd": 0.0,
            "cost_basis": "Walking has no transportation fare.",
        }

    if mode == "DRIVE":
        # Assumptions: 25 miles per gallon and $3.00 per gallon.
        distance_miles = distance_km * 0.621371
        gallons_used = distance_miles / 25
        estimated_cost = round(gallons_used * 3.00, 2)

        return {
            "estimated_cost_usd": estimated_cost,
            "cost_basis": (
                "Estimated fuel cost using 25 MPG and $3.00 per gallon. "
                "Excludes parking, tolls, and vehicle expenses."
            ),
        }

    if mode == "TRANSIT":
        if transit_fare is None or not transit_currency:
            return {
                "estimated_cost_usd": None,
                "cost_basis": "Public transit fare unavailable.",
            }

        return {
            "estimated_cost_usd": (
                transit_fare if transit_currency == "USD" else None
            ),
            "transit_fare": transit_fare,
            "transit_currency": transit_currency,
            "cost_basis": "Public transit fare provided by Google Routes.",
        }

    raise ValueError(f"Unsupported transportation mode: {mode}")
