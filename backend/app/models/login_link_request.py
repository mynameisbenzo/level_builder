from datetime import datetime, timedelta, timezone

from app.extensions import db

# After this many requests for the same identifier within the window
# below, further requests are blocked and told so honestly - deliberately
# tracked by the raw submitted identifier (not by a matched User row),
# so the rate limit itself behaves identically whether the identifier
# corresponds to a real account or not. That's what keeps it from
# leaking account existence: an attacker probing a made-up email gets
# blocked on the same schedule as someone spamming a real one.
MAX_REQUESTS_PER_WINDOW = 3
RATE_LIMIT_WINDOW = timedelta(days=1)


class LoginLinkRequest(db.Model):
    """
    One row per login-link request attempt - not tied to a specific
    User (identifier is the raw string someone submitted, matched or
    not), purely to support rate-limiting without revealing whether an
    account exists.
    """

    __tablename__ = "login_link_requests"

    id = db.Column(db.Integer, primary_key=True)
    # Lowercased/trimmed at write time by the endpoint, not here - kept
    # as a plain string rather than a FK, since this needs to track
    # attempts against identifiers that might not match any real user.
    identifier = db.Column(db.String(255), nullable=False, index=True)
    requested_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), index=True)