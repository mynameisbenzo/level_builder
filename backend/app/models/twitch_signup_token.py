import secrets
from datetime import timedelta

from app.extensions import db
from app.utils.time import utc_now

TOKEN_LENGTH_BYTES = 32
# Short-lived on purpose - this only needs to survive "Twitch redirected
# back, now type a username and submit", not sit around like a login
# link might.
TOKEN_LIFETIME = timedelta(minutes=15)


def generate_twitch_signup_token() -> str:
    """Cryptographically secure, URL-safe, single-use token."""
    return secrets.token_urlsafe(TOKEN_LENGTH_BYTES)


class TwitchSignupToken(db.Model):
    """
    A single-use, short-lived token representing a genuinely verified
    Twitch identity mid-signup - issued by POST /api/auth/twitch/callback
    once the backend has actually exchanged an OAuth code with Twitch
    and confirmed no existing User already has this twitch_id.

    The frontend carries this token through the "choose a username"
    step instead of the raw twitch_id/twitch_display_name - if the
    client could just send back {twitch_id: "...", username: "..."}
    directly, nothing would stop it from claiming a Twitch identity
    that was never actually verified by the real OAuth exchange. This
    token is what makes POST /api/auth/twitch/finish-signup trustworthy
    without needing the client to prove anything about Twitch itself.
    """

    __tablename__ = "twitch_signup_tokens"

    id = db.Column(db.Integer, primary_key=True)
    token = db.Column(db.String(64), unique=True, nullable=False, default=generate_twitch_signup_token)

    # The real, verified values from Twitch's own API - never supplied
    # by the client, only ever read back out via this token.
    twitch_id = db.Column(db.String(64), nullable=False)
    twitch_display_name = db.Column(db.String(80), nullable=True)

    created_at = db.Column(db.DateTime, default=utc_now)
    expires_at = db.Column(db.DateTime, default=lambda: utc_now() + TOKEN_LIFETIME, nullable=False)
    used_at = db.Column(db.DateTime, nullable=True)

    def is_valid(self) -> bool:
        if self.used_at is not None:
            return False
        return utc_now() <= self.expires_at

    def __repr__(self):
        return f"<TwitchSignupToken twitch_id={self.twitch_id} used={self.used_at is not None}>"