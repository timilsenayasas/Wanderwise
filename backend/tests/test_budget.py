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


# --- The traveler's own cost lines ----------------------------------------
HOTEL = {"category": "lodging", "amount": 450, "description": "Hotel, 2 nights", "trip_date": "2026-10-10"}


def add_line(client, trip_id: int, **overrides):
    return client.post(f"/api/trips/{trip_id}/cost-items", json={**HOTEL, **overrides})


def plan_line_id(client, trip_id: int) -> int:
    return next(item["id"] for item in get_budget(client, trip_id)["items"] if item["source"] == "plan")


def test_add_a_cost_line(client):
    register(client)
    trip_id = create_trip(client)

    r = add_line(client, trip_id)

    assert r.status_code == 201
    line = r.json()
    assert line == {
        "id": line["id"],
        "category": "lodging",
        "description": "Hotel, 2 nights",
        "amount": 450.0,
        "source": "user",
        "trip_date": "2026-10-10",
    }
    assert get_budget(client, trip_id)["items"] == [line]


def test_new_line_needs_only_category_and_amount(client):
    register(client)
    trip_id = create_trip(client)

    r = client.post(f"/api/trips/{trip_id}/cost-items", json={"category": "other", "amount": 12.3456, "description": "  "})

    assert r.status_code == 201
    assert r.json()["amount"] == 12.35  # rounded to cents
    assert r.json()["description"] is None
    assert r.json()["trip_date"] is None


def test_edit_a_cost_line(client):
    register(client)
    trip_id = create_trip(client)
    line_id = add_line(client, trip_id).json()["id"]

    r = client.put(
        f"/api/trips/{trip_id}/cost-items/{line_id}",
        json={"category": "transport", "amount": 60, "description": "Train", "trip_date": None},
    )

    assert r.status_code == 200
    assert r.json() == {
        "id": line_id,
        "category": "transport",
        "description": "Train",
        "amount": 60.0,
        "source": "user",
        "trip_date": None,
    }
    assert by_category(get_budget(client, trip_id))["transport"] == 60.0


def test_delete_a_cost_line(client):
    register(client)
    trip_id = create_trip(client)
    line_id = add_line(client, trip_id).json()["id"]

    r = client.delete(f"/api/trips/{trip_id}/cost-items/{line_id}")

    assert r.status_code == 204
    assert get_budget(client, trip_id)["items"] == []
    assert client.delete(f"/api/trips/{trip_id}/cost-items/{line_id}").status_code == 404


def test_plan_lines_cannot_be_edited_or_deleted(client, monkeypatch):
    use_fake_gemini(monkeypatch, FIRST_PLAN)
    register(client)
    trip_id = create_trip(client)
    client.post(f"/api/trips/{trip_id}/plan")
    before = get_budget(client, trip_id)
    line_id = plan_line_id(client, trip_id)

    put = client.put(f"/api/trips/{trip_id}/cost-items/{line_id}", json=HOTEL)
    delete = client.delete(f"/api/trips/{trip_id}/cost-items/{line_id}")

    assert put.status_code == 403
    assert delete.status_code == 403
    assert put.json()["detail"] == "Plan cost lines are read-only. Regenerate the plan to change them."
    assert get_budget(client, trip_id) == before


def test_regenerate_keeps_lines_added_through_the_api(client, monkeypatch):
    use_fake_gemini(monkeypatch, FIRST_PLAN, FIRST_PLAN)
    register(client)
    trip_id = create_trip(client)
    client.post(f"/api/trips/{trip_id}/plan")
    line = add_line(client, trip_id).json()

    client.post(f"/api/trips/{trip_id}/plan")

    budget = get_budget(client, trip_id)
    assert line in budget["items"]
    assert budget["total"] == 547.0  # 97 plan + 450 hotel


@pytest.mark.parametrize(
    "bad",
    [
        {"category": "souvenirs"},
        {"category": "Food"},  # categories are exact
        {"category": None},
        {"amount": -1},
        {"amount": "lots"},
        {"description": "x" * 201},
        {"trip_date": "not-a-date"},
    ],
)
def test_bad_cost_line_returns_422(client, bad):
    register(client)
    trip_id = create_trip(client)

    assert add_line(client, trip_id, **bad).status_code == 422
    assert get_budget(client, trip_id)["items"] == []


def test_line_date_outside_the_trip_returns_422(client):
    register(client)
    trip_id = create_trip(client)  # 2026-10-10 to 2026-10-11
    line_id = add_line(client, trip_id).json()["id"]

    assert add_line(client, trip_id, trip_date="2026-10-12").status_code == 422
    r = client.put(f"/api/trips/{trip_id}/cost-items/{line_id}", json={**HOTEL, "trip_date": "2026-10-09"})
    assert r.status_code == 422
    assert r.json()["detail"] == "The date must be within the trip's dates."


def test_line_from_another_trip_returns_404(client):
    register(client)
    first = create_trip(client)
    second = create_trip(client, destination="Milwaukee, WI")
    line_id = add_line(client, second).json()["id"]

    assert client.put(f"/api/trips/{first}/cost-items/{line_id}", json=HOTEL).status_code == 404
    assert client.delete(f"/api/trips/{first}/cost-items/{line_id}").status_code == 404
    assert len(get_budget(client, second)["items"]) == 1


def test_another_users_cost_lines_return_404(client):
    register(client)
    trip_id = create_trip(client)
    line_id = add_line(client, trip_id).json()["id"]
    client.post("/api/auth/logout")
    register(client, email="second@example.com")

    assert add_line(client, trip_id).status_code == 404
    assert client.put(f"/api/trips/{trip_id}/cost-items/{line_id}", json=HOTEL).status_code == 404
    assert client.delete(f"/api/trips/{trip_id}/cost-items/{line_id}").status_code == 404


def test_cost_lines_require_login(client):
    assert client.post("/api/trips/1/cost-items", json=HOTEL).status_code == 401
    assert client.put("/api/trips/1/cost-items/1", json=HOTEL).status_code == 401
    assert client.delete("/api/trips/1/cost-items/1").status_code == 401
