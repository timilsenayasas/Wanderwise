
"""A8: Google Routes API integration for trip transportation options."""

import httpx

from app.config import logger, settings
from functools import lru_cache

ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes"
TIMEOUT_SECONDS = 8

SUPPORTED_MODES = ("DRIVE", "WALK")


class RoutesServiceError(Exception):
    """Raised when Google Routes cannot provide a route."""


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

    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": settings.routes_api_key,
        "X-Goog-FieldMask": "routes.duration,routes.distanceMeters",
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
            raise RoutesServiceError("No route found.")

        route = routes[0]
        duration_seconds = float(route["duration"].removesuffix("s"))
        distance_meters = int(route["distanceMeters"])

        return {
            "mode": mode,
            "duration_minutes": round(duration_seconds / 60, 1),
            "distance_km": round(distance_meters / 1000, 2),
        }

    except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
        # Never log the request headers or API key.
        logger.warning(
            "Routes API request failed: %s",
            type(exc).__name__,
        )
        raise RoutesServiceError(
            "Unable to retrieve transportation information."
        ) from exc


def estimate_transport_cost(mode: str, distance_km: float) -> dict:
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

    raise ValueError(f"Unsupported transportation mode: {mode}")
