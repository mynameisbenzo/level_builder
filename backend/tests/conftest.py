from datetime import timedelta

import pytest

from app.utils.time import utc_now


class _Clock:
    """
    A controllable "now" for the endless endpoints - the service takes
    its time from the request handler, which reads app.api.endless's
    utc_now, so patching that one name moves every time-based rule
    (grace period, pool windows, idle expiry) without sleeping.
    """

    def __init__(self):
        self.now = utc_now()

    def advance(self, **kwargs):
        self.now += timedelta(**kwargs)


@pytest.fixture
def clock(monkeypatch):
    fake = _Clock()
    monkeypatch.setattr("app.api.endless.utc_now", lambda: fake.now)
    return fake


@pytest.fixture
def frozen_labels(monkeypatch):
    """
    Keeps the labels these tests give their levels. Beginning and clearing
    an attempt recomputes a level's label from its real play attempts (see
    app/services/difficulty.py), which would wipe a label a test just set
    by hand - the scoreboard rules are what's under test here, not that.
    """
    monkeypatch.setattr("app.services.difficulty.recompute_level_difficulty", lambda level: None)