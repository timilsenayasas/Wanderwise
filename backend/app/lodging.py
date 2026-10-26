"""Where to stay: hotel suggestions with price estimates and budget fit, and the traveler's choice.

Google's Places terms: hotel names, ratings and photos are fetched fresh for every response and
never stored. Only place IDs and our own data are (TripLodging, TripHotelEstimate).

Budget fit: a hotel's stay total (estimate x the trip's nights) against the budget left for
lodging (the trip budget minus every cost line except lodging, so the current choice doesn't
count against itself).
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.budget import PLAN_CURRENCY, budget_summary, to_cents, to_dollars
from app.models import LODGING_HOTEL, Trip, TripHotelEstimate, TripLodging
from app.schemas import (
    HotelOut,
    HotelPhotoOut,
    HotelSuggestionOut,
    LodgingChoiceOut,
    LodgingFit,
    LodgingOut,
    PhotoAuthorOut,
)
from app.services import hotel_prices, places

# "Slightly over" is up to this much above the budget left for lodging.
SLIGHTLY_OVER_SHARE = 0.10

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


def choice_out(trip: Trip, db: Session, found: list[places.Hotel]) -> LodgingChoiceOut | None:
    """The traveler's current choice. A picked hotel's details come from this search, or are looked up."""
    row = db.scalar(select(TripLodging).where(TripLodging.trip_id == trip.id))
    if row is None:
        return None

    hotel = None
    if row.choice == LODGING_HOTEL and row.place_id:
        # Already in the suggestions: no extra request.
        hotel = next((h for h in found if h.place_id == row.place_id), None) or places.get_hotel(row.place_id)

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
        choice=choice_out(trip, db, search.hotels),
        suggestions=rank(suggestions, has_budget=left is not None),
        suggestions_status=search.status,
        fit_note=fit_note,
    )
