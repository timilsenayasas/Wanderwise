"""A2 budget: fixed categories, the budget summary, and the traveler's own cost lines."""

import pytest

from app.budget import BUDGET_CATEGORIES, to_budget_category


# --- Category mapping -----------------------------------------------------
@pytest.mark.parametrize(
    ("ai_category", "expected"),
    [
        ("meal", "food"),
        ("activity", "activities"),
        ("sightseeing", "activities"),
        ("nightlife", "activities"),
        ("nature", "activities"),
        ("transportation", "transport"),
        ("shopping", "other"),
        # Already a budget category: kept as is.
        ("food", "food"),
        ("activities", "activities"),
        ("transport", "transport"),
        # Case and spaces don't matter.
        (" Meal ", "food"),
        ("SIGHTSEEING", "activities"),
        # Unknown, blank, and lodging (lodging only comes from user lines for now).
        ("surfing", "other"),
        ("", "other"),
        ("lodging", "other"),
    ],
)
def test_ai_category_maps_to_budget_category(ai_category, expected):
    assert to_budget_category(ai_category) == expected


def test_budget_categories_are_fixed():
    assert BUDGET_CATEGORIES == ("food", "activities", "transport", "lodging", "other")
