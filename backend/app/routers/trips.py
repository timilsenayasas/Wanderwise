"""F2/F12: create, list, view, edit, and delete the logged-in user's trips."""

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.database import DbSession
from app.models import Trip, User
from app.plans import clear_plan
from app.schemas import TripIn, TripOut
from app.security import CurrentUser

router = APIRouter(prefix="/api/trips", tags=["trips"])


def trip_to_out(trip: Trip) -> TripOut:
    """Convert a database Trip into the public API response format."""
    interests = trip.interests.split(",") if trip.interests else []

    return TripOut(
        id=trip.id,
        origin=trip.origin,
        destination=trip.destination,
        start_date=trip.start_date,
        end_date=trip.end_date,
        travelers=trip.travelers,
        budget=trip.budget,
        interests=interests,
        created_at=trip.created_at,
    )


def get_own_trip(trip_id: int, user: User, db: DbSession) -> Trip:
    """Return the user's trip, or 404. Other users' trips are also 404 so ids don't leak."""
    trip = db.scalar(select(Trip).where(Trip.id == trip_id, Trip.user_id == user.id))
    if trip is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Trip not found")
    return trip


def apply_trip_fields(trip: Trip, body: TripIn) -> None:
    trip.origin = body.origin
    trip.destination = body.destination
    trip.start_date = body.start_date
    trip.end_date = body.end_date
    trip.travelers = body.travelers
    trip.budget = body.budget
    trip.interests = ",".join(body.interests) if body.interests else None


@router.post("", response_model=TripOut, status_code=status.HTTP_201_CREATED)
def create_trip(body: TripIn, user: CurrentUser, db: DbSession) -> TripOut:
    trip = Trip(user_id=user.id)
    apply_trip_fields(trip, body)

    db.add(trip)
    db.commit()
    db.refresh(trip)

    return trip_to_out(trip)


@router.get("", response_model=list[TripOut])
def list_trips(user: CurrentUser, db: DbSession) -> list[TripOut]:
    trips = db.scalars(
        select(Trip).where(Trip.user_id == user.id).order_by(Trip.created_at.desc(), Trip.id.desc())
    ).all()

    return [trip_to_out(trip) for trip in trips]


@router.get("/{trip_id}", response_model=TripOut)
def get_trip(trip_id: int, user: CurrentUser, db: DbSession) -> TripOut:
    return trip_to_out(get_own_trip(trip_id, user, db))


@router.put("/{trip_id}", response_model=TripOut)
def update_trip(trip_id: int, body: TripIn, user: CurrentUser, db: DbSession) -> TripOut:
    trip = get_own_trip(trip_id, user, db)
    apply_trip_fields(trip, body)

    db.commit()
    db.refresh(trip)

    return trip_to_out(trip)


@router.delete("/{trip_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_trip(trip_id: int, user: CurrentUser, db: DbSession) -> None:
    trip = get_own_trip(trip_id, user, db)
    # SQLite can reuse a deleted trip's id, so its plan must not be left behind.
    clear_plan(trip, db)
    db.delete(trip)
    db.commit()
