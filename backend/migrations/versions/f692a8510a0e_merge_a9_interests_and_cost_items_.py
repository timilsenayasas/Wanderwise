"""Merge A9 interests and cost items migrations

Revision ID: f692a8510a0e
Revises: 93c75e18b68d, b9a9197fc833
Create Date: 2026-10-29 18:39:11.815917
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f692a8510a0e'
down_revision: Union[str, None] = ('93c75e18b68d', 'b9a9197fc833')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
