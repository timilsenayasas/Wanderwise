"""merge plan alternatives and destination photo migrations

Revision ID: e1f0a43c0dc3
Revises: 7bfb2662dba5, d4c13164f0d8
Create Date: 2026-11-28 00:49:10.207072
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e1f0a43c0dc3'
down_revision: Union[str, None] = ('7bfb2662dba5', 'd4c13164f0d8')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
