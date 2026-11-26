
from fastapi import APIRouter, HTTPException, status

from app.database import DbSession
from app.plans import load_plan
from app.routers.trips import get_own_trip
from app.routers.weather import get_trip_weather
from app.schemas import PackingListOut
from app.security import CurrentUser
from app.services import llm, packing

router = APIRouter(prefix="/api/trips", tags=["packing list"])


@router.post("/{trip_id}/packing-list", response_model=PackingListOut)
def generate_packing_list(
    trip_id: int,
    user: CurrentUser,
    db: DbSession,
) -> PackingListOut:
    """Generate a packing list from the trip's saved plan and weather."""

    trip = get_own_trip(trip_id, user, db)

    # A saved itinerary is needed to identify planned activities.
    saved_plan = load_plan(trip, db)

    if saved_plan is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Generate a trip itinerary before creating a packing list.",
        )

    # Reuse the existing A11 weather endpoint.
    weather_data = get_trip_weather(trip_id, user, db)
    weather_days = weather_data.get("days", [])

    if not weather_days or all(
        day.get("type") == "unavailable" for day in weather_days
    ):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Weather information is unavailable. Please try again later.",
        )

    # Collect the activity categories from the saved itinerary.
    activities = sorted({
        activity.category.strip()
        for day in saved_plan.days
        for activity in day.activities
        if activity.category.strip()
    })

    try:
        return packing.generate_packing_list(
            trip_id=trip.id,
            destination=trip.destination,
            weather=weather_days,
            activities=activities,
        )

    except llm.LLMServiceError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "message": exc.message,
                "retry": exc.retry,
            },
        ) from exc