"""Where to stay: hotel suggestions for a trip, with price estimates and budget fit, and the traveler's choice.

GET and refresh search Google Places, which is billed, so the page only calls them when the
Where to stay tab is opened or Refresh is pressed.
"""

from fastapi import APIRouter, HTTPException, status

from app.database import DbSession
from app.lodging import (
    ChoiceError,
    choice_out,
    clear_stale_coords,
    hotel_pin,
    lodging_budget_left,
    lodging_page,
    remove_choice,
    save_choice,
)
from app.routers.trips import get_own_trip
from app.schemas import LodgingChoiceIn, LodgingChoiceOut, LodgingOut, LodgingPinOut
from app.security import CurrentUser

router = APIRouter(prefix="/api/trips", tags=["where to stay"])


@router.get("/{trip_id}/lodging", response_model=LodgingOut)
def get_lodging(trip_id: int, user: CurrentUser, db: DbSession) -> LodgingOut:
    """The current choice and fresh hotel suggestions. Only hotels without an estimate are priced."""
    page = lodging_page(get_own_trip(trip_id, user, db), db)
    db.commit()  # new estimates
    return page


@router.post("/{trip_id}/lodging/refresh", response_model=LodgingOut)
def refresh_lodging(trip_id: int, user: CurrentUser, db: DbSession) -> LodgingOut:
    """Search again and re-estimate every suggested hotel's price."""
    page = lodging_page(get_own_trip(trip_id, user, db), db, fresh=True)
    db.commit()
    return page


@router.put("/{trip_id}/lodging", response_model=LodgingChoiceOut)
def set_lodging(trip_id: int, body: LodgingChoiceIn, user: CurrentUser, db: DbSession) -> LodgingChoiceOut:
    """Pick a suggested hotel, add the traveler's own, or skip. Keeps one Lodging cost line in step."""
    trip = get_own_trip(trip_id, user, db)
    try:
        save_choice(trip, body, db)
    except ChoiceError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc
    db.commit()
    return choice_out(trip, db, found=[], left=lodging_budget_left(trip, db), look_up=False)


@router.get("/{trip_id}/lodging/pin", response_model=LodgingPinOut | None)
def get_lodging_pin(trip_id: int, user: CurrentUser, db: DbSession) -> LodgingPinOut | None:
    """The chosen hotel's map pin, or null. No search: a location lookup only if it's missing or 30 days old."""
    trip = get_own_trip(trip_id, user, db)
    # Every trip's, not just this one's: so old coordinates go even on a server that never restarts.
    clear_stale_coords(db)
    pin = hotel_pin(trip, db)
    db.commit()  # refreshed or cleared coordinates
    return LodgingPinOut(latitude=pin[0], longitude=pin[1]) if pin else None


@router.delete("/{trip_id}/lodging", status_code=status.HTTP_204_NO_CONTENT)
def delete_lodging(trip_id: int, user: CurrentUser, db: DbSession) -> None:
    """Remove the choice and its Lodging cost line. Nothing chosen is fine too."""
    remove_choice(get_own_trip(trip_id, user, db), db)
    db.commit()
