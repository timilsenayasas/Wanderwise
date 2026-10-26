
"""Database migrations (Alembic) stay in sync with the models and keep old data."""

from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import create_engine, inspect, text

import app.models  # noqa: F401  (register every table on Base.metadata)
from app.database import Base
from app.db_migrate import alembic_config, upgrade_database


def make_engine(tmp_path):
    return create_engine(f"sqlite:///{tmp_path / 'migrate.db'}")


def upgrade_to(engine, revision: str) -> None:
    """Migrate only up to `revision`, to set up a database from before a later migration."""
    config = alembic_config()
    with engine.begin() as connection:
        config.attributes["connection"] = connection
        command.upgrade(config, revision)


def test_migrations_match_models(tmp_path):
    """Fails if someone changed models.py without creating a migration.

    Fix: from backend/, run
    alembic revision --autogenerate -m "describe the change"
    """
    engine = make_engine(tmp_path)
    upgrade_database(engine)

    with engine.connect() as connection:
        context = MigrationContext.configure(
            connection,
            opts={"compare_type": True},
        )
        diff = compare_metadata(context, Base.metadata)

    engine.dispose()
    assert diff == [], f"models.py and migrations/ differ: {diff}"


def test_upgrade_is_safe_to_run_twice(tmp_path):
    """Running migrations multiple times should not cause errors."""
    engine = make_engine(tmp_path)

    upgrade_database(engine)
    upgrade_database(engine)

    engine.dispose()


def test_existing_database_without_migrations_keeps_its_data(tmp_path):
    """A database created before Alembic should retain its existing users."""
    engine = make_engine(tmp_path)

    users = Base.metadata.tables["users"]
    users.create(engine)

    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO users (email, password_hash, name, created_at, updated_at) "
                "VALUES ('old@example.com', 'x', 'Old User', '2026-10-01', '2026-10-01')"
            )
        )

    upgrade_database(engine)

    tables = set(inspect(engine).get_table_names())

    assert {
        "users",
        "preferences",
        "trips",
        "trip_days",
        "activities",
        "cost_items",
        "alembic_version",
    } <= tables

    with engine.connect() as connection:
        emails = connection.execute(
            text("SELECT email FROM users")
        ).scalars().all()

    engine.dispose()

    assert emails == ["old@example.com"]


def test_existing_database_with_empty_version_table_is_adopted(tmp_path):
    """An interrupted first run can leave alembic_version empty.

    Simulate the original database before the new tables were added.
    Alembic should adopt it and apply the remaining migrations.
    """
    engine = make_engine(tmp_path)

    # Only create the original baseline tables.
    # Do not create trip_days, activities, or cost_items here.
    baseline_tables = [
        Base.metadata.tables[name]
        for name in ("users", "preferences", "trips")
    ]

    Base.metadata.create_all(
        engine,
        tables=baseline_tables,
    )

    with engine.begin() as connection:
        connection.execute(
            text(
                "CREATE TABLE alembic_version "
                "(version_num VARCHAR(32) NOT NULL)"
            )
        )

    upgrade_database(engine)

    with engine.connect() as connection:
        version = connection.execute(
            text("SELECT version_num FROM alembic_version")
        ).scalar()

    tables = set(inspect(engine).get_table_names())

    engine.dispose()

    assert version is not None

    assert {
        "users",
        "preferences",
        "trips",
        "trip_days",
        "activities",
        "cost_items",
        "alembic_version",
    } <= tables


def test_existing_cost_items_become_plan_lines_with_fixed_categories(tmp_path):
    """Cost lines saved before A2 are marked "plan" and moved onto the fixed categories."""
    engine = make_engine(tmp_path)
    upgrade_to(engine, "ae137b358740")  # the revision before source/trip_date

    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO users (id, email, password_hash, name, created_at, updated_at) "
                "VALUES (1, 'old@example.com', 'x', 'Old User', '2026-10-01', '2026-10-01')"
            )
        )
        connection.execute(
            text(
                "INSERT INTO trips (id, user_id, origin, destination, start_date, end_date, travelers, created_at) "
                "VALUES (1, 1, 'Dallas', 'Chicago', '2026-10-10', '2026-10-11', 1, '2026-10-01')"
            )
        )
        for category in ("meal", "Sightseeing ", "nature", "transportation", "shopping", "lodging", "surfing"):
            connection.execute(
                text(
                    "INSERT INTO cost_items (trip_id, category, amount, created_at) "
                    "VALUES (1, :category, 10, '2026-10-01')"
                ),
                {"category": category},
            )

    upgrade_database(engine)

    with engine.connect() as connection:
        rows = connection.execute(
            text("SELECT category, source, trip_date FROM cost_items ORDER BY id")
        ).all()

    engine.dispose()

    assert [row.category for row in rows] == [
        "food", "activities", "activities", "transport", "other", "other", "other",
    ]
    assert {(row.source, row.trip_date) for row in rows} == {("plan", None)}
