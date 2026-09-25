import secrets
from datetime import timedelta

from app.extensions import db
from app.utils.time import utc_now

TOKEN_LENGTH_BYTES = 32
# Deliberately much shorter than EmailVerificationToken's 24h - a login
# link is meant to be used right away, not sit in an inbox for a day.
# Kept as a genuinely separate model/table (not reused) specifically so
# a verification token could never accidentally double as something
# that logs someone in - the two serve different purposes and should
# fail closed independently of each other.
TOKEN_LIFETIME = timedelta(minutes=15)


def generate_login_token() -> str:
    """Cryptographically secure, URL-safe, single-use token."""
    return secrets.token_urlsafe(TOKEN_LENGTH_BYTES)


class LoginToken(db.Model):
    """
    A single-use, short-lived token proving someone clicked a login link
    that was actually emailed to a real account's address. Issued by
    POST /api/auth/request-login-link; consumed exactly once by
    POST /api/auth/login, which issues a JWT in exchange.
    """

    __tablename__ = "login_tokens"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    token = db.Column(db.String(64), unique=True, nullable=False, default=generate_login_token)

    created_at = db.Column(db.DateTime, default=utc_now)
    expires_at = db.Column(db.DateTime, default=lambda: utc_now() + TOKEN_LIFETIME, nullable=False)
    used_at = db.Column(db.DateTime, nullable=True)

    user = db.relationship("User")

    def is_valid(self) -> bool:
        if self.used_at is not None:
            return False
        # Both sides are naive datetimes that are actually UTC now (see
        # utc_now()'s docstring for why that's a real, load-bearing
        # assumption and not just a convention) - comparing them
        # directly, with no tzinfo juggling, is correct here.
        return utc_now() <= self.expires_at

    def __repr__(self):
        return f"<LoginToken user_id={self.user_id} used={self.used_at is not None}>"