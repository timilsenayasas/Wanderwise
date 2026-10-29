"""add source and trip_date to cost_items

Existing rows all came from generated plans, so they are marked "plan" and their
raw AI categories are moved onto the fixed budget categories (A2).

Revision ID: 93c75e18b68d
Revises: ae137b358740
Create Date: 2026-10-24 21:15:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '93c75e18b68d'
down_revision: Union[str, None] = 'ae137b358740'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# A frozen copy of the mapping in app/budget.py at the time of this migration.
# Migrations must keep doing the same thing even if the app's mapping changes later.
OLD_TO_FIXED = {
    "meal": "food",
    "food": "food",
    "activity": "activities",
    "activities": "activities",
    "sightseeing": "activities",
    "nightlife": "activities",
    "nature": "activities",
    "transportation": "transport",
    "transport": "transport",
}

cost_items = sa.table(
    "cost_items",
    sa.column("category", sa.String),
)


def upgrade() -> None:
    with op.batch_alter_table('cost_items', schema=None) as batch_op:
        batch_op.add_column(sa.Column('source', sa.String(length=10), server_default='plan', nullable=False))
        batch_op.add_column(sa.Column('trip_date', sa.Date(), nullable=True))

    raw = sa.func.lower(sa.func.trim(cost_items.c.category))
    for old, fixed in OLD_TO_FIXED.items():
        op.execute(cost_items.update().where(raw == old).values(category=fixed))
    # Shopping, lodging and anything unknown from the AI.
    op.execute(
        cost_items.update()
        .where(cost_items.c.category.not_in(set(OLD_TO_FIXED.values())))
        .values(category="other")
    )


def downgrade() -> None:
    # The original AI category names can't be restored; lines keep their fixed category.
    with op.batch_alter_table('cost_items', schema=None) as batch_op:
        batch_op.drop_column('trip_date')
        batch_op.drop_column('source')
