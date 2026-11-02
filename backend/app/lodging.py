"""Where to stay: hotel suggestions with price estimates and budget fit, and the traveler's choice.

Google's Places terms: hotel names, ratings and photos are fetched fresh for every response and
never stored. Only place IDs and our own data are (TripLodging, TripHotelEstimate).

Budget fit: a hotel's stay total (estimate x the trip's nights) against the budget left for
lodging (the trip budget minus every cost line except lodging, so the current choice doesn't
count against itself).
"""

from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.budget import PLAN_CURRENCY, budget_summary, to_cents, to_dollars
from app.config import logger
from app.models import (
    LODGING_HOTEL,
    LODGING_OWN,
    LODGING_SKIP,
    USER_SOURCE,
    CostItem,
    Trip,
    TripHotelEstimate,
    TripLodging,
    utcnow,
)
from app.schemas import (
    HotelChoiceIn,
    HotelOut,
    HotelPhotoOut,
    HotelSuggestionOut,
    LodgingChoiceIn,
    LodgingChoiceOut,
    LodgingFit,
    LodgingOut,
    OwnHotelIn,
    PhotoAuthorOut,
)
from app.services import hotel_prices, places
from app.services.geocoding import Coordinates

# "Slightly over" is up to this much above the budget left for lodging.
SLIGHTLY_OVER_SHARE = 0.10

# Google's Places terms: stored coordinates are refreshed or cleared after 30 days.
COORDS_MAX_AGE = timedelta(days=30)

# The description on the choice's cost line (Budget tab).
LODGING_LINE_DESCRIPTION = "Lodging"


class ChoiceError(Exception):
    """A lodging choice that can't be saved. The message is shown to the traveler."""

FIT_ORDER: dict[LodgingFit | None, int] = {"fits": 0, "slightly_over": 1, "over": 2, None: 3}


# --- Budget fit -----------------------------------------------------------
def trip_nights(trip: Trip) -> int:
    """Check-in on the start date, check-out on the end date; a same-day trip still counts one night."""
    return max(1, (trip.end_date - trip.start_date).days)


def lodging_budget_left(trip: Trip, db: Session) -> float | None:
    """The trip budget minus every cost line except lodging. None without a budget."""
    if trip.budget is None:
        return None
    summary = budget_summary(trip, db)
    lodging = next(total.amount for total in summary.categories if total.category == "lodging")
    return to_dollars(to_cents(trip.budget) - to_cents(summary.total) + to_cents(lodging))


def budget_fit(stay_total: float | None, left: float | None) -> LodgingFit | None:
    if stay_total is None or left is None:
        return None
    if to_cents(stay_total) <= to_cents(left):
        return "fits"
    if left > 0 and to_cents(stay_total) <= to_cents(left * (1 + SLIGHTLY_OVER_SHARE)):
        return "slightly_over"
    return "over"


def rank(suggestions: list[HotelSuggestionOut], has_budget: bool) -> list[HotelSuggestionOut]:
    """Best fit first (then rating, then price); without a budget, by rating. Flags one best fit."""
    if has_budget:
        no_price = float("inf")
        ranked = sorted(
            suggestions,
            key=lambda s: (FIT_ORDER[s.fit], -(s.rating or 0), no_price if s.stay_total is None else s.stay_total),
        )
    else:
        ranked = sorted(suggestions, key=lambda s: (-(s.rating or 0), -(s.review_count or 0)))
    if ranked and ranked[0].fit == "fits":
        ranked[0] = ranked[0].model_copy(update={"best_fit": True})
    return ranked


# --- Price estimates ------------------------------------------------------
def nightly_estimates(trip: Trip, hotels: list[places.Hotel], db: Session, fresh: bool) -> dict[str, float | None]:
    """place_id -> stored estimate, asking Gemini (once, for all of them) about hotels without one.

    fresh (Refresh) asks about every hotel again; a failed refresh keeps the earlier estimates.
    Every suggested hotel gets a row, so a later pick can be checked against it.
    """
    rows = {
        row.place_id: row
        for row in db.scalars(select(TripHotelEstimate).where(TripHotelEstimate.trip_id == trip.id))
    }
    to_price = [
        hotel
        for hotel in hotels
        if fresh or hotel.place_id not in rows or rows[hotel.place_id].nightly_price is None
    ]
    new_prices = hotel_prices.estimate_nightly_prices(
        trip.destination, trip.start_date, trip.end_date, trip.travelers, to_price
    )

    for hotel in hotels:
        row = rows.get(hotel.place_id)
        if row is None:
            row = rows[hotel.place_id] = TripHotelEstimate(trip_id=trip.id, place_id=hotel.place_id)
            db.add(row)
        if hotel.place_id in new_prices:
            row.nightly_price = new_prices[hotel.place_id]
    return {hotel.place_id: rows[hotel.place_id].nightly_price for hotel in hotels}


# --- The traveler's choice ------------------------------------------------
def choice_row(trip: Trip, db: Session) -> TripLodging | None:
    return db.scalar(select(TripLodging).where(TripLodging.trip_id == trip.id))


def stay_line_id(trip: Trip, db: Session) -> int | None:
    """The cost line the choice keeps in step, which the Budget tab can't edit."""
    return db.scalar(select(TripLodging.cost_item_id).where(TripLodging.trip_id == trip.id))


def _as_utc(moment: datetime) -> datetime:
    # SQLite gives back naive datetimes; they were stored in UTC.
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def coords_are_fresh(row: TripLodging) -> bool:
    return (
        row.latitude is not None
        and row.longitude is not None
        and row.coords_fetched_at is not None
        and utcnow() - _as_utc(row.coords_fetched_at) < COORDS_MAX_AGE
    )


def set_coords(row: TripLodging, coords: Coordinates | None) -> None:
    row.latitude, row.longitude = coords if coords else (None, None)
    row.coords_fetched_at = utcnow() if coords else None


def hotel_pin(trip: Trip, db: Session) -> Coordinates | None:
    """The chosen hotel's coordinates for the map. Older than 30 days: looked up again, or cleared.

    The traveler's own hotel and skips have no pin. The caller commits.
    """
    row = choice_row(trip, db)
    if row is None or row.choice != LODGING_HOTEL or not row.place_id:
        return None
    if not coords_are_fresh(row):
        set_coords(row, places.get_location(row.place_id))
    return None if row.latitude is None else (row.latitude, row.longitude)


def clear_stale_coords(db: Session) -> int:
    """Clear every stored hotel coordinate older than 30 days, even ones nobody looks at. The caller commits.

    Run at startup and whenever a map pin is requested; hotel_pin then refreshes that trip's own.
    """
    result = db.execute(
        update(TripLodging)
        .where(TripLodging.coords_fetched_at < utcnow() - COORDS_MAX_AGE)
        .values(latitude=None, longitude=None, coords_fetched_at=None)
    )
    if result.rowcount:
        logger.info("Cleared %d hotel locations older than 30 days.", result.rowcount)
    return result.rowcount


def _check_nights(trip: Trip, nights: int) -> None:
    most = trip_nights(trip)
    if not 1 <= nights <= most:
        raise ChoiceError(f"Nights must be between 1 and {most}, the length of your trip.")


def _own_line(trip: Trip, row: TripLodging, db: Session) -> CostItem | None:
    line = db.get(CostItem, row.cost_item_id) if row.cost_item_id else None
    return line if line is not None and line.trip_id == trip.id else None


def _remove_cost_line(trip: Trip, row: TripLodging, db: Session) -> None:
    line = _own_line(trip, row, db)
    row.cost_item_id = None
    if line is not None:
        db.flush()  # stop pointing at the line before it goes (where foreign keys are enforced)
        db.delete(line)


def _sync_cost_line(trip: Trip, row: TripLodging, db: Session) -> None:
    """Keep the choice's one Lodging line in step: nightly price x nights, or no line when skipping.

    A user line, so regenerating the plan keeps it. Changing the choice updates the same line.
    """
    if row.choice == LODGING_SKIP:
        _remove_cost_line(trip, row, db)
        return

    amount = to_dollars(to_cents(row.nightly_price) * row.nights)
    line = _own_line(trip, row, db)
    if line is None:
        line = CostItem(trip_id=trip.id, source=USER_SOURCE, category="lodging", amount=amount)
        db.add(line)
        db.flush()  # for its id
        row.cost_item_id = line.id
    line.description = LODGING_LINE_DESCRIPTION
    line.amount = amount
    line.trip_date = None


def save_choice(trip: Trip, body: LodgingChoiceIn, db: Session) -> TripLodging:
    """Save a pick, the traveler's own hotel, or a skip, and its cost line. The caller commits.

    Raises ChoiceError (nothing is changed) if the choice doesn't fit the trip.
    """
    row = choice_row(trip, db)

    if isinstance(body, HotelChoiceIn):
        estimate = db.scalar(
            select(TripHotelEstimate).where(
                TripHotelEstimate.trip_id == trip.id, TripHotelEstimate.place_id == body.place_id
            )
        )
        if estimate is None:
            raise ChoiceError("Choose one of the suggested hotels.")
        price = body.nightly_price if body.nightly_price is not None else estimate.nightly_price
        if price is None:
            raise ChoiceError("This hotel has no price estimate. Enter a nightly price.")
        nights = body.nights if body.nights is not None else trip_nights(trip)
        _check_nights(trip, nights)

        row = row or TripLodging(trip_id=trip.id)
        # The same hotel again keeps its coordinates while they're fresh: no extra request.
        if row.place_id != body.place_id or not coords_are_fresh(row):
            set_coords(row, places.get_location(body.place_id))
        row.choice, row.place_id, row.custom_name, row.skip_reason = LODGING_HOTEL, body.place_id, None, None
        row.nightly_price, row.nights = price, nights

    elif isinstance(body, OwnHotelIn):
        _check_nights(trip, body.nights)
        row = row or TripLodging(trip_id=trip.id)
        set_coords(row, None)  # no place ID to look it up by, so no map pin
        row.choice, row.place_id, row.custom_name, row.skip_reason = LODGING_OWN, None, body.name, None
        row.nightly_price, row.nights = body.nightly_price, body.nights

    else:
        row = row or TripLodging(trip_id=trip.id)
        set_coords(row, None)
        row.choice, row.place_id, row.custom_name, row.skip_reason = LODGING_SKIP, None, None, body.reason
        row.nightly_price, row.nights = None, None

    db.add(row)
    _sync_cost_line(trip, row, db)
    return row


def remove_choice(trip: Trip, db: Session) -> None:
    """Forget the choice and remove its cost line. The caller commits."""
    row = choice_row(trip, db)
    if row is None:
        return
    line = _own_line(trip, row, db)
    db.delete(row)
    if line is not None:
        db.flush()  # the row points at the line, so it goes first
        db.delete(line)


# --- Responses ------------------------------------------------------------
def hotel_out(hotel: places.Hotel) -> dict:
    """A Places hotel as HotelOut fields."""
    photo = None
    if hotel.photo and hotel.photo.uri:
        photo = HotelPhotoOut(
            uri=hotel.photo.uri,
            authors=[PhotoAuthorOut(name=author.name, uri=author.uri) for author in hotel.photo.authors],
        )
    return {
        "place_id": hotel.place_id,
        "name": hotel.name,
        "area": hotel.area,
        "address": hotel.address,
        "rating": hotel.rating,
        "review_count": hotel.review_count,
        "google_maps_uri": hotel.google_maps_uri,
        "photo": photo,
    }


def choice_out(
    trip: Trip, db: Session, found: list[places.Hotel], left: float | None, look_up: bool = True
) -> LodgingChoiceOut | None:
    """The traveler's current choice. A picked hotel's details come from this search, or are looked up.

    left is the budget left for lodging, for the stay's own fit (its saved price x its nights).
    """
    row = choice_row(trip, db)
    if row is None:
        return None

    hotel = None
    if row.choice == LODGING_HOTEL and row.place_id:
        # Already in the suggestions: no extra request.
        hotel = next((h for h in found if h.place_id == row.place_id), None)
        if hotel is None and look_up:
            hotel = places.get_hotel(row.place_id)

    total = None
    if row.nightly_price is not None and row.nights is not None:
        total = to_dollars(to_cents(row.nightly_price) * row.nights)

    return LodgingChoiceOut(
        choice=row.choice,
        skip_reason=row.skip_reason,
        place_id=row.place_id,
        hotel=HotelOut(**hotel_out(hotel)) if hotel else None,
        custom_name=row.custom_name,
        nightly_price=row.nightly_price,
        nights=row.nights,
        total=total,
        fit=budget_fit(total, left),
        nights_exceed_trip=row.nights is not None and row.nights > trip_nights(trip),
    )


def lodging_page(trip: Trip, db: Session, fresh: bool = False) -> LodgingOut:
    """Everything the Where to stay tab shows. The caller commits (new estimates are saved)."""
    search = places.search_hotels(trip.destination)
    estimates = nightly_estimates(trip, search.hotels, db, fresh)
    nights = trip_nights(trip)
    left = lodging_budget_left(trip, db)

    suggestions = []
    for hotel in search.hotels:
        nightly = estimates[hotel.place_id]
        stay_total = None if nightly is None else to_dollars(to_cents(nightly) * nights)
        suggestions.append(
            HotelSuggestionOut(
                **hotel_out(hotel),
                nightly_estimate=nightly,
                stay_total=stay_total,
                fit=budget_fit(stay_total, left),
                best_fit=False,
            )
        )

    fit_note = None
    if left is None:
        fit_note = "no_budget"
    elif any(s.fit for s in suggestions) and not any(s.fit == "fits" for s in suggestions):
        fit_note = "none_fit"

    return LodgingOut(
        trip_id=trip.id,
        currency=PLAN_CURRENCY,
        nights=nights,
        lodging_budget_left=left,
        choice=choice_out(trip, db, search.hotels, left),
        suggestions=rank(suggestions, has_budget=left is not None),
        suggestions_status=search.status,
        fit_note=fit_note,
    )
