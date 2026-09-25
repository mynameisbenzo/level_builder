import os
import secrets
from datetime import timedelta

from dotenv import load_dotenv

# Loads backend/.env if present (gitignored, never committed). Doesn't
# override variables already set in the real shell environment, and
# silently no-ops if no .env file exists at all - safe in CI/production,
# where real env vars are set directly by the platform instead.
load_dotenv()

def _normalize_database_url(url: str) -> str:
    """
    Normalizes a database URL to use the psycopg (v3) driver explicitly.
    Some providers (Neon included) hand out URLs starting with the legacy
    "postgres://" scheme, which SQLAlchemy 2.0 no longer accepts directly.
    """
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql://", 1)
    if url.startswith("postgresql://") and "+psycopg" not in url:
        url = url.replace("postgresql://", "postgresql+psycopg://", 1)
    return url


class Config:
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_DATABASE_URI = _normalize_database_url(
        os.environ.get("DATABASE_URL", "postgresql://localhost/level_builder_dev")
    )
    FRONTEND_ORIGIN = os.environ.get("FRONTEND_ORIGIN", "http://localhost:5173")

    GITHUB_URL = os.environ.get("GITHUB_URL", "https://github.com/mynameisbenzo/level_builder")
    PORTFOLIO_URL = os.environ.get("PORTFOLIO_URL", "")

    RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
    # onboarding@resend.dev is Resend's built-in test sender - works
    # without verifying a custom domain, but Resend restricts who it can
    # deliver to until a real domain is verified (see their dashboard
    # for the current specifics). Override once a real domain exists.
    EMAIL_FROM_ADDRESS = os.environ.get("EMAIL_FROM_ADDRESS", "onboarding@resend.dev")

    # From a registered app at https://dev.twitch.tv/console/apps. The
    # client ID isn't secret (it's meant to be embedded client-side too
    # - the frontend needs its own copy, as VITE_TWITCH_CLIENT_ID, to
    # build the authorize URL), but the secret absolutely is - it's
    # only ever used server-side, in app/services/twitch.py's token
    # exchange, and must never reach the frontend.
    TWITCH_CLIENT_ID = os.environ.get("TWITCH_CLIENT_ID", "")
    TWITCH_CLIENT_SECRET = os.environ.get("TWITCH_CLIENT_SECRET", "")

    # Randomly generated per process if not set - safe for local dev/
    # testing (a restart just means existing JWTs stop validating, no
    # real consequence), but this must never be relied on in production,
    # where a predictable/reused secret would let anyone forge valid
    # tokens. main.py's create_app() fails loudly at startup if
    # config_name == "production" and JWT_SECRET_KEY isn't actually set
    # via the environment - not enforced here, since this class body
    # executes at import time regardless of which config ends up
    # selected, so a hard requirement here would break dev/testing too.
    JWT_SECRET_KEY = os.environ.get("JWT_SECRET_KEY") or secrets.token_hex(32)
    # Short - this is the primary mitigation for storing the token in
    # localStorage (necessary since frontend/backend are cross-origin -
    # see README) rather than an HttpOnly cookie: a short-lived token
    # limits how long a stolen one is actually useful for. Safe to keep
    # this short specifically because RefreshToken (see
    # app/models/refresh_token.py) now handles staying logged in - the
    # frontend renews this silently in the background well before it
    # expires, so this duration is no longer a UX tradeoff the way it
    # was before refresh tokens existed, just a security one.
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(minutes=15)

    # Postgres.app (and possibly other local setups) can default a
    # database's own session timezone to the host machine's timezone
    # rather than UTC - confirmed directly as the root cause of a real
    # bug: every timestamp this app writes is computed as UTC via
    # utc_now() (see app/utils/time.py) specifically to avoid handing
    # psycopg a timezone-aware value, but that's a Python-side
    # safeguard. This is a second, independent layer at the connection
    # level itself - forcing every session's timezone to UTC outright,
    # so even a future `datetime.now(timezone.utc)` slipping back into
    # the codebase (bypassing utc_now()) wouldn't silently corrupt what
    # actually gets stored. Overridden to empty in TestingConfig, since
    # SQLite has no session-timezone concept and would error on this
    # Postgres-specific connect arg.
    SQLALCHEMY_ENGINE_OPTIONS = {"connect_args": {"options": "-c timezone=utc"}}


class TestingConfig(Config):
    TESTING = True
    SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
    # The Postgres-specific `-c timezone=utc` connect arg from Config
    # would make sqlite3's driver error out on connection - SQLite has
    # no session-timezone GUC to set in the first place.
    SQLALCHEMY_ENGINE_OPTIONS = {}
    # Never send real email during tests, no matter what's actually set
    # in the local environment/.env - tests must not depend on, or
    # accidentally trigger, a real external API call.
    RESEND_API_KEY = ""


class DevelopmentConfig(Config):
    DEBUG = True


class ProductionConfig(Config):
    pass


config_by_name = {
    "testing": TestingConfig,
    "development": DevelopmentConfig,
    "production": ProductionConfig,
}