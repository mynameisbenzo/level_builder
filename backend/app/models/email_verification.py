import secrets
from datetime import datetime, timedelta, timezone

from app.extensions import db

TOKEN_LENGTH_BYTES = 32
TOKEN_LIFETIME = timedelta(hours=24)


def generate_verification_token() -> str:
    """Cryptographically secure, URL-safe, single-use token."""
    return secrets.token_urlsafe(TOKEN_LENGTH_BYTES)


class EmailVerificationToken(db.Model):
    """
    A single-use, time-limited token proving control of the email
    address on a User account. Issued at signup (and re-issuable via a
    resend, once that exists); consumed exactly once by the verify
    endpoint, which sets User.email_verified_at.
    """

    __tablename__ = "email_verification_tokens"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    token = db.Column(db.String(64), unique=True, nullable=False, default=generate_verification_token)

    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    expires_at = db.Column(
        db.DateTime, default=lambda: datetime.now(timezone.utc) + TOKEN_LIFETIME, nullable=False
    )
    # Null until consumed by the verify endpoint - checked instead of
    # just deleting the row on use, so there's a record that this
    # specific token was actually redeemed (not just expired unused).
    used_at = db.Column(db.DateTime, nullable=True)

    user = db.relationship("User")

    def is_valid(self) -> bool:
        """True if this token can still be redeemed right now - not
        already used, and not past its expiry."""
        if self.used_at is not None:
            return False
        return datetime.now(timezone.utc) <= self.expires_at.replace(tzinfo=timezone.utc)

    def __repr__(self):
        return f"<EmailVerificationToken user_id={self.user_id} used={self.used_at is not None}>"