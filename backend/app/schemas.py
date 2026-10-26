"""Request and response shapes (Pydantic). These define the public API contract."""

import re
from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


def _end_not_before_start(end_date: date, info) -> date:
    start_date = info.data.get("start_date")
    if start_date and end_date < start_date:
        raise ValueError("End date must be on or after start date")
    return end_date


def _clock_time(value: str) -> str:
    """Accept "9:00" or "09:00" (24-hour) and store it as "09:00"."""
    match = re.fullmatch(r"(\d{1,2}):(\d{2})", value.strip())
    if not match or int(match[1]) > 23 or int(match[2]) > 59:
        raise ValueError("Time must be HH:MM (24-hour)")
    return f"{int(match[1]):02d}:{match[2]}"


# --- Auth -----------------------------------------------------------------
class RegisterIn(BaseModel):
    email: EmailStr
    # Upper bound stops someone sending megabytes of "password" to hash.
    password: str = Field(min_length=8, max_length=128)
    name: str = Field(min_length=1, max_length=100)

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Name is required")
        return v


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class UserOut(BaseModel):
    """Public user shape. Never add password_hash here."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    name: str


# --- Preferences (F1) -----------------------------------------------------
class PreferenceIn(BaseModel):
    home_city: str = ""
    interests: str = ""
    default_budget: float | None = None
    travel_style: str = ""


class PreferenceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    home_city: str
    interests: str
    default_budget: float | None
    travel_style: str


# --- Trips (F2/F12) -------------------------------------------------------
class TripIn(BaseModel):
    origin: str = Field(min_length=1, max_length=120)
    destination: str = Field(min_length=1, max_length=120)
    start_date: date
    end_date: date
    travelers: int = Field(default=1, ge=1, le=20)
    budget: float | None = Field(default=None, ge=0)
    interests: list[str] = Field(default_factory=list)

    check_dates = field_validator("end_date")(_end_not_before_start)


class TripOut(BaseModel):
    id: int
    origin: str
    destination: str
    start_date: date
    end_date: date
    travelers: int
    budget: float | None
    interests: list[str]
    created_at: datetime


# --- AI itinerary (F3) ----------------------------------------------------
class TripPlanRequest(BaseModel):
    """Trip constraints sent to the LLM itinerary generator. Built from a saved trip."""

    origin: str = Field(min_length=1, max_length=120)
    destination: str = Field(min_length=1, max_length=120)
    start_date: date
    end_date: date
    travelers: int = Field(ge=1, le=20)
    budget: float = Field(gt=0)
    interests: list[str] = Field(min_length=1)
    pace: str | None = None
    dietary_preferences: list[str] = Field(default_factory=list)
    accessibility_needs: list[str] = Field(default_factory=list)

    check_dates = field_validator("end_date")(_end_not_before_start)


class ItineraryActivity(BaseModel):
    start_time: str
    duration_minutes: int = Field(gt=0)
    name: str
    category: str
    location: str
    description: str
    estimated_cost: float = Field(ge=0)
    travel_time_to_next_minutes: int = Field(ge=0)

    check_start_time = field_validator("start_time")(_clock_time)


class ItineraryDay(BaseModel):
    date: date
    activities: list[ItineraryActivity]


class ItineraryResponse(BaseModel):
    destination: str
    currency: str
    total_estimated_cost: float = Field(ge=0)
    days: list[ItineraryDay]


# --- Saved plan (A1) ------------------------------------------------------
# Same fields as ItineraryResponse (so the frontend renders both the same way),
# plus database ids, end times and coordinates for chat (A6) and the map (A12).
class SavedActivity(ItineraryActivity):
    id: int
    end_time: str
    latitude: float | None
    longitude: float | None


class SavedDay(BaseModel):
    id: int
    day_number: int
    date: date
    activities: list[SavedActivity]


# The fixed budget categories every cost line uses (A2, see budget.py).
BudgetCategory = Literal["food", "activities", "transport", "lodging", "other"]


class CostItemIn(BaseModel):
    """A traveler's own cost line. Plan lines come only from generating a plan."""

    category: BudgetCategory
    amount: float = Field(ge=0, allow_inf_nan=False)
    description: str | None = Field(default=None, max_length=200)
    trip_date: date | None = None  # must fall within the trip's dates (checked in the router)

    @field_validator("amount")
    @classmethod
    def whole_cents(cls, v: float) -> float:
        # Stored amounts are whole cents, so budget totals add up exactly.
        return round(v, 2)

    @field_validator("description")
    @classmethod
    def blank_is_none(cls, v: str | None) -> str | None:
        return (v or "").strip() or None


class CostItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    category: str
    description: str | None
    amount: float
    source: str
    trip_date: date | None
    # The Where to stay choice's Lodging line: read-only here, changed on the Stay tab.
    from_stay: bool = False


class SavedPlanOut(BaseModel):
    trip_id: int
    destination: str
    currency: str
    total_estimated_cost: float
    days: list[SavedDay]
    cost_items: list[CostItemOut]


# --- Budget (A2) ----------------------------------------------------------
class CategoryTotal(BaseModel):
    category: BudgetCategory
    amount: float


class DayTotal(BaseModel):
    day_number: int
    date: date
    amount: float


class BudgetOut(BaseModel):
    """Worked out from the trip's cost lines, not the AI's own total."""

    trip_id: int
    currency: str
    # Every amount is an estimate (the AI's or the traveler's), not a quoted price.
    estimated: bool
    categories: list[CategoryTotal]  # every budget category, in order; they add up to total
    per_day: list[DayTotal]  # the saved plan's days; empty without a plan
    not_by_day: float  # user lines not on a plan day; sum(per_day) + not_by_day == total
    total: float
    budget: float | None
    remaining: float | None  # budget - total; negative when over budget
    over_budget: bool | None
    items: list[CostItemOut]


# --- Where to stay --------------------------------------------------------
# How a hotel's stay total compares to the budget left for lodging (see lodging.py).
LodgingFit = Literal["fits", "slightly_over", "over"]
LodgingChoice = Literal["hotel", "own", "skip"]
SkipReason = Literal["have_place", "not_needed"]


class PhotoAuthorOut(BaseModel):
    """Google requires every photo to credit its authors, linked to their profile."""

    name: str
    uri: str | None


class HotelPhotoOut(BaseModel):
    uri: str  # Google's image URL; short-lived, never stored
    authors: list[PhotoAuthorOut]


class HotelOut(BaseModel):
    """A hotel's details, fetched fresh from Google Places each time (never stored)."""

    place_id: str
    name: str
    area: str
    address: str
    rating: float | None
    review_count: int | None
    google_maps_uri: str | None
    photo: HotelPhotoOut | None


class HotelSuggestionOut(HotelOut):
    nightly_estimate: float | None  # AI estimate in USD; None if it couldn't be estimated
    stay_total: float | None  # nightly_estimate x the trip's nights
    fit: LodgingFit | None  # None without a trip budget or an estimate
    best_fit: bool  # true on at most one suggestion


def _nightly_price(v: float | None) -> float | None:
    if v is None:
        return v
    if v < 0:
        raise ValueError("Nightly price can't be negative")
    return round(v, 2)  # whole cents, like every cost line


def _at_least_one_night(v: int | None) -> int | None:
    if v is not None and v < 1:
        raise ValueError("Nights must be at least 1")
    return v  # the most is the trip's length (checked in lodging.py)


class HotelChoiceIn(BaseModel):
    """Pick a suggested hotel. Without a price, its estimate is used; without nights, the whole trip."""

    choice: Literal["hotel"]
    place_id: str = Field(min_length=1, max_length=255)
    nightly_price: float | None = Field(default=None, allow_inf_nan=False)
    nights: int | None = None

    check_price = field_validator("nightly_price")(_nightly_price)
    check_nights = field_validator("nights")(_at_least_one_night)


class OwnHotelIn(BaseModel):
    """A hotel the traveler found themselves."""

    choice: Literal["own"]
    name: str = Field(max_length=200)
    nightly_price: float = Field(allow_inf_nan=False)
    nights: int

    check_price = field_validator("nightly_price")(_nightly_price)
    check_nights = field_validator("nights")(_at_least_one_night)

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Enter your hotel's name")
        return v


class SkipLodgingIn(BaseModel):
    """No hotel to book: "I already have a place" or "No hotel needed"."""

    choice: Literal["skip"]
    reason: SkipReason


LodgingChoiceIn = Annotated[HotelChoiceIn | OwnHotelIn | SkipLodgingIn, Field(discriminator="choice")]


class LodgingChoiceOut(BaseModel):
    choice: LodgingChoice
    skip_reason: SkipReason | None
    place_id: str | None
    # A picked hotel's details: None if Google couldn't be reached, and in PUT responses
    # (the page already shows the suggestion, so it isn't fetched again).
    hotel: HotelOut | None
    custom_name: str | None  # the traveler's own hotel
    nightly_price: float | None
    nights: int | None
    total: float | None  # nightly_price x nights, the Lodging cost line's amount
    nights_exceed_trip: bool  # the trip's dates were shortened after choosing


class LodgingOut(BaseModel):
    trip_id: int
    currency: str
    nights: int  # the trip's nights, at least 1
    lodging_budget_left: float | None  # trip budget minus everything except lodging
    choice: LodgingChoiceOut | None
    suggestions: list[HotelSuggestionOut]
    suggestions_status: Literal["ok", "not_configured", "unavailable"]
    # "no_budget": sorted by rating; "none_fit": no hotel fits what's left for lodging.
    fit_note: Literal["no_budget", "none_fit"] | None
