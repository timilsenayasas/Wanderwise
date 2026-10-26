"""Where to stay: hotel suggestions for a trip, with price estimates and budget fit.

Each request searches Google Places, which is billed, so the page only calls these when the
Where to stay tab is opened or Refresh is pressed.
"""

from fastapi import APIRouter

from app.database import DbSession
from app.lodging import lodging_page
from app.routers.trips import get_own_trip
from app.schemas import LodgingOut
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
