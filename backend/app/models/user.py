import enum

from app.extensions import db
from app.utils.slugs import generate_slug
from app.utils.time import utc_now


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
    # The externally-visible identifier - used in every URL, API
    # response, and the JWT identity claim itself instead of the raw
    # integer PK, which never leaves the database. A JWT's payload is
    # base64-encoded, not encrypted - anyone holding a token can decode
    # and read its claims even without the signing key, so using the
    # real PK there would still leak it despite every API response
    # already hiding it. `id` stays internal-only: FKs (LoginToken.user_id,
    # Level.owner_id, etc.) and in-process comparisons keep using it,
    # since nothing about hiding a sequential ID from the outside world
    # requires the internal join key to change too.
    public_id = db.Column(db.String(19), unique=True, nullable=False, default=generate_slug, index=True)
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
    hide_email = db.Column(db.Boolean, nullable=False, default=True)
    hide_twitch = db.Column(db.Boolean, nullable=False, default=False)

    is_suspended = db.Column(db.Boolean, nullable=False, default=False)
    # Soft-delete: the row stays as a "deleted user" placeholder rather
    # than cascading deletes through everything they created. The
    # DELETE /api/users/<id> endpoint clears email/twitch_id/username to
    # scrub PII, which the check constraint above exempts deleted rows
    # from - a deleted account no longer needs a valid auth identity
    # since it can't log in again anyway.
    is_deleted = db.Column(db.Boolean, nullable=False, default=False)

    created_at = db.Column(db.DateTime, default=utc_now)

    def __repr__(self):
        return f"<User {self.username}>"