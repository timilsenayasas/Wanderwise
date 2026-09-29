"""
WanderWise backend (FastAPI).

All backend code lives in this one file, grouped by the section headers below.
When adding a feature, put each piece under the matching header:
  Config -> Database -> Models -> Schemas -> Security -> Endpoints

Run locally:   uvicorn main:app --reload
API docs:      http://localhost:8000/docs
"""

import logging
from pathlib import Path
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone
from typing import Annotated, Generator

import jwt
from fastapi import Cookie, Depends, FastAPI, HTTPException, Response, status
from fastapi.middleware.cors import CORSMiddleware
from pwdlib import PasswordHash
from pwdlib.hashers.argon2 import Argon2Hasher
from pydantic import BaseModel, ConfigDict, EmailStr, Field, ValidationError, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import DateTime, Integer, String, create_engine, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

import json
from google import genai
from google.genai import errors

import time

logger = logging.getLogger("wanderwise")

# The backend/ folder. .env and the SQLite file are resolved from here, so the
# server behaves the same no matter which directory you start it from.
BASE_DIR = Path(__file__).resolve().parent


# --- Config ---------------------------------------------------------------
class Settings(BaseSettings):
    """App settings, read from environment variables or backend/.env."""

    model_config = SettingsConfigDict(env_file=BASE_DIR / ".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = "sqlite:///./wanderwise.db"
    jwt_secret: str = "change-me"
    jwt_expire_minutes: int = 60
    cookie_secure: bool = False
    # Comma-separated list, e.g. "http://localhost:5173,https://wanderwise.app"
    cors_origins: str = "http://localhost:5173"

    # API keys for LLM, maps, and weather integrations.
    llm_api_key: str = ""
    maps_api_key: str = ""
    weather_api_key: str = ""

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()

gemini_client = genai.Client(api_key=settings.llm_api_key)

# Development-only cache for generated itineraries.
itinerary_cache: dict[str, "ItineraryResponse"] = {}

if settings.jwt_secret == "change-me":
    logger.warning("JWT_SECRET is the default 'change-me'. Set a real secret in backend/.env.")

SESSION_COOKIE = "ww_session"
JWT_ALGORITHM = "HS256"


# --- Database -------------------------------------------------------------
def _normalize_db_url(url: str) -> str:
    """Anchor relative SQLite paths to backend/ and use psycopg (v3) for postgresql:// URLs."""
    sqlite_prefix = "sqlite:///"
    if url.startswith(sqlite_prefix) and url != "sqlite:///:memory:":
        db_path = Path(url[len(sqlite_prefix):])
        if not db_path.is_absolute():
            url = sqlite_prefix + str(BASE_DIR / db_path)
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://"):]
    return url


DATABASE_URL = _normalize_db_url(settings.database_url)

engine = create_engine(
    DATABASE_URL,
    # SQLite only: allow the connection to be used across FastAPI's worker threads.
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {},
    pool_pre_ping=True,
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency: one DB session per request, always closed."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


DbSession = Annotated[Session, Depends(get_db)]


# --- Models ---------------------------------------------------------------
def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # Always stored lowercase (see register/login) so lookups are case-insensitive.
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )


# TODO(teammates): add the remaining tables here as their features land:
#   preferences  (F1 profile: interests, home city, budget defaults)  -> FK users.id
#   trips        (F2/F3/F12: origin, destination, dates, travelers, budget) -> FK users.id
#   trip_days    (F5: one row per day of a trip)                      -> FK trips.id
#   activities   (F5/F6/F7: stops, meals, times, transport between)   -> FK trip_days.id
#   cost_items   (F8: category + amount, rolled up for the budget tab) -> FK trips.id
# Tables are created on startup by Base.metadata.create_all (no Alembic).


# --- Schemas --------------------------------------------------------------
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

    @field_validator("end_date")
    @classmethod
    def end_date_after_start_date(cls, end_date: date, info):
        start_date = info.data.get("start_date")
        if start_date and end_date < start_date:
            raise ValueError("End date must be on or after start date")
        return end_date

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


# --- LLM Service ----------------------------------------------------------
def build_itinerary_prompt(trip: TripPlanRequest) -> str:
    """Build the prompt used to generate a structured trip itinerary."""

    return f"""
You are the itinerary planning service for WanderWise.

Create a realistic day-by-day travel itinerary using the traveler's
constraints below.

TRIP DETAILS
Origin: {trip.origin}
Destination: {trip.destination}
Start date: {trip.start_date.isoformat()}
End date: {trip.end_date.isoformat()}
Number of travelers: {trip.travelers}
Total trip budget: {trip.budget:.2f}
Interests: {", ".join(trip.interests)}
Pace: {trip.pace or "No preference"}
Dietary preferences: {", ".join(trip.dietary_preferences) or "None"}
Accessibility needs: {", ".join(trip.accessibility_needs) or "None"}

REQUIREMENTS
- Cover every date from the start date through the end date.
- Do not create overlapping activities.
- Reflect the traveler's interests throughout the itinerary.
- Include at least one meal suggestion per day.
- Give every activity a start time and duration.
- Include estimated cost for each activity.
- Include estimated travel time to the next activity.
- Keep the total estimated cost within the traveler's budget when reasonably possible.
- All monetary values must use one consistent currency.
- Costs are estimates, not guaranteed prices.
- Do not include booking or payment instructions.

Return ONLY valid JSON.
Do not include Markdown, code fences, commentary, or text outside the JSON.

Use exactly this JSON structure:

{{
  "destination": "string",
  "currency": "string",
  "total_estimated_cost": 0.00,
  "days": [
    {{
      "date": "YYYY-MM-DD",
      "activities": [
        {{
          "start_time": "HH:MM",
          "duration_minutes": 0,
          "name": "string",
          "category": "activity, meal, sightseeing, shopping, nightlife, nature, or transportation",
          "location": "string",
          "description": "string",
          "estimated_cost": 0.00,
          "travel_time_to_next_minutes": 0
        }}
      ]
    }}
  ]
}}
""".strip()

class LLMServiceError(Exception):
    """Raised when the itinerary service cannot complete a request."""

    def __init__(self, message: str, retry: bool = True):
        super().__init__(message)
        self.message = message
        self.retry = retry

def build_cache_key(trip: TripPlanRequest) -> str:
    """Create a consistent cache key from the trip request."""

    return trip.model_dump_json()

def generate_itinerary(trip: TripPlanRequest) -> ItineraryResponse:
    """Generate an itinerary with Gemini and validate the JSON response."""

    cache_key = build_cache_key(trip)

    if cache_key in itinerary_cache:
        logger.info("LLM cache hit")
        return itinerary_cache[cache_key]

    logger.info("LLM cache miss")

    prompt = build_itinerary_prompt(trip)

    start_time = time.perf_counter()

    try:
        response = gemini_client.models.generate_content(
            model="gemini-3.5-flash-lite",
            contents=prompt,
            config={
                "response_mime_type": "application/json",
            },
        )

    except errors.ServerError as exc:
        latency = time.perf_counter() - start_time
        logger.warning(f"LLM request failed after {latency:.2f} seconds")
        raise LLMServiceError(
            "The itinerary service is temporarily unavailable. Please retry."
        ) from exc

    except errors.APIError as exc:
        latency = time.perf_counter() - start_time
        logger.warning(f"LLM request failed after {latency:.2f} seconds")
        raise LLMServiceError(
            "The itinerary service could not complete the request. Please retry."
        ) from exc

    except TimeoutError as exc:
        latency = time.perf_counter() - start_time
        logger.warning(f"LLM request timed out after {latency:.2f} seconds")
        raise LLMServiceError(
            "The itinerary request timed out. Please retry."
        ) from exc

    latency = time.perf_counter() - start_time
    logger.info(f"LLM latency: {latency:.2f} seconds")

    if response.usage_metadata:
        usage = response.usage_metadata
        logger.info(f"LLM input tokens: {usage.prompt_token_count}")
        logger.info(f"LLM output tokens: {usage.candidates_token_count}")
        logger.info(f"LLM total tokens: {usage.total_token_count}")

    if not response.text:
        raise LLMServiceError(
            "The itinerary service returned an empty response. Please retry."
        )

    try:
        response_data = json.loads(response.text)
    except json.JSONDecodeError as exc:
        raise LLMServiceError(
            "The itinerary service returned invalid data. Please retry."
        ) from exc

    try:
        itinerary = ItineraryResponse.model_validate(response_data)
    except ValidationError as exc:
        raise LLMServiceError(
            "The itinerary service returned an invalid itinerary. Please retry."
        ) from exc

    itinerary_cache[cache_key] = itinerary

    return itinerary

# --- Security -------------------------------------------------------------
# Argon2id with pwdlib's recommended parameters.
password_hasher = PasswordHash((Argon2Hasher(),))

# Used when a login email doesn't exist, so the response takes the same time
# as a real password check and doesn't reveal which accounts exist.
DUMMY_HASH = password_hasher.hash("wanderwise-dummy-password")


def hash_password(password: str) -> str:
    return password_hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return password_hasher.verify(password, password_hash)
    except Exception:  # malformed hash etc. -> treat as mismatch
        return False


def create_access_token(user_id: int) -> str:
    now = _utcnow()
    payload = {
        "sub": str(user_id),
        "iat": now,
        "exp": now + timedelta(minutes=settings.jwt_expire_minutes),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=JWT_ALGORITHM)


def decode_access_token(token: str) -> int | None:
    """Return the user id from a valid token, or None if invalid/expired."""
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[JWT_ALGORITHM],
            options={"require": ["exp", "sub"]},
        )
        return int(payload["sub"])
    except (jwt.PyJWTError, ValueError, KeyError):
        return None


def set_session_cookie(response: Response, user_id: int) -> None:
    response.set_cookie(
        key=SESSION_COOKIE,
        value=create_access_token(user_id),
        max_age=settings.jwt_expire_minutes * 60,
        httponly=True,  # JS can't read it (protects against XSS token theft)
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(
        key=SESSION_COOKIE,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )


def get_current_user(
    db: DbSession,
    ww_session: Annotated[str | None, Cookie()] = None,
) -> User:
    """Dependency for protected routes: returns the logged-in User or raises 401.

    Usage in a new endpoint:
        def my_route(user: CurrentUser): ...
    """
    unauthorized = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    if not ww_session:
        raise unauthorized
    user_id = decode_access_token(ww_session)
    if user_id is None:
        raise unauthorized
    user = db.get(User, user_id)
    if user is None:
        raise unauthorized
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


# --- Endpoints ------------------------------------------------------------
@asynccontextmanager
async def lifespan(_app: FastAPI):
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(title="WanderWise API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type"],
)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/api/auth/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def register(body: RegisterIn, response: Response, db: DbSession) -> User:
    email = body.email.lower()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This email is already registered")

    user = User(email=email, name=body.name, password_hash=hash_password(body.password))
    db.add(user)
    try:
        db.commit()
    except IntegrityError:  # two sign-ups with the same email at the same moment
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This email is already registered")
    db.refresh(user)

    set_session_cookie(response, user.id)
    return user


@app.post("/api/auth/login", response_model=UserOut)
def login(body: LoginIn, response: Response, db: DbSession) -> User:
    user = db.scalar(select(User).where(User.email == body.email.lower()))
    # Always run one hash verification so wrong-email and wrong-password take the same time.
    password_ok = verify_password(body.password, user.password_hash if user else DUMMY_HASH)
    if user is None or not password_ok:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")

    set_session_cookie(response, user.id)
    return user


@app.post("/api/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout() -> Response:
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    clear_session_cookie(response)
    return response


@app.get("/api/auth/me", response_model=UserOut)
def me(user: CurrentUser) -> User:
    return user
