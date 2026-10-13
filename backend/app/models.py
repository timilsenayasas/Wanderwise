"""Database tables.

Changing a table here? Create a migration afterwards (see README, "Database changes"):
    alembic revision --autogenerate -m "describe the change"
"""

from datetime import date, datetime, timezone

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # Always stored lowercase (see register/login) so lookups are case-insensitive.
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )


class Preference(Base):
    """F1 profile: one row per user."""

    __tablename__ = "preferences"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), unique=True, nullable=False, index=True)
    home_city: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    interests: Mapped[str] = mapped_column(Text, default="", nullable=False)
    default_budget: Mapped[float | None] = mapped_column(Float, nullable=True)
    travel_style: Mapped[str] = mapped_column(String(100), default="", nullable=False)


class Trip(Base):
    """F2/F12: a saved trip."""

    __tablename__ = "trips"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)

    origin: Mapped[str] = mapped_column(String(120), nullable=False)
    destination: Mapped[str] = mapped_column(String(120), nullable=False)
    start_date: Mapped[date] = mapped_column(nullable=False)
    end_date: Mapped[date] = mapped_column(nullable=False)

    travelers: Mapped[int] = mapped_column(default=1, nullable=False)
    budget: Mapped[float | None] = mapped_column(nullable=True)
    # Stored comma-separated; the API exposes it as a list (see routers/trips.py).
    interests: Mapped[str | None] = mapped_column(nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


# Planned tables (add here, then create a migration):
#   trip_days    (F5: one row per day of a trip)                      -> FK trips.id
#   activities   (F5/F6/F7: stops, meals, times, transport between)   -> FK trip_days.id
#   cost_items   (F8: category + amount, rolled up for the budget tab) -> FK trips.id
