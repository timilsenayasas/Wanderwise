"""A2: a trip's budget summary (the Budget tab, A3)."""

from fastapi import APIRouter

from app.budget import budget_summary
from app.database import DbSession
from app.routers.trips import get_own_trip
from app.schemas import BudgetOut
from app.security import CurrentUser

router = APIRouter(prefix="/api/trips", tags=["budget"])


@router.get("/{trip_id}/budget", response_model=BudgetOut)
def get_budget(trip_id: int, user: CurrentUser, db: DbSession) -> BudgetOut:
    """Costs by category and by day, the total, and the difference from the trip budget."""
    return budget_summary(get_own_trip(trip_id, user, db), db)
