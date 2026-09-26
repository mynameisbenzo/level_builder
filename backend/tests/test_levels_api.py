from app.extensions import db
from app.main import create_app
from app.models.level import Level, LevelVersion


def _client():
    app = create_app("testing")
    with app.app_context():
        db.create_all()
    return app, app.test_client()


def _signup_and_login(app, client, username="creator", email="c@example.com") -> str:
    """Goes through the real signup + login flow to get a genuine access
    token for a fresh user, who'll own whatever level a test creates."""
    app.config["DEBUG"] = True
    client.post("/api/users", json={"username": username, "email": email})
    request_response = client.post("/api/auth/request-login-link", json={"identifier": username})
    login_token = request_response.get_json()["dev_login_token"]
    login_response = client.post("/api/auth/login", json={"token": login_token})
    return login_response.get_json()["access_token"]


def _auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _create_level(client, token, title="My Level") -> dict:
    response = client.post("/api/levels", json={"title": title}, headers=_auth_headers(token))
    return response.get_json()


def _valid_content(**overrides) -> dict:
    content = {
        "spawnPosition": {"x": 64, "y": 64},
        "cameraMode": "follow",
        "playerStartingColor": "green",
        "placedObjects": [],
        "characterSwapObjects": [],
        "doorObjects": [],
        "keyObjects": [],
    }
    content.update(overrides)
    return content


# --- create ---


def test_create_level_succeeds():
    app, client = _client()
    with app.app_context():
        token = _signup_and_login(app, client)
        response = client.post("/api/levels", json={"title": "My Level"}, headers=_auth_headers(token))

        assert response.status_code == 201
        body = response.get_json()
        assert body["title"] == "My Level"
        assert body["visibility_state"] == "draft"
        # Starts in an already-valid, saveable state - not null.
        assert body["draft_content"] is not None
        assert body["draft_beaten_at"] is None


def test_create_level_requires_title():
    app, client = _client()
    with app.app_context():
        token = _signup_and_login(app, client)
        response = client.post("/api/levels", json={}, headers=_auth_headers(token))
        assert response.status_code == 400


def test_create_level_requires_auth():
    app, client = _client()
    with app.app_context():
        response = client.post("/api/levels", json={"title": "My Level"})
        assert response.status_code == 401


# --- get ---


def test_get_level_returns_own_level():
    app, client = _client()
    with app.app_context():
        token = _signup_and_login(app, client)
        level = _create_level(client, token)

        response = client.get(f"/api/levels/{level['id']}", headers=_auth_headers(token))
        assert response.status_code == 200
        assert response.get_json()["title"] == "My Level"


def test_get_nonexistent_level_returns_404():
    app, client = _client()
    with app.app_context():
        token = _signup_and_login(app, client)
        response = client.get("/api/levels/NOPE-NOPE-NOPE-NOPE", headers=_auth_headers(token))
        assert response.status_code == 404


def test_get_someone_elses_level_returns_404_not_403():
    """Enumeration-safe, same principle as everywhere else in this auth
    system - a non-owner can't tell "doesn't exist" from "exists but
    isn't yours"."""
    app, client = _client()
    with app.app_context():
        owner_token = _signup_and_login(app, client, "owner", "owner@example.com")
        level = _create_level(client, owner_token)

        other_token = _signup_and_login(app, client, "other", "other@example.com")
        response = client.get(f"/api/levels/{level['id']}", headers=_auth_headers(other_token))
        assert response.status_code == 404


# --- save ---


def test_save_updates_content():
    app, client = _client()
    with app.app_context():
        token = _signup_and_login(app, client)
        level = _create_level(client, token)

        new_content = _valid_content(spawnPosition={"x": 96, "y": 96})
        response = client.patch(
            f"/api/levels/{level['id']}", json={"content": new_content}, headers=_auth_headers(token)
        )

        assert response.status_code == 200
        assert response.get_json()["draft_content"]["spawnPosition"] == {"x": 96, "y": 96}


def test_save_rejects_invalid_content():
    app, client = _client()
    with app.app_context():
        token = _signup_and_login(app, client)
        level = _create_level(client, token)

        bad_content = _valid_content(cameraMode="orbit")
        response = client.patch(
            f"/api/levels/{level['id']}", json={"content": bad_content}, headers=_auth_headers(token)
        )
        assert response.status_code == 400

        # And the level's actual stored content is untouched by the
        # rejected save.
        db_level = Level.query.filter_by(slug=level["id"]).first()
        assert db_level.draft_content["cameraMode"] == "follow"


def test_save_clears_a_previous_beat_confirmation():
    app, client = _client()
    with app.app_context():
        token = _signup_and_login(app, client)
        level = _create_level(client, token)
        client.post(f"/api/levels/{level['id']}/beat", headers=_auth_headers(token))

        response = client.patch(
            f"/api/levels/{level['id']}", json={"content": _valid_content()}, headers=_auth_headers(token)
        )
        assert response.get_json()["draft_beaten_at"] is None


def test_save_demotes_a_published_level_to_testing():
    app, client = _client()
    with app.app_context():
        token = _signup_and_login(app, client)
        level = _create_level(client, token)
        client.post(f"/api/levels/{level['id']}/beat", headers=_auth_headers(token))
        client.post(f"/api/levels/{level['id']}/publish", headers=_auth_headers(token))

        response = client.patch(
            f"/api/levels/{level['id']}", json={"content": _valid_content()}, headers=_auth_headers(token)
        )
        assert response.get_json()["visibility_state"] == "testing"


def test_save_requires_ownership():
    app, client = _client()
    with app.app_context():
        owner_token = _signup_and_login(app, client, "owner2", "owner2@example.com")
        level = _create_level(client, owner_token)

        other_token = _signup_and_login(app, client, "other2", "other2@example.com")
        response = client.patch(
            f"/api/levels/{level['id']}",
            json={"content": _valid_content()},
            headers=_auth_headers(other_token),
        )
        assert response.status_code == 404


# --- beat ---


def test_beat_sets_draft_beaten_at():
    app, client = _client()
    with app.app_context():
        token = _signup_and_login(app, client)
        level = _create_level(client, token)

        response = client.post(f"/api/levels/{level['id']}/beat", headers=_auth_headers(token))
        assert response.status_code == 200
        assert response.get_json()["draft_beaten_at"] is not None


def test_beat_requires_ownership():
    app, client = _client()
    with app.app_context():
        owner_token = _signup_and_login(app, client, "owner3", "owner3@example.com")
        level = _create_level(client, owner_token)

        other_token = _signup_and_login(app, client, "other3", "other3@example.com")
        response = client.post(f"/api/levels/{level['id']}/beat", headers=_auth_headers(other_token))
        assert response.status_code == 404


# --- publish ---


def test_publish_requires_beaten_first():
    app, client = _client()
    with app.app_context():
        token = _signup_and_login(app, client)
        level = _create_level(client, token)

        response = client.post(f"/api/levels/{level['id']}/publish", headers=_auth_headers(token))
        assert response.status_code == 409


def test_publish_creates_a_level_version_and_publishes():
    app, client = _client()
    with app.app_context():
        token = _signup_and_login(app, client)
        level = _create_level(client, token)
        client.post(f"/api/levels/{level['id']}/beat", headers=_auth_headers(token))

        response = client.post(f"/api/levels/{level['id']}/publish", headers=_auth_headers(token))

        assert response.status_code == 200
        body = response.get_json()
        assert body["visibility_state"] == "published"

        db_level = Level.query.filter_by(slug=level["id"]).first()
        assert db_level.latest_published_version_id is not None

        version = db.session.get(LevelVersion, db_level.latest_published_version_id)
        assert version.version_number == 1
        assert version.beaten_at is not None
        assert version.content == db_level.draft_content


def test_publish_increments_version_number_on_a_later_republish():
    app, client = _client()
    with app.app_context():
        token = _signup_and_login(app, client)
        level = _create_level(client, token)

        client.patch(
            f"/api/levels/{level['id']}",
            json={"content": _valid_content(spawnPosition={"x": 64, "y": 64})},
            headers=_auth_headers(token),
        )
        client.post(f"/api/levels/{level['id']}/beat", headers=_auth_headers(token))
        client.post(f"/api/levels/{level['id']}/publish", headers=_auth_headers(token))

        # Edit, re-beat, publish again.
        client.patch(
            f"/api/levels/{level['id']}",
            json={"content": _valid_content(spawnPosition={"x": 128, "y": 128})},
            headers=_auth_headers(token),
        )
        client.post(f"/api/levels/{level['id']}/beat", headers=_auth_headers(token))
        second_publish = client.post(f"/api/levels/{level['id']}/publish", headers=_auth_headers(token))

        assert second_publish.status_code == 200

        db_level = Level.query.filter_by(slug=level["id"]).first()
        latest_version = db.session.get(LevelVersion, db_level.latest_published_version_id)
        assert latest_version.version_number == 2
        assert latest_version.content["spawnPosition"] == {"x": 128, "y": 128}

        # And the first version is still there, untouched - immutable,
        # not overwritten by the second publish.
        first_version = LevelVersion.query.filter_by(level_id=db_level.id, version_number=1).first()
        assert first_version is not None
        assert first_version.content["spawnPosition"] == {"x": 64, "y": 64}


def test_publish_requires_ownership():
    app, client = _client()
    with app.app_context():
        owner_token = _signup_and_login(app, client, "owner4", "owner4@example.com")
        level = _create_level(client, owner_token)
        client.post(f"/api/levels/{level['id']}/beat", headers=_auth_headers(owner_token))

        other_token = _signup_and_login(app, client, "other4", "other4@example.com")
        response = client.post(f"/api/levels/{level['id']}/publish", headers=_auth_headers(other_token))
        assert response.status_code == 404

        # And it genuinely never got published by the attempt.
        db_level = Level.query.filter_by(slug=level["id"]).first()
        assert db_level.visibility_state.value == "draft"


def test_publish_rejects_content_that_became_invalid_since_it_was_saved():
    """
    Defense in depth: re-validates at publish time rather than trusting
    that content already passed validation once. Simulated here by
    writing directly to the row, bypassing the save endpoint entirely -
    the one realistic way this could actually happen (a bug, or a
    future direct DB access path, not the normal save flow itself).
    """
    app, client = _client()
    with app.app_context():
        token = _signup_and_login(app, client)
        level = _create_level(client, token)
        client.post(f"/api/levels/{level['id']}/beat", headers=_auth_headers(token))

        db_level = Level.query.filter_by(slug=level["id"]).first()
        db_level.draft_content = {**db_level.draft_content, "cameraMode": "orbit"}
        db.session.commit()

        response = client.post(f"/api/levels/{level['id']}/publish", headers=_auth_headers(token))
        assert response.status_code == 409


# --- public play endpoint ---


def test_play_endpoint_serves_the_published_content_with_no_auth():
    app, client = _client()
    with app.app_context():
        token = _signup_and_login(app, client)
        level = _create_level(client, token)
        client.patch(
            f"/api/levels/{level['id']}",
            json={"content": _valid_content(spawnPosition={"x": 96, "y": 96})},
            headers=_auth_headers(token),
        )
        client.post(f"/api/levels/{level['id']}/beat", headers=_auth_headers(token))
        client.post(f"/api/levels/{level['id']}/publish", headers=_auth_headers(token))

        # Deliberately no Authorization header at all.
        response = client.get(f"/api/levels/{level['id']}/play")

        assert response.status_code == 200
        body = response.get_json()
        assert body["title"] == "My Level"
        assert body["content"]["spawnPosition"] == {"x": 96, "y": 96}


def test_play_endpoint_returns_404_for_a_never_published_level():
    app, client = _client()
    with app.app_context():
        token = _signup_and_login(app, client)
        level = _create_level(client, token)

        response = client.get(f"/api/levels/{level['id']}/play")
        assert response.status_code == 404


def test_play_endpoint_returns_404_for_an_unknown_slug():
    app, client = _client()
    with app.app_context():
        response = client.get("/api/levels/NOPE-NOPE-NOPE-NOPE/play")
        assert response.status_code == 404


def test_play_endpoint_still_serves_the_last_published_version_after_a_demoting_edit():
    """
    A level demoted back to 'testing' by a post-publish edit (see
    save_level) should still serve its last published version publicly
    - the whole point of that demotion is that the old version keeps
    working for everyone else while a replacement is worked on.
    """
    app, client = _client()
    with app.app_context():
        token = _signup_and_login(app, client)
        level = _create_level(client, token)
        client.post(f"/api/levels/{level['id']}/beat", headers=_auth_headers(token))
        client.post(f"/api/levels/{level['id']}/publish", headers=_auth_headers(token))

        # An edit after publishing - demotes visibility_state, but
        # shouldn't affect what /play serves.
        client.patch(
            f"/api/levels/{level['id']}",
            json={"content": _valid_content(spawnPosition={"x": 200, "y": 200})},
            headers=_auth_headers(token),
        )

        response = client.get(f"/api/levels/{level['id']}/play")
        assert response.status_code == 200
        # Still the originally-published content, not the in-progress edit.
        assert response.get_json()["content"]["spawnPosition"] != {"x": 200, "y": 200}