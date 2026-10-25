"""F3/A1: generate a trip's AI itinerary, save it with the trip, and load it back."""

from fastapi import APIRouter, HTTPException, status

from app.database import DbSession
from app.models import Trip
from app.plans import has_plan, load_plan, save_plan
from app.routers.trips import get_own_trip
from app.schemas import SavedPlanOut, TripPlanRequest
from app.security import CurrentUser
from app.services import llm

router = APIRouter(prefix="/api/trips", tags=["ai plan"])


def plan_request(trip: Trip) -> TripPlanRequest:
    """Build the generator's input from the trip's own fields, or 422 if it can't be planned."""
    missing = []
    if not trip.budget or trip.budget <= 0:
        missing.append("a budget")
    if not trip.interests:
        missing.append("at least one interest")
    if missing:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Add {' and '.join(missing)} to this trip to generate a plan.",
        )

    return TripPlanRequest(
        origin=trip.origin,
        destination=trip.destination,
        start_date=trip.start_date,
        end_date=trip.end_date,
        travelers=trip.travelers,
        budget=trip.budget,
        interests=trip.interests.split(","),
    )


@router.get("/{trip_id}/plan", response_model=SavedPlanOut | None)
def get_plan(trip_id: int, user: CurrentUser, db: DbSession) -> SavedPlanOut | None:
    """The trip's saved plan, or null if none has been generated yet."""
    return load_plan(get_own_trip(trip_id, user, db), db)


@router.post("/{trip_id}/plan", response_model=SavedPlanOut)
def generate_plan(trip_id: int, user: CurrentUser, db: DbSession) -> SavedPlanOut:
    """Generate a plan from the trip's details and save it, replacing any earlier plan."""
    trip = get_own_trip(trip_id, user, db)
    body = plan_request(trip)

    # Regenerating should give a new plan, not the cached copy of the old one.
    use_cache = not has_plan(trip, db)
    try:
        # Called through the module so tests can swap in a fake generator.
        itinerary = llm.generate_itinerary(body, use_cache=use_cache)
    except llm.LLMServiceError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "message": exc.message,
                "retry": exc.retry,
            },
        ) from exc

    # Only replace the saved plan once a new one was generated.
    save_plan(trip, itinerary, db)
    db.commit()

    return load_plan(trip, db)
