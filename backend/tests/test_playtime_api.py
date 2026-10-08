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


def test_the_first_heartbeat_creates_a_row_and_counts_the_time_it_reports():
    _app, client, token, player, level = _world()

    response = _beat(client, token, level.slug, 4000)

    assert response.status_code == 200
    # The reported time happened before the row existed, so it counts.
    assert response.get_json()["total_ms"] == 4000
    assert LevelPlaytime.query.filter_by(user_id=player.id, level_id=level.id).count() == 1


def test_heartbeats_accumulate_per_player_and_level():
    app, client, token, player, level = _world()
    other_token, other = _player(app, client, "speedy", "s@example.com")
    start = utc_now() - timedelta(seconds=30)
    _row_at(player, level, start, total_ms=0, last=start)

    first = _beat(client, token, level.slug, 5000).get_json()["total_ms"]
    assert first == 5000  # what it reported; 30s of real time had passed

    # Another player's total is their own.
    assert _beat(client, other_token, level.slug, 2000).get_json()["total_ms"] == 2000
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


def test_a_first_heartbeat_cannot_claim_more_than_one_interval():
    _app, client, token, _player_user, level = _world()

    body = _beat(client, token, level.slug, 300_000).get_json()

    assert body["total_ms"] == playtime_service.MAX_HEARTBEAT_MS


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


# ── The record: total playtime, all tries added up ──────────────────────


def _win(client, token, slug, elapsed_ms=0):
    return client.post(
        f"/api/levels/{slug}/record", json={"elapsed_ms": elapsed_ms}, headers=_headers(token)
    )


def _creator_levels(client):
    return client.get("/api/levels/by-user/creator").get_json()


def test_nobody_holds_a_record_until_someone_wins():
    _app, client, _token, _player_user, level = _world()

    response = client.get(f"/api/levels/{level.slug}/record")

    assert response.status_code == 200
    assert response.get_json() == {"record": None}


def test_the_record_is_all_tries_added_up_not_the_winning_try():
    # user b plays x, dies and leaves, comes back and wins in y: x + y.
    _app, client, token, player, level = _world()
    long_ago = utc_now() - timedelta(minutes=10)
    _row_at(player, level, long_ago, total_ms=40_000, last=long_ago)  # x = 40s

    response = _win(client, token, level.slug, elapsed_ms=5000)  # y = 5s

    assert response.status_code == 200
    body = response.get_json()
    assert body["total_ms"] == 45_000
    assert body["is_record"] is True
    assert body["record"] == {"username": "runner", "total_ms": 45_000}
    assert client.get(f"/api/levels/{level.slug}/record").get_json()["record"]["total_ms"] == 45_000


def test_a_win_resets_the_running_total():
    _app, client, token, player, level = _world()
    _row_at(player, level, utc_now() - timedelta(minutes=1), total_ms=30_000)

    _win(client, token, level.slug, elapsed_ms=1000)

    assert LevelPlaytime.query.filter_by(user_id=player.id).count() == 0
    # The next try starts from zero.
    second = _win(client, token, level.slug, elapsed_ms=3000).get_json()
    assert second["total_ms"] == 3000


def test_a_slower_total_does_not_take_the_record():
    app, client, token, player, level = _world()
    other_token, other = _player(app, client, "speedy", "s@example.com")
    _win(client, token, level.slug, elapsed_ms=5000)

    _row_at(other, level, utc_now() - timedelta(minutes=1), total_ms=20_000)
    body = _win(client, other_token, level.slug, elapsed_ms=1000).get_json()

    assert body["total_ms"] == 21_000
    assert body["is_record"] is False
    assert body["record"] == {"username": "runner", "total_ms": 5000}


def test_a_faster_total_takes_the_record_and_a_tie_keeps_it():
    app, client, token, _player_user, level = _world()
    other_token, _ = _player(app, client, "speedy", "s@example.com")
    _win(client, token, level.slug, elapsed_ms=5000)

    tie = _win(client, other_token, level.slug, elapsed_ms=5000).get_json()
    assert tie["is_record"] is False
    assert tie["record"]["username"] == "runner"

    faster = _win(client, other_token, level.slug, elapsed_ms=3000).get_json()
    assert faster["is_record"] is True
    assert faster["record"] == {"username": "speedy", "total_ms": 3000}


def test_a_win_with_almost_no_time_is_not_a_record():
    _app, client, token, _player_user, level = _world()

    body = _win(client, token, level.slug, elapsed_ms=50).get_json()

    assert body["is_record"] is False
    assert body["record"] is None


def test_a_deleted_holder_does_not_block_a_new_record():
    app, client, token, _player_user, level = _world()
    other_token, _ = _player(app, client, "newcomer", "n@example.com")
    _win(client, token, level.slug, elapsed_ms=2000)
    runner = User.query.filter_by(username="runner").first()
    runner.is_deleted = True
    db.session.commit()

    assert client.get(f"/api/levels/{level.slug}/record").get_json() == {"record": None}
    body = _win(client, other_token, level.slug, elapsed_ms=9000).get_json()

    assert body["is_record"] is True
    assert body["record"]["username"] == "newcomer"


def test_a_win_needs_a_login_and_a_published_level():
    _app, client, token, _player_user, level = _world()

    assert client.post(f"/api/levels/{level.slug}/record", json={"elapsed_ms": 1}).status_code == 401
    assert _win(client, token, "nope").status_code == 404
    assert client.get("/api/levels/nope/record").status_code == 404


@pytest.mark.parametrize("bad", [None, -1, 1.5, "5000", True])
def test_a_win_with_a_bad_elapsed_value_is_rejected(bad):
    _app, client, token, _player_user, level = _world()

    response = _win(client, token, level.slug, elapsed_ms=bad)

    assert response.status_code == 400
    assert response.get_json()["code"] == "invalid_playtime"


def test_the_level_card_shows_the_record():
    app, client, token, player, level = _world()
    assert _creator_levels(client)[0]["best_time_ms"] is None

    _row_at(player, level, utc_now() - timedelta(minutes=1), total_ms=40_000)
    _win(client, token, level.slug, elapsed_ms=5000)

    assert _creator_levels(client)[0]["best_time_ms"] == 45_000

    creator_token = _signup_creator_login(app, client)
    owner_list = client.get("/api/levels", headers=_headers(creator_token))
    assert owner_list.get_json()[0]["best_time_ms"] == 45_000


def test_the_card_ignores_a_deleted_holder():
    _app, client, token, _player_user, level = _world()
    _win(client, token, level.slug, elapsed_ms=2000)
    runner = User.query.filter_by(username="runner").first()
    runner.is_deleted = True
    db.session.commit()

    assert _creator_levels(client)[0]["best_time_ms"] is None


def _signup_creator_login(app, client) -> str:
    app.config["DEBUG"] = True
    login_response = client.post("/api/auth/request-login-link", json={"identifier": "creator"})
    login_token = login_response.get_json()["dev_login_token"]
    return client.post("/api/auth/login", json={"token": login_token}).get_json()["access_token"]