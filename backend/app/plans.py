"""A1: save a generated plan with its trip, load it back, and clear it.

A saved plan is: trip_days -> activities, plus plan cost_items (one line per activity category).
The traveler's own cost lines (source "user") belong to the trip, not the plan.
SQLite doesn't enforce foreign keys yet, so clear_plan/clear_trip delete rows explicitly
instead of relying on ON DELETE CASCADE.
"""

from collections import defaultdict

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.budget import PLAN_CURRENCY, to_budget_category
from app.models import PLAN_SOURCE, Activity, CostItem, Trip, TripDay
from app.schemas import (
    CostItemOut,
    ItineraryActivity,
    ItineraryResponse,
    SavedActivity,
    SavedDay,
    SavedPlanOut,
)

MINUTES_PER_DAY = 24 * 60


# --- Times ----------------------------------------------------------------
def _to_minutes(clock: str) -> int:
    hours, minutes = clock.split(":")
    return int(hours) * 60 + int(minutes)


def _to_clock(minutes: int) -> str:
    minutes %= MINUTES_PER_DAY
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def end_time(start_time: str, duration_minutes: int) -> str:
    """"22:30" + 120 min -> "00:30" (wraps past midnight)."""
    return _to_clock(_to_minutes(start_time) + duration_minutes)


def duration_minutes(start_time: str, end_time: str) -> int:
    """Reverse of end_time(). Equal times mean a full day, not zero."""
    minutes = (_to_minutes(end_time) - _to_minutes(start_time)) % MINUTES_PER_DAY
    return minutes or MINUTES_PER_DAY


# --- Saving ---------------------------------------------------------------
def has_plan(trip: Trip, db: Session) -> bool:
    return db.scalar(select(TripDay.id).where(TripDay.trip_id == trip.id).limit(1)) is not None


def clear_plan(trip: Trip, db: Session) -> None:
    """Delete the trip's saved plan rows, keeping the traveler's own cost lines. The caller commits."""
    day_ids = select(TripDay.id).where(TripDay.trip_id == trip.id)
    db.execute(delete(Activity).where(Activity.trip_day_id.in_(day_ids)))
    db.execute(delete(TripDay).where(TripDay.trip_id == trip.id))
    db.execute(delete(CostItem).where(CostItem.trip_id == trip.id, CostItem.source == PLAN_SOURCE))


def clear_trip(trip: Trip, db: Session) -> None:
    """Delete the plan and every cost line (plan and user), before deleting the trip. The caller commits."""
    clear_plan(trip, db)
    db.execute(delete(CostItem).where(CostItem.trip_id == trip.id))


def _activity_row(trip_day: TripDay, activity: ItineraryActivity) -> Activity:
    # Slices match the column lengths (Postgres rejects longer strings).
    return Activity(
        trip_day_id=trip_day.id,
        name=activity.name[:200],
        description=activity.description,
        location=activity.location[:255],
        start_time=activity.start_time,
        end_time=end_time(activity.start_time, activity.duration_minutes),
        category=activity.category[:80],
        estimated_cost=activity.estimated_cost,
        travel_minutes_to_next=activity.travel_time_to_next_minutes,
        # The AI gives no coordinates; the map card (A12) fills these from `location`.
        latitude=None,
        longitude=None,
    )


def build_cost_items(trip: Trip, itinerary: ItineraryResponse) -> list[CostItem]:
    """One cost line per budget category with its summed cost. $0 categories are skipped."""
    totals: dict[str, float] = defaultdict(float)
    counts: dict[str, int] = defaultdict(int)
    for day in itinerary.days:
        for activity in day.activities:
            category = to_budget_category(activity.category)
            totals[category] += activity.estimated_cost
            counts[category] += 1

    return [
        CostItem(
            trip_id=trip.id,
            source=PLAN_SOURCE,
            category=category,
            description=f"{counts[category]} {'activity' if counts[category] == 1 else 'activities'}",
            amount=round(total, 2),
        )
        for category, total in totals.items()
        if total > 0
    ]


def save_plan(trip: Trip, itinerary: ItineraryResponse, db: Session) -> None:
    """Replace the trip's saved plan with this itinerary. The caller commits."""
    clear_plan(trip, db)

    for number, day in enumerate(itinerary.days, start=1):
        trip_day = TripDay(trip_id=trip.id, day_number=number, trip_date=day.date)
        db.add(trip_day)
        db.flush()  # assigns trip_day.id for its activities
        db.add_all(_activity_row(trip_day, activity) for activity in day.activities)

    db.add_all(build_cost_items(trip, itinerary))


# --- Loading --------------------------------------------------------------
def _activity_out(row: Activity) -> SavedActivity:
    return SavedActivity(
        id=row.id,
        start_time=row.start_time,
        end_time=row.end_time,
        duration_minutes=duration_minutes(row.start_time, row.end_time),
        name=row.name,
        category=row.category or "",
        location=row.location or "",
        description=row.description or "",
        estimated_cost=row.estimated_cost or 0.0,
        travel_time_to_next_minutes=row.travel_minutes_to_next or 0,
        latitude=row.latitude,
        longitude=row.longitude,
    )


def load_plan(trip: Trip, db: Session) -> SavedPlanOut | None:
    """The trip's saved plan in API shape, or None if none has been generated yet."""
    days = db.scalars(
        select(TripDay).where(TripDay.trip_id == trip.id).order_by(TripDay.day_number)
    ).all()
    if not days:
        return None

    activities = db.scalars(
        select(Activity)
        .where(Activity.trip_day_id.in_([day.id for day in days]))
        .order_by(Activity.id)  # the order the plan listed them
    ).all()
    by_day: dict[int, list[SavedActivity]] = defaultdict(list)
    for row in activities:
        by_day[row.trip_day_id].append(_activity_out(row))

    cost_items = db.scalars(
        select(CostItem).where(CostItem.trip_id == trip.id).order_by(CostItem.id)
    ).all()

    return SavedPlanOut(
        trip_id=trip.id,
        destination=trip.destination,
        currency=PLAN_CURRENCY,
        total_estimated_cost=round(sum(a.estimated_cost for a in activities if a.estimated_cost), 2),
        days=[
            SavedDay(id=day.id, day_number=day.day_number, date=day.trip_date, activities=by_day[day.id])
            for day in days
        ],
        cost_items=[CostItemOut.model_validate(item) for item in cost_items],
    )
