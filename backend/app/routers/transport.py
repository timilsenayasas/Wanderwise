
"""A8: Transportation options between trip stops."""

from fastapi import APIRouter, Query

from app.database import DbSession
from app.routers.trips import get_own_trip
from app.security import CurrentUser
from app.services.routes import (
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

    for mode in ("DRIVE", "WALK"):
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
            )

            options.append({
                **route,
                **cost,
                "is_estimate": True,
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
