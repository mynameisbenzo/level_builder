import enum
from datetime import datetime, timezone

from app.extensions import db


class UserRole(enum.Enum):
    OWNER = "owner"
    DEVELOPER = "developer"
    MODERATOR = "moderator"
    USER = "user"


class User(db.Model):
    __tablename__ = "users"
    __table_args__ = (
        db.CheckConstraint(
            "is_deleted OR email IS NOT NULL OR twitch_id IS NOT NULL",
            name="users_must_have_an_auth_identity",
        ),
    )

    id = db.Column(db.Integer, primary_key=True)
    # The public identity everywhere on the site - never email or Twitch.
    # Chosen as a hard gate right after signup, so this is non-nullable
    # from the start rather than filled in later.
    username = db.Column(db.String(80), unique=True, nullable=False)

    # Signup identities - a user has at least one of these (enforced by
    # the check constraint above), and can have both at once.
    email = db.Column(db.String(255), unique=True, nullable=True)
    email_verified_at = db.Column(db.DateTime, nullable=True)
    twitch_id = db.Column(db.String(64), unique=True, nullable=True)
    twitch_display_name = db.Column(db.String(80), nullable=True)

    role = db.Column(db.Enum(UserRole, name="user_role"), nullable=False, default=UserRole.USER)

    # Per-identity visibility - the username itself is always public
    # regardless of these.
    hide_email = db.Column(db.Boolean, nullable=False, default=False)
    hide_twitch = db.Column(db.Boolean, nullable=False, default=False)

    is_suspended = db.Column(db.Boolean, nullable=False, default=False)
    # Soft-delete: the row stays as a "deleted user" placeholder rather
    # than cascading deletes through everything they created. The
    # DELETE /api/users/<id> endpoint clears email/twitch_id/username to
    # scrub PII, which the check constraint above exempts deleted rows
    # from - a deleted account no longer needs a valid auth identity
    # since it can't log in again anyway.
    is_deleted = db.Column(db.Boolean, nullable=False, default=False)

    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    def __repr__(self):
        return f"<User {self.username}>"