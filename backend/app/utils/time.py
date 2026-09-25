from datetime import datetime, timezone


def utc_now() -> datetime:
    """
    The current UTC time, as a NAIVE datetime (no tzinfo attached).

    This project stores timestamps in `TIMESTAMP WITHOUT TIME ZONE`
    columns, on the assumption that every value written is already UTC
    - so a naive value read back can safely be treated as UTC too.

    That assumption breaks if a timezone-AWARE datetime (e.g. the more
    "obviously correct"-looking `datetime.now(timezone.utc)`) is handed
    directly to SQLAlchemy/psycopg for one of these columns: psycopg
    converts an aware datetime into the DATABASE CONNECTION'S OWN
    SESSION TIMEZONE before stripping its tzinfo to fit a timezone-less
    column - not UTC, regardless of what timezone the aware value was
    already in. If that session timezone isn't UTC (Postgres.app, by
    default, matches the host machine's timezone), every timestamp
    written this way silently comes out shifted by that offset, while
    still looking numerically like the right kind of value - correct
    date, correct-looking time, just wrong. Confirmed by direct
    reproduction: an identical write, with the DB session timezone set
    to America/Los_Angeles, came back shifted by exactly 7 hours.

    Stripping tzinfo here, in Python, before the value ever reaches
    SQLAlchemy, means there's nothing timezone-aware left for the
    driver to "helpfully" convert - the naive value is written as-is.
    Use this everywhere a UTC "now" is needed for one of these columns,
    instead of calling datetime.now(timezone.utc) directly.
    """
    return datetime.now(timezone.utc).replace(tzinfo=None)