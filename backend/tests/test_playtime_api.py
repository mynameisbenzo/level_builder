from datetime import timedelta

import pytest
from flask import current_app

from app.extensions import db
from app.main import create_app
from app.models.level import Level, LevelVisibilityState
from app.models.level_playtime import LevelPlaytime
from app.models.user import User, UserRole
from app.services import playtime as playtime_service
from app.utils.time import utc_now


@pytest.fixture(autouse=True)
def _app_context():
    """A fresh app (and fresh database) per test, with its context active."""
    app = create_app("testing")
    with app.app_context():
        db.create_all()
        yield app


def _client():
    app = current_app._get_current_object()
    return app, app.test_client()


def _signup_and_login(app, client, username, email) -> str:
    app.config["DEBUG"] = True
    create_response = client.post("/api/users", json={"username": username, "email": email})
    verification_token = create_response.get_json()["dev_verification_token"]
    client.post("/api/users/verify-email", json={"token": verification_token})
    request_response = client.post("/api/auth/request-login-link", json={"identifier": username})
    login_token = request_response.get_json()["dev_login_token"]
    login_response = client.post("/api/auth/login", json={"token": login_token})
    return login_response.get_json()["access_token"]


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _player(app, client, username, email):
    token = _signup_and_login(app, client, username, email)
    user = User.query.filter_by(username=username).first()
    user.role = UserRole.USER
    db.session.commit()
    return token, user


def _live_level(owner: User) -> Level:
    level = Level(
        owner_id=owner.id,
        title="L",
        visibility_state=LevelVisibilityState.PUBLISHED,
        published_at=utc_now(),
        draft_content={
            "spawnPosition": {"x": 48, "y": 48},
            "cameraMode": "follow",
            "playerStartingColor": "green",
            "placedObjects": [],
        },
    )
    db.session.add(level)
    db.session.commit()
    return level


def _world():
    app, client = _client()
    token, player = _player(app, client, "runner", "r@example.com")
    _creator_token, creator = _player(app, client, "creator", "c@example.com")
    return app, client, token, player, _live_level(creator)


def _beat(client, token, slug, elapsed_ms):
    return client.post(
        f"/api/levels/{slug}/playtime", json={"elapsed_ms": elapsed_ms}, headers=_headers(token)
    )


# ── Service: how a heartbeat is clamped ─────────────────────────────────


def _row_at(player, level, created_at, total_ms=0, last=None):
    row = LevelPlaytime(
        level_id=level.id,
        user_id=player.id,
        total_ms=total_ms,
        created_at=created_at,
        last_heartbeat_at=last or created_at,
    )
    db.session.add(row)
    db.session.commit()
    return row


def test_a_heartbeat_adds_the_reported_time_when_it_is_plausible():
    _app, _client_, _token, player, level = _world()
    start = utc_now()
    _row_at(player, level, start)

    row = playtime_service.apply_heartbeat(player, level, 4800, now=start + timedelta(seconds=5))

    assert row.total_ms == 4800


def test_a_heartbeat_cannot_add_more_than_real_time_since_the_last_one():
    _app, _client_, _token, player, level = _world()
    start = utc_now()
    _row_at(player, level, start, total_ms=0, last=start)

    # Claims 5s but only 1s of real time has passed.
    row = playtime_service.apply_heartbeat(player, level, 5000, now=start + timedelta(seconds=1))

    assert row.total_ms == 1000


def test_one_heartbeat_never_adds_more_than_an_interval_plus_tolerance():
    _app, _client_, _token, player, level = _world()
    start = utc_now()
    _row_at(player, level, start)

    # A 5-minute gap, with a browser claiming all five minutes.
    row = playtime_service.apply_heartbeat(
        player, level, 300_000, now=start + timedelta(minutes=5)
    )

    assert row.total_ms == playtime_service.MAX_HEARTBEAT_MS == 7000


def test_a_flood_of_heartbeats_cannot_outrun_the_clock():
    _app, _client_, _token, player, level = _world()
    start = utc_now()
    _row_at(player, level, start)

    # 50 heartbeats, 100ms apart, each claiming 5s: 5s of real time in total.
    row = None
    for i in range(1, 51):
        row = playtime_service.apply_heartbeat(
            player, level, 5000, now=start + timedelta(milliseconds=100 * i)
        )

    assert row.total_ms == 5000


def test_the_total_never_exceeds_real_time_since_the_row_was_created():
    _app, _client_, _token, player, level = _world()
    start = utc_now()
    # Corrupt state: 60s already counted, but the row is only 10s old.
    _row_at(player, level, start, total_ms=60_000, last=start + timedelta(seconds=5))

    row = playtime_service.apply_heartbeat(player, level, 5000, now=start + timedelta(seconds=10))

    # The cap would be 10s, but a total never goes down.
    assert row.total_ms == 60_000


def test_the_cap_holds_back_a_total_that_would_pass_real_time():
    _app, _client_, _token, player, level = _world()
    start = utc_now()
    _row_at(player, level, start, total_ms=8000, last=start + timedelta(seconds=8))

    row = playtime_service.apply_heartbeat(player, level, 5000, now=start + timedelta(seconds=10))

    # 8000 + 2000 (only 2s since the last beat) = 10_000 = real time since creation.
    assert row.total_ms == 10_000


def test_the_total_stops_at_the_ceiling():
    _app, _client_, _token, player, level = _world()
    start = utc_now() - timedelta(days=30)
    _row_at(
        player,
        level,
        start,
        total_ms=playtime_service.MAX_PLAYTIME_MS - 1000,
        last=utc_now() - timedelta(seconds=5),
    )

    row = playtime_service.apply_heartbeat(player, level, 5000)

    assert row.total_ms == playtime_service.MAX_PLAYTIME_MS == 5_999_999

    row = playtime_service.apply_heartbeat(player, level, 5000)
    assert row.total_ms == 5_999_999


def test_finishing_returns_the_total_and_deletes_the_row():
    _app, _client_, _token, player, level = _world()
    _row_at(player, level, utc_now(), total_ms=12_345)

    total = playtime_service.finish_playtime(player, level)
    db.session.commit()

    assert total == 12_345
    assert LevelPlaytime.query.count() == 0
    assert playtime_service.get_total_ms(player, level) == 0
    assert playtime_service.finish_playtime(player, level) == 0


# ── API ─────────────────────────────────────────────────────────────────


def test_the_first_heartbeat_creates_a_row_with_nothing_added_yet():
    _app, client, token, player, level = _world()

    response = _beat(client, token, level.slug, 5000)

    assert response.status_code == 200
    # Nothing has happened between creating the row and the first beat.
    assert response.get_json()["total_ms"] < 1000
    assert LevelPlaytime.query.filter_by(user_id=player.id, level_id=level.id).count() == 1


def test_heartbeats_accumulate_per_player_and_level():
    app, client, token, player, level = _world()
    other_token, other = _player(app, client, "speedy", "s@example.com")
    start = utc_now() - timedelta(seconds=30)
    _row_at(player, level, start, total_ms=0, last=start)

    first = _beat(client, token, level.slug, 5000).get_json()["total_ms"]
    assert first == 5000  # what it reported; 30s of real time had passed

    # Another player's total is their own.
    assert _beat(client, other_token, level.slug, 5000).get_json()["total_ms"] < 1000
    assert playtime_service.get_total_ms(player, level) == first


def test_a_heartbeat_needs_a_login():
    _app, client, _token, _player_user, level = _world()

    response = client.post(f"/api/levels/{level.slug}/playtime", json={"elapsed_ms": 1000})

    assert response.status_code == 401


@pytest.mark.parametrize("bad", [None, -1, 1.5, "5000", True])
def test_a_bad_elapsed_value_is_rejected(bad):
    _app, client, token, _player_user, level = _world()

    response = _beat(client, token, level.slug, bad)

    assert response.status_code == 400
    assert response.get_json()["code"] == "invalid_playtime"
    assert LevelPlaytime.query.count() == 0


def test_an_unknown_or_unpublished_level_is_a_404():
    app, client, token, _player_user, level = _world()

    assert _beat(client, token, "nope", 1000).status_code == 404

    level.published_at = None
    db.session.commit()
    assert _beat(client, token, level.slug, 1000).status_code == 404


def test_the_response_says_when_the_ceiling_is_reached():
    _app, client, token, player, level = _world()
    start = utc_now() - timedelta(days=30)
    _row_at(
        player,
        level,
        start,
        total_ms=playtime_service.MAX_PLAYTIME_MS,
        last=utc_now() - timedelta(seconds=5),
    )

    body = _beat(client, token, level.slug, 5000).get_json()

    assert body == {"total_ms": 5_999_999, "at_ceiling": True}