"""A2: a trip's budget summary (the Budget tab, A3) and the traveler's own cost lines."""

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.budget import budget_summary
from app.database import DbSession
from app.models import USER_SOURCE, CostItem, Trip
from app.routers.trips import get_own_trip
from app.schemas import BudgetOut, CostItemIn, CostItemOut
from app.security import CurrentUser

router = APIRouter(prefix="/api/trips", tags=["budget"])


@router.get("/{trip_id}/budget", response_model=BudgetOut)
def get_budget(trip_id: int, user: CurrentUser, db: DbSession) -> BudgetOut:
    """Costs by category and by day, the total, and the difference from the trip budget."""
    return budget_summary(get_own_trip(trip_id, user, db), db)


# --- The traveler's own cost lines ----------------------------------------
def get_user_line(trip: Trip, item_id: int, db: DbSession) -> CostItem:
    """The trip's cost line, or 404. Plan lines are 403: they change only by regenerating the plan."""
    item = db.scalar(select(CostItem).where(CostItem.id == item_id, CostItem.trip_id == trip.id))
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cost line not found")
    if item.source != USER_SOURCE:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Plan cost lines are read-only. Regenerate the plan to change them.",
        )
    return item


def apply_cost_fields(item: CostItem, body: CostItemIn, trip: Trip) -> None:
    if body.trip_date and not trip.start_date <= body.trip_date <= trip.end_date:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="The date must be within the trip's dates.",
        )
    item.category = body.category
    item.amount = body.amount
    item.description = body.description
    item.trip_date = body.trip_date


@router.post("/{trip_id}/cost-items", response_model=CostItemOut, status_code=status.HTTP_201_CREATED)
def create_cost_item(trip_id: int, body: CostItemIn, user: CurrentUser, db: DbSession) -> CostItemOut:
    trip = get_own_trip(trip_id, user, db)
    item = CostItem(trip_id=trip.id, source=USER_SOURCE)
    apply_cost_fields(item, body, trip)

    db.add(item)
    db.commit()
    db.refresh(item)

    return CostItemOut.model_validate(item)


@router.put("/{trip_id}/cost-items/{item_id}", response_model=CostItemOut)
def update_cost_item(trip_id: int, item_id: int, body: CostItemIn, user: CurrentUser, db: DbSession) -> CostItemOut:
    trip = get_own_trip(trip_id, user, db)
    item = get_user_line(trip, item_id, db)
    apply_cost_fields(item, body, trip)

    db.commit()
    db.refresh(item)

    return CostItemOut.model_validate(item)


@router.delete("/{trip_id}/cost-items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_cost_item(trip_id: int, item_id: int, user: CurrentUser, db: DbSession) -> None:
    trip = get_own_trip(trip_id, user, db)
    db.delete(get_user_line(trip, item_id, db))
    db.commit()
