"""A2 budget: fixed categories, the budget summary, and the traveler's own cost lines."""

from datetime import date

import pytest
from conftest import register
from test_plan import FIRST_PLAN, add_user_line, create_trip, use_fake_gemini

from app.budget import BUDGET_CATEGORIES, to_budget_category


def get_budget(client, trip_id: int) -> dict:
    r = client.get(f"/api/trips/{trip_id}/budget")
    assert r.status_code == 200
    return r.json()


def by_category(budget: dict) -> dict[str, float]:
    return {line["category"]: line["amount"] for line in budget["categories"]}


def assert_adds_up(budget: dict) -> None:
    """Category subtotals, and per-day totals plus lines on no day, both equal the grand total."""
    assert round(sum(by_category(budget).values()), 2) == budget["total"]
    assert round(sum(day["amount"] for day in budget["per_day"]) + budget["not_by_day"], 2) == budget["total"]


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


# --- Summary: access ------------------------------------------------------
def test_budget_requires_login(client):
    assert client.get("/api/trips/1/budget").status_code == 401


def test_another_users_budget_returns_404(client):
    register(client)
    trip_id = create_trip(client)
    client.post("/api/auth/logout")
    register(client, email="second@example.com")

    assert client.get(f"/api/trips/{trip_id}/budget").status_code == 404
    assert client.get("/api/trips/999/budget").status_code == 404


# --- Summary: totals ------------------------------------------------------
def test_trip_with_no_plan_and_no_cost_lines_is_all_zeros(client):
    register(client)
    trip_id = create_trip(client)

    budget = get_budget(client, trip_id)

    assert budget == {
        "trip_id": trip_id,
        "currency": "USD",
        "estimated": True,
        "categories": [{"category": name, "amount": 0.0} for name in BUDGET_CATEGORIES],
        "per_day": [],
        "not_by_day": 0.0,
        "total": 0.0,
        "budget": 1200.0,
        "remaining": 1200.0,
        "over_budget": False,
        "items": [],
    }


def test_budget_follows_the_saved_plan(client, monkeypatch):
    use_fake_gemini(monkeypatch, FIRST_PLAN)
    register(client)
    trip_id = create_trip(client)
    plan = client.post(f"/api/trips/{trip_id}/plan").json()

    budget = get_budget(client, trip_id)

    assert by_category(budget) == {"food": 65.0, "activities": 32.0, "transport": 0.0, "lodging": 0.0, "other": 0.0}
    assert budget["per_day"] == [
        {"day_number": day["day_number"], "date": day["date"], "amount": sum(a["estimated_cost"] for a in day["activities"])}
        for day in plan["days"]
    ]
    assert [day["amount"] for day in budget["per_day"]] == [57.0, 40.0]
    assert budget["total"] == 97.0
    assert budget["remaining"] == 1103.0
    assert budget["over_budget"] is False
    assert_adds_up(budget)


def test_budget_ignores_the_ais_own_total(client, monkeypatch):
    use_fake_gemini(monkeypatch, {**FIRST_PLAN, "total_estimated_cost": 5000.0})
    register(client)
    trip_id = create_trip(client)
    client.post(f"/api/trips/{trip_id}/plan")

    assert get_budget(client, trip_id)["total"] == 97.0


def test_user_lines_count_in_totals_and_on_their_day(client, monkeypatch):
    use_fake_gemini(monkeypatch, FIRST_PLAN)
    register(client)
    trip_id = create_trip(client)
    client.post(f"/api/trips/{trip_id}/plan")
    add_user_line(trip_id, "lodging", 300.0, trip_date=date(2026, 10, 10))
    add_user_line(trip_id, "transport", 45.5)  # no day

    budget = get_budget(client, trip_id)

    assert by_category(budget)["lodging"] == 300.0
    assert by_category(budget)["transport"] == 45.5
    assert [day["amount"] for day in budget["per_day"]] == [357.0, 40.0]
    assert budget["not_by_day"] == 45.5
    assert budget["total"] == 442.5
    assert len(budget["items"]) == 4  # 2 plan lines + 2 user lines
    assert_adds_up(budget)


def test_user_lines_without_a_plan_are_not_by_day(client):
    register(client)
    trip_id = create_trip(client)
    add_user_line(trip_id, "lodging", 300.0, trip_date=date(2026, 10, 10))

    budget = get_budget(client, trip_id)

    assert budget["per_day"] == []
    assert budget["not_by_day"] == 300.0
    assert budget["total"] == 300.0
    assert_adds_up(budget)


def test_totals_are_exact_to_the_cent(client):
    register(client)
    trip_id = create_trip(client)
    for _ in range(10):
        add_user_line(trip_id, "food", 0.1)  # 10 x 0.1 is 0.9999999999999999 as plain floats
    add_user_line(trip_id, "other", 0.2)

    budget = get_budget(client, trip_id)

    assert by_category(budget)["food"] == 1.0
    assert budget["total"] == 1.2
    assert_adds_up(budget)


# --- Summary: compared to the budget --------------------------------------
def test_over_budget(client, monkeypatch):
    use_fake_gemini(monkeypatch, FIRST_PLAN)
    register(client)
    trip_id = create_trip(client, budget=50)
    client.post(f"/api/trips/{trip_id}/plan")

    budget = get_budget(client, trip_id)

    assert budget["budget"] == 50.0
    assert budget["remaining"] == -47.0
    assert budget["over_budget"] is True


def test_exactly_on_budget_is_not_over(client):
    register(client)
    trip_id = create_trip(client, budget=300)
    add_user_line(trip_id, "lodging", 300.0)

    budget = get_budget(client, trip_id)

    assert budget["remaining"] == 0.0
    assert budget["over_budget"] is False


def test_trip_with_no_budget(client):
    register(client)
    trip_id = create_trip(client, budget=None)
    add_user_line(trip_id, "lodging", 300.0)

    budget = get_budget(client, trip_id)

    assert budget["total"] == 300.0
    assert budget["budget"] is None
    assert budget["remaining"] is None
    assert budget["over_budget"] is None
