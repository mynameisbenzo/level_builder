import pytest
from flask import current_app

from app.extensions import db
from app.main import create_app
from app.models.level import Level, LevelVersion, LevelVisibilityState
from app.models.level_ghost import LevelGhost
from app.models.user import User, UserRole


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


def _live_level(owner: User, spawn=(48, 48)) -> Level:
    level = Level(owner_id=owner.id, title="L", visibility_state=LevelVisibilityState.PUBLISHED)
    db.session.add(level)
    db.session.flush()
    version = LevelVersion(
        level_id=level.id,
        version_number=1,
        content={
            "spawnPosition": {"x": spawn[0], "y": spawn[1]},
            "cameraMode": "follow",
            "playerStartingColor": "green",
            "placedObjects": [],
        },
    )
    db.session.add(version)
    db.session.flush()
    level.latest_published_version_id = version.id
    db.session.commit()
    return level


def _run(duration_ms=2000, start=(48, 48), step=10, state=0):
    """A valid, gently moving run: a sample every 50ms plus the final one."""
    count = duration_ms // 50 + 1
    return {
        "version": 1,
        "duration_ms": duration_ms,
        "frames": [[start[0] + i * step, start[1], state] for i in range(count)],
    }


def _submit(client, token, slug, body):
    return client.post(f"/api/levels/{slug}/ghost", json=body, headers=_headers(token))


def _world():
    app, client = _client()
    token, _player_user = _player(app, client, "runner", "r@example.com")
    creator_token, creator = _player(app, client, "creator", "c@example.com")
    level = _live_level(creator)
    return app, client, token, level


def test_no_ghost_until_someone_clears_it():
    _app, client, _token, level = _world()
    response = client.get(f"/api/levels/{level.slug}/ghost")
    assert response.status_code == 200
    assert response.get_json() == {"ghost": None}


def test_first_clear_becomes_the_ghost_and_is_public():
    _app, client, token, level = _world()

    response = _submit(client, token, level.slug, _run(2000))
    assert response.status_code == 200
    body = response.get_json()
    assert body["is_record"] is True
    assert body["record"] == {"username": "runner", "duration_ms": 2000}

    # Public: no auth needed to fetch it.
    fetched = client.get(f"/api/levels/{level.slug}/ghost").get_json()["ghost"]
    assert fetched["username"] == "runner"
    assert fetched["duration_ms"] == 2000
    assert fetched["sample_interval_ms"] == 50
    assert fetched["version"] == 1
    assert len(fetched["frames"]) == 41


def test_faster_clear_replaces_the_ghost():
    app, client, token, level = _world()
    other_token, _ = _player(app, client, "speedy", "s@example.com")

    _submit(client, token, level.slug, _run(3000))
    response = _submit(client, other_token, level.slug, _run(2000))

    assert response.get_json()["is_record"] is True
    assert response.get_json()["record"]["username"] == "speedy"
    assert LevelGhost.query.count() == 1
    assert client.get(f"/api/levels/{level.slug}/ghost").get_json()["ghost"]["username"] == "speedy"


def test_slower_clear_keeps_the_ghost_and_reports_the_record():
    app, client, token, level = _world()
    other_token, _ = _player(app, client, "slowpoke", "s@example.com")

    _submit(client, token, level.slug, _run(2000))
    response = _submit(client, other_token, level.slug, _run(3000))

    assert response.status_code == 200
    body = response.get_json()
    assert body["is_record"] is False
    assert body["record"] == {"username": "runner", "duration_ms": 2000}


def test_tie_keeps_the_existing_ghost():
    app, client, token, level = _world()
    other_token, _ = _player(app, client, "late", "l@example.com")

    _submit(client, token, level.slug, _run(2000))
    response = _submit(client, other_token, level.slug, _run(2000))

    assert response.get_json()["is_record"] is False
    assert response.get_json()["record"]["username"] == "runner"


def test_beating_your_own_ghost_replaces_it():
    _app, client, token, level = _world()

    _submit(client, token, level.slug, _run(3000))
    response = _submit(client, token, level.slug, _run(2500))

    assert response.get_json()["is_record"] is True
    assert LevelGhost.query.one().duration_ms == 2500


def test_submitting_requires_login():
    _app, client, _token, level = _world()
    response = client.post(f"/api/levels/{level.slug}/ghost", json=_run())
    assert response.status_code == 401


def test_unverified_account_cannot_submit():
    app, client, _token, level = _world()
    app.config["DEBUG"] = True
    client.post("/api/users", json={"username": "unverified", "email": "u@example.com"})
    login_request = client.post("/api/auth/request-login-link", json={"identifier": "unverified"})
    login_token = login_request.get_json()["dev_login_token"]
    token = client.post("/api/auth/login", json={"token": login_token}).get_json()["access_token"]

    response = _submit(client, token, level.slug, _run())
    assert response.status_code in (401, 403)
    assert response.get_json()["code"] == "verification_required"


def test_unknown_or_unpublished_level_is_404():
    app, client, token, _level = _world()
    assert client.get("/api/levels/nope/ghost").status_code == 404
    assert _submit(client, token, "nope", _run()).status_code == 404

    creator = User.query.filter_by(username="creator").first()
    draft = Level(owner_id=creator.id, title="Draft")
    db.session.add(draft)
    db.session.commit()
    assert client.get(f"/api/levels/{draft.slug}/ghost").status_code == 404


def test_deleted_level_is_404():
    _app, client, token, level = _world()
    level.is_deleted = True
    db.session.commit()
    assert client.get(f"/api/levels/{level.slug}/ghost").status_code == 404
    assert _submit(client, token, level.slug, _run()).status_code == 404


def test_run_for_an_old_version_is_rejected():
    _app, client, token, level = _world()
    body = _run()
    body["version"] = 7

    response = _submit(client, token, level.slug, body)
    assert response.status_code == 409
    assert response.get_json()["code"] == "stale_version"
    assert LevelGhost.query.count() == 0


def test_republishing_starts_a_level_with_no_ghost():
    _app, client, token, level = _world()
    _submit(client, token, level.slug, _run())

    new_version = LevelVersion(
        level_id=level.id,
        version_number=2,
        content=level.latest_published_version.content,
    )
    db.session.add(new_version)
    db.session.flush()
    level.latest_published_version_id = new_version.id
    db.session.commit()

    assert client.get(f"/api/levels/{level.slug}/ghost").get_json() == {"ghost": None}
    # ...and a clear of the new version becomes its ghost, leaving v1's row alone.
    body = _run()
    body["version"] = 2
    assert _submit(client, token, level.slug, body).get_json()["is_record"] is True
    assert LevelGhost.query.count() == 2


def test_deleted_holder_does_not_block_a_new_record():
    app, client, token, level = _world()
    other_token, _ = _player(app, client, "newcomer", "n@example.com")

    _submit(client, token, level.slug, _run(1000))
    runner = User.query.filter_by(username="runner").first()
    runner.is_deleted = True
    db.session.commit()

    assert client.get(f"/api/levels/{level.slug}/ghost").get_json() == {"ghost": None}
    response = _submit(client, other_token, level.slug, _run(4000))
    assert response.get_json()["is_record"] is True
    assert response.get_json()["record"]["username"] == "newcomer"


def test_play_response_carries_the_version_number():
    _app, client, _token, level = _world()
    assert client.get(f"/api/levels/{level.slug}/play").get_json()["version"] == 1


# ── Validation ──────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "mutate, label",
    [
        (lambda b: b.update(duration_ms=50), "too short"),
        (lambda b: b.update(duration_ms=11 * 60 * 1000), "too long"),
        (lambda b: b.update(duration_ms="2000"), "duration not a number"),
        (lambda b: b.update(duration_ms=True), "duration is a bool"),
        (lambda b: b.update(frames="nope"), "frames not a list"),
        (lambda b: b.update(frames=b["frames"][:5]), "frames don't match duration"),
        (lambda b: b["frames"].__setitem__(3, [1, 2]), "frame wrong length"),
        (lambda b: b["frames"].__setitem__(3, [1.5, 2, 0]), "non-integer value"),
        (lambda b: b["frames"].__setitem__(3, [-5, 48, 0]), "x outside world"),
        (lambda b: b["frames"].__setitem__(3, [200, 99999, 0]), "y outside world"),
        (lambda b: b["frames"].__setitem__(3, [78, 48, 40]), "state out of range"),
        (lambda b: b["frames"].__setitem__(3, [5000, 48, 0]), "teleport sideways"),
        (lambda b: b["frames"].__setitem__(3, [78, 600, 0]), "teleport vertically"),
        (lambda b: b.update(frames=[[900 + i, 48, 0] for i in range(41)]), "wrong spawn"),
    ],
)
def test_invalid_runs_are_rejected(mutate, label):
    _app, client, token, level = _world()
    body = _run(2000)
    mutate(body)

    response = _submit(client, token, level.slug, body)
    assert response.status_code == 400, label
    assert response.get_json()["code"] == "invalid_ghost"
    assert LevelGhost.query.count() == 0


def test_a_rejected_run_does_not_disturb_an_existing_ghost():
    app, client, token, level = _world()
    other_token, _ = _player(app, client, "cheater", "x@example.com")

    _submit(client, token, level.slug, _run(2000))
    bad = _run(500)
    bad["frames"][2] = [9000, 48, 0]
    assert _submit(client, other_token, level.slug, bad).status_code == 400

    assert client.get(f"/api/levels/{level.slug}/ghost").get_json()["ghost"]["username"] == "runner"


def test_non_json_body_is_a_400_not_a_crash():
    _app, client, token, level = _world()
    response = client.post(
        f"/api/levels/{level.slug}/ghost", data="not json", headers=_headers(token)
    )
    assert response.status_code == 400