"""Where to stay with more than one base city: stays from the plan, per-stay choices, lines and pins.

Google and Gemini are faked. Plans are written straight to the database, so each test controls
exactly which base city every day has.
"""

from datetime import date, timedelta

from conftest import register
from sqlalchemy import delete, select
from test_lodging import (
    DRAKE,
    LUX,
    age_coords,
    choice_of,
    create_trip,
    get_pins,
    lodging_lines,
    prices,
    put_choice,
    set_choice,
)
from test_places import fake_places, place
from test_plan import use_fake_gemini

from app.database import get_db
from app.main import app
from app.models import LODGING_HOTEL, TripDay, TripLodging

KATHMANDU = "Kathmandu, Nepal"
CHITWAN = "Chitwan, Nepal"
POKHARA = "Pokhara, Nepal"
TIGER = place("t1", "Tiger Lodge")


def set_plan_cities(trip_id: int, cities: list[str | None], start: date = date(2026, 10, 10)) -> None:
    """Replace the trip's plan days with one day per city (None: no base city), from `start`."""
    db = next(app.dependency_overrides[get_db]())
    try:
        db.execute(delete(TripDay).where(TripDay.trip_id == trip_id))
        for i, city in enumerate(cities):
            db.add(TripDay(trip_id=trip_id, day_number=i + 1, trip_date=start + timedelta(days=i), base_city=city))
        db.commit()
    finally:
        db.close()


def two_city_trip(client, **overrides) -> int:
    """Oct 10-14 (4 nights): 2 nights in Kathmandu, then 2 in Chitwan."""
    register(client)
    trip_id = create_trip(client, destination=KATHMANDU, **overrides)
    set_plan_cities(trip_id, [KATHMANDU, KATHMANDU, CHITWAN, CHITWAN, CHITWAN])
    return trip_id


def overview(client, trip_id: int) -> dict:
    r = client.get(f"/api/trips/{trip_id}/lodging")
    assert r.status_code == 200, r.text
    return r.json()


def stays(client, trip_id: int) -> list[tuple]:
    """(number, city, check-in, check-out, nights) per stay."""
    return [
        (s["number"], s["city"], s["check_in"], s["check_out"], s["nights"]) for s in overview(client, trip_id)["stays"]
    ]


def open_stay(client, monkeypatch, trip_id: int, stay: int, hotels: list[dict], **nightly) -> list[dict]:
    """Open a stay's section with these hotels and estimates. Returns the Places requests."""
    locations = {h["id"]: {"location": {"latitude": 27.7, "longitude": 85.3 + n}} for n, h in enumerate(hotels)}
    sent = fake_places(monkeypatch, search={"places": hotels}, details=locations)
    prompts = use_fake_gemini(monkeypatch, prices(**nightly))
    r = client.get(f"/api/trips/{trip_id}/lodging/stays/{stay}")
    assert r.status_code == 200, r.text
    sent.append({"prompts": prompts, "page": r.json()})
    return sent


# --- Stays from the plan --------------------------------------------------
def test_consecutive_nights_in_one_city_make_a_stay(client):
    trip_id = two_city_trip(client)

    assert stays(client, trip_id) == [
        (1, KATHMANDU, "2026-10-10", "2026-10-12", 2),
        (2, CHITWAN, "2026-10-12", "2026-10-14", 2),
    ]


def test_without_a_plan_or_base_cities_there_is_one_stay_in_the_destination(client):
    register(client)
    no_plan = create_trip(client)
    no_cities = create_trip(client)
    set_plan_cities(no_cities, [None] * 5)

    for trip_id in (no_plan, no_cities):
        assert stays(client, trip_id) == [(1, "Chicago, IL", "2026-10-10", "2026-10-14", 4)]


def test_city_spellings_are_grouped_and_a_missing_city_takes_the_one_before(client):
    register(client)
    trip_id = create_trip(client, destination=KATHMANDU)
    set_plan_cities(trip_id, [KATHMANDU, " kathmandu,  nepal", None, CHITWAN, CHITWAN])

    assert stays(client, trip_id) == [
        (1, KATHMANDU, "2026-10-10", "2026-10-13", 3),  # the first spelling is shown
        (2, CHITWAN, "2026-10-13", "2026-10-14", 1),
    ]


def test_a_city_visited_twice_is_two_stays(client):
    register(client)
    trip_id = create_trip(client, destination=KATHMANDU)
    set_plan_cities(trip_id, [KATHMANDU, CHITWAN, CHITWAN, KATHMANDU, KATHMANDU])

    assert [(n, city, nights) for n, city, _, _, nights in stays(client, trip_id)] == [
        (1, KATHMANDU, 1),
        (2, CHITWAN, 2),
        (3, KATHMANDU, 1),
    ]


def test_at_most_six_stays_and_extra_nights_join_the_last(client):
    register(client)
    trip_id = create_trip(client, destination="A", end_date="2026-10-18")  # 8 nights
    set_plan_cities(trip_id, list("ABCDEFGHI"))

    result = stays(client, trip_id)
    assert len(result) == 6
    assert result[-1] == (6, "F", "2026-10-15", "2026-10-18", 3)


def test_a_same_day_trip_is_one_night(client):
    register(client)
    trip_id = create_trip(client, end_date="2026-10-10")

    assert stays(client, trip_id) == [(1, "Chicago, IL", "2026-10-10", "2026-10-10", 1)]


def test_the_overview_makes_no_google_or_gemini_calls(client, monkeypatch):
    trip_id = two_city_trip(client)
    prompts = use_fake_gemini(monkeypatch)
    # The autouse no_real_places fixture fails the test if Places is called.

    data = overview(client, trip_id)

    assert [s["choice"] for s in data["stays"]] == [None, None]
    assert data["earlier_choices"] == []
    assert prompts == []


# --- A stay's section -----------------------------------------------------
def test_a_stays_section_searches_its_city_and_prices_its_dates(client, monkeypatch):
    trip_id = two_city_trip(client)

    sent = open_stay(client, monkeypatch, trip_id, 2, [TIGER], t1=90)

    [search] = [r for r in sent if r.get("url", "").endswith("searchText")]
    assert search["body"]["textQuery"] == f"hotels in {CHITWAN}"
    prompt = sent[-1]["prompts"][0]
    assert f"Destination: {CHITWAN}" in prompt
    assert "Check-in: 2026-10-12" in prompt
    assert "Check-out: 2026-10-14" in prompt
    page = sent[-1]["page"]
    assert page["stay"]["number"] == 2
    assert page["suggestions"][0]["stay_total"] == 180  # 90 x the stay's 2 nights


def test_unknown_stays_are_404_before_any_google_call(client):
    trip_id = two_city_trip(client)

    assert client.get(f"/api/trips/{trip_id}/lodging/stays/3").status_code == 404
    assert client.post(f"/api/trips/{trip_id}/lodging/stays/0/refresh").status_code == 404
    assert put_choice(client, trip_id, stay=3, choice="skip", reason="not_needed").status_code == 404
    assert client.delete(f"/api/trips/{trip_id}/lodging/stays/7").status_code == 404


# --- Choices per stay -----------------------------------------------------
def test_each_stay_has_its_own_choice_and_lodging_line(client, monkeypatch):
    trip_id = two_city_trip(client)
    open_stay(client, monkeypatch, trip_id, 1, [DRAKE], p1=140)

    put_choice(client, trip_id, stay=1, choice="hotel", place_id="p1")
    r = put_choice(client, trip_id, stay=2, choice="own", name="Tiger Camp", nightly_price=80, nights=2)

    assert (choice_of(r, 1)["total"], choice_of(r, 2)["total"]) == (280, 160)
    assert [line[1:] for line in lodging_lines(trip_id)] == [
        (280, "user", f"Lodging · {KATHMANDU}"),
        (160, "user", f"Lodging · {CHITWAN}"),
    ]
    items = client.get(f"/api/trips/{trip_id}/budget").json()["items"]
    assert [item["from_stay"] for item in items] == [True, True]
    for line_id, *_ in lodging_lines(trip_id):  # both are changed only on the Stay tab
        assert client.delete(f"/api/trips/{trip_id}/cost-items/{line_id}").status_code == 409


def test_a_stays_budget_left_takes_off_the_other_stays_choices(client, monkeypatch):
    trip_id = two_city_trip(client, budget=1000)
    open_stay(client, monkeypatch, trip_id, 1, [DRAKE], p1=140)

    r = put_choice(client, trip_id, stay=1, choice="hotel", place_id="p1")  # 280

    assert [s["budget_left"] for s in r.json()["stays"]] == [1000, 720]  # stay 1 doesn't count against itself
    assert r.json()["lodging_budget_left"] == 1000

    page = open_stay(client, monkeypatch, trip_id, 2, [TIGER], t1=390)[-1]["page"]
    assert page["stay"]["budget_left"] == 720
    assert page["suggestions"][0]["fit"] == "slightly_over"  # 780 of 720: within 10% (792)
    assert page["fit_note"] == "none_fit"


def test_nights_are_checked_against_the_stay(client, monkeypatch):
    trip_id = two_city_trip(client)
    open_stay(client, monkeypatch, trip_id, 1, [DRAKE], p1=140)

    too_many = put_choice(client, trip_id, stay=1, choice="hotel", place_id="p1", nights=3)
    default = put_choice(client, trip_id, stay=1, choice="hotel", place_id="p1")

    assert too_many.status_code == 422
    assert too_many.json()["detail"] == "Nights must be between 1 and 2, the length of this stay."
    assert choice_of(default)["nights"] == 2  # the whole stay, not the whole trip


def test_a_new_plan_that_moves_a_stay_is_pointed_out(client, monkeypatch):
    trip_id = two_city_trip(client)
    put_choice(client, trip_id, stay=2, choice="own", name="Tiger Camp", nightly_price=80, nights=2)

    set_plan_cities(trip_id, [KATHMANDU, KATHMANDU, POKHARA, POKHARA, POKHARA])  # regenerated

    second = overview(client, trip_id)["stays"][1]
    assert (second["city"], second["plan_changed"], second["choice_city"]) == (POKHARA, True, CHITWAN)
    assert second["choice"]["custom_name"] == "Tiger Camp"  # kept, not guessed away

    put_choice(client, trip_id, stay=2, choice="own", name="Lake Inn", nightly_price=70, nights=2)
    assert overview(client, trip_id)["stays"][1]["plan_changed"] is False


def test_choices_for_stays_a_new_plan_dropped_are_kept_until_removed(client):
    trip_id = two_city_trip(client)
    put_choice(client, trip_id, stay=2, choice="own", name="Tiger Camp", nightly_price=80, nights=2)

    set_plan_cities(trip_id, [KATHMANDU] * 5)  # one city now

    data = overview(client, trip_id)
    assert len(data["stays"]) == 1
    [earlier] = data["earlier_choices"]
    assert (earlier["number"], earlier["city"], earlier["choice"]["total"]) == (2, CHITWAN, 160)
    assert len(lodging_lines(trip_id)) == 1  # its money stays in the budget until removed

    r = client.delete(f"/api/trips/{trip_id}/lodging/stays/2")

    assert r.status_code == 200
    assert r.json()["earlier_choices"] == []
    assert lodging_lines(trip_id) == []


def test_a_one_stay_trip_is_never_flagged_for_its_destinations_spelling(client):
    register(client)
    trip_id = create_trip(client)  # "Chicago, IL"
    put_choice(client, trip_id, choice="own", name="Lake House", nightly_price=80, nights=4)  # before a plan

    set_plan_cities(trip_id, ["Chicago"] * 5)

    [stay] = overview(client, trip_id)["stays"]
    assert stay["plan_changed"] is False
    assert lodging_lines(trip_id)[0][3] == "Lodging"  # one stay: no city on the line


def test_choices_from_before_multi_city_are_never_flagged(client):
    trip_id = two_city_trip(client)
    set_choice(trip_id, choice="own", custom_name="Old Inn", nightly_price=50, nights=2)  # no city

    assert overview(client, trip_id)["stays"][0]["plan_changed"] is False


# --- Map pins -------------------------------------------------------------
def test_one_pin_per_stay_with_a_picked_hotel(client, monkeypatch):
    trip_id = two_city_trip(client)
    open_stay(client, monkeypatch, trip_id, 1, [DRAKE], p1=140)
    put_choice(client, trip_id, stay=1, choice="hotel", place_id="p1")
    open_stay(client, monkeypatch, trip_id, 2, [TIGER, LUX], t1=90, p2=300)
    put_choice(client, trip_id, stay=2, choice="hotel", place_id="p2")

    assert get_pins(client, trip_id) == [
        {"stay_number": 1, "city": KATHMANDU, "latitude": 27.7, "longitude": 85.3},
        {"stay_number": 2, "city": CHITWAN, "latitude": 27.7, "longitude": 86.3},
    ]


def test_own_hotels_skips_and_dropped_stays_have_no_pin(client, monkeypatch):
    trip_id = two_city_trip(client)
    open_stay(client, monkeypatch, trip_id, 2, [TIGER], t1=90)
    put_choice(client, trip_id, stay=2, choice="hotel", place_id="t1")
    put_choice(client, trip_id, stay=1, choice="own", name="Old Inn", nightly_price=50, nights=2)
    assert [pin["stay_number"] for pin in get_pins(client, trip_id)] == [2]

    set_plan_cities(trip_id, [KATHMANDU] * 5)  # stay 2 is gone

    assert get_pins(client, trip_id) == []


def test_each_stays_old_coordinates_are_refreshed(client, monkeypatch):
    trip_id = two_city_trip(client)
    open_stay(client, monkeypatch, trip_id, 1, [DRAKE], p1=140)
    put_choice(client, trip_id, stay=1, choice="hotel", place_id="p1")
    age_coords(trip_id, days=31)
    sent = fake_places(monkeypatch, details={"p1": {"location": {"latitude": 27.75, "longitude": 85.35}}})

    assert get_pins(client, trip_id)[0]["latitude"] == 27.75
    assert [r["field_mask"] for r in sent] == ["location"]


def test_stay_rows_are_kept_apart_per_stay(client, monkeypatch):
    trip_id = two_city_trip(client)
    put_choice(client, trip_id, stay=1, choice="skip", reason="have_place")
    put_choice(client, trip_id, stay=2, choice="skip", reason="not_needed")

    db = next(app.dependency_overrides[get_db]())
    try:
        rows = list(
            db.scalars(select(TripLodging).where(TripLodging.trip_id == trip_id).order_by(TripLodging.stay_number))
        )
        assert [(row.stay_number, row.city, row.skip_reason) for row in rows] == [
            (1, KATHMANDU, "have_place"),
            (2, CHITWAN, "not_needed"),
        ]
        assert LODGING_HOTEL not in {row.choice for row in rows}
    finally:
        db.close()
