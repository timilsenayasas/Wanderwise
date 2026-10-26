"""Where to stay: a trip's stays, hotel suggestions per stay with price estimates and budget fit, and choices.

The overview (GET /lodging) and changes make no searches. A stay's suggestions search Google
Places, which is billed, so the page asks for them only when that stay's section is first
opened or Refresh is pressed.
"""

from datetime import date
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status

from app.database import DbSession
from app.lodging import (
    MAX_STAYS,
    ChoiceError,
    NightNotFound,
    StayNotFound,
    clear_stale_coords,
    hotel_names,
    hotel_pins,
    lodging_overview,
    remove_choice,
    save_choice,
    set_night_transit,
    stay_page,
)
from app.models import Trip
from app.routers.trips import get_own_trip
from app.schemas import (
    HotelNameOut,
    LodgingChoiceIn,
    LodgingOverviewOut,
    LodgingPinOut,
    NightIn,
    StayPageOut,
)
from app.security import CurrentUser

router = APIRouter(prefix="/api/trips", tags=["where to stay"])

STAY_NOT_FOUND = HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Stay not found")


@router.get("/{trip_id}/lodging", response_model=LodgingOverviewOut)
def get_lodging(trip_id: int, user: CurrentUser, db: DbSession) -> LodgingOverviewOut:
    """Every stay with its choice (no Google details), and choices a new plan left behind. No searches."""
    return lodging_overview(get_own_trip(trip_id, user, db), db)


def _stay_page(trip: Trip, stay_number: int, db: DbSession, fresh: bool) -> StayPageOut:
    try:
        page = stay_page(trip, stay_number, db, fresh=fresh)
    except StayNotFound:
        raise STAY_NOT_FOUND from None
    db.commit()  # new estimates
    return page


@router.get("/{trip_id}/lodging/stays/{stay_number}", response_model=StayPageOut)
def get_stay_page(trip_id: int, stay_number: int, user: CurrentUser, db: DbSession) -> StayPageOut:
    """Fresh hotel suggestions for the stay's city, and its choice. Only hotels without an estimate are priced."""
    return _stay_page(get_own_trip(trip_id, user, db), stay_number, db, fresh=False)


@router.post("/{trip_id}/lodging/stays/{stay_number}/refresh", response_model=StayPageOut)
def refresh_stay_page(trip_id: int, stay_number: int, user: CurrentUser, db: DbSession) -> StayPageOut:
    """Search the stay's city again and re-estimate every suggested hotel's price."""
    return _stay_page(get_own_trip(trip_id, user, db), stay_number, db, fresh=True)


@router.put("/{trip_id}/lodging/stays/{stay_number}", response_model=LodgingOverviewOut)
def set_stay_choice(
    trip_id: int, stay_number: int, body: LodgingChoiceIn, user: CurrentUser, db: DbSession
) -> LodgingOverviewOut:
    """Pick a suggested hotel, add the traveler's own, or skip, for one stay. Keeps its Lodging line in step.

    Answers with the overview: the other stays' budget left changes too.
    """
    trip = get_own_trip(trip_id, user, db)
    try:
        save_choice(trip, stay_number, body, db)
    except StayNotFound:
        raise STAY_NOT_FOUND from None
    except ChoiceError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc
    db.commit()
    return lodging_overview(trip, db)


@router.delete("/{trip_id}/lodging/stays/{stay_number}", response_model=LodgingOverviewOut)
def delete_stay_choice(trip_id: int, stay_number: int, user: CurrentUser, db: DbSession) -> LodgingOverviewOut:
    """Remove a stay's choice and its Lodging line, also for a stay the plan no longer has. Nothing chosen is fine."""
    trip = get_own_trip(trip_id, user, db)
    if not 1 <= stay_number <= MAX_STAYS:
        raise STAY_NOT_FOUND
    remove_choice(trip, stay_number, db)
    db.commit()
    return lodging_overview(trip, db)


@router.get("/{trip_id}/lodging/pins", response_model=list[LodgingPinOut])
def get_lodging_pins(trip_id: int, user: CurrentUser, db: DbSession) -> list[LodgingPinOut]:
    """One pin per stay with a picked hotel. No search: a location lookup only if one is missing or 30 days old."""
    trip = get_own_trip(trip_id, user, db)
    # Every trip's, not just this one's: so old coordinates go even on a server that never restarts.
    clear_stale_coords(db)
    pins = hotel_pins(trip, db)
    db.commit()  # refreshed or cleared coordinates
    return pins


@router.get("/{trip_id}/lodging/names", response_model=list[HotelNameOut])
def get_hotel_names(
    trip_id: int, user: CurrentUser, db: DbSession, stays: Annotated[list[int], Query()] = []
) -> list[HotelNameOut]:
    """Fresh Google names of the hotels picked for these stays (?stays=1&stays=3), for the Itinerary.

    One name-only Place Details lookup (Pro tier) per stay, never stored. The page asks only for
    names it doesn't have yet (the Stay tab's hotels already come with theirs).
    """
    return hotel_names(get_own_trip(trip_id, user, db), stays, db)


# --- Nights in transit ----------------------------------------------------
def _set_night(
    trip_id: int, night: date, in_transit: bool | None, user: CurrentUser, db: DbSession
) -> LodgingOverviewOut:
    trip = get_own_trip(trip_id, user, db)
    try:
        set_night_transit(trip, night, in_transit, db)
    except NightNotFound:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Night not found") from None
    db.commit()
    return lodging_overview(trip, db)


@router.put("/{trip_id}/nights/{night}", response_model=LodgingOverviewOut)
def set_night(trip_id: int, night: date, body: NightIn, user: CurrentUser, db: DbSession) -> LodgingOverviewOut:
    """The traveler's switch: this night is (or isn't) spent travelling, whatever the plan says.

    Kept when the plan is regenerated. Answers with the overview: the stays change with it.
    """
    return _set_night(trip_id, night, body.in_transit, user, db)


@router.delete("/{trip_id}/nights/{night}", response_model=LodgingOverviewOut)
def reset_night(trip_id: int, night: date, user: CurrentUser, db: DbSession) -> LodgingOverviewOut:
    """Go back to the plan's say on whether this night is spent travelling."""
    return _set_night(trip_id, night, None, user, db)
