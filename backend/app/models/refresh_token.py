import secrets
from datetime import timedelta

from app.extensions import db
from app.utils.time import utc_now

TOKEN_LENGTH_BYTES = 32
# Deliberately long-lived relative to the access token it exists to
# renew - this is the actual "stay logged in" mechanism, so the access
# token's own lifetime can stay short (see JWT_ACCESS_TOKEN_EXPIRES)
# without forcing a real re-login every time it expires. Rotated on
# every use (see POST /api/auth/refresh) rather than reused as-is, so a
# stolen-and-replayed old token is detectable rather than silently
# accepted.
TOKEN_LIFETIME = timedelta(days=14)


def generate_refresh_token() -> str:
    """Cryptographically secure, URL-safe token."""
    return secrets.token_urlsafe(TOKEN_LENGTH_BYTES)


class RefreshToken(db.Model):
    """
    A long-lived credential used only to silently mint new access
    tokens - never to authenticate a request directly. Issued alongside
    an access token by POST /api/auth/login; exchanged for a new
    access+refresh pair (with this row revoked in the process - see
    revoked_at) by POST /api/auth/refresh. An explicit logout
    (POST /api/auth/logout) revokes one directly, rather than just
    trusting the client to have forgotten it.
    """

    __tablename__ = "refresh_tokens"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    token = db.Column(db.String(64), unique=True, nullable=False, default=generate_refresh_token)

    created_at = db.Column(db.DateTime, default=utc_now)
    expires_at = db.Column(db.DateTime, default=lambda: utc_now() + TOKEN_LIFETIME, nullable=False)
    # Set either by an explicit logout, or by rotation the instant this
    # token is exchanged for a new one via /refresh. A revoked token
    # being presented again afterward is a strong signal of theft/replay
    # (a legitimate client would already have switched to its new one),
    # not ordinary expiry - see /api/auth/refresh's handling of this
    # case specifically, which is why it's checked separately from
    # is_valid() rather than folded into it.
    revoked_at = db.Column(db.DateTime, nullable=True)

    user = db.relationship("User")

    def is_valid(self) -> bool:
        if self.revoked_at is not None:
            return False
        return utc_now() <= self.expires_at

    def __repr__(self):
        return f"<RefreshToken user_id={self.user_id} revoked={self.revoked_at is not None}>"