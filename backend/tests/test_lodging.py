"""Where to stay: the traveler's lodging choice and hotel suggestions. Google and Gemini are faked."""

from datetime import timedelta, timezone

import httpx
from conftest import register
from fastapi.testclient import TestClient
from sqlalchemy import select
from test_places import fake_places, photo_uri, place
from test_plan import FIRST_PLAN, SECOND_PLAN, use_fake_gemini

from app import main
from app.config import settings
from app.database import Base, get_db
from app.lodging import clear_stale_coords
from app.main import app
from app.models import (
    LODGING_HOTEL,
    LODGING_OWN,
    USER_SOURCE,
    CostItem,
    TripHotelEstimate,
    TripLodging,
    utcnow,
)

VALID_TRIP = {
    "origin": "Dallas, TX",
    "destination": "Chicago, IL",
    "start_date": "2026-10-10",
    "end_date": "2026-10-14",
    "travelers": 2,
    "budget": 2000,
    "interests": ["food", "museums"],
}


def create_trip(client, **overrides) -> int:
    return client.post("/api/trips", json={**VALID_TRIP, **overrides}).json()["id"]


def add_lodging_rows(trip_id: int, place_id: str = "place-1") -> None:
    """A chosen hotel with its Lodging line and estimate, written straight to the database."""
    db = next(app.dependency_overrides[get_db]())
    try:
        line = CostItem(trip_id=trip_id, source=USER_SOURCE, category="lodging", amount=560.0, description="Lodging")
        db.add(line)
        db.flush()
        db.add(TripHotelEstimate(trip_id=trip_id, place_id=place_id, nightly_price=140.0))
        db.add(
            TripLodging(
                trip_id=trip_id,
                choice=LODGING_HOTEL,
                place_id=place_id,
                nightly_price=140.0,
                nights=4,
                cost_item_id=line.id,
            )
        )
        db.commit()
    finally:
        db.close()


def trip_ids_with(model) -> set[int]:
    db = next(app.dependency_overrides[get_db]())
    try:
        return set(db.scalars(select(model.trip_id)))
    finally:
        db.close()


# --- Data -----------------------------------------------------------------
def test_deleting_a_trip_removes_its_lodging_rows(client):
    register(client)
    deleted, kept = create_trip(client), create_trip(client)
    add_lodging_rows(deleted)
    add_lodging_rows(kept)

    assert client.delete(f"/api/trips/{deleted}").status_code == 204

    # SQLite can reuse the id, so nothing of the deleted trip may be left behind.
    assert trip_ids_with(TripLodging) == {kept}
    assert trip_ids_with(TripHotelEstimate) == {kept}
    assert trip_ids_with(CostItem) == {kept}


# --- Suggestions ----------------------------------------------------------
DRAKE = place("p1", "The Drake")
LUX = place("p2", "Hotel Lux", rating=4.2, userRatingCount=310)


def prices(**nightly) -> dict:
    """Gemini's answer: place_id -> nightly USD."""
    return {"prices": [{"place_id": place_id, "nightly_usd": usd} for place_id, usd in nightly.items()]}


def get_lodging(client, trip_id: int) -> dict:
    r = client.get(f"/api/trips/{trip_id}/lodging")
    assert r.status_code == 200, r.text
    return r.json()


def by_id(page: dict) -> dict[str, dict]:
    return {s["place_id"]: s for s in page["suggestions"]}


def stored_estimates(trip_id: int) -> dict[str, float | None]:
    db = next(app.dependency_overrides[get_db]())
    try:
        rows = db.scalars(select(TripHotelEstimate).where(TripHotelEstimate.trip_id == trip_id))
        return {row.place_id: row.nightly_price for row in rows}
    finally:
        db.close()


def set_choice(trip_id: int, **fields) -> None:
    """A lodging choice written straight to the database (PUT comes in a later step)."""
    db = next(app.dependency_overrides[get_db]())
    try:
        db.add(TripLodging(trip_id=trip_id, **fields))
        db.commit()
    finally:
        db.close()


def test_lodging_requires_login(client):
    assert client.get("/api/trips/1/lodging").status_code == 401
    assert client.post("/api/trips/1/lodging/refresh").status_code == 401


def test_another_users_trip_returns_404(client):
    register(client)
    trip_id = create_trip(client)
    client.post("/api/auth/logout")
    register(client, email="second@example.com")

    assert client.get(f"/api/trips/{trip_id}/lodging").status_code == 404
    assert client.post(f"/api/trips/{trip_id}/lodging/refresh").status_code == 404


def test_suggestions_have_details_estimates_and_attribution(client, monkeypatch):
    fake_places(monkeypatch, search={"places": [DRAKE, LUX]})
    use_fake_gemini(monkeypatch, prices(p1=140, p2=300))
    register(client)
    trip_id = create_trip(client)

    page = get_lodging(client, trip_id)

    assert page["nights"] == 4
    assert page["currency"] == "USD"
    assert page["lodging_budget_left"] == 2000
    assert page["suggestions_status"] == "ok"
    assert page["choice"] is None
    assert page["fit_note"] is None
    assert page["suggestions"][0] == {
        "place_id": "p1",
        "name": "The Drake",
        "area": "Near North Side",
        "address": "1 The Drake St, Chicago, IL 60611, USA",
        "rating": 4.6,
        "review_count": 1284,
        "google_maps_uri": "https://maps.google.com/?cid=p1",
        "photo": {
            "uri": photo_uri("p1"),
            "authors": [{"name": "Sam Lee", "uri": "https://maps.google.com/maps/contrib/1"}],
        },
        "nightly_estimate": 140,
        "stay_total": 560,
        "fit": "fits",
        "best_fit": True,
    }
    assert by_id(page)["p2"]["stay_total"] == 1200


def test_the_estimate_prompt_describes_the_trip_and_hotels(client, monkeypatch):
    fake_places(monkeypatch, search={"places": [DRAKE, LUX]})
    prompts = use_fake_gemini(monkeypatch, prices(p1=140, p2=300))
    register(client)
    trip_id = create_trip(client)

    get_lodging(client, trip_id)

    [prompt] = prompts
    for expected in (
        "Destination: Chicago, IL",
        "Check-in: 2026-10-10",
        "Check-out: 2026-10-14",
        "Number of travelers: 2",
        "- id: p1 | The Drake | Near North Side",
        "- id: p2 | Hotel Lux | Near North Side",
        "USD",
    ):
        assert expected in prompt


def test_estimates_are_kept_but_google_is_asked_every_time(client, monkeypatch):
    sent = fake_places(monkeypatch, search={"places": [DRAKE, LUX]})
    prompts = use_fake_gemini(monkeypatch, prices(p1=140, p2=300))
    register(client)
    trip_id = create_trip(client)

    get_lodging(client, trip_id)
    again = get_lodging(client, trip_id)

    assert len(prompts) == 1  # our own estimates are reused
    assert len([r for r in sent if r["url"].endswith("searchText")]) == 2  # Google content is never cached
    assert by_id(again)["p1"]["nightly_estimate"] == 140
    assert stored_estimates(trip_id) == {"p1": 140, "p2": 300}


def test_only_new_hotels_are_priced(client, monkeypatch):
    fake_places(monkeypatch, search={"places": [DRAKE]})
    prompts = use_fake_gemini(monkeypatch, prices(p1=140), prices(p2=300))
    register(client)
    trip_id = create_trip(client)
    get_lodging(client, trip_id)

    fake_places(monkeypatch, search={"places": [DRAKE, LUX]})
    page = get_lodging(client, trip_id)

    assert "id: p2" in prompts[1] and "id: p1" not in prompts[1]
    assert {k: v["nightly_estimate"] for k, v in by_id(page).items()} == {"p1": 140, "p2": 300}


def test_refresh_searches_again_and_reestimates_every_hotel(client, monkeypatch):
    fake_places(monkeypatch, search={"places": [DRAKE, LUX]})
    prompts = use_fake_gemini(monkeypatch, prices(p1=140, p2=300), prices(p1=150, p2=310))
    register(client)
    trip_id = create_trip(client)
    get_lodging(client, trip_id)

    r = client.post(f"/api/trips/{trip_id}/lodging/refresh")

    assert r.status_code == 200
    assert "id: p1" in prompts[1] and "id: p2" in prompts[1]
    assert {k: v["nightly_estimate"] for k, v in by_id(r.json()).items()} == {"p1": 150, "p2": 310}
    assert stored_estimates(trip_id) == {"p1": 150, "p2": 310}


def test_a_failed_refresh_keeps_the_earlier_estimates(client, monkeypatch):
    fake_places(monkeypatch, search={"places": [DRAKE]})
    use_fake_gemini(monkeypatch, prices(p1=140), "not json")
    register(client)
    trip_id = create_trip(client)
    get_lodging(client, trip_id)

    page = client.post(f"/api/trips/{trip_id}/lodging/refresh").json()

    assert page["suggestions"][0]["nightly_estimate"] == 140


def test_without_an_estimate_hotels_still_show_and_are_priced_next_time(client, monkeypatch):
    fake_places(monkeypatch, search={"places": [DRAKE]})
    prompts = use_fake_gemini(monkeypatch, "not json", prices(p1=140))
    register(client)
    trip_id = create_trip(client)

    first = get_lodging(client, trip_id)["suggestions"][0]
    assert first["name"] == "The Drake"
    assert [first[key] for key in ("nightly_estimate", "stay_total", "fit", "best_fit")] == [None, None, None, False]
    assert stored_estimates(trip_id) == {"p1": None}  # still marked as suggested, so it can be picked

    assert get_lodging(client, trip_id)["suggestions"][0]["nightly_estimate"] == 140
    assert len(prompts) == 2


def test_bad_estimates_are_ignored(client, monkeypatch):
    fake_places(monkeypatch, search={"places": [DRAKE, LUX, place("p3", "Hotel Three")]})
    answer = {
        "prices": [
            {"place_id": "p1", "nightly_usd": -5},
            {"place_id": "p2", "nightly_usd": "cheap"},
            {"place_id": "p3", "nightly_usd": 99.999},
            {"place_id": "unknown", "nightly_usd": 100},
        ]
    }
    use_fake_gemini(monkeypatch, answer)
    register(client)
    trip_id = create_trip(client)

    page = get_lodging(client, trip_id)

    assert {k: v["nightly_estimate"] for k, v in by_id(page).items()} == {"p1": None, "p2": None, "p3": 100.0}
    assert "unknown" not in stored_estimates(trip_id)


# --- Budget fit -----------------------------------------------------------
def test_fit_bands_order_and_one_best_fit(client, monkeypatch):
    hotels = [
        place("over", "Over", rating=5.0),
        place("slight", "Slightly", rating=4.9),
        place("edge", "Edge", rating=4.2),
        place("cheap", "Cheap", rating=4.8),
    ]
    fake_places(monkeypatch, search={"places": hotels})
    use_fake_gemini(monkeypatch, prices(over=441, slight=440, edge=400, cheap=300))
    register(client)
    trip_id = create_trip(client)
    client.post(f"/api/trips/{trip_id}/cost-items", json={"category": "food", "amount": 400})

    page = get_lodging(client, trip_id)

    # 2000 budget - 400 food = 1600 for 4 nights. Up to 1760 (10% over) is "slightly over".
    assert page["lodging_budget_left"] == 1600
    assert [(s["place_id"], s["stay_total"], s["fit"]) for s in page["suggestions"]] == [
        ("cheap", 1200, "fits"),
        ("edge", 1600, "fits"),
        ("slight", 1760, "slightly_over"),
        ("over", 1764, "over"),
    ]
    assert [s["place_id"] for s in page["suggestions"] if s["best_fit"]] == ["cheap"]
    assert page["fit_note"] is None


def test_lodging_lines_dont_count_against_the_lodging_budget(client, monkeypatch):
    fake_places(monkeypatch, search={"places": [DRAKE]})
    use_fake_gemini(monkeypatch, prices(p1=140))
    register(client)
    trip_id = create_trip(client)
    client.post(f"/api/trips/{trip_id}/cost-items", json={"category": "food", "amount": 400})
    client.post(f"/api/trips/{trip_id}/cost-items", json={"category": "lodging", "amount": 900})

    assert get_lodging(client, trip_id)["lodging_budget_left"] == 1600


def test_when_nothing_fits_there_is_no_best_fit(client, monkeypatch):
    fake_places(monkeypatch, search={"places": [DRAKE, LUX]})
    use_fake_gemini(monkeypatch, prices(p1=140, p2=300))
    register(client)
    trip_id = create_trip(client, budget=520)

    page = get_lodging(client, trip_id)

    assert page["fit_note"] == "none_fit"
    # 520 left: 560 is within 10% (572), 1200 isn't.
    assert [s["fit"] for s in page["suggestions"]] == ["slightly_over", "over"]
    assert not any(s["best_fit"] for s in page["suggestions"])


def test_already_over_budget_makes_every_hotel_over(client, monkeypatch):
    fake_places(monkeypatch, search={"places": [DRAKE]})
    use_fake_gemini(monkeypatch, prices(p1=140))
    register(client)
    trip_id = create_trip(client, budget=100)
    client.post(f"/api/trips/{trip_id}/cost-items", json={"category": "food", "amount": 150})

    page = get_lodging(client, trip_id)

    assert page["lodging_budget_left"] == -50
    assert page["suggestions"][0]["fit"] == "over"


def test_without_a_budget_hotels_are_sorted_by_rating(client, monkeypatch):
    hotels = [place("low", "Low", rating=3.9), place("top", "Top", rating=4.9), place("mid", "Mid", rating=4.5)]
    fake_places(monkeypatch, search={"places": hotels})
    use_fake_gemini(monkeypatch, prices(low=90, top=400, mid=200))
    register(client)
    trip_id = create_trip(client, budget=None)

    page = get_lodging(client, trip_id)

    assert page["fit_note"] == "no_budget"
    assert page["lodging_budget_left"] is None
    assert [s["place_id"] for s in page["suggestions"]] == ["top", "mid", "low"]
    assert {s["fit"] for s in page["suggestions"]} == {None}
    assert not any(s["best_fit"] for s in page["suggestions"])


def test_a_same_day_trip_counts_one_night(client, monkeypatch):
    fake_places(monkeypatch, search={"places": [DRAKE]})
    use_fake_gemini(monkeypatch, prices(p1=140))
    register(client)
    trip_id = create_trip(client, end_date="2026-10-10")

    page = get_lodging(client, trip_id)

    assert page["nights"] == 1
    assert page["suggestions"][0]["stay_total"] == 140


# --- Fallbacks ------------------------------------------------------------
def test_without_a_key_the_page_still_works(client, monkeypatch):
    prompts = use_fake_gemini(monkeypatch)
    register(client)
    trip_id = create_trip(client)
    set_choice(trip_id, choice=LODGING_OWN, custom_name="Lake House", nightly_price=0, nights=4)

    page = get_lodging(client, trip_id)

    assert page["suggestions_status"] == "not_configured"
    assert page["suggestions"] == []
    assert page["choice"]["custom_name"] == "Lake House"
    assert prompts == []


def test_without_a_gemini_key_hotels_show_without_estimates(client, monkeypatch):
    fake_places(monkeypatch, search={"places": [DRAKE]})
    monkeypatch.setattr(settings, "llm_api_key", "")
    register(client)
    trip_id = create_trip(client)

    page = get_lodging(client, trip_id)

    assert page["suggestions"][0]["name"] == "The Drake"
    assert page["suggestions"][0]["nightly_estimate"] is None


def test_a_places_error_still_shows_the_page(client, monkeypatch):
    fake_places(monkeypatch, search=httpx.ConnectError("down"))
    prompts = use_fake_gemini(monkeypatch)
    register(client)
    trip_id = create_trip(client)

    page = get_lodging(client, trip_id)

    assert page["suggestions_status"] == "unavailable"
    assert page["suggestions"] == []
    assert prompts == []


# --- Current choice -------------------------------------------------------
def test_a_chosen_hotel_in_the_results_needs_no_extra_lookup(client, monkeypatch):
    sent = fake_places(monkeypatch, search={"places": [DRAKE, LUX]})
    use_fake_gemini(monkeypatch, prices(p2=300))
    register(client)
    trip_id = create_trip(client)
    add_lodging_rows(trip_id, place_id="p1")  # chose The Drake at 140 x 4

    choice = get_lodging(client, trip_id)["choice"]

    assert choice["choice"] == "hotel"
    assert choice["hotel"]["name"] == "The Drake"
    assert choice["hotel"]["photo"]["uri"] == photo_uri("p1")
    assert (choice["nightly_price"], choice["nights"], choice["total"]) == (140, 4, 560)
    assert choice["nights_exceed_trip"] is False
    assert not any(r["url"].endswith("/places/p1") for r in sent)


def test_a_chosen_hotel_not_in_the_results_is_looked_up(client, monkeypatch):
    sent = fake_places(monkeypatch, search={"places": [LUX]}, details={"p1": place("p1", "The Drake")})
    use_fake_gemini(monkeypatch, prices(p2=300))
    register(client)
    trip_id = create_trip(client)
    add_lodging_rows(trip_id, place_id="p1")

    choice = get_lodging(client, trip_id)["choice"]

    assert choice["hotel"]["name"] == "The Drake"
    assert [r["url"] for r in sent if r["url"].endswith("/places/p1")] == ["https://places.googleapis.com/v1/places/p1"]


def test_a_chosen_hotel_google_cant_find_still_shows_its_price(client, monkeypatch):
    fake_places(monkeypatch, search={"places": [LUX]}, details={"p1": httpx.ConnectError("down")})
    use_fake_gemini(monkeypatch, prices(p2=300))
    register(client)
    trip_id = create_trip(client)
    add_lodging_rows(trip_id, place_id="p1")

    choice = get_lodging(client, trip_id)["choice"]

    assert choice["hotel"] is None
    assert (choice["place_id"], choice["total"]) == ("p1", 560)


def test_shortened_dates_are_flagged_on_the_choice(client, monkeypatch):
    use_fake_gemini(monkeypatch)
    register(client)
    trip_id = create_trip(client)
    set_choice(trip_id, choice=LODGING_OWN, custom_name="Lake Inn", nightly_price=120.5, nights=4)
    client.put(f"/api/trips/{trip_id}", json={**VALID_TRIP, "end_date": "2026-10-12"})

    choice = get_lodging(client, trip_id)["choice"]

    assert choice["nights_exceed_trip"] is True
    assert choice["total"] == 482


def test_nothing_from_google_is_stored(client, monkeypatch):
    fake_places(monkeypatch, search={"places": [DRAKE, LUX]})
    use_fake_gemini(monkeypatch, prices(p1=140, p2=300))
    register(client)
    trip_id = create_trip(client)
    add_lodging_rows(trip_id, place_id="p1")
    client.post(f"/api/trips/{trip_id}/lodging/refresh")

    db = next(app.dependency_overrides[get_db]())
    try:
        everything = repr([db.execute(table.select()).all() for table in Base.metadata.sorted_tables])
    finally:
        db.close()
    for google_content in ("The Drake", "Hotel Lux", "Near North Side", "Sam Lee", "googleusercontent", "cid="):
        assert google_content not in everything


# --- Choosing -------------------------------------------------------------
DRAKE_AT = (41.9, -87.62)


def suggest(client, monkeypatch, trip_id: int, estimates=None, locations=None) -> list[dict]:
    """Open Where to stay with The Drake (140/night) and Hotel Lux (300/night). Returns the Places requests."""
    if locations is None:
        locations = {"p1": {"location": {"latitude": DRAKE_AT[0], "longitude": DRAKE_AT[1]}}, "p2": {}}
    sent = fake_places(monkeypatch, search={"places": [DRAKE, LUX]}, details=locations)
    use_fake_gemini(monkeypatch, estimates or prices(p1=140, p2=300))
    get_lodging(client, trip_id)
    return sent


def put_choice(client, trip_id: int, **body):
    return client.put(f"/api/trips/{trip_id}/lodging", json=body)


def lodging_lines(trip_id: int) -> list[tuple]:
    """(id, amount, source, description) of the trip's lodging cost lines."""
    db = next(app.dependency_overrides[get_db]())
    try:
        rows = db.scalars(select(CostItem).where(CostItem.trip_id == trip_id, CostItem.category == "lodging"))
        return [(line.id, line.amount, line.source, line.description) for line in rows]
    finally:
        db.close()


def stored_choice(trip_id: int) -> TripLodging | None:
    db = next(app.dependency_overrides[get_db]())
    try:
        return db.scalar(select(TripLodging).where(TripLodging.trip_id == trip_id))
    finally:
        db.close()


def location_requests(sent: list[dict]) -> list[dict]:
    return [r for r in sent if r["field_mask"] == "location"]


def test_choose_requires_login_and_ownership(client):
    assert client.put("/api/trips/1/lodging", json={"choice": "skip", "reason": "not_needed"}).status_code == 401
    assert client.delete("/api/trips/1/lodging").status_code == 401

    register(client)
    trip_id = create_trip(client)
    client.post("/api/auth/logout")
    register(client, email="second@example.com")

    assert put_choice(client, trip_id, choice="skip", reason="not_needed").status_code == 404
    assert client.delete(f"/api/trips/{trip_id}/lodging").status_code == 404


def test_picking_a_hotel_uses_its_estimate_for_the_whole_trip(client, monkeypatch):
    register(client)
    trip_id = create_trip(client)
    sent = suggest(client, monkeypatch, trip_id)

    r = put_choice(client, trip_id, choice="hotel", place_id="p1")

    assert r.status_code == 200
    assert r.json() == {
        "choice": "hotel",
        "skip_reason": None,
        "place_id": "p1",
        "hotel": None,  # the page already shows it; not fetched again
        "custom_name": None,
        "nightly_price": 140,
        "nights": 4,
        "total": 560,
        "nights_exceed_trip": False,
    }
    [(_, amount, source, description)] = lodging_lines(trip_id)
    assert (amount, source, description) == (560, "user", "Lodging")

    row = stored_choice(trip_id)
    assert (row.latitude, row.longitude) == DRAKE_AT
    assert row.coords_fetched_at is not None
    assert len(location_requests(sent)) == 1


def test_picking_with_my_own_price_and_nights(client, monkeypatch):
    register(client)
    trip_id = create_trip(client)
    suggest(client, monkeypatch, trip_id)

    r = put_choice(client, trip_id, choice="hotel", place_id="p2", nightly_price=275.555, nights=2)

    assert (r.json()["nightly_price"], r.json()["nights"], r.json()["total"]) == (275.56, 2, 551.12)
    assert [line[1] for line in lodging_lines(trip_id)] == [551.12]


def test_a_hotel_whose_location_cant_be_found_is_still_saved(client, monkeypatch):
    register(client)
    trip_id = create_trip(client)
    suggest(client, monkeypatch, trip_id)

    assert put_choice(client, trip_id, choice="hotel", place_id="p2").status_code == 200  # p2 has no location

    row = stored_choice(trip_id)
    assert (row.latitude, row.longitude, row.coords_fetched_at) == (None, None, None)


def test_picking_the_same_hotel_again_keeps_fresh_coordinates(client, monkeypatch):
    register(client)
    trip_id = create_trip(client)
    sent = suggest(client, monkeypatch, trip_id)
    put_choice(client, trip_id, choice="hotel", place_id="p1")

    put_choice(client, trip_id, choice="hotel", place_id="p1", nights=3)

    assert len(location_requests(sent)) == 1
    assert [line[1] for line in lodging_lines(trip_id)] == [420]


def test_only_suggested_hotels_can_be_picked(client, monkeypatch):
    register(client)
    trip_id = create_trip(client)
    suggest(client, monkeypatch, trip_id)

    r = put_choice(client, trip_id, choice="hotel", place_id="not-suggested")

    assert r.status_code == 422
    assert r.json()["detail"] == "Choose one of the suggested hotels."
    assert stored_choice(trip_id) is None
    assert lodging_lines(trip_id) == []


def test_a_hotel_without_an_estimate_needs_a_price(client, monkeypatch):
    register(client)
    trip_id = create_trip(client)
    suggest(client, monkeypatch, trip_id, estimates="not json")

    r = put_choice(client, trip_id, choice="hotel", place_id="p1")
    assert r.status_code == 422
    assert r.json()["detail"] == "This hotel has no price estimate. Enter a nightly price."

    assert put_choice(client, trip_id, choice="hotel", place_id="p1", nightly_price=99).json()["total"] == 396


def test_adding_my_own_hotel(client, monkeypatch):
    register(client)
    trip_id = create_trip(client)

    r = put_choice(client, trip_id, choice="own", name="  Lake House  ", nightly_price=80, nights=3)

    assert r.status_code == 200
    assert (r.json()["choice"], r.json()["custom_name"], r.json()["place_id"], r.json()["total"]) == (
        "own",
        "Lake House",
        None,
        240,
    )
    assert [line[1:] for line in lodging_lines(trip_id)] == [(240, "user", "Lodging")]
    assert stored_choice(trip_id).latitude is None  # no place ID, so no map pin


def test_skipping_stores_the_reason_and_no_cost_line(client):
    register(client)
    trip_id = create_trip(client)

    r = put_choice(client, trip_id, choice="skip", reason="have_place")

    assert r.status_code == 200
    assert (r.json()["choice"], r.json()["skip_reason"], r.json()["total"]) == ("skip", "have_place", None)
    assert lodging_lines(trip_id) == []


def test_changing_the_choice_keeps_exactly_one_line_the_same_line(client, monkeypatch):
    register(client)
    trip_id = create_trip(client)
    suggest(client, monkeypatch, trip_id)

    put_choice(client, trip_id, choice="hotel", place_id="p1")
    [(line_id, amount, *_)] = lodging_lines(trip_id)
    assert amount == 560

    put_choice(client, trip_id, choice="own", name="Lake House", nightly_price=80, nights=4)
    assert lodging_lines(trip_id) == [(line_id, 320, "user", "Lodging")]
    row = stored_choice(trip_id)
    assert (row.place_id, row.latitude) == (None, None)

    put_choice(client, trip_id, choice="hotel", place_id="p2")
    assert lodging_lines(trip_id) == [(line_id, 1200, "user", "Lodging")]

    put_choice(client, trip_id, choice="skip", reason="not_needed")
    assert lodging_lines(trip_id) == []

    put_choice(client, trip_id, choice="hotel", place_id="p1")
    assert [line[1] for line in lodging_lines(trip_id)] == [560]


def test_removing_the_choice_removes_its_line_only(client, monkeypatch):
    register(client)
    trip_id = create_trip(client)
    suggest(client, monkeypatch, trip_id)
    client.post(f"/api/trips/{trip_id}/cost-items", json={"category": "lodging", "amount": 50, "description": "Hostel"})
    put_choice(client, trip_id, choice="hotel", place_id="p1")

    r = client.delete(f"/api/trips/{trip_id}/lodging")

    assert r.status_code == 204
    assert stored_choice(trip_id) is None
    assert [line[1:] for line in lodging_lines(trip_id)] == [(50, "user", "Hostel")]
    assert client.delete(f"/api/trips/{trip_id}/lodging").status_code == 204  # nothing left: still fine


def test_regenerating_the_plan_keeps_the_lodging_line(client, monkeypatch):
    register(client)
    trip_id = create_trip(client)
    suggest(client, monkeypatch, trip_id)
    put_choice(client, trip_id, choice="hotel", place_id="p1")
    [line] = lodging_lines(trip_id)

    monkeypatch.setattr(settings, "maps_api_key", "")  # plans saved without map lookups
    use_fake_gemini(monkeypatch, FIRST_PLAN, SECOND_PLAN)
    assert client.post(f"/api/trips/{trip_id}/plan").status_code == 200
    assert client.post(f"/api/trips/{trip_id}/plan").status_code == 200

    assert lodging_lines(trip_id) == [line]
    assert stored_choice(trip_id).cost_item_id == line[0]


def test_the_choice_shows_in_the_budget(client, monkeypatch):
    register(client)
    trip_id = create_trip(client)
    suggest(client, monkeypatch, trip_id)
    client.post(f"/api/trips/{trip_id}/cost-items", json={"category": "lodging", "amount": 50})
    put_choice(client, trip_id, choice="hotel", place_id="p1")

    budget = client.get(f"/api/trips/{trip_id}/budget").json()

    lodging = next(c["amount"] for c in budget["categories"] if c["category"] == "lodging")
    assert lodging == 610
    assert sorted((item["amount"], item["from_stay"]) for item in budget["items"]) == [(50, False), (560, True)]


def test_the_stay_line_cant_be_edited_or_deleted_in_the_budget(client, monkeypatch):
    register(client)
    trip_id = create_trip(client)
    suggest(client, monkeypatch, trip_id)
    put_choice(client, trip_id, choice="hotel", place_id="p1")
    [(line_id, *_)] = lodging_lines(trip_id)

    edit = client.put(f"/api/trips/{trip_id}/cost-items/{line_id}", json={"category": "lodging", "amount": 1})
    delete = client.delete(f"/api/trips/{trip_id}/cost-items/{line_id}")

    for r in (edit, delete):
        assert r.status_code == 409
        assert r.json()["detail"] == "This line comes from your Where to stay choice. Change it on the Stay tab."
    assert [line[1] for line in lodging_lines(trip_id)] == [560]


# --- Validation -----------------------------------------------------------
def test_nights_must_fit_the_trip(client, monkeypatch):
    register(client)
    trip_id = create_trip(client)
    suggest(client, monkeypatch, trip_id)

    too_many = put_choice(client, trip_id, choice="hotel", place_id="p1", nights=5)
    own_too_many = put_choice(client, trip_id, choice="own", name="Inn", nightly_price=80, nights=5)
    zero = put_choice(client, trip_id, choice="own", name="Inn", nightly_price=80, nights=0)

    for r in (too_many, own_too_many):
        assert r.status_code == 422
        assert r.json()["detail"] == "Nights must be between 1 and 4, the length of your trip."
    assert zero.status_code == 422
    assert zero.json()["detail"][0]["msg"] == "Value error, Nights must be at least 1"
    assert stored_choice(trip_id) is None


def test_invalid_choices_are_422_with_clear_messages(client):
    register(client)
    trip_id = create_trip(client)

    cases = [
        ({"choice": "own", "name": "Inn", "nightly_price": -1, "nights": 2}, "Nightly price can't be negative"),
        ({"choice": "own", "name": "   ", "nightly_price": 80, "nights": 2}, "Enter your hotel's name"),
        ({"choice": "hotel", "place_id": "p1", "nightly_price": -5}, "Nightly price can't be negative"),
    ]
    for body, message in cases:
        r = put_choice(client, trip_id, **body)
        assert r.status_code == 422, body
        assert r.json()["detail"][0]["msg"] == f"Value error, {message}"

    for body in (
        {"choice": "own", "nightly_price": 80, "nights": 2},  # no name
        {"choice": "own", "name": "Inn", "nights": 2},  # no price
        {"choice": "skip", "reason": "bored"},
        {"choice": "castle"},
        {},
    ):
        assert put_choice(client, trip_id, **body).status_code == 422, body
    assert stored_choice(trip_id) is None


# --- Map pin and the 30-day rule ------------------------------------------
def get_pin(client, trip_id: int):
    r = client.get(f"/api/trips/{trip_id}/lodging/pin")
    assert r.status_code == 200, r.text
    return r.json()


def age_coords(trip_id: int, days: int) -> None:
    """Pretend the stored coordinates were fetched `days` ago."""
    db = next(app.dependency_overrides[get_db]())
    try:
        row = db.scalar(select(TripLodging).where(TripLodging.trip_id == trip_id))
        row.coords_fetched_at = utcnow() - timedelta(days=days)
        db.commit()
    finally:
        db.close()


def test_pin_requires_login_and_ownership(client):
    assert client.get("/api/trips/1/lodging/pin").status_code == 401

    register(client)
    trip_id = create_trip(client)
    client.post("/api/auth/logout")
    register(client, email="second@example.com")

    assert client.get(f"/api/trips/{trip_id}/lodging/pin").status_code == 404


def test_a_picked_hotel_has_a_pin_without_another_lookup(client, monkeypatch):
    register(client)
    trip_id = create_trip(client)
    sent = suggest(client, monkeypatch, trip_id)
    put_choice(client, trip_id, choice="hotel", place_id="p1")

    assert get_pin(client, trip_id) == {"latitude": DRAKE_AT[0], "longitude": DRAKE_AT[1]}
    assert len(location_requests(sent)) == 1  # only the one made when picking


def test_no_choice_own_hotel_or_skip_have_no_pin(client):
    register(client)
    trip_id = create_trip(client)
    assert get_pin(client, trip_id) is None

    put_choice(client, trip_id, choice="own", name="Lake House", nightly_price=80, nights=2)
    assert get_pin(client, trip_id) is None

    put_choice(client, trip_id, choice="skip", reason="not_needed")
    assert get_pin(client, trip_id) is None


def test_coordinates_older_than_30_days_are_looked_up_again(client, monkeypatch):
    register(client)
    trip_id = create_trip(client)
    suggest(client, monkeypatch, trip_id)
    put_choice(client, trip_id, choice="hotel", place_id="p1")
    age_coords(trip_id, days=31)
    sent = fake_places(monkeypatch, details={"p1": {"location": {"latitude": 41.95, "longitude": -87.65}}})

    assert get_pin(client, trip_id) == {"latitude": 41.95, "longitude": -87.65}

    assert [r["field_mask"] for r in sent] == ["location"]
    row = stored_choice(trip_id)
    assert (row.latitude, row.longitude) == (41.95, -87.65)
    assert utcnow() - row.coords_fetched_at.replace(tzinfo=timezone.utc) < timedelta(minutes=1)


def test_coordinates_under_30_days_old_are_kept(client, monkeypatch):
    register(client)
    trip_id = create_trip(client)
    suggest(client, monkeypatch, trip_id)
    put_choice(client, trip_id, choice="hotel", place_id="p1")
    age_coords(trip_id, days=29)
    sent = fake_places(monkeypatch)

    assert get_pin(client, trip_id) == {"latitude": DRAKE_AT[0], "longitude": DRAKE_AT[1]}
    assert sent == []


def test_old_coordinates_that_cant_be_refreshed_are_cleared(client, monkeypatch):
    register(client)
    trip_id = create_trip(client)
    suggest(client, monkeypatch, trip_id)
    put_choice(client, trip_id, choice="hotel", place_id="p1")
    age_coords(trip_id, days=31)
    fake_places(monkeypatch, details={"p1": httpx.ConnectError("down")})

    assert get_pin(client, trip_id) is None

    row = stored_choice(trip_id)
    assert (row.latitude, row.longitude, row.coords_fetched_at) == (None, None, None)
    assert row.place_id == "p1"  # the choice itself stays


def test_a_hotel_saved_without_a_location_gets_its_pin_later(client, monkeypatch):
    register(client)
    trip_id = create_trip(client)
    suggest(client, monkeypatch, trip_id, locations={"p1": httpx.ConnectError("down"), "p2": {}})
    put_choice(client, trip_id, choice="hotel", place_id="p1")
    fake_places(monkeypatch, details={"p1": {"location": {"latitude": DRAKE_AT[0], "longitude": DRAKE_AT[1]}}})

    assert get_pin(client, trip_id) == {"latitude": DRAKE_AT[0], "longitude": DRAKE_AT[1]}


def test_cleanup_clears_only_coordinates_older_than_30_days(client):
    register(client)
    old, recent, none = create_trip(client), create_trip(client), create_trip(client)
    set_choice(old, choice=LODGING_HOTEL, place_id="p1", latitude=41.9, longitude=-87.6, nightly_price=1, nights=1)
    set_choice(recent, choice=LODGING_HOTEL, place_id="p2", latitude=41.8, longitude=-87.7, nightly_price=1, nights=1)
    set_choice(none, choice=LODGING_OWN, custom_name="Lake House", nightly_price=1, nights=1)
    age_coords(old, days=31)
    age_coords(recent, days=2)

    db = next(app.dependency_overrides[get_db]())
    try:
        assert clear_stale_coords(db) == 1
        db.commit()
    finally:
        db.close()

    assert (stored_choice(old).latitude, stored_choice(old).coords_fetched_at) == (None, None)
    assert stored_choice(old).place_id == "p1"
    assert (stored_choice(recent).latitude, stored_choice(recent).longitude) == (41.8, -87.7)


def test_startup_runs_the_cleanup(monkeypatch):
    calls = []
    monkeypatch.setattr(main, "clear_stale_coords", lambda db: calls.append(db) or 0)

    with TestClient(app):
        pass

    assert len(calls) == 1
