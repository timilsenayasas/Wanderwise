
"""Database tables.

Changing a table here? Create a migration afterwards (see README, "Database changes"):
    alembic revision --autogenerate -m "describe the change"
"""

from datetime import date, datetime, timezone

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy import JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    # Always stored lowercase (see register/login) so lookups are case-insensitive.
    email: Mapped[str] = mapped_column(
        String(320), unique=True, index=True, nullable=False
    )
    password_hash: Mapped[str] = mapped_column(
        String(255), nullable=False
    )
    name: Mapped[str] = mapped_column(
        String(100), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
        nullable=False,
    )


class Preference(Base):
    """F1 profile: one row per user."""

    __tablename__ = "preferences"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id"),
        unique=True,
        nullable=False,
        index=True,
    )
    home_city: Mapped[str] = mapped_column(
        String(120), default="", nullable=False
    )
    interests: Mapped[list[str]] = mapped_column(
        sa.JSON().with_variant(JSONB(), "postgresql"),
        default=list,
        nullable=False,
    )
    default_budget: Mapped[float | None] = mapped_column(
        Float, nullable=True
    )
    travel_style: Mapped[str] = mapped_column(
        String(100), default="", nullable=False
    )


class Trip(Base):
    """F2/F12: a saved trip."""

    __tablename__ = "trips"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id"),
        nullable=False,
        index=True,
    )

    origin: Mapped[str] = mapped_column(
        String(120), nullable=False
    )
    destination: Mapped[str] = mapped_column(
        String(120), nullable=False
    )
    start_date: Mapped[date] = mapped_column(nullable=False)
    end_date: Mapped[date] = mapped_column(nullable=False)

    travelers: Mapped[int] = mapped_column(
        default=1, nullable=False
    )
    budget: Mapped[float | None] = mapped_column(nullable=True)

    # Stored comma-separated; the API exposes it as a list.
    interests: Mapped[str | None] = mapped_column(nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        nullable=False,
    )


class TripDay(Base):
    """F5: One row per day of a saved trip."""

    __tablename__ = "trip_days"

    id: Mapped[int] = mapped_column(
        Integer, primary_key=True
    )
    trip_id: Mapped[int] = mapped_column(
        ForeignKey("trips.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    day_number: Mapped[int] = mapped_column(
        Integer, nullable=False
    )
    trip_date: Mapped[date] = mapped_column(
        nullable=False
    )
    notes: Mapped[str | None] = mapped_column(
        Text, nullable=True
    )


class Activity(Base):
    """F5/F6/F7: An activity scheduled for an itinerary day."""

    __tablename__ = "activities"

    id: Mapped[int] = mapped_column(
        Integer, primary_key=True
    )
    trip_day_id: Mapped[int] = mapped_column(
        ForeignKey("trip_days.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(
        String(200), nullable=False
    )
    description: Mapped[str | None] = mapped_column(
        Text, nullable=True
    )
    location: Mapped[str | None] = mapped_column(
        String(255), nullable=True
    )
    start_time: Mapped[str | None] = mapped_column(
        String(10), nullable=True
    )
    end_time: Mapped[str | None] = mapped_column(
        String(10), nullable=True
    )
    category: Mapped[str | None] = mapped_column(
        String(80), nullable=True
    )
    estimated_cost: Mapped[float | None] = mapped_column(
        Float, nullable=True
    )
    # Minutes of travel from this stop to the next one that day.
    travel_minutes_to_next: Mapped[int | None] = mapped_column(
        Integer, nullable=True
    )
    latitude: Mapped[float | None] = mapped_column(
        Float, nullable=True
    )
    longitude: Mapped[float | None] = mapped_column(
        Float, nullable=True
    )


# CostItem.source: "plan" lines are rebuilt on every regenerate; "user" lines are the traveler's own.
PLAN_SOURCE = "plan"
USER_SOURCE = "user"


class CostItem(Base):
    """F8: An estimated expense associated with a trip."""

    __tablename__ = "cost_items"

    id: Mapped[int] = mapped_column(
        Integer, primary_key=True
    )
    trip_id: Mapped[int] = mapped_column(
        ForeignKey("trips.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    category: Mapped[str] = mapped_column(
        String(80), nullable=False
    )
    description: Mapped[str | None] = mapped_column(
        Text, nullable=True
    )
    amount: Mapped[float] = mapped_column(
        Float, nullable=False
    )
    source: Mapped[str] = mapped_column(
        String(10),
        default=PLAN_SOURCE,
        server_default=PLAN_SOURCE,
        nullable=False,
    )
    # Optional day of the trip, so per-day totals can include the line.
    trip_date: Mapped[date | None] = mapped_column(
        nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        nullable=False,
    )
