
"""Database tables.

Changing a table here? Create a migration afterwards (see README, "Database changes"):
    alembic revision --autogenerate -m "describe the change"
"""

from datetime import date, datetime, timezone

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
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
    interests: Mapped[str] = mapped_column(
        Text, default="", nullable=False
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


# TripLodging.choice: a suggested hotel, the traveler's own hotel, or no hotel to book.
LODGING_HOTEL = "hotel"
LODGING_OWN = "own"
LODGING_SKIP = "skip"


class TripLodging(Base):
    """Where to stay: the traveler's lodging choice, one row per trip.

    Google's Places terms: only the place ID may be kept. Names, ratings and photos are
    fetched fresh when shown, and coordinates are refreshed or cleared after 30 days.
    """

    __tablename__ = "trip_lodging"

    id: Mapped[int] = mapped_column(
        Integer, primary_key=True
    )
    trip_id: Mapped[int] = mapped_column(
        ForeignKey("trips.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
        index=True,
    )
    choice: Mapped[str] = mapped_column(
        String(10), nullable=False
    )
    # "have_place" or "not_needed" when choice is "skip".
    skip_reason: Mapped[str | None] = mapped_column(
        String(20), nullable=True
    )
    place_id: Mapped[str | None] = mapped_column(
        String(255), nullable=True
    )
    # The traveler's own hotel name (choice "own"). Never a Google name.
    custom_name: Mapped[str | None] = mapped_column(
        String(200), nullable=True
    )
    nightly_price: Mapped[float | None] = mapped_column(
        Float, nullable=True
    )
    nights: Mapped[int | None] = mapped_column(
        Integer, nullable=True
    )
    latitude: Mapped[float | None] = mapped_column(
        Float, nullable=True
    )
    longitude: Mapped[float | None] = mapped_column(
        Float, nullable=True
    )
    coords_fetched_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # The user Lodging cost line this choice keeps in step (Budget tab).
    cost_item_id: Mapped[int | None] = mapped_column(
        ForeignKey("cost_items.id", ondelete="SET NULL"),
        nullable=True,
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


class TripHotelEstimate(Base):
    """Where to stay: a hotel suggested for a trip, with our AI nightly price estimate (USD).

    Our own data, keyed by Google's place ID. A row means "suggested for this trip", so a
    pick can be checked; nightly_price is empty when the estimate failed.
    """

    __tablename__ = "trip_hotel_estimates"
    __table_args__ = (UniqueConstraint("trip_id", "place_id"),)

    id: Mapped[int] = mapped_column(
        Integer, primary_key=True
    )
    trip_id: Mapped[int] = mapped_column(
        ForeignKey("trips.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    place_id: Mapped[str] = mapped_column(
        String(255), nullable=False
    )
    nightly_price: Mapped[float | None] = mapped_column(
        Float, nullable=True
    )
    estimated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        nullable=False,
    )
