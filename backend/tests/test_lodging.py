"""Where to stay: the traveler's lodging choice and hotel suggestions."""

from conftest import register
from sqlalchemy import select

from app.database import get_db
from app.main import app
from app.models import LODGING_HOTEL, USER_SOURCE, CostItem, TripHotelEstimate, TripLodging

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
