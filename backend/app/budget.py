"""A2: a trip's budget: the fixed cost categories and the totals the Budget tab (A3) shows.

Totals are worked out from the cost_items rows (plan and user lines), never from the
AI's total_estimated_cost. Amounts are added up in whole cents so the category
subtotals and the per-day totals always add up exactly to the grand total.
"""

from typing import get_args

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import USER_SOURCE, Activity, CostItem, Trip, TripDay
from app.schemas import BudgetCategory, BudgetOut, CategoryTotal, CostItemOut, DayTotal

# Plans are generated in USD to match the trip budget (see services/llm.py).
PLAN_CURRENCY = "USD"

# Every cost line uses one of these, in this order. Lodging only comes from user lines for now.
BUDGET_CATEGORIES: tuple[str, ...] = get_args(BudgetCategory)

# The AI's activity categories (see services/llm.py) -> budget categories. Anything else -> "other".
# Migration 93c75e18b68d keeps its own copy; change this one only.
PLAN_CATEGORY_MAP = {
    "meal": "food",
    "food": "food",
    "activity": "activities",
    "activities": "activities",
    "sightseeing": "activities",
    "nightlife": "activities",
    "nature": "activities",
    "transportation": "transport",
    "transport": "transport",
    "shopping": "other",
}


def to_budget_category(ai_category: str) -> str:
    """"Meal " -> "food"; unknown categories -> "other"."""
    return PLAN_CATEGORY_MAP.get(ai_category.strip().lower(), "other")


# --- Money ----------------------------------------------------------------
def to_cents(amount: float) -> int:
    return round(amount * 100)


def to_dollars(cents: int) -> float:
    return cents / 100


# --- Summary --------------------------------------------------------------
def _cents_by_category(items: list[CostItem]) -> dict[str, int]:
    totals = dict.fromkeys(BUDGET_CATEGORIES, 0)
    for item in items:
        # A row outside the fixed set (shouldn't happen) still counts toward the total.
        category = item.category if item.category in totals else "other"
        totals[category] += to_cents(item.amount)
    return totals


def _cents_by_day(days: list[TripDay], items: list[CostItem], db: Session) -> tuple[dict[int, int], int]:
    """Per plan day: its activities' costs plus user lines dated that day. Also the cents on no plan day."""
    totals = {day.id: 0 for day in days}
    activity_costs = db.execute(
        select(Activity.trip_day_id, Activity.estimated_cost).where(Activity.trip_day_id.in_(list(totals)))
    ).all()
    for day_id, cost in activity_costs:
        totals[day_id] += to_cents(cost or 0)

    # Plan lines are already counted through their activities above.
    day_for_date = {day.trip_date: day.id for day in days}
    not_by_day = 0
    for item in items:
        if item.source != USER_SOURCE:
            continue
        if item.trip_date in day_for_date:
            totals[day_for_date[item.trip_date]] += to_cents(item.amount)
        else:
            not_by_day += to_cents(item.amount)
    return totals, not_by_day


def budget_summary(trip: Trip, db: Session) -> BudgetOut:
    """The trip's costs by category and by day, its total, and how it compares to the budget."""
    items = list(db.scalars(select(CostItem).where(CostItem.trip_id == trip.id).order_by(CostItem.id)))
    days = list(db.scalars(select(TripDay).where(TripDay.trip_id == trip.id).order_by(TripDay.day_number)))

    by_category = _cents_by_category(items)
    by_day, not_by_day = _cents_by_day(days, items, db)
    total = sum(by_category.values())

    remaining = None if trip.budget is None else to_cents(trip.budget) - total

    return BudgetOut(
        trip_id=trip.id,
        currency=PLAN_CURRENCY,
        estimated=True,
        categories=[CategoryTotal(category=name, amount=to_dollars(cents)) for name, cents in by_category.items()],
        per_day=[
            DayTotal(day_number=day.day_number, date=day.trip_date, amount=to_dollars(by_day[day.id]))
            for day in days
        ],
        not_by_day=to_dollars(not_by_day),
        total=to_dollars(total),
        budget=trip.budget,
        remaining=None if remaining is None else to_dollars(remaining),
        over_budget=None if remaining is None else remaining < 0,
        items=[CostItemOut.model_validate(item) for item in items],
    )
