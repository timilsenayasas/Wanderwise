"""add trip_lodging and trip_hotel_estimates

Where to stay: the traveler's lodging choice (one row per trip) and the hotels
suggested for a trip with our nightly price estimates. Only Google place IDs are
stored, never Google's names, ratings or photos.

Revision ID: c4e1a7b92d3f
Revises: 93c75e18b68d
Create Date: 2026-10-25 20:10:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c4e1a7b92d3f'
down_revision: Union[str, None] = '93c75e18b68d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'trip_lodging',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('trip_id', sa.Integer(), nullable=False),
        sa.Column('choice', sa.String(length=10), nullable=False),
        sa.Column('skip_reason', sa.String(length=20), nullable=True),
        sa.Column('place_id', sa.String(length=255), nullable=True),
        sa.Column('custom_name', sa.String(length=200), nullable=True),
        sa.Column('nightly_price', sa.Float(), nullable=True),
        sa.Column('nights', sa.Integer(), nullable=True),
        sa.Column('latitude', sa.Float(), nullable=True),
        sa.Column('longitude', sa.Float(), nullable=True),
        sa.Column('coords_fetched_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('cost_item_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['cost_item_id'], ['cost_items.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['trip_id'], ['trips.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('trip_lodging', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_trip_lodging_trip_id'), ['trip_id'], unique=True)

    op.create_table(
        'trip_hotel_estimates',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('trip_id', sa.Integer(), nullable=False),
        sa.Column('place_id', sa.String(length=255), nullable=False),
        sa.Column('nightly_price', sa.Float(), nullable=True),
        sa.Column('estimated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['trip_id'], ['trips.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('trip_id', 'place_id'),
    )
    with op.batch_alter_table('trip_hotel_estimates', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_trip_hotel_estimates_trip_id'), ['trip_id'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('trip_hotel_estimates', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_trip_hotel_estimates_trip_id'))
    op.drop_table('trip_hotel_estimates')

    with op.batch_alter_table('trip_lodging', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_trip_lodging_trip_id'))
    op.drop_table('trip_lodging')
