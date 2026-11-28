
"""Generate, save, reload, refine, and compare AI trip itineraries."""

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select

from app.database import DbSession
from app.models import PlanAlternative, Trip
from app.plans import has_plan, load_plan, save_plan
from app.routers.trips import get_own_trip
from app.schemas import ItineraryResponse, RefinePlanIn, SavedPlanOut, TripPlanRequest
from app.security import CurrentUser
from app.services import geocoding, llm, refinement

router = APIRouter(prefix="/api/trips", tags=["ai plan"])


class AlternativePlanOut(BaseModel):
    id: int
    itinerary: ItineraryResponse


def plan_request(trip: Trip) -> TripPlanRequest:
    """Build generation input from the saved trip."""
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


def get_alternative(trip_id: int, db: DbSession) -> PlanAlternative | None:
    """Find the latest pending alternative for a trip."""
    return db.scalar(
        select(PlanAlternative)
        .where(PlanAlternative.trip_id == trip_id)
        .order_by(PlanAlternative.id.desc())
        .limit(1)
    )


def alternative_response(alternative: PlanAlternative) -> AlternativePlanOut:
    return AlternativePlanOut(
        id=alternative.id,
        itinerary=ItineraryResponse.model_validate(alternative.itinerary),
    )


def clear_alternatives(trip_id: int, db: DbSession) -> None:
    """Discard pending alternatives for a trip."""
    alternatives = db.scalars(
        select(PlanAlternative).where(PlanAlternative.trip_id == trip_id)
    ).all()

    for alternative in alternatives:
        db.delete(alternative)


# --- Original itinerary ---------------------------------------------------

@router.get("/{trip_id}/plan", response_model=SavedPlanOut | None)
def get_plan(
    trip_id: int,
    user: CurrentUser,
    db: DbSession,
) -> SavedPlanOut | None:
    return load_plan(get_own_trip(trip_id, user, db), db)


@router.post("/{trip_id}/plan", response_model=SavedPlanOut)
def generate_plan(
    trip_id: int,
    user: CurrentUser,
    db: DbSession,
) -> SavedPlanOut:
    trip = get_own_trip(trip_id, user, db)
    body = plan_request(trip)

    use_cache = not has_plan(trip, db)

    try:
        itinerary = llm.generate_itinerary(body, use_cache=use_cache)
    except llm.LLMServiceError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"message": exc.message, "retry": exc.retry},
        ) from exc

    coordinates = geocoding.locate_activities(itinerary, trip.destination)

    save_plan(trip, itinerary, db, coordinates)
    clear_alternatives(trip_id, db)
    db.commit()

    return load_plan(trip, db)


# --- R7: Generate and store an alternative --------------------------------

@router.post(
    "/{trip_id}/plan/alternative",
    response_model=AlternativePlanOut,
)
def generate_alternative(
    trip_id: int,
    user: CurrentUser,
    db: DbSession,
) -> AlternativePlanOut:
    """Generate an alternative without modifying the original plan."""
    trip = get_own_trip(trip_id, user, db)

    if not has_plan(trip, db):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Generate an original plan before comparing alternatives.",
        )

    body = plan_request(trip)

    try:
        itinerary = llm.generate_itinerary(body, use_cache=False)
    except llm.LLMServiceError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"message": exc.message, "retry": exc.retry},
        ) from exc

    # Only discard the previous candidate after generation succeeds.
    clear_alternatives(trip_id, db)

    alternative = PlanAlternative(
        trip_id=trip_id,
        itinerary=itinerary.model_dump(mode="json"),
    )

    db.add(alternative)
    db.commit()
    db.refresh(alternative)

    return alternative_response(alternative)


# --- R7: Retrieve pending alternative ------------------------------------

@router.get(
    "/{trip_id}/plan/alternative",
    response_model=AlternativePlanOut | None,
)
def load_alternative(
    trip_id: int,
    user: CurrentUser,
    db: DbSession,
) -> AlternativePlanOut | None:
    get_own_trip(trip_id, user, db)

    alternative = get_alternative(trip_id, db)

    if alternative is None:
        return None

    return alternative_response(alternative)


# --- R7: Accept alternative ----------------------------------------------

@router.post(
    "/{trip_id}/plan/alternative/{alternative_id}/accept",
    response_model=SavedPlanOut,
)
def accept_alternative(
    trip_id: int,
    alternative_id: int,
    user: CurrentUser,
    db: DbSession,
) -> SavedPlanOut:
    """Replace the saved plan only after explicit acceptance."""
    trip = get_own_trip(trip_id, user, db)

    alternative = db.scalar(
        select(PlanAlternative).where(
            PlanAlternative.id == alternative_id,
            PlanAlternative.trip_id == trip_id,
        )
    )

    if alternative is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Alternative itinerary not found.",
        )

    itinerary = ItineraryResponse.model_validate(alternative.itinerary)

    coordinates = geocoding.locate_activities(
        itinerary,
        trip.destination,
    )

    save_plan(trip, itinerary, db, coordinates)
    clear_alternatives(trip_id, db)
    db.commit()

    return load_plan(trip, db)


# --- R7: Reject alternative ----------------------------------------------

@router.delete(
    "/{trip_id}/plan/alternative/{alternative_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def reject_alternative(
    trip_id: int,
    alternative_id: int,
    user: CurrentUser,
    db: DbSession,
) -> None:
    """Discard the alternative and keep the original plan."""
    get_own_trip(trip_id, user, db)

    alternative = db.scalar(
        select(PlanAlternative).where(
            PlanAlternative.id == alternative_id,
            PlanAlternative.trip_id == trip_id,
        )
    )

    if alternative is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Alternative itinerary not found.",
        )

    db.delete(alternative)
    db.commit()


# --- Refine saved itinerary ----------------------------------------------

@router.post("/{trip_id}/plan/refine", response_model=SavedPlanOut)
def refine_plan(
    trip_id: int,
    body: RefinePlanIn,
    user: CurrentUser,
    db: DbSession,
) -> SavedPlanOut:
    trip = get_own_trip(trip_id, user, db)

    existing_plan = load_plan(trip, db)

    if existing_plan is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="This trip does not have a saved itinerary.",
        )

    current_itinerary = ItineraryResponse.model_validate(
        existing_plan.model_dump()
    )

    try:
        updated_itinerary = refinement.refine_itinerary(
            current_itinerary,
            body.message,
        )
    except llm.LLMServiceError as exc:
        raise HTTPException(
            status_code=503,
            detail={"message": exc.message, "retry": exc.retry},
        ) from exc

    coordinates = geocoding.locate_activities(
        updated_itinerary,
        trip.destination,
    )

    save_plan(trip, updated_itinerary, db, coordinates)
    clear_alternatives(trip_id, db)
    db.commit()

    return load_plan(trip, db)
