"""Request and response shapes (Pydantic). These define the public API contract."""

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


def _end_not_before_start(end_date: date, info) -> date:
    start_date = info.data.get("start_date")
    if start_date and end_date < start_date:
        raise ValueError("End date must be on or after start date")
    return end_date


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
    """Trip constraints sent to the LLM itinerary generator."""

    origin: str = Field(min_length=1, max_length=100)
    destination: str = Field(min_length=1, max_length=100)
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


class ItineraryDay(BaseModel):
    date: date
    activities: list[ItineraryActivity]


class ItineraryResponse(BaseModel):
    destination: str
    currency: str
    total_estimated_cost: float = Field(ge=0)
    days: list[ItineraryDay]
