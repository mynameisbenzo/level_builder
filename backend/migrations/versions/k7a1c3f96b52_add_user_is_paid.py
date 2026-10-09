"""add users.is_paid: the paid tier flag

Revision ID: k7a1c3f96b52
Revises: j6f0b2e85a41
Create Date: 2026-10-08 18:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'k7a1c3f96b52'
down_revision = 'j6f0b2e85a41'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('users', sa.Column('is_paid', sa.Boolean(), server_default=sa.false(), nullable=False))


def downgrade():
    op.drop_column('users', 'is_paid')