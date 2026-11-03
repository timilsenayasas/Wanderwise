"""Bring the database schema up to date with Alembic. Runs on app startup.

Databases created before Alembic was added (by the old create_all) have the
tables but no version stamp. Those get any missing baseline tables created,
are stamped at the baseline, and then upgraded like everyone else, so no
existing data is lost.
"""

from alembic import command
from alembic.config import Config
from alembic.migration import MigrationContext
from sqlalchemy import Engine, inspect

from app.config import BASE_DIR, logger
from app.database import Base, engine

# The first migration: users, preferences, trips (the schema before Alembic).
BASELINE_REVISION = "0001"


def alembic_config() -> Config:
    config = Config(str(BASE_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BASE_DIR / "migrations"))
    config.attributes["configure_logger"] = False  # keep uvicorn's log setup
    return config


def upgrade_database(bind: Engine = engine) -> None:
    config = alembic_config()

    with bind.begin() as connection:
        config.attributes["connection"] = connection

        tables = set(inspect(connection).get_table_names())
        current = MigrationContext.configure(connection).get_current_revision()

        if "users" in tables and current is None:
            logger.info(
                "Existing database without migrations: adopting it at the baseline."
            )

            import app.models  # noqa: F401

            baseline = [
                Base.metadata.tables[name]
                for name in ("users", "preferences", "trips")
            ]
            Base.metadata.create_all(bind=connection, tables=baseline)


            command.stamp(config, BASELINE_REVISION)

        command.upgrade(config, "head")
