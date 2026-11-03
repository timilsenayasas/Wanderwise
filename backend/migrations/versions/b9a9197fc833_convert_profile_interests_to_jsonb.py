
"""Convert profile interests from text to JSONB arrays.

Revision ID: b9a9197fc833
Revises: ae137b358740
"""

import json

import sqlalchemy as sa
from alembic import op
from sqlalchemy import text

revision = "b9a9197fc833"
down_revision = "ae137b358740"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if op.get_bind().dialect.name == "sqlite":
        connection = op.get_bind()

        rows = connection.execute(
            text("SELECT user_id, interests FROM preferences")
        ).fetchall()

        for user_id, interests in rows:
            items = [
                item.strip()
                for item in (interests or "").split(",")
                if item.strip()
            ]
            connection.execute(
                text(
                    "UPDATE preferences SET interests = :interests "
                    "WHERE user_id = :user_id"
                ),
                {"interests": json.dumps(items), "user_id": user_id},
            )

        with op.batch_alter_table("preferences") as batch_op:
            batch_op.alter_column(
                "interests",
                existing_type=sa.Text(),
                type_=sa.JSON(),
                existing_nullable=False,
            )

        return

    # PostgreSQL: convert comma-separated text into JSONB arrays.
    op.execute("""
        CREATE FUNCTION a9_interests_to_jsonb(value text)
        RETURNS jsonb
        LANGUAGE sql
        IMMUTABLE
        AS $$
            SELECT COALESCE(
                jsonb_agg(btrim(item) ORDER BY position)
                    FILTER (WHERE btrim(item) <> ''),
                '[]'::jsonb
            )
            FROM unnest(string_to_array(COALESCE(value, ''), ','))
                WITH ORDINALITY AS parts(item, position)
        $$;
    """)

    op.execute("""
        ALTER TABLE preferences
        ALTER COLUMN interests DROP DEFAULT
    """)

    op.execute("""
        ALTER TABLE preferences
        ALTER COLUMN interests TYPE jsonb
        USING a9_interests_to_jsonb(interests)
    """)

    op.execute("""
        DROP FUNCTION a9_interests_to_jsonb(text)
    """)


def downgrade() -> None:
    if op.get_bind().dialect.name == "sqlite":
        connection = op.get_bind()

        rows = connection.execute(
            text("SELECT user_id, interests FROM preferences")
        ).fetchall()

        for user_id, interests in rows:
            try:
                items = json.loads(interests or "[]")
            except (ValueError, TypeError):
                items = []

            value = ", ".join(items) if isinstance(items, list) else ""

            connection.execute(
                text(
                    "UPDATE preferences SET interests = :interests "
                    "WHERE user_id = :user_id"
                ),
                {"interests": value, "user_id": user_id},
            )

        with op.batch_alter_table("preferences") as batch_op:
            batch_op.alter_column(
                "interests",
                existing_type=sa.JSON(),
                type_=sa.Text(),
                existing_nullable=False,
            )

        return

    # PostgreSQL: convert JSONB arrays back to comma-separated text.
    op.execute("""
        CREATE FUNCTION a9_interests_to_text(value jsonb)
        RETURNS text
        LANGUAGE sql
        IMMUTABLE
        AS $$
            SELECT COALESCE(
                string_agg(item, ', ' ORDER BY position),
                ''
            )
            FROM jsonb_array_elements_text(value)
                WITH ORDINALITY AS parts(item, position)
        $$;
    """)

    op.execute("""
        ALTER TABLE preferences
        ALTER COLUMN interests DROP DEFAULT
    """)

    op.execute("""
        ALTER TABLE preferences
        ALTER COLUMN interests TYPE text
        USING a9_interests_to_text(interests)
    """)

    op.execute("""
        DROP FUNCTION a9_interests_to_text(jsonb)
    """)
