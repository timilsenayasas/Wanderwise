"""Splitting a stay so one city has more than one hotel, and merging it back. Google and Gemini are faked."""

from conftest import register
from sqlalchemy import select
from test_lodging import DRAKE, choice_of, get_pins, lodging_lines, put_choice
from test_places import place
from test_stays import CHITWAN, KATHMANDU, POKHARA, create_trip, open_stay, overview, set_plan_cities

from app.database import get_db
from app.main import app
from app.models import TripStaySplit

YAK = place("y1", "Yak & Yeti")


def kathmandu_then_chitwan(client) -> int:
    """Oct 10 – 16 (6 nights): 4 nights in Kathmandu (Oct 10 – 14), then 2 in Chitwan (Oct 14 – 16)."""
    register(client)
    trip_id = create_trip(client, destination=KATHMANDU, end_date="2026-10-16")
    set_plan_cities(trip_id, [KATHMANDU] * 4 + [CHITWAN] * 3)
    return trip_id


def split(client, trip_id: int, night: str):
    return client.put(f"/api/trips/{trip_id}/splits/{night}")


def merge(client, trip_id: int, night: str):
    return client.delete(f"/api/trips/{trip_id}/splits/{night}")


def stays(data: dict) -> list[tuple]:
    """(number, city, check-in, check-out, nights, part, parts) per stay."""
    keys = ("number", "city", "check_in", "check_out", "nights", "part", "parts")
    return [tuple(s[key] for key in keys) for s in data["stays"]]


# --- Splitting ------------------------------------------------------------
def test_splitting_makes_two_parts_of_the_same_city(client):
    trip_id = kathmandu_then_chitwan(client)

    r = split(client, trip_id, "2026-10-12")

    assert r.status_code == 200
    assert stays(r.json()) == [
        (1, KATHMANDU, "2026-10-10", "2026-10-12", 2, 1, 2),
        (2, KATHMANDU, "2026-10-12", "2026-10-14", 2, 2, 2),
        (3, CHITWAN, "2026-10-14", "2026-10-16", 2, None, None),
    ]
    first, second, chitwan = r.json()["stays"]
    assert (first["merge_night"], second["merge_night"], chitwan["merge_night"]) == (None, "2026-10-12", None)
    assert [s["can_split"] for s in r.json()["stays"]] == [True, True, True]


def test_a_part_can_be_split_again(client):
    trip_id = kathmandu_then_chitwan(client)
    split(client, trip_id, "2026-10-12")

    r = split(client, trip_id, "2026-10-13")

    assert [(n, nights, part, parts) for n, _, _, _, nights, part, parts in stays(r.json())] == [
        (1, 2, 1, 3),
        (2, 1, 2, 3),
        (3, 1, 3, 3),
        (4, 2, None, None),
    ]


def test_later_stays_keep_their_choices(client):
    trip_id = kathmandu_then_chitwan(client)
    put_choice(client, trip_id, stay=2, choice="own", name="Tiger Camp", nightly_price=80, nights=2)

    r = split(client, trip_id, "2026-10-12")

    chitwan = r.json()["stays"][2]
    assert (chitwan["city"], chitwan["plan_changed"]) == (CHITWAN, False)
    assert chitwan["choice"]["custom_name"] == "Tiger Camp"
    assert r.json()["stays"][1]["choice"] is None  # the new part starts empty


def test_the_first_part_keeps_its_choice_shortened_with_its_line(client):
    trip_id = kathmandu_then_chitwan(client)
    put_choice(client, trip_id, stay=1, choice="own", name="Hotel Thamel", nightly_price=35, nights=4)

    r = split(client, trip_id, "2026-10-12")

    first = r.json()["stays"][0]["choice"]
    assert (first["custom_name"], first["nights"], first["total"]) == ("Hotel Thamel", 2, 70)
    assert [line[1:] for line in lodging_lines(trip_id)] == [(70, "user", f"Lodging · {KATHMANDU} · Oct 10 – 12")]


def test_each_part_has_its_own_choice_line_and_pin(client, monkeypatch):
    trip_id = kathmandu_then_chitwan(client)
    split(client, trip_id, "2026-10-12")
    open_stay(client, monkeypatch, trip_id, 1, [DRAKE], p1=140)
    put_choice(client, trip_id, stay=1, choice="hotel", place_id="p1")
    open_stay(client, monkeypatch, trip_id, 2, [YAK], y1=120)

    r = put_choice(client, trip_id, stay=2, choice="hotel", place_id="y1")

    assert (choice_of(r, 1)["place_id"], choice_of(r, 2)["place_id"]) == ("p1", "y1")
    assert [line[1:] for line in lodging_lines(trip_id)] == [
        (280, "user", f"Lodging · {KATHMANDU} · Oct 10 – 12"),
        (240, "user", f"Lodging · {KATHMANDU} · Oct 12 – 14"),
    ]
    assert [(pin["stay_number"], pin["part"], pin["parts"]) for pin in get_pins(client, trip_id)] == [
        (1, 1, 2),
        (2, 2, 2),
    ]


def test_splitting_a_one_stay_trip_names_the_parts_lines(client):
    register(client)
    trip_id = create_trip(client)  # Chicago, Oct 10 – 14
    put_choice(client, trip_id, choice="own", name="Lake House", nightly_price=80, nights=4)

    split(client, trip_id, "2026-10-12")
    assert lodging_lines(trip_id)[0][3] == "Lodging · Chicago, IL · Oct 10 – 12"

    merge(client, trip_id, "2026-10-12")
    assert lodging_lines(trip_id)[0][3] == "Lodging"  # one stay again


# --- What can't be split --------------------------------------------------
def test_a_stay_splits_only_after_its_first_night(client):
    trip_id = kathmandu_then_chitwan(client)

    for night in ("2026-10-10", "2026-10-14"):  # Kathmandu's and Chitwan's first nights
        r = split(client, trip_id, night)
        assert r.status_code == 422
        assert r.json()["detail"] == "Pick a night after the stay's first night, so each part has at least one."


def test_a_night_in_transit_or_outside_the_trip_cant_be_split(client):
    trip_id = kathmandu_then_chitwan(client)
    client.put(f"/api/trips/{trip_id}/nights/2026-10-12", json={"in_transit": True})

    transit = split(client, trip_id, "2026-10-12")
    assert transit.status_code == 422
    assert transit.json()["detail"] == "That night is spent travelling, so there's no stay to split."
    for night in ("2026-10-09", "2026-10-16"):  # before the trip; the last day has no night
        assert split(client, trip_id, night).status_code == 404


def test_splits_count_toward_the_six_stay_cap(client):
    register(client)
    trip_id = create_trip(client, destination=KATHMANDU, end_date="2026-10-17")  # 7 nights
    set_plan_cities(trip_id, [KATHMANDU] * 8)
    for night in ("2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15"):
        assert split(client, trip_id, night).status_code == 200  # 6 stays now

    r = split(client, trip_id, "2026-10-16")

    assert r.status_code == 422
    assert r.json()["detail"] == "A trip can have at most 6 stays, counting split ones."
    assert {s["can_split"] for s in overview(client, trip_id)["stays"]} == {False}


# --- Merging --------------------------------------------------------------
def test_merging_keeps_the_first_parts_choice_and_drops_the_seconds(client):
    trip_id = kathmandu_then_chitwan(client)
    put_choice(client, trip_id, stay=2, choice="own", name="Tiger Camp", nightly_price=80, nights=2)
    split(client, trip_id, "2026-10-12")
    put_choice(client, trip_id, stay=1, choice="own", name="Hotel Thamel", nightly_price=35, nights=2)
    put_choice(client, trip_id, stay=2, choice="own", name="Yak & Yeti", nightly_price=120, nights=2)

    r = merge(client, trip_id, "2026-10-12")

    assert r.status_code == 200
    assert stays(r.json())[0] == (1, KATHMANDU, "2026-10-10", "2026-10-14", 4, None, None)
    assert [choice_of(r, n)["custom_name"] for n in (1, 2)] == ["Hotel Thamel", "Tiger Camp"]  # Chitwan moved back
    assert [line[1:] for line in lodging_lines(trip_id)] == [
        (160, "user", f"Lodging · {CHITWAN}"),
        (70, "user", f"Lodging · {KATHMANDU}"),  # the first part's, as it was (2 nights)
    ]


def test_merging_keeps_and_stretches_the_second_parts_choice_when_it_is_the_only_one(client):
    trip_id = kathmandu_then_chitwan(client)
    split(client, trip_id, "2026-10-12")
    put_choice(client, trip_id, stay=2, choice="own", name="Yak & Yeti", nightly_price=120, nights=2)

    r = merge(client, trip_id, "2026-10-12")

    kept = choice_of(r, 1)
    assert (kept["custom_name"], kept["nights"], kept["total"]) == ("Yak & Yeti", 4, 480)
    assert [line[1:] for line in lodging_lines(trip_id)] == [(480, "user", f"Lodging · {KATHMANDU}")]


def test_merging_parts_without_choices(client):
    trip_id = kathmandu_then_chitwan(client)
    split(client, trip_id, "2026-10-12")

    r = merge(client, trip_id, "2026-10-12")

    assert [s[4] for s in stays(r.json())] == [4, 2]
    assert merge(client, trip_id, "2026-10-12").status_code == 404  # nothing left to merge


# --- Splits and new plans -------------------------------------------------
def test_a_split_outlives_a_new_plan_but_never_cuts_a_different_city(client):
    trip_id = kathmandu_then_chitwan(client)
    split(client, trip_id, "2026-10-12")

    set_plan_cities(trip_id, [KATHMANDU] * 2 + [POKHARA] * 2 + [CHITWAN] * 3)  # Pokhara on Oct 12 now
    assert [(city, part) for _, city, _, _, _, part, _ in stays(overview(client, trip_id))] == [
        (KATHMANDU, None),
        (POKHARA, None),  # set aside, not cutting Pokhara in two
        (CHITWAN, None),
    ]

    set_plan_cities(trip_id, [KATHMANDU] * 4 + [CHITWAN] * 3)  # Kathmandu again
    assert [part for *_, part, _ in stays(overview(client, trip_id))] == [1, 2, None]


def test_splits_need_login_the_owner_and_go_with_the_trip(client):
    assert client.put("/api/trips/1/splits/2026-10-12").status_code == 401
    trip_id = kathmandu_then_chitwan(client)
    split(client, trip_id, "2026-10-12")
    client.post("/api/auth/logout")
    register(client, email="second@example.com")

    assert split(client, trip_id, "2026-10-13").status_code == 404
    assert merge(client, trip_id, "2026-10-12").status_code == 404

    client.post("/api/auth/logout")
    client.post("/api/auth/login", json={"email": "Ada@Example.com", "password": "correct-horse-battery"})
    client.delete(f"/api/trips/{trip_id}")
    db = next(app.dependency_overrides[get_db]())
    try:
        assert db.scalars(select(TripStaySplit)).all() == []
    finally:
        db.close()
