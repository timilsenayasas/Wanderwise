"""Request and response shapes (Pydantic). These define the public API contract."""

import re
from datetime import date, datetime
from typing import Literal

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


class CostItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    category: str
    description: str | None
    amount: float
    source: str
    trip_date: date | None


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
