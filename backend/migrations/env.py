"""Alembic environment: points migrations at our models and database."""

from logging.config import fileConfig

from alembic import context

import app.models  # noqa: F401  (register every table on Base.metadata)
from app.database import Base, engine

config = context.config

# Only configure logging for the alembic CLI. When the app runs migrations on
# startup, leave uvicorn's logging alone.
if config.config_file_name is not None and config.attributes.get("configure_logger", True):
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=str(engine.url),
        target_metadata=target_metadata,
        literal_binds=True,
        render_as_batch=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def _run(connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        # SQLite can't ALTER most columns; batch mode rebuilds the table instead.
        render_as_batch=True,
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    # The app (app/db_migrate.py) and tests pass in their own connection.
    connection = config.attributes.get("connection")
    if connection is not None:
        _run(connection)
        return
    # Alembic CLI: use the database from backend/.env.
    with engine.connect() as connection:
        _run(connection)


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
