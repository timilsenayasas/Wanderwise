"""add base_city to trip_days and stays to trip_lodging

Multi-city trips: each plan day records its base city (where the traveler sleeps), and a
trip can have one lodging choice per stay instead of one per trip. Existing choices
become stay 1, so one-city trips keep working unchanged.

Revision ID: d7b3f19a4c82
Revises: c4e1a7b92d3f
Create Date: 2026-10-26 10:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd7b3f19a4c82'
down_revision: Union[str, None] = 'c4e1a7b92d3f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('trip_days', schema=None) as batch_op:
        batch_op.add_column(sa.Column('base_city', sa.String(length=120), nullable=True))

    with op.batch_alter_table('trip_lodging', schema=None) as batch_op:
        batch_op.add_column(sa.Column('stay_number', sa.Integer(), server_default='1', nullable=False))
        batch_op.add_column(sa.Column('city', sa.String(length=120), nullable=True))
        # One row per trip -> one row per stay of a trip.
        batch_op.drop_index(batch_op.f('ix_trip_lodging_trip_id'))
        batch_op.create_index(batch_op.f('ix_trip_lodging_trip_id'), ['trip_id'], unique=False)
        batch_op.create_unique_constraint('uq_trip_lodging_trip_stay', ['trip_id', 'stay_number'])


def downgrade() -> None:
    # Only stay 1 fits the old one-row-per-trip table.
    op.execute("DELETE FROM trip_lodging WHERE stay_number <> 1")
    with op.batch_alter_table('trip_lodging', schema=None) as batch_op:
        batch_op.drop_constraint('uq_trip_lodging_trip_stay', type_='unique')
        batch_op.drop_index(batch_op.f('ix_trip_lodging_trip_id'))
        batch_op.create_index(batch_op.f('ix_trip_lodging_trip_id'), ['trip_id'], unique=True)
        batch_op.drop_column('city')
        batch_op.drop_column('stay_number')

    with op.batch_alter_table('trip_days', schema=None) as batch_op:
        batch_op.drop_column('base_city')
