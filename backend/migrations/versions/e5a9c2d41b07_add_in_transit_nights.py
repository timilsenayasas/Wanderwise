"""add in_transit to trip_days and trip_night_overrides

Nights spent travelling (overnight flight, train, bus) need no hotel: the AI plan marks them
on trip_days, and the traveler can override any night in trip_night_overrides, which is kept
when the plan is regenerated. Existing days are not in transit.

Revision ID: e5a9c2d41b07
Revises: d7b3f19a4c82
Create Date: 2026-10-26 18:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e5a9c2d41b07'
down_revision: Union[str, None] = 'd7b3f19a4c82'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('trip_days', schema=None) as batch_op:
        batch_op.add_column(sa.Column('in_transit', sa.Boolean(), server_default=sa.false(), nullable=False))

    op.create_table(
        'trip_night_overrides',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('trip_id', sa.Integer(), nullable=False),
        sa.Column('night_date', sa.Date(), nullable=False),
        sa.Column('in_transit', sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(['trip_id'], ['trips.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('trip_id', 'night_date', name='uq_trip_night_overrides_trip_night'),
    )
    with op.batch_alter_table('trip_night_overrides', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_trip_night_overrides_trip_id'), ['trip_id'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('trip_night_overrides', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_trip_night_overrides_trip_id'))
    op.drop_table('trip_night_overrides')

    with op.batch_alter_table('trip_days', schema=None) as batch_op:
        batch_op.drop_column('in_transit')
