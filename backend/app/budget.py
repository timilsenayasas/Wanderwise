"""A2: a trip's budget: the fixed cost categories and the totals the Budget tab (A3) shows."""

from typing import get_args

from app.schemas import BudgetCategory

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
