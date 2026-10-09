from datetime import timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy.exc import IntegrityError

from app.extensions import db
from app.main import create_app
from app.models.endless import EndlessLifeLoss, EndlessLifeLossReason, EndlessRun
from app.models.level import Level, LevelVisibilityState
from app.models.play_attempt import PlayAttempt
from app.models.user import User, UserRole
from app.services.endless import FREE_DAILY_POOL, get_pool_window
from app.utils.time import utc_now


def _client():
    app = create_app("testing")
    with app.app_context():
        db.create_all()
    return app, app.test_client()


def _signup_and_login(app, client, username="player", email="p@example.com") -> str:
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


def _player(app, client, clock, username="player", email="p@example.com", paid=False):
    """
    A logged-in, verified user whose created_at is pinned to the test
    clock, so their daily pool window starts exactly at clock.now and
    every window boundary in a test is predictable.
    """
    token = _signup_and_login(app, client, username, email)
    user = User.query.filter_by(username=username).first()
    user.created_at = clock.now
    # Set explicitly either way: the very first account ever created is
    # bootstrapped as OWNER (see create_user_row), which counts as paid.
    user.role = UserRole.MODERATOR if paid else UserRole.USER
    db.session.commit()
    return token, user


def _valid_content(**overrides) -> dict:
    content = {
        "spawnPosition": {"x": 48, "y": 48},
        "cameraMode": "follow",
        "playerStartingColor": "pink",
        "placedObjects": [],
        "characterSwapObjects": [],
        "doorObjects": [],
        "keyObjects": [],
    }
    content.update(overrides)
    return content


def _live_level(owner: User, title="A Level", difficulty=None, deleted=False) -> Level:
    """A published level, written straight to the database."""
    level = Level(
        owner_id=owner.id,
        title=title,
        visibility_state=LevelVisibilityState.PUBLISHED,
        published_at=utc_now(),
        draft_content=_valid_content(),
        difficulty_label_cached=difficulty,
        is_deleted=deleted,
    )
    db.session.add(level)
    db.session.commit()
    return level


def _creator(app, client, clock):
    """A second account that owns the levels the player gets served."""
    _token, creator = _player(app, client, clock, username="creator", email="c@example.com")
    return creator


def _post(client, token, path, json=None):
    return client.post(f"/api/endless{path}", json=json, headers=_headers(token))


def _status(client, token):
    return client.get("/api/endless/status", headers=_headers(token))


def _start(client, token, **body):
    return _post(client, token, "/runs", body)


def _die_once(client, token):
    assert _post(client, token, "/runs/current/begin").status_code == 200
    return _post(client, token, "/runs/current/death")


def _setup_free_world(app, client, clock, levels=1):
    token, player = _player(app, client, clock)
    creator = _creator(app, client, clock)
    for index in range(levels):
        _live_level(creator, title=f"Level {index}")
    return token, player, creator


# --- pool window math (pure) ---


def test_pool_window_is_anchored_at_created_at_and_rolls_every_24_hours():
    created = utc_now()
    user = SimpleNamespace(created_at=created)

    assert get_pool_window(user, created) == (created, created + timedelta(hours=24))
    assert get_pool_window(user, created + timedelta(hours=23, minutes=59))[0] == created
    # The end of a window is exclusive - exactly 24h in is the next window.
    assert get_pool_window(user, created + timedelta(hours=24)) == (
        created + timedelta(hours=24),
        created + timedelta(hours=48),
    )
    assert get_pool_window(user, created + timedelta(hours=100))[0] == created + timedelta(hours=96)


# --- auth & gating ---


def test_endless_requires_auth():
    app, client = _client()
    with app.app_context():
        assert client.get("/api/endless/status").status_code == 401
        assert client.post("/api/endless/runs", json={}).status_code == 401


def test_unverified_account_is_blocked():
    app, client = _client()
    with app.app_context():
        app.config["DEBUG"] = True
        client.post("/api/users", json={"username": "newbie", "email": "n@example.com"})
        request_response = client.post("/api/auth/request-login-link", json={"identifier": "newbie"})
        login_token = request_response.get_json()["dev_login_token"]
        token = client.post("/api/auth/login", json={"token": login_token}).get_json()["access_token"]

        response = _status(client, token)
        assert response.status_code == 403
        assert response.get_json()["code"] == "verification_required"


# --- status ---


def test_status_for_a_free_account(clock):
    app, client = _client()
    with app.app_context():
        token, _player_user, creator = _setup_free_world(app, client, clock)
        _live_level(creator, title="Hard one", difficulty="hard")
        _live_level(creator, title="Deleted", deleted=True)

        body = _status(client, token).get_json()

        assert body["is_paid"] is False
        assert body["lives"] == {"adjustable": False, "default": 10, "min": 10, "max": 10}
        assert body["pool"]["daily_limit"] == FREE_DAILY_POOL
        assert body["pool"]["remaining"] == FREE_DAILY_POOL
        # Two live levels; the deleted one is never served. Only "hard"
        # has any - the rest are greyed out in the picker.
        assert body["difficulties"]["any"] == 2
        assert body["difficulties"]["hard"] == 1
        assert body["difficulties"]["easy"] == 0
        assert body["active_run"] is None


def test_status_for_a_paid_account_has_no_pool(clock):
    app, client = _client()
    with app.app_context():
        token, _user = _player(app, client, clock, paid=True)

        body = _status(client, token).get_json()
        assert body["is_paid"] is True
        assert body["pool"] is None
        assert body["lives"] == {"adjustable": True, "default": 100, "min": 1, "max": 100}


# --- starting a run ---


def test_start_run_for_a_free_account(clock):
    app, client = _client()
    with app.app_context():
        token, _player_user, _creator_user = _setup_free_world(app, client, clock)

        response = _start(client, token)
        assert response.status_code == 201
        run = response.get_json()["run"]

        assert run["is_active"] is True
        assert run["difficulty"] is None
        assert run["starting_lives"] == 10
        assert run["lives_remaining"] == 10
        assert run["current_level"]["title"] == "Level 0"
        assert run["current_level"]["owner_username"] == "creator"
        assert run["current_level"]["player_starting_color"] == "pink"
        assert run["current_level"]["position"] == 1
        assert run["current_level"]["attempt_in_progress"] is False
        assert run["pool"]["remaining"] == 50


def test_free_account_cannot_choose_its_lives(clock):
    app, client = _client()
    with app.app_context():
        token, _p, _c = _setup_free_world(app, client, clock)

        response = _start(client, token, starting_lives=5)
        assert response.status_code == 403
        assert response.get_json()["code"] == "paid_only"


def test_paid_account_defaults_to_100_and_can_choose_1_to_100(clock):
    app, client = _client()
    with app.app_context():
        token, _user = _player(app, client, clock, paid=True)
        creator = _creator(app, client, clock)
        _live_level(creator)

        run = _start(client, token).get_json()["run"]
        assert run["starting_lives"] == 100
        assert run["pool"] is None

        run = _start(client, token, starting_lives=25, replace=True).get_json()["run"]
        assert run["starting_lives"] == 25

        for bad in (0, 101, -3, "5", 2.5, True):
            response = _start(client, token, starting_lives=bad, replace=True)
            assert response.status_code == 400, bad
            assert response.get_json()["code"] == "invalid_lives"


def test_start_run_with_no_levels_is_rejected(clock):
    app, client = _client()
    with app.app_context():
        token, _user = _player(app, client, clock)

        response = _start(client, token)
        assert response.status_code == 409
        assert response.get_json()["code"] == "no_levels_available"


def test_difficulty_filter(clock):
    app, client = _client()
    with app.app_context():
        token, _p, creator = _setup_free_world(app, client, clock)
        _live_level(creator, title="Tough", difficulty="hard")

        assert _start(client, token, difficulty="bogus").get_json()["code"] == "invalid_difficulty"

        empty = _start(client, token, difficulty="easy")
        assert empty.status_code == 409
        assert empty.get_json()["code"] == "no_levels_available"

        # Nothing is lost by a failed attempt: the run starts fine after.
        run = _start(client, token, difficulty="hard").get_json()["run"]
        assert run["difficulty"] == "hard"
        assert run["current_level"]["title"] == "Tough"

        run = _start(client, token, difficulty="any", replace=True).get_json()["run"]
        assert run["difficulty"] is None


def test_only_one_active_run_and_start_over_replaces_it(clock):
    app, client = _client()
    with app.app_context():
        token, _p, _c = _setup_free_world(app, client, clock)
        _start(client, token)

        conflict = _start(client, token)
        assert conflict.status_code == 409
        body = conflict.get_json()
        assert body["code"] == "active_run_exists"
        assert body["active_run"]["is_active"] is True

        replaced = _start(client, token, replace=True)
        assert replaced.status_code == 201
        assert EndlessRun.query.filter_by(is_active=True).count() == 1
        forfeited = EndlessRun.query.filter_by(is_active=False).one()
        assert forfeited.end_reason.value == "forfeited"


def test_database_refuses_two_active_runs_for_one_user(clock):
    app, client = _client()
    with app.app_context():
        _token, user, _c = _setup_free_world(app, client, clock)
        db.session.add(EndlessRun(user_id=user.id, starting_lives=10, lives_remaining=10))
        db.session.commit()
        db.session.add(EndlessRun(user_id=user.id, starting_lives=10, lives_remaining=10))
        with pytest.raises(IntegrityError):
            db.session.commit()
        db.session.rollback()


# --- playing: begin / death / clear / skip ---


def test_death_costs_a_life_and_counts_every_try(clock):
    app, client = _client()
    with app.app_context():
        token, _player_user, creator = _setup_free_world(app, client, clock)
        level = Level.query.filter_by(owner_id=creator.id).first()
        _start(client, token)

        begun = _post(client, token, "/runs/current/begin").get_json()["run"]
        assert begun["current_level"]["attempt_in_progress"] is True
        assert begun["current_level"]["attempts"] == 1
        # A real player counts toward the level's play count.
        assert db.session.get(Level, level.id).play_count == 1

        died = _post(client, token, "/runs/current/death").get_json()["run"]
        assert died["lives_remaining"] == 9
        assert died["deaths"] == 1
        assert died["pool"]["remaining"] == 49
        assert died["current_level"]["attempt_in_progress"] is False

        # The retry is a second attempt of the same level.
        retry = _post(client, token, "/runs/current/begin").get_json()["run"]
        assert retry["current_level"]["attempts"] == 2
        assert db.session.get(Level, level.id).play_count == 2


def test_death_or_clear_without_a_begun_attempt_is_rejected(clock):
    app, client = _client()
    with app.app_context():
        token, _p, _c = _setup_free_world(app, client, clock)
        _start(client, token)

        for path in ("/runs/current/death", "/runs/current/clear", "/runs/current/heartbeat"):
            response = _post(client, token, path)
            assert response.status_code == 409, path
            assert response.get_json()["code"] == "no_attempt_in_progress"


def test_actions_without_an_active_run_are_404(clock):
    app, client = _client()
    with app.app_context():
        token, _p, _c = _setup_free_world(app, client, clock)

        for path in ("/runs/current/begin", "/runs/current/death", "/runs/current/skip", "/runs/current/quit"):
            response = _post(client, token, path)
            assert response.status_code == 404, path
            assert response.get_json()["code"] == "no_active_run"


def test_clear_advances_and_repeats_are_allowed(clock):
    app, client = _client()
    with app.app_context():
        token, _player_user, creator = _setup_free_world(app, client, clock, levels=1)
        level = Level.query.filter_by(owner_id=creator.id).first()
        _start(client, token)
        _post(client, token, "/runs/current/begin")

        run = _post(client, token, "/runs/current/clear").get_json()["run"]

        assert run["levels_cleared"] == 1
        assert run["lives_remaining"] == 10
        # Only one level exists, so the next one is the same level again.
        assert run["current_level"]["title"] == "Level 0"
        assert run["current_level"]["position"] == 2
        assert run["current_level"]["attempts"] == 0
        assert db.session.get(Level, level.id).completion_count == 1


def test_skip_costs_a_life_with_or_without_an_attempt(clock):
    app, client = _client()
    with app.app_context():
        token, _p, _c = _setup_free_world(app, client, clock)
        _start(client, token)

        run = _post(client, token, "/runs/current/skip").get_json()["run"]
        assert run["lives_remaining"] == 9
        assert run["skips"] == 1
        assert run["deaths"] == 0
        assert run["current_level"]["position"] == 2

        # Skipping mid-attempt costs the skip's life, not an extra death.
        _post(client, token, "/runs/current/begin")
        run = _post(client, token, "/runs/current/skip").get_json()["run"]
        assert run["lives_remaining"] == 8
        assert run["deaths"] == 0
        assert run["pool"]["remaining"] == 48


def test_run_ends_when_lives_run_out_and_shows_the_pool_reset(clock):
    app, client = _client()
    with app.app_context():
        token, _p, _c = _setup_free_world(app, client, clock)
        _start(client, token)

        for _ in range(9):
            assert _die_once(client, token).get_json()["run"]["is_active"] is True
        last = _die_once(client, token).get_json()["run"]

        assert last["is_active"] is False
        assert last["end_reason"] == "out_of_lives"
        assert last["lives_remaining"] == 0
        assert last["current_level"] is None
        # What the game-over screen needs: lives left in the pool and when they refresh.
        assert last["pool"]["remaining"] == 40
        assert last["pool"]["resets_at"]

        assert _post(client, token, "/runs/current/begin").status_code == 404


def test_skip_on_the_last_life_ends_the_run(clock):
    app, client = _client()
    with app.app_context():
        token, _p, _c = _setup_free_world(app, client, clock)
        _start(client, token)
        for _ in range(9):
            _post(client, token, "/runs/current/skip")

        run = _post(client, token, "/runs/current/skip").get_json()["run"]
        assert run["is_active"] is False
        assert run["end_reason"] == "out_of_lives"


def test_quit_forfeits_the_run(clock):
    app, client = _client()
    with app.app_context():
        token, _p, _c = _setup_free_world(app, client, clock)
        _start(client, token)

        run = _post(client, token, "/runs/current/quit").get_json()["run"]
        assert run["is_active"] is False
        assert run["end_reason"] == "forfeited"
        # Quitting cost nothing: only lives actually lost are charged.
        assert run["pool"]["remaining"] == 50
        assert _status(client, token).get_json()["active_run"] is None


def test_runs_are_private_to_their_user(clock):
    app, client = _client()
    with app.app_context():
        token, _p, creator = _setup_free_world(app, client, clock)
        other_token, _other = _player(app, client, clock, username="other", email="o@example.com")
        _start(client, token)

        assert _status(client, other_token).get_json()["active_run"] is None
        assert _post(client, other_token, "/runs/current/death").status_code == 404


# --- the daily pool ---


def test_new_runs_start_with_10_or_whatever_is_left_in_the_pool(clock):
    """The spec's own example: pool of 16 -> a run loses all 10 -> pool 6
    -> the next run starts with 6, not a fresh 10."""
    app, client = _client()
    with app.app_context():
        token, player, _c = _setup_free_world(app, client, clock)
        first_run = EndlessRun(user_id=player.id, starting_lives=10, lives_remaining=0, is_active=False)
        db.session.add(first_run)
        db.session.flush()
        for _ in range(34):
            db.session.add(
                EndlessLifeLoss(
                    user_id=player.id, run_id=first_run.id, reason=EndlessLifeLossReason.DEATH, created_at=clock.now
                )
            )
        db.session.commit()
        assert _status(client, token).get_json()["pool"]["remaining"] == 16

        run = _start(client, token).get_json()["run"]
        assert run["starting_lives"] == 10
        for _ in range(10):
            _die_once(client, token)
        assert _status(client, token).get_json()["pool"]["remaining"] == 6

        run = _start(client, token).get_json()["run"]
        assert run["starting_lives"] == 6
        for _ in range(6):
            last = _die_once(client, token).get_json()["run"]
        assert last["is_active"] is False
        assert last["pool"]["remaining"] == 0

        exhausted = _start(client, token)
        assert exhausted.status_code == 429
        body = exhausted.get_json()
        assert body["code"] == "daily_pool_exhausted"
        assert body["pool"]["remaining"] == 0
        assert body["pool"]["resets_at"]


def test_pool_refreshes_24_hours_after_signup(clock):
    app, client = _client()
    with app.app_context():
        token, player, _c = _setup_free_world(app, client, clock)
        first_run = EndlessRun(user_id=player.id, starting_lives=10, lives_remaining=0, is_active=False)
        db.session.add(first_run)
        db.session.flush()
        for _ in range(FREE_DAILY_POOL):
            db.session.add(
                EndlessLifeLoss(
                    user_id=player.id, run_id=first_run.id, reason=EndlessLifeLossReason.DEATH, created_at=clock.now
                )
            )
        db.session.commit()
        assert _start(client, token).status_code == 429

        clock.advance(hours=23, minutes=59)
        assert _start(client, token).status_code == 429

        clock.advance(minutes=2)
        refreshed = _status(client, token).get_json()["pool"]
        assert refreshed["remaining"] == FREE_DAILY_POOL
        assert _start(client, token).get_json()["run"]["starting_lives"] == 10


def test_paid_accounts_are_never_locked_out(clock):
    app, client = _client()
    with app.app_context():
        token, _user = _player(app, client, clock, paid=True)
        creator = _creator(app, client, clock)
        _live_level(creator)

        for _ in range(3):
            _start(client, token, starting_lives=1, replace=True)
            run = _die_once(client, token).get_json()["run"]
            assert run["is_active"] is False
            assert run["pool"] is None


# --- abandoned attempts ---


def test_an_abandoned_attempt_costs_a_life_when_the_player_returns(clock):
    app, client = _client()
    with app.app_context():
        token, _p, _c = _setup_free_world(app, client, clock)
        _start(client, token)
        _post(client, token, "/runs/current/begin")
        _post(client, token, "/runs/current/heartbeat")
        clock.advance(seconds=10)
        _post(client, token, "/runs/current/heartbeat")
        clock.advance(seconds=20)
        _post(client, token, "/runs/current/heartbeat")  # last seen 30s after it began
        clock.advance(minutes=5)  # ...then the tab was closed

        run = _status(client, token).get_json()["active_run"]

        assert run["lives_remaining"] == 9
        assert run["deaths"] == 1
        assert run["current_level"]["attempt_in_progress"] is False
        assert run["pool"]["remaining"] == 49
        # A second look doesn't charge again.
        assert _status(client, token).get_json()["active_run"]["lives_remaining"] == 9


def test_closing_within_the_grace_period_is_free(clock):
    app, client = _client()
    with app.app_context():
        token, _p, _c = _setup_free_world(app, client, clock)
        _start(client, token)
        _post(client, token, "/runs/current/begin")
        _post(client, token, "/runs/current/heartbeat")  # the client's first beat, right away
        clock.advance(seconds=10)
        _post(client, token, "/runs/current/heartbeat")
        clock.advance(minutes=5)  # tab closed ~10s in, back much later

        run = _status(client, token).get_json()["active_run"]
        assert run["lives_remaining"] == 10
        assert run["pool"]["remaining"] == 50
        assert run["current_level"]["attempt_in_progress"] is False


def test_an_attempt_with_no_heartbeat_never_gets_the_grace_period(clock):
    """Otherwise a client that simply never sent heartbeats could quit
    before every death and never lose a life."""
    app, client = _client()
    with app.app_context():
        token, _p, _c = _setup_free_world(app, client, clock)
        _start(client, token)
        _post(client, token, "/runs/current/begin")
        clock.advance(seconds=5)

        assert _status(client, token).get_json()["active_run"]["lives_remaining"] == 9


def test_starting_over_cannot_dodge_an_abandoned_attempt(clock):
    app, client = _client()
    with app.app_context():
        token, _p, _c = _setup_free_world(app, client, clock)
        _start(client, token)
        _post(client, token, "/runs/current/begin")
        clock.advance(minutes=1)

        run = _start(client, token, replace=True).get_json()["run"]
        # The old run's abandoned attempt was charged to the pool first.
        assert run["pool"]["remaining"] == 49
        assert run["starting_lives"] == 10


def test_beginning_a_new_attempt_settles_the_unreported_one(clock):
    app, client = _client()
    with app.app_context():
        token, _p, _c = _setup_free_world(app, client, clock)
        _start(client, token)
        _post(client, token, "/runs/current/begin")
        clock.advance(minutes=1)

        run = _post(client, token, "/runs/current/begin").get_json()["run"]
        assert run["lives_remaining"] == 9
        assert run["current_level"]["attempts"] == 2


def test_an_abandon_charged_in_an_earlier_pool_window_costs_nothing(clock):
    app, client = _client()
    with app.app_context():
        token, _p, _c = _setup_free_world(app, client, clock)
        _start(client, token)
        clock.advance(hours=23, minutes=50)
        _post(client, token, "/runs/current/begin")
        # The pool window rolls over at 24h; the run itself is only
        # 20 minutes idle, so it hasn't expired - the window rule is
        # what makes this free.
        clock.advance(minutes=20)

        run = _status(client, token).get_json()["active_run"]
        assert run["lives_remaining"] == 10
        assert run["pool"]["remaining"] == 50


def test_a_run_idle_for_24_hours_expires_without_charging_anything(clock):
    app, client = _client()
    with app.app_context():
        token, _p, _c = _setup_free_world(app, client, clock)
        _start(client, token)
        _post(client, token, "/runs/current/begin")
        clock.advance(hours=25)

        body = _status(client, token).get_json()
        assert body["active_run"] is None
        assert body["pool"]["remaining"] == 50

        expired = EndlessRun.query.one()
        assert expired.is_active is False
        assert expired.end_reason.value == "expired"
        # Free to start a fresh run straight away.
        assert _start(client, token).status_code == 201
        
# --- clear rate / difficulty ---


def test_endless_tries_and_clears_feed_the_levels_attempts(clock):
    app, client = _client()
    with app.app_context():
        token, player, creator = _setup_free_world(app, client, clock)
        level = Level.query.filter_by(owner_id=creator.id).first()
        _start(client, token)

        # A death: one attempt, never completed.
        _die_once(client, token)
        # The retry is cleared: a second attempt, now completed.
        _post(client, token, "/runs/current/begin")
        _post(client, token, "/runs/current/clear")

        attempts = PlayAttempt.query.filter_by(level_id=level.id).order_by(PlayAttempt.id).all()
        assert [attempt.source for attempt in attempts] == ["endless", "endless"]
        assert [attempt.completed_at is not None for attempt in attempts] == [False, True]
        assert all(attempt.user_id == player.id for attempt in attempts)
        


# --- the shuffled list levels are served from ---


def _setup_paid_world(app, client, clock, levels):
    """A paid player (so a run can have many lives) and `levels` live levels."""
    token, player = _player(app, client, clock, paid=True)
    creator = _creator(app, client, clock)
    for index in range(levels):
        _live_level(creator, title=f"Level {index}")
    return token, player, creator


def _served_level_ids(run_id):
    from app.models.endless import EndlessRunLevel

    entries = EndlessRunLevel.query.filter_by(run_id=run_id).order_by(EndlessRunLevel.position).all()
    return [entry.level_id for entry in entries]


def test_every_level_is_served_once_before_any_repeats(clock):
    app, client = _client()
    with app.app_context():
        token, _p, _c = _setup_paid_world(app, client, clock, levels=4)
        run = _start(client, token, starting_lives=50).get_json()["run"]

        for _ in range(7):
            _post(client, token, "/runs/current/skip")

        served = _served_level_ids(EndlessRun.query.first().id)
        assert len(served) == 8
        # Two full passes through the 4 levels: each pass has no duplicates.
        assert len(set(served[:4])) == 4
        assert len(set(served[4:])) == 4
        assert run["current_level"]["position"] == 1


def test_the_same_level_is_never_served_twice_in_a_row(clock):
    app, client = _client()
    with app.app_context():
        token, _p, _c = _setup_paid_world(app, client, clock, levels=2)
        _start(client, token, starting_lives=50)

        for _ in range(30):
            _post(client, token, "/runs/current/skip")

        served = _served_level_ids(EndlessRun.query.first().id)
        assert len(served) == 31
        assert all(a != b for a, b in zip(served, served[1:]))


def test_a_lone_level_repeats_since_it_is_the_only_choice(clock):
    app, client = _client()
    with app.app_context():
        token, _p, _c = _setup_free_world(app, client, clock, levels=1)
        _start(client, token)
        _post(client, token, "/runs/current/skip")
        _post(client, token, "/runs/current/skip")

        served = _served_level_ids(EndlessRun.query.first().id)
        assert len(served) == 3
        assert len(set(served)) == 1


def test_a_level_removed_after_the_list_was_built_is_skipped(clock):
    app, client = _client()
    with app.app_context():
        token, _p, _c = _setup_paid_world(app, client, clock, levels=5)
        _start(client, token, starting_lives=50)
        run = EndlessRun.query.first()
        remaining = list(run.level_queue)
        assert len(remaining) == 4

        # Delete the level that was next in line.
        doomed = db.session.get(Level, remaining[0])
        doomed.is_deleted = True
        db.session.commit()

        _post(client, token, "/runs/current/skip")

        served = _served_level_ids(run.id)
        assert doomed.id not in served
        assert served[1] == remaining[1]


def test_a_relabeled_level_drops_out_of_a_difficulty_run(clock):
    app, client = _client()
    with app.app_context():
        token, _p = _player(app, client, clock, paid=True)
        creator = _creator(app, client, clock)
        for index in range(3):
            _live_level(creator, title=f"Hard {index}", difficulty="hard")
        _start(client, token, difficulty="hard", starting_lives=50)
        run = EndlessRun.query.first()
        remaining = list(run.level_queue)

        relabeled = db.session.get(Level, remaining[0])
        relabeled.difficulty_label_cached = "easy"
        db.session.commit()

        _post(client, token, "/runs/current/skip")

        assert relabeled.id not in _served_level_ids(run.id)


def test_a_run_with_no_levels_left_serves_none(clock):
    app, client = _client()
    with app.app_context():
        token, _p, _c = _setup_paid_world(app, client, clock, levels=2)
        _start(client, token, starting_lives=50)
        for level in Level.query.all():
            level.is_deleted = True
        db.session.commit()

        response = _post(client, token, "/runs/current/skip")

        # Same as before the list existed: the run stays, with no level to serve.
        assert response.status_code == 200
        assert response.get_json()["run"]["current_level"] is None
        


# --- scoreboard mode ---
def _start_scoreboard(client, token, **body):
    return _start(client, token, mode="scoreboard", **body)


def _clear_once(client, token):
    assert _post(client, token, "/runs/current/begin").status_code == 200
    return _post(client, token, "/runs/current/clear")


def _scoreboard_world(app, client, clock, labels, paid=False):
    """A player plus one live level per label in `labels` (None = unlabeled)."""
    token, player = _player(app, client, clock, paid=paid)
    creator = _creator(app, client, clock)
    levels = [_live_level(creator, title=f"Level {i}", difficulty=label) for i, label in enumerate(labels)]
    return token, player, levels


def test_status_lists_the_scoreboard_picker_data(clock):
    app, client = _client()
    with app.app_context():
        token, _p, _levels = _scoreboard_world(app, client, clock, ["easy", "hard", None])

        body = _status(client, token).get_json()

        assert body["scoreboard"]["lives"] == 5
        assert body["scoreboard"]["points"] == {"easy": 1, "normal": 2, "hard": 3, "very_hard": 4, "tas": 5}
        # Endless counts the unlabeled level; the scoreboard doesn't.
        assert body["difficulties"]["any"] == 3
        assert body["scoreboard"]["difficulties"]["any"] == 2
        assert body["scoreboard"]["difficulties"]["hard"] == 1
        assert body["scoreboard"]["difficulties"]["tas"] == 0


def test_a_scoreboard_run_has_five_lives_and_only_serves_labeled_levels(clock):
    app, client = _client()
    with app.app_context():
        token, _p, levels = _scoreboard_world(app, client, clock, ["easy", "normal", None])
        unlabeled = levels[2]

        run = _start_scoreboard(client, token).get_json()["run"]
        assert run["mode"] == "scoreboard"
        assert run["starting_lives"] == 5
        assert run["lives_remaining"] == 5
        assert run["score"] == 0

        for _ in range(4):
            _post(client, token, "/runs/current/skip")
        served = _served_level_ids(EndlessRun.query.first().id)
        assert unlabeled.id not in served


def test_a_scoreboard_run_needs_a_labeled_level(clock):
    app, client = _client()
    with app.app_context():
        token, _p, _levels = _scoreboard_world(app, client, clock, [None, None])

        response = _start_scoreboard(client, token)

        assert response.status_code == 409
        assert response.get_json()["code"] == "no_levels_available"
        # Endless mode still serves them.
        assert _start(client, token).status_code == 201


def test_a_scoreboard_run_refuses_a_chosen_number_of_lives(clock):
    app, client = _client()
    with app.app_context():
        token, _p, _levels = _scoreboard_world(app, client, clock, ["easy"], paid=True)

        response = _start_scoreboard(client, token, starting_lives=20)

        assert response.status_code == 400
        assert response.get_json()["code"] == "fixed_lives"


def test_an_unknown_mode_is_rejected(clock):
    app, client = _client()
    with app.app_context():
        token, _p, _levels = _scoreboard_world(app, client, clock, ["easy"])

        response = _start(client, token, mode="chaos")

        assert response.status_code == 400
        assert response.get_json()["code"] == "invalid_mode"


def test_in_any_a_clear_is_worth_the_levels_difficulty(clock, frozen_labels):
    app, client = _client()
    with app.app_context():
        token, _p, levels = _scoreboard_world(app, client, clock, ["easy", "normal", "hard", "very_hard", "tas"])
        weights = {level.id: points for level, points in zip(levels, [1, 2, 3, 4, 5])}
        _start_scoreboard(client, token, difficulty="any")

        expected = 0
        run = None
        for _ in range(5):
            current = EndlessRun.query.first()
            entry_level_id = [e for e in current.levels if e.outcome.value == "active"][0].level_id
            expected += weights[entry_level_id]
            run = _clear_once(client, token).get_json()["run"]
            assert run["score"] == expected
            assert run["levels_cleared"] == len([e for e in EndlessRun.query.first().levels if e.outcome.value == "cleared"])

        assert expected == 15


def test_in_a_single_difficulty_every_clear_is_one_point(clock, frozen_labels):
    app, client = _client()
    with app.app_context():
        token, _p, _levels = _scoreboard_world(app, client, clock, ["hard", "hard", "easy"])
        run = _start_scoreboard(client, token, difficulty="hard").get_json()["run"]
        assert run["current_level"]["points"] == 1

        _clear_once(client, token)
        run = _clear_once(client, token).get_json()["run"]

        assert run["score"] == 2


def test_a_levels_points_are_fixed_when_it_is_served(clock, frozen_labels):
    app, client = _client()
    with app.app_context():
        token, _p, levels = _scoreboard_world(app, client, clock, ["tas"])
        run = _start_scoreboard(client, token).get_json()["run"]
        assert run["current_level"]["points"] == 5

        # Relabeled while the player is on it: still worth what it was.
        levels[0].difficulty_label_cached = "easy"
        db.session.commit()
        run = _clear_once(client, token).get_json()["run"]

        assert run["score"] == 5


def test_deaths_and_skips_score_nothing_and_five_end_the_run(clock, frozen_labels):
    app, client = _client()
    with app.app_context():
        token, _p, _levels = _scoreboard_world(app, client, clock, ["normal"])
        _start_scoreboard(client, token)
        _clear_once(client, token)

        for _ in range(4):
            _die_once(client, token)
        run = _post(client, token, "/runs/current/skip").get_json()["run"]

        assert run["is_active"] is False
        assert run["end_reason"] == "out_of_lives"
        assert run["score"] == 2
        assert run["lives_remaining"] == 0


def test_scoreboard_lives_come_out_of_the_free_daily_pool(clock, frozen_labels):
    app, client = _client()
    with app.app_context():
        token, _p, _levels = _scoreboard_world(app, client, clock, ["easy"])
        _start_scoreboard(client, token)

        run = _die_once(client, token).get_json()["run"]

        assert run["pool"]["remaining"] == 49


def test_a_free_account_needs_a_full_runs_worth_of_pool_left(clock):
    app, client = _client()
    with app.app_context():
        token, player, _levels = _scoreboard_world(app, client, clock, ["easy"])
        from app.models.endless import EndlessLifeLossReason

        earlier = EndlessRun(user_id=player.id, starting_lives=10, lives_remaining=0, is_active=False)
        db.session.add(earlier)
        db.session.flush()
        for _ in range(46):  # 4 of today's 50 left
            db.session.add(
                EndlessLifeLoss(
                    user_id=player.id, run_id=earlier.id, reason=EndlessLifeLossReason.DEATH, created_at=clock.now
                )
            )
        db.session.commit()

        response = _start_scoreboard(client, token)

        assert response.status_code == 429
        assert response.get_json()["code"] == "daily_pool_too_low"
        assert response.get_json()["pool"]["remaining"] == 4
        # Endless mode would still start (with the 4 lives that are left).
        assert _start(client, token).get_json()["run"]["starting_lives"] == 4


def test_a_paid_account_has_no_pool_in_scoreboard_mode(clock):
    app, client = _client()
    with app.app_context():
        token, _p, _levels = _scoreboard_world(app, client, clock, ["easy"], paid=True)

        run = _start_scoreboard(client, token).get_json()["run"]

        assert run["starting_lives"] == 5
        assert run["pool"] is None


def test_an_endless_run_is_not_scored(clock, frozen_labels):
    app, client = _client()
    with app.app_context():
        token, _p, _levels = _scoreboard_world(app, client, clock, ["hard"])
        run = _start(client, token).get_json()["run"]
        assert run["mode"] == "endless"
        assert run["current_level"]["points"] is None

        run = _clear_once(client, token).get_json()["run"]

        assert run["score"] == 0
        assert run["levels_cleared"] == 1


def test_a_scoreboard_run_shares_the_one_active_run_slot(clock):
    app, client = _client()
    with app.app_context():
        token, _p, _levels = _scoreboard_world(app, client, clock, ["easy"])
        _start(client, token)

        response = _start_scoreboard(client, token)

        assert response.status_code == 409
        assert response.get_json()["code"] == "active_run_exists"
        assert response.get_json()["active_run"]["mode"] == "endless"

        replaced = _start_scoreboard(client, token, replace=True)
        assert replaced.status_code == 201
        assert replaced.get_json()["run"]["mode"] == "scoreboard"