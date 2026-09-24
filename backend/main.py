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
from datetime import datetime, timedelta, timezone
from typing import Annotated, Generator

import jwt
from fastapi import Cookie, Depends, FastAPI, HTTPException, Response, status
from fastapi.middleware.cors import CORSMiddleware
from pwdlib import PasswordHash
from pwdlib.hashers.argon2 import Argon2Hasher
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import DateTime, Integer, String, create_engine, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

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

    # Keys for upcoming features (LLM plan/chat, maps, weather). Not used yet.
    llm_api_key: str = ""
    maps_api_key: str = ""
    weather_api_key: str = ""

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()

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
