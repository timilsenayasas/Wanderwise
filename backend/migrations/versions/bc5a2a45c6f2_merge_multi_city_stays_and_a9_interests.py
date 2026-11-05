"""merge multi-city stays and A9 interests

Revision ID: bc5a2a45c6f2
Revises: f3c8d6a20e51, f692a8510a0e
Create Date: 2026-11-02 20:04:39.924405
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'bc5a2a45c6f2'
down_revision: Union[str, None] = ('f3c8d6a20e51', 'f692a8510a0e')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
