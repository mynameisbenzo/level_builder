"""
Account tiers: anonymous (no account), free, and paid.

The one place that decides which tier an account is in, so every caller -
endless mode's lives rules today; the editor's screen bounds and catalog
gating, and live races, to come - agrees. Staff roles count as paid, then
the account's own `is_paid` flag, then any other signed-in account is free.
"""

from app.models.user import User, UserRole

TIER_ANONYMOUS = "anonymous"
TIER_FREE = "free"
TIER_PAID = "paid"

# Roles that get everything a paid account does, without paying.
STAFF_ROLES = (UserRole.OWNER, UserRole.DEVELOPER, UserRole.MODERATOR)


def get_account_tier(user: User | None) -> str:
    """The tier for this account; `None` (nobody signed in) is anonymous."""
    if user is None:
        return TIER_ANONYMOUS
    if user.role in STAFF_ROLES or user.is_paid:
        return TIER_PAID
    return TIER_FREE


def is_paid_account(user: User | None) -> bool:
    return get_account_tier(user) == TIER_PAID