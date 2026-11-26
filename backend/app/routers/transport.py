
"""A8/A22: Compare driving, walking, and public transit between two locations.."""

from fastapi import APIRouter, Query

from app.database import DbSession
from app.routers.trips import get_own_trip
from app.security import CurrentUser
from app.config import settings
from app.services.geocoding import geocode
from app.services.routes import (
    NoRouteFoundError,
    RoutesServiceError,
    estimate_transport_cost,
    fetch_route,
)

router = APIRouter(prefix="/api/trips", tags=["transport"])


@router.get("/{trip_id}/transport")
def get_transport_options(
    trip_id: int,
    user: CurrentUser,
    db: DbSession,
    origin_lat: float = Query(ge=-90, le=90),
    origin_lng: float = Query(ge=-180, le=180),
    destination_lat: float = Query(ge=-90, le=90),
    destination_lng: float = Query(ge=-180, le=180),
):
    """Compare driving and walking between two locations."""

    # Ensure the trip belongs to the authenticated user.
    get_own_trip(trip_id, user, db)

    options = []

    for mode in ("DRIVE", "WALK", "TRANSIT"):
        try:
            route = fetch_route(
                origin_lat,
                origin_lng,
                destination_lat,
                destination_lng,
                mode,
            )

            cost = estimate_transport_cost(
                mode,
                route["distance_km"],
                route.get("transit_fare"),
                route.get("transit_currency"),
            )

            options.append({
                **route,
                **cost,
                "is_estimate": True,
            })

        except NoRouteFoundError:
            options.append({
                "mode": mode,
                "available": False,
                "message": (
                    "No public transit route available."
                    if mode == "TRANSIT"
                    else "No route available."
                ),
            })

        except RoutesServiceError:
            options.append({
                "mode": mode,
                "available": False,
                "message": "Transportation estimate unavailable.",
            })

    return {
        "trip_id": trip_id,
        "options": options,
    }


@router.get("/{trip_id}/getting-there")
def get_getting_there(
    trip_id: int,
    user: CurrentUser,
    db: DbSession,
):
    """Compare driving and public transit between trip cities."""

    trip = get_own_trip(trip_id, user, db)

    result = {
        "trip_id": trip_id,
        "origin": trip.origin,
        "destination": trip.destination,
        "options": [],
    }

    if not settings.maps_api_key:
        result["message"] = "City lookup is currently unavailable."
        return result

    origin = geocode(trip.origin)
    destination = geocode(trip.destination)

    if origin is None or destination is None:
        result["message"] = (
            "Could not locate the starting city or destination."
        )
        return result

    for mode in ("DRIVE", "TRANSIT"):
        try:
            route = fetch_route(
                origin[0],
                origin[1],
                destination[0],
                destination[1],
                mode,
            )

            cost = estimate_transport_cost(
                mode,
                route["distance_km"],
                route.get("transit_fare"),
                route.get("transit_currency"),
            )

            result["options"].append({
                **route,
                **cost,
                "is_estimate": True,
            })

        except NoRouteFoundError:
            result["options"].append({
                "mode": mode,
                "available": False,
                "message": (
                    "No public transit route available."
                    if mode == "TRANSIT"
                    else "No driving route available."
                ),
            })

        except RoutesServiceError:
            result["options"].append({
                "mode": mode,
                "available": False,
                "message": "Transportation estimate unavailable.",
            })

    return result
