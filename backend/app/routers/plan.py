"""F3: generate an AI itinerary."""

from fastapi import APIRouter, HTTPException, status

from app.schemas import ItineraryResponse, TripPlanRequest
from app.security import CurrentUser
from app.services import llm

router = APIRouter(prefix="/api/trips", tags=["ai plan"])


@router.post("/plan", response_model=ItineraryResponse)
def plan_trip(body: TripPlanRequest, user: CurrentUser) -> ItineraryResponse:
    """Generate an AI itinerary for the logged-in user."""
    try:
        # Called through the module so tests can swap in a fake generator.
        return llm.generate_itinerary(body)
    except llm.LLMServiceError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "message": exc.message,
                "retry": exc.retry,
            },
        ) from exc
