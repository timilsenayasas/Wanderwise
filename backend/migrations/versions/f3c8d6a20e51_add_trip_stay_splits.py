"""add trip_stay_splits

The traveler can split a stay so one city has more than one hotel: a split says a new stay
starts on that night in that city. Kept when the plan is regenerated.

Revision ID: f3c8d6a20e51
Revises: e5a9c2d41b07
Create Date: 2026-10-26 22:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f3c8d6a20e51'
down_revision: Union[str, None] = 'e5a9c2d41b07'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'trip_stay_splits',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('trip_id', sa.Integer(), nullable=False),
        sa.Column('night_date', sa.Date(), nullable=False),
        sa.Column('city', sa.String(length=120), nullable=False),
        sa.ForeignKeyConstraint(['trip_id'], ['trips.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('trip_id', 'night_date', name='uq_trip_stay_splits_trip_night'),
    )
    with op.batch_alter_table('trip_stay_splits', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_trip_stay_splits_trip_id'), ['trip_id'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('trip_stay_splits', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_trip_stay_splits_trip_id'))
    op.drop_table('trip_stay_splits')
