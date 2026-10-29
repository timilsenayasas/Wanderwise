"""Convert profile interests from text to JSONB arrays.

Revision ID: b9a9197fc833
Revises: ae137b358740
"""

from alembic import op

revision = "b9a9197fc833"
down_revision = "ae137b358740"
branch_labels = None
depends_on = None


def upgrade() -> None:
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
