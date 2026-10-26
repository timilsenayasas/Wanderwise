"""Where to stay: a trip's stays, hotel suggestions with price estimates and budget fit, and choices.

A stay is a run of consecutive nights in one base city, worked out from the saved plan's days
(never stored). A trip without a plan, or whose plan has no base cities, has one stay in its
destination. Choices (TripLodging) are matched to stays by number; each keeps its own Lodging
cost line.

Google's Places terms: hotel names, ratings and photos are fetched fresh for every response and
never stored. Only place IDs and our own data are (TripLodging, TripHotelEstimate). The overview
makes no Google calls; a stay's hotels are searched only when its section asks for them.

Budget fit: a hotel's stay total (estimate x the stay's nights) against the budget left for that
stay: the trip budget minus every cost line except lodging, minus the other stays' choices. So a
stay's own choice doesn't count against itself, and with one stay this is the whole lodging budget.
"""

from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

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
    TripDay,
    TripHotelEstimate,
    TripLodging,
    TripNightOverride,
    TripStaySplit,
    utcnow,
)
from app.schemas import (
    EarlierChoiceOut,
    HotelChoiceIn,
    HotelNameOut,
    HotelOut,
    HotelPhotoOut,
    HotelSuggestionOut,
    LodgingChoiceIn,
    LodgingChoiceOut,
    LodgingFit,
    LodgingOverviewOut,
    NightOut,
    LodgingPinOut,
    OwnHotelIn,
    PhotoAuthorOut,
    StayOut,
    StayPageOut,
)
from app.services import hotel_prices, places
from app.services.geocoding import Coordinates

# "Slightly over" is up to this much above the budget left for lodging.
SLIGHTLY_OVER_SHARE = 0.10

# Each stay can be searched separately, so this bounds the cost of an odd plan.
MAX_STAYS = 6

# Google's Places terms: stored coordinates are refreshed or cleared after 30 days.
COORDS_MAX_AGE = timedelta(days=30)

# The description on a choice's cost line (Budget tab); multi-city trips add the city.
LODGING_LINE_DESCRIPTION = "Lodging"

FIT_ORDER: dict[LodgingFit | None, int] = {"fits": 0, "slightly_over": 1, "over": 2, None: 3}


class ChoiceError(Exception):
    """A lodging choice that can't be saved. The message is shown to the traveler."""


class StayNotFound(Exception):
    """No stay with that number in the trip's current plan."""


# --- Stays ----------------------------------------------------------------
@dataclass(frozen=True)
class Stay:
    number: int
    city: str
    check_in: date
    check_out: date
    nights: int
    # A traveler's split: this stay starts at one (split_night), and is part `part` of `parts`
    # of the same city's run. All None for a stay that isn't split.
    split_night: date | None = None
    part: int | None = None
    parts: int | None = None


def trip_nights(trip: Trip) -> int:
    """Check-in on the start date, check-out on the end date; a same-day trip still counts one night."""
    return max(1, (trip.end_date - trip.start_date).days)


def _city_key(city: str) -> str:
    """"Chitwan " and "chitwan" are the same stay."""
    return " ".join(city.split()).casefold()


def _place(city: str | None) -> str:
    """"Chicago, IL" -> "chicago", to tell whether two spellings name the same place."""
    return (city or "").split(",")[0].strip().casefold()


@dataclass(frozen=True)
class Night:
    date: date
    in_transit: bool  # spent travelling (overnight flight, train, bus): no hotel
    set_by: str  # "plan" (the AI plan's mark, or no mark) or "you" (the traveler's override)


def night_dates(trip: Trip) -> list[date]:
    """A night belongs to the day it starts on: the start date up to the day before the end."""
    return [trip.start_date + timedelta(days=i) for i in range(trip_nights(trip))]


def trip_night_marks(trip: Trip, db: Session) -> list[Night]:
    """Every night of the trip and whether it's in transit: the traveler's say, else the plan's."""
    planned = {
        day.trip_date
        for day in db.scalars(select(TripDay).where(TripDay.trip_id == trip.id, TripDay.in_transit.is_(True)))
    }
    overrides = {
        row.night_date: row.in_transit
        for row in db.scalars(select(TripNightOverride).where(TripNightOverride.trip_id == trip.id))
    }
    return [
        Night(night, overrides[night], "you") if night in overrides else Night(night, night in planned, "plan")
        for night in night_dates(trip)
    ]


def trip_stays(trip: Trip, db: Session, nights: list[Night] | None = None) -> list[Stay]:
    """The trip's stays, in order: consecutive nights grouped by the plan's base city.

    Days without a base city take the one before (or the destination). Nights in transit belong
    to no stay and end a run, so the same city before and after one is two stays (rebooked).
    The traveler's splits end a run too, while that night is still in the split's city: one city,
    two hotels. More than MAX_STAYS stays (splits included): the extra nights join the last one.
    Every night in transit: none.
    """
    nights = nights if nights is not None else trip_night_marks(trip, db)
    cities = {
        day.trip_date: day.base_city
        for day in db.scalars(select(TripDay).where(TripDay.trip_id == trip.id, TripDay.base_city.is_not(None)))
    }
    splits = {
        row.night_date: row.city
        for row in db.scalars(select(TripStaySplit).where(TripStaySplit.trip_id == trip.id))
    }

    # (city, nights, the split night it starts at or None)
    groups: list[tuple[str, list[date], date | None]] = []
    city = trip.destination
    after_transit = False
    for night in nights:
        city = cities.get(night.date, city)
        if night.in_transit:
            after_transit = True
            continue
        continues = groups and not after_transit and _city_key(groups[-1][0]) == _city_key(city)
        split_here = continues and night.date in splits and _place(splits[night.date]) == _place(city)
        if continues and not split_here:
            groups[-1][1].append(night.date)
        elif len(groups) == MAX_STAYS:
            groups[-1][1].append(night.date)
        else:
            groups.append((city, [night.date], night.date if split_here else None))
        after_transit = False

    # Number each chain of split parts (a stay, then the parts split off it): 1 of 3, 2 of 3, 3 of 3.
    part_of: list[tuple[int | None, int | None]] = [(None, None)] * len(groups)
    first = 0
    while first < len(groups):
        last = first
        while last + 1 < len(groups) and groups[last + 1][2]:
            last += 1
        if last > first:
            for i in range(first, last + 1):
                part_of[i] = (i - first + 1, last - first + 1)
        first = last + 1

    # Check out the morning after the last night; a same-day trip checks out the day it checks in.
    trip_end = max(trip.end_date, trip.start_date)
    return [
        Stay(
            number,
            stay_city,
            dates[0],
            min(dates[-1] + timedelta(days=1), trip_end),
            len(dates),
            split_night,
            *part_of[number - 1],
        )
        for number, (stay_city, dates, split_night) in enumerate(groups, start=1)
    ]


class NightNotFound(Exception):
    """That date isn't one of the trip's nights."""


def set_night_transit(trip: Trip, night: date, in_transit: bool | None, db: Session) -> None:
    """The traveler's say on a night: in transit or not, or None to go back to the plan's. The caller commits."""
    if night not in night_dates(trip):
        raise NightNotFound
    row = db.scalar(
        select(TripNightOverride).where(TripNightOverride.trip_id == trip.id, TripNightOverride.night_date == night)
    )
    if in_transit is None:
        if row is not None:
            db.delete(row)
        return
    row = row or TripNightOverride(trip_id=trip.id, night_date=night)
    row.in_transit = in_transit
    db.add(row)


def get_stay(stays: list[Stay], number: int) -> Stay:
    if not 1 <= number <= len(stays):
        raise StayNotFound
    return stays[number - 1]


# --- Budget fit -----------------------------------------------------------
def lodging_budget_left(trip: Trip, db: Session) -> float | None:
    """The trip budget minus every cost line except lodging. None without a budget."""
    if trip.budget is None:
        return None
    summary = budget_summary(trip, db)
    lodging = next(total.amount for total in summary.categories if total.category == "lodging")
    return to_dollars(to_cents(trip.budget) - to_cents(summary.total) + to_cents(lodging))


def _choice_cents(row: TripLodging) -> int:
    if row.nightly_price is None or row.nights is None:
        return 0
    return to_cents(row.nightly_price) * row.nights


def stay_budget_left(lodging_left: float | None, rows: dict[int, TripLodging], number: int) -> float | None:
    """What's left for this stay: the lodging budget minus every other stay's choice."""
    if lodging_left is None:
        return None
    others = sum(_choice_cents(row) for stay_number, row in rows.items() if stay_number != number)
    return to_dollars(to_cents(lodging_left) - others)


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
def nightly_estimates(
    trip: Trip, stay: Stay, hotels: list[places.Hotel], db: Session, fresh: bool
) -> dict[str, float | None]:
    """place_id -> stored estimate, asking Gemini (once, for all of them) about hotels without one.

    Priced for the stay's city and dates. fresh (Refresh) asks about every hotel again; a failed
    refresh keeps the earlier estimates. Every suggested hotel gets a row, so a pick can be checked.
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
        stay.city, stay.check_in, stay.check_out, trip.travelers, to_price
    )

    for hotel in hotels:
        row = rows.get(hotel.place_id)
        if row is None:
            row = rows[hotel.place_id] = TripHotelEstimate(trip_id=trip.id, place_id=hotel.place_id)
            db.add(row)
        if hotel.place_id in new_prices:
            row.nightly_price = new_prices[hotel.place_id]
    return {hotel.place_id: rows[hotel.place_id].nightly_price for hotel in hotels}


# --- The traveler's choices -----------------------------------------------
def choice_rows(trip: Trip, db: Session) -> dict[int, TripLodging]:
    """stay number -> choice, including choices for stays the current plan no longer has."""
    return {row.stay_number: row for row in db.scalars(select(TripLodging).where(TripLodging.trip_id == trip.id))}


def stay_line_ids(trip: Trip, db: Session) -> set[int]:
    """The cost lines the choices keep in step, which the Budget tab can't edit."""
    ids = db.scalars(select(TripLodging.cost_item_id).where(TripLodging.trip_id == trip.id))
    return {line_id for line_id in ids if line_id is not None}


def plan_changed(row: TripLodging, stay: Stay, trip: Trip, one_stay: bool) -> bool:
    """True when the choice was made for a different city than this stay now has.

    Choices from before multi-city (no city) never count, and a one-stay trip's choice is for the
    whole trip, so its destination's spelling ("Chicago, IL" vs "Chicago") doesn't either.
    """
    if row.city is None:
        return False
    same = {_place(stay.city)} | ({_place(trip.destination)} if one_stay else set())
    return _place(row.city) not in same


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


def hotel_pins(trip: Trip, db: Session) -> list[LodgingPinOut]:
    """One map pin per stay with a picked hotel. Coordinates older than 30 days are looked up again, or cleared.

    The traveler's own hotel and skips have no pin, nor do choices for stays the plan no longer has.
    The caller commits.
    """
    rows = choice_rows(trip, db)
    pins = []
    for stay in trip_stays(trip, db):
        row = rows.get(stay.number)
        if row is None or row.choice != LODGING_HOTEL or not row.place_id:
            continue
        if not coords_are_fresh(row):
            set_coords(row, places.get_location(row.place_id))
        if row.latitude is not None:
            pins.append(
                LodgingPinOut(
                    stay_number=stay.number,
                    city=stay.city,
                    part=stay.part,
                    parts=stay.parts,
                    latitude=row.latitude,
                    longitude=row.longitude,
                )
            )
    return pins


def clear_stale_coords(db: Session) -> int:
    """Clear every stored hotel coordinate older than 30 days, even ones nobody looks at. The caller commits.

    Run at startup and whenever map pins are requested; hotel_pins then refreshes that trip's own.
    """
    result = db.execute(
        update(TripLodging)
        .where(TripLodging.coords_fetched_at < utcnow() - COORDS_MAX_AGE)
        .values(latitude=None, longitude=None, coords_fetched_at=None)
    )
    if result.rowcount:
        logger.info("Cleared %d hotel locations older than 30 days.", result.rowcount)
    return result.rowcount


def _check_nights(stay: Stay, nights: int, one_stay: bool) -> None:
    if not 1 <= nights <= stay.nights:
        length = "your trip" if one_stay else "this stay"
        raise ChoiceError(f"Nights must be between 1 and {stay.nights}, the length of {length}.")


def _own_line(trip: Trip, row: TripLodging, db: Session) -> CostItem | None:
    line = db.get(CostItem, row.cost_item_id) if row.cost_item_id else None
    return line if line is not None and line.trip_id == trip.id else None


def _remove_cost_line(trip: Trip, row: TripLodging, db: Session) -> None:
    line = _own_line(trip, row, db)
    row.cost_item_id = None
    if line is not None:
        db.flush()  # stop pointing at the line before it goes (where foreign keys are enforced)
        db.delete(line)


def _date_span(start: date, end: date) -> str:
    """"Oct 12 – 14", or "Oct 30 – Nov 2" across months."""
    end_text = str(end.day) if (start.year, start.month) == (end.year, end.month) else f"{end:%b} {end.day}"
    return f"{start:%b} {start.day} – {end_text}"


def line_description(stay: Stay, one_stay: bool) -> str:
    """"Lodging"; "Lodging · Chitwan, Nepal" on multi-city trips; with the dates for a split part."""
    if one_stay:
        return LODGING_LINE_DESCRIPTION
    if stay.part:
        return f"{LODGING_LINE_DESCRIPTION} · {stay.city} · {_date_span(stay.check_in, stay.check_out)}"
    return f"{LODGING_LINE_DESCRIPTION} · {stay.city}"


def _sync_cost_line(trip: Trip, row: TripLodging, db: Session, description: str) -> None:
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
    line.description = description
    line.amount = amount
    line.trip_date = None


def save_choice(trip: Trip, stay_number: int, body: LodgingChoiceIn, db: Session) -> TripLodging:
    """Save a pick, the traveler's own hotel, or a skip for one stay, and its cost line. The caller commits.

    Raises StayNotFound, or ChoiceError (nothing is changed) if the choice doesn't fit the stay.
    """
    stays = trip_stays(trip, db)
    stay = get_stay(stays, stay_number)
    one_stay = len(stays) == 1
    row = choice_rows(trip, db).get(stay.number)

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
        nights = body.nights if body.nights is not None else stay.nights
        _check_nights(stay, nights, one_stay)

        row = row or TripLodging(trip_id=trip.id, stay_number=stay.number)
        # The same hotel again keeps its coordinates while they're fresh: no extra request.
        if row.place_id != body.place_id or not coords_are_fresh(row):
            set_coords(row, places.get_location(body.place_id))
        row.choice, row.place_id, row.custom_name, row.skip_reason = LODGING_HOTEL, body.place_id, None, None
        row.nightly_price, row.nights = price, nights

    elif isinstance(body, OwnHotelIn):
        _check_nights(stay, body.nights, one_stay)
        row = row or TripLodging(trip_id=trip.id, stay_number=stay.number)
        set_coords(row, None)  # no place ID to look it up by, so no map pin
        row.choice, row.place_id, row.custom_name, row.skip_reason = LODGING_OWN, None, body.name, None
        row.nightly_price, row.nights = body.nightly_price, body.nights

    else:
        row = row or TripLodging(trip_id=trip.id, stay_number=stay.number)
        set_coords(row, None)
        row.choice, row.place_id, row.custom_name, row.skip_reason = LODGING_SKIP, None, None, body.reason
        row.nightly_price, row.nights = None, None

    row.city = stay.city  # what this choice is for, in case a new plan moves the stays
    db.add(row)
    _sync_cost_line(trip, row, db, line_description(stay, one_stay))
    return row


def remove_choice(trip: Trip, stay_number: int, db: Session) -> None:
    """Forget a stay's choice (also one the plan no longer has) and remove its cost line. The caller commits."""
    row = choice_rows(trip, db).get(stay_number)
    if row is None:
        return
    line = _own_line(trip, row, db)
    db.delete(row)
    if line is not None:
        db.flush()  # the row points at the line, so it goes first
        db.delete(line)


# --- Splitting a stay (one city, more than one hotel) ----------------------
class SplitError(Exception):
    """A split that can't be made. The message is shown to the traveler."""


class SplitNotFound(Exception):
    """No split on that night."""


def _renumber(rows: list[TripLodging], step: int, db: Session) -> None:
    """Move choices one stay number up (+1) or down (-1), one at a time so (trip, stay) stays unique."""
    for row in sorted(rows, key=lambda row: row.stay_number, reverse=step > 0):
        row.stay_number += step
        db.flush()


def _refresh_lines(trip: Trip, db: Session) -> None:
    """After a split or merge, every choice's line gets its stay's description and current amount."""
    stays = trip_stays(trip, db)
    rows = choice_rows(trip, db)
    for stay in stays:
        if stay.number in rows:
            _sync_cost_line(trip, rows[stay.number], db, line_description(stay, len(stays) == 1))


def split_stay(trip: Trip, night: date, db: Session) -> None:
    """Split the stay holding `night`: a second hotel in the same city from that night on. The caller commits.

    Later stays' choices move up one number with their stays. The first part keeps the stay's choice,
    shortened to its nights (and its Lodging line with it); the second part starts with none.
    """
    if night not in night_dates(trip):
        raise NightNotFound
    stays = trip_stays(trip, db)
    stay = next((s for s in stays if s.check_in <= night < s.check_in + timedelta(days=s.nights)), None)
    if stay is None:
        raise SplitError("That night is spent travelling, so there's no stay to split.")
    if night == stay.check_in:
        raise SplitError("Pick a night after the stay's first night, so each part has at least one.")
    if len(stays) >= MAX_STAYS:
        raise SplitError(f"A trip can have at most {MAX_STAYS} stays, counting split ones.")

    rows = choice_rows(trip, db)
    _renumber([row for number, row in rows.items() if number > stay.number], +1, db)
    split = db.scalar(select(TripStaySplit).where(TripStaySplit.trip_id == trip.id, TripStaySplit.night_date == night))
    split = split or TripStaySplit(trip_id=trip.id, night_date=night)
    split.city = stay.city  # (an earlier split here that a new plan had set aside applies again)
    db.add(split)
    db.flush()

    first = rows.get(stay.number)
    first_nights = (night - stay.check_in).days
    if first is not None and first.nights is not None and first.nights > first_nights:
        first.nights = first_nights
    _refresh_lines(trip, db)


def merge_stay(trip: Trip, night: date, db: Session) -> None:
    """Undo the split at `night`: the two parts are one stay again. The caller commits.

    The first part's choice is kept. If only the second part has one, it's kept and stretched over
    the whole stay. If both have one, the second part's goes, with its Lodging line.
    """
    split = db.scalar(select(TripStaySplit).where(TripStaySplit.trip_id == trip.id, TripStaySplit.night_date == night))
    if split is None:
        raise SplitNotFound
    second = next((s for s in trip_stays(trip, db) if s.split_night == night), None)
    db.delete(split)
    db.flush()
    if second is None:
        return  # a new plan had already set it aside: nothing to put back together

    first_number = second.number - 1
    rows = choice_rows(trip, db)
    first_row, second_row = rows.get(first_number), rows.get(second.number)
    if first_row is not None and second_row is not None:
        remove_choice(trip, second.number, db)
    elif second_row is not None:
        second_row.stay_number = first_number
        if second_row.nights is not None:
            second_row.nights = trip_stays(trip, db)[first_number - 1].nights
    db.flush()
    _renumber([row for number, row in choice_rows(trip, db).items() if number > second.number], -1, db)
    _refresh_lines(trip, db)


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
    row: TripLodging, left: float | None, most_nights: int | None, hotel: places.Hotel | None = None
) -> LodgingChoiceOut:
    """A choice in API shape. hotel: fresh Google details, only where a search or lookup was made.

    most_nights is the stay's length now (None for a stay the plan no longer has).
    """
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
        nights_exceed_stay=most_nights is not None and row.nights is not None and row.nights > most_nights,
    )


def stay_out(
    trip: Trip,
    stay: Stay,
    rows: dict[int, TripLodging],
    lodging_left: float | None,
    stay_count: int,
    hotel: places.Hotel | None = None,
) -> StayOut:
    row = rows.get(stay.number)
    left = stay_budget_left(lodging_left, rows, stay.number)
    return StayOut(
        number=stay.number,
        city=stay.city,
        check_in=stay.check_in,
        check_out=stay.check_out,
        nights=stay.nights,
        budget_left=left,
        choice=choice_out(row, left, stay.nights, hotel) if row else None,
        plan_changed=bool(row) and plan_changed(row, stay, trip, stay_count == 1),
        choice_city=row.city if row else None,
        part=stay.part,
        parts=stay.parts,
        merge_night=stay.split_night,
        can_split=stay.nights >= 2 and stay_count < MAX_STAYS,
    )


def lodging_overview(trip: Trip, db: Session) -> LodgingOverviewOut:
    """Every night (in transit or not) and stay with its choice, without Google details: no Google calls at all."""
    nights = trip_night_marks(trip, db)
    stays = trip_stays(trip, db, nights)
    rows = choice_rows(trip, db)
    lodging_left = lodging_budget_left(trip, db)
    return LodgingOverviewOut(
        trip_id=trip.id,
        currency=PLAN_CURRENCY,
        lodging_budget_left=lodging_left,
        nights=[NightOut(date=night.date, in_transit=night.in_transit, set_by=night.set_by) for night in nights],
        stays=[stay_out(trip, stay, rows, lodging_left, len(stays)) for stay in stays],
        # Choices for stays a regenerated plan no longer has: shown so they can be removed.
        earlier_choices=[
            EarlierChoiceOut(
                number=number,
                city=row.city,
                choice=choice_out(row, stay_budget_left(lodging_left, rows, number), None),
            )
            for number, row in sorted(rows.items())
            if number > len(stays)
        ],
    )


def stay_page(trip: Trip, stay_number: int, db: Session, fresh: bool = False) -> StayPageOut:
    """One stay's section: hotels in its city with estimates and fit, and its choice with fresh details.

    Raises StayNotFound before any Google call. The caller commits (new estimates are saved).
    """
    stays = trip_stays(trip, db)
    stay = get_stay(stays, stay_number)
    rows = choice_rows(trip, db)
    lodging_left = lodging_budget_left(trip, db)
    left = stay_budget_left(lodging_left, rows, stay.number)

    search = places.search_hotels(stay.city)
    estimates = nightly_estimates(trip, stay, search.hotels, db, fresh)

    suggestions = []
    for hotel in search.hotels:
        nightly = estimates[hotel.place_id]
        stay_total = None if nightly is None else to_dollars(to_cents(nightly) * stay.nights)
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

    # The chosen hotel's details: from this search when it's there, else one lookup.
    row = rows.get(stay.number)
    chosen = None
    if row and row.choice == LODGING_HOTEL and row.place_id:
        chosen = next((h for h in search.hotels if h.place_id == row.place_id), None) or places.get_hotel(row.place_id)

    return StayPageOut(
        trip_id=trip.id,
        currency=PLAN_CURRENCY,
        lodging_budget_left=lodging_left,
        stay=stay_out(trip, stay, rows, lodging_left, len(stays), chosen),
        suggestions=rank(suggestions, has_budget=left is not None),
        suggestions_status=search.status,
        fit_note=fit_note,
    )


def hotel_names(trip: Trip, stay_numbers: list[int], db: Session) -> list[HotelNameOut]:
    """Fresh names of the hotels picked for these stays (Itinerary), one name-only lookup each, in parallel.

    Only stays the current plan has, with a picked hotel; at most MAX_STAYS lookups. Never stored:
    the browser keeps them for the page visit. A lookup that fails is just left out.
    """
    rows = choice_rows(trip, db)
    wanted = sorted(set(stay_numbers))[:MAX_STAYS]
    stays = len(trip_stays(trip, db))
    picked = [
        rows[number]
        for number in wanted
        if 1 <= number <= stays and number in rows and rows[number].choice == LODGING_HOTEL and rows[number].place_id
    ]
    if not picked:
        return []
    with ThreadPoolExecutor(max_workers=len(picked)) as pool:
        names = list(pool.map(lambda row: places.get_name(row.place_id), picked))
    return [
        HotelNameOut(stay_number=row.stay_number, place_id=row.place_id, name=name)
        for row, name in zip(picked, names)
        if name
    ]
