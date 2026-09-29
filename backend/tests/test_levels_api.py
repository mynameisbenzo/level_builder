from app.api.levels import MAX_DRAFT_LEVELS, MAX_PUBLISHED_TOTAL, MAX_TITLE_LENGTH
from app.extensions import db
from app.main import create_app
from app.models.level import Level, LevelVersion
from app.utils.time import utc_now


def _client():
    app = create_app("testing")
    with app.app_context():
        db.create_all()
    return app, app.test_client()


def _signup_and_login(app, client, username="creator", email="c@example.com") -> str:
    """
    Goes through the real signup + login flow to get a genuine access
    token for a fresh user, who'll own whatever level a test creates.

    Also verifies the user's email before logging in - level actions
    require a verified email or linked Twitch (see
    _verification_gate in app/api/levels.py), and this file's tests are
    about level behavior, not verification, so they need a user who can
    actually get past that gate by default. test_verification_gate.py
    covers the gate itself with a deliberately-unverified user.
    """
    app.config["DEBUG"] = True
    create_response = client.post("/api/users", json={"username": username, "email": email})
    verification_token = create_response.get_json()["dev_verification_token"]
    client.post("/api/users/verify-email", json={"token": verification_token})
    request_response = client.post("/api/auth/request-login-link", json={"identifier": username})
    login_token = request_response.get_json()["dev_login_token"]
    login_response = client.post("/api/auth/login", json={"token": login_token})
    return login_response.get_json()["access_token"]


def _auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _create_level(client, token, title="My Level") -> dict:
    response = client.post("/api/levels", json={"title": title}, headers=_auth_headers(token))
    return response.get_json()


def _publish(client, token, slug, title=None):
    """
    A level's FIRST publish - which now requires a name (see
    publish_level). Defaults to reusing whatever title the level was
    created with, so the many tests that assert on a level's title after
    publishing keep meaning what they always did.
    """
    if title is None:
        title = client.get(f"/api/levels/{slug}", headers=_auth_headers(token)).get_json()["title"]
    return client.post(f"/api/levels/{slug}/publish", json={"title": title}, headers=_auth_headers(token))


def _valid_content(**overrides) -> dict:
    content = {
        "spawnPosition": {"x": 48, "y": 48},
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

        new_content = _valid_content(spawnPosition={"x": 112, "y": 112})
        response = client.patch(
            f"/api/levels/{level['id']}", json={"content": new_content}, headers=_auth_headers(token)
        )

        assert response.status_code == 200
        assert response.get_json()["draft_content"]["spawnPosition"] == {"x": 112, "y": 112}


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
        _publish(client, token, level['id'])

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

        response = _publish(client, token, level['id'])
        assert response.status_code == 409


def test_publish_creates_a_level_version_and_publishes():
    app, client = _client()
    with app.app_context():
        token = _signup_and_login(app, client)
        level = _create_level(client, token)
        client.post(f"/api/levels/{level['id']}/beat", headers=_auth_headers(token))

        response = _publish(client, token, level['id'])

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
            json={"content": _valid_content(spawnPosition={"x": 48, "y": 48})},
            headers=_auth_headers(token),
        )
        client.post(f"/api/levels/{level['id']}/beat", headers=_auth_headers(token))
        _publish(client, token, level['id'])

        # Edit, re-beat, publish again.
        client.patch(
            f"/api/levels/{level['id']}",
            json={"content": _valid_content(spawnPosition={"x": 144, "y": 144})},
            headers=_auth_headers(token),
        )
        client.post(f"/api/levels/{level['id']}/beat", headers=_auth_headers(token))
        second_publish = client.post(f"/api/levels/{level['id']}/publish", headers=_auth_headers(token))

        assert second_publish.status_code == 200

        db_level = Level.query.filter_by(slug=level["id"]).first()
        latest_version = db.session.get(LevelVersion, db_level.latest_published_version_id)
        assert latest_version.version_number == 2
        assert latest_version.content["spawnPosition"] == {"x": 144, "y": 144}

        # And the first version is still there, untouched - immutable,
        # not overwritten by the second publish.
        first_version = LevelVersion.query.filter_by(level_id=db_level.id, version_number=1).first()
        assert first_version is not None
        assert first_version.content["spawnPosition"] == {"x": 48, "y": 48}


def test_publish_requires_ownership():
    app, client = _client()
    with app.app_context():
        owner_token = _signup_and_login(app, client, "owner4", "owner4@example.com")
        level = _create_level(client, owner_token)
        client.post(f"/api/levels/{level['id']}/beat", headers=_auth_headers(owner_token))

        other_token = _signup_and_login(app, client, "other4", "other4@example.com")
        response = _publish(client, other_token, level['id'], title="Hijack attempt")
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

        response = _publish(client, token, level['id'])
        assert response.status_code == 409


# --- public play endpoint ---


def test_play_endpoint_serves_the_published_content_with_no_auth():
    app, client = _client()
    with app.app_context():
        token = _signup_and_login(app, client)
        level = _create_level(client, token)
        client.patch(
            f"/api/levels/{level['id']}",
            json={"content": _valid_content(spawnPosition={"x": 112, "y": 112})},
            headers=_auth_headers(token),
        )
        client.post(f"/api/levels/{level['id']}/beat", headers=_auth_headers(token))
        _publish(client, token, level['id'])

        # Deliberately no Authorization header at all.
        response = client.get(f"/api/levels/{level['id']}/play")

        assert response.status_code == 200
        body = response.get_json()
        assert body["title"] == "My Level"
        assert body["content"]["spawnPosition"] == {"x": 112, "y": 112}


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
        _publish(client, token, level['id'])

        # An edit after publishing - demotes visibility_state, but
        # shouldn't affect what /play serves.
        client.patch(
            f"/api/levels/{level['id']}",
            json={"content": _valid_content(spawnPosition={"x": 208, "y": 208})},
            headers=_auth_headers(token),
        )

        response = client.get(f"/api/levels/{level['id']}/play")
        assert response.status_code == 200
        # Still the originally-published content, not the in-progress edit.
        assert response.get_json()["content"]["spawnPosition"] != {"x": 208, "y": 208}
        

# --- list my levels (owner-only) ---


def test_list_my_levels_returns_all_own_levels_including_drafts():
    app, client = _client()
    with app.app_context():
        token = _signup_and_login(app, client)
        _create_level(client, token, title="Still a draft")
        published_level = _create_level(client, token, title="Published one")
        client.post(f"/api/levels/{published_level['id']}/beat", headers=_auth_headers(token))
        _publish(client, token, published_level['id'])

        response = client.get("/api/levels", headers=_auth_headers(token))
        assert response.status_code == 200
        titles = {item["title"] for item in response.get_json()}
        assert titles == {"Still a draft", "Published one"}


def test_list_my_levels_is_ordered_newest_first():
    app, client = _client()
    with app.app_context():
        token = _signup_and_login(app, client)
        _create_level(client, token, title="First")
        _create_level(client, token, title="Second")
        _create_level(client, token, title="Third")

        response = client.get("/api/levels", headers=_auth_headers(token))
        titles = [item["title"] for item in response.get_json()]
        assert titles == ["Third", "Second", "First"]


def test_list_my_levels_excludes_another_users_levels():
    app, client = _client()
    with app.app_context():
        owner_token = _signup_and_login(app, client, "listowner", "listowner@example.com")
        _create_level(client, owner_token, title="Owner's level")

        other_token = _signup_and_login(app, client, "listother", "listother@example.com")
        _create_level(client, other_token, title="Other's level")

        response = client.get("/api/levels", headers=_auth_headers(owner_token))
        titles = [item["title"] for item in response.get_json()]
        assert titles == ["Owner's level"]


def test_list_my_levels_requires_auth():
    app, client = _client()
    with app.app_context():
        response = client.get("/api/levels")
        assert response.status_code == 401


def test_list_my_levels_omits_draft_content():
    """The list view is deliberately lean - a list of many levels
    shouldn't carry each one's full content blob."""
    app, client = _client()
    with app.app_context():
        token = _signup_and_login(app, client)
        _create_level(client, token)

        response = client.get("/api/levels", headers=_auth_headers(token))
        assert "draft_content" not in response.get_json()[0]


def test_list_my_levels_with_none_yet_returns_empty_list():
    app, client = _client()
    with app.app_context():
        token = _signup_and_login(app, client)
        response = client.get("/api/levels", headers=_auth_headers(token))
        assert response.status_code == 200
        assert response.get_json() == []


# --- list levels by username (public) ---


def test_list_levels_by_user_only_shows_published_levels():
    app, client = _client()
    with app.app_context():
        token = _signup_and_login(app, client, "publiclister", "publiclister@example.com")
        _create_level(client, token, title="Draft one")
        published = _create_level(client, token, title="Published one")
        client.post(f"/api/levels/{published['id']}/beat", headers=_auth_headers(token))
        _publish(client, token, published['id'])

        # Deliberately no Authorization header - this is public.
        response = client.get("/api/levels/by-user/publiclister")
        assert response.status_code == 200
        titles = [item["title"] for item in response.get_json()]
        assert titles == ["Published one"]


def test_list_levels_by_user_returns_empty_list_for_unknown_username():
    """An unknown username and a real user with zero published levels
    look identical here - both a 200 with an empty list, never a 404,
    since nothing here needs to tell those two cases apart."""
    app, client = _client()
    with app.app_context():
        response = client.get("/api/levels/by-user/nobody-with-this-name")
        assert response.status_code == 200
        assert response.get_json() == []


def test_list_levels_by_user_still_shows_a_level_demoted_to_testing_after_publishing():
    """Same reasoning as /play - a level demoted back to testing by a
    post-publish edit should still appear here, since its last
    published version is still live for everyone."""
    app, client = _client()
    with app.app_context():
        token = _signup_and_login(app, client, "demotelister", "demotelister@example.com")
        level = _create_level(client, token, title="Demoted but still live")
        client.post(f"/api/levels/{level['id']}/beat", headers=_auth_headers(token))
        _publish(client, token, level['id'])

        client.patch(
            f"/api/levels/{level['id']}",
            json={"content": _valid_content()},
            headers=_auth_headers(token),
        )

        response = client.get("/api/levels/by-user/demotelister")
        titles = [item["title"] for item in response.get_json()]
        assert titles == ["Demoted but still live"]


def test_list_levels_by_user_excludes_another_users_levels():
    app, client = _client()
    with app.app_context():
        token_a = _signup_and_login(app, client, "publica", "publica@example.com")
        level_a = _create_level(client, token_a, title="A's level")
        client.post(f"/api/levels/{level_a['id']}/beat", headers=_auth_headers(token_a))
        _publish(client, token_a, level_a['id'])

        token_b = _signup_and_login(app, client, "publicb", "publicb@example.com")
        level_b = _create_level(client, token_b, title="B's level")
        client.post(f"/api/levels/{level_b['id']}/beat", headers=_auth_headers(token_b))
        _publish(client, token_b, level_b['id'])

        response = client.get("/api/levels/by-user/publica")
        titles = [item["title"] for item in response.get_json()]
        assert titles == ["A's level"]


def test_list_levels_by_user_omits_draft_content():
    app, client = _client()
    with app.app_context():
        token = _signup_and_login(app, client, "leanpublic", "leanpublic@example.com")
        level = _create_level(client, token)
        client.post(f"/api/levels/{level['id']}/beat", headers=_auth_headers(token))
        _publish(client, token, level['id'])

        response = client.get("/api/levels/by-user/leanpublic")
        assert "draft_content" not in response.get_json()[0]
        


# --- naming: set once at first publish, then locked ---


def test_first_publish_sets_the_levels_name():
    app, client = _client()
    with app.app_context():
        token = _signup_and_login(app, client)
        level = _create_level(client, token, title="Untitled Level")
        client.post(f"/api/levels/{level['id']}/beat", headers=_auth_headers(token))

        response = _publish(client, token, level["id"], title="  Sky Castle  ")

        assert response.status_code == 200
        body = response.get_json()
        assert body["title"] == "Sky Castle"  # trimmed
        assert body["visibility_state"] == "published"
        assert body["has_been_published"] is True

        # And what the public sees carries the name too.
        play = client.get(f"/api/levels/{level['id']}/play")
        assert play.get_json()["title"] == "Sky Castle"


def test_first_publish_requires_a_name():
    """No unnamed published levels - and since names are locked once
    published, an unnamed one would stay that way for good."""
    app, client = _client()
    with app.app_context():
        token = _signup_and_login(app, client)
        level = _create_level(client, token)
        client.post(f"/api/levels/{level['id']}/beat", headers=_auth_headers(token))

        response = client.post(f"/api/levels/{level['id']}/publish", headers=_auth_headers(token))
        assert response.status_code == 400

        db_level = Level.query.filter_by(slug=level["id"]).first()
        assert db_level.visibility_state.value == "draft"
        assert db_level.latest_published_version_id is None


def test_first_publish_with_an_empty_title_is_rejected_and_publishes_nothing():
    app, client = _client()
    with app.app_context():
        token = _signup_and_login(app, client)
        level = _create_level(client, token)
        client.post(f"/api/levels/{level['id']}/beat", headers=_auth_headers(token))

        response = _publish(client, token, level["id"], title="   ")
        assert response.status_code == 400

        db_level = Level.query.filter_by(slug=level["id"]).first()
        assert db_level.visibility_state.value == "draft"
        assert db_level.latest_published_version_id is None


def test_publish_title_length_limit_is_enforced_at_exactly_the_boundary():
    app, client = _client()
    with app.app_context():
        token = _signup_and_login(app, client)
        level = _create_level(client, token)
        client.post(f"/api/levels/{level['id']}/beat", headers=_auth_headers(token))

        too_long = _publish(client, token, level["id"], title="x" * (MAX_TITLE_LENGTH + 1))
        assert too_long.status_code == 400

        at_the_limit = _publish(client, token, level["id"], title="x" * MAX_TITLE_LENGTH)
        assert at_the_limit.status_code == 200


def test_a_failed_first_publish_does_not_set_the_name():
    """The title is applied in the same transaction as the publish and
    only after every other check passes - a publish that's rejected
    (here: never beaten) must never quietly set the name as a side
    effect."""
    app, client = _client()
    with app.app_context():
        token = _signup_and_login(app, client)
        level = _create_level(client, token, title="Original name")

        response = _publish(client, token, level["id"], title="Sneaky rename")
        assert response.status_code == 409

        db_level = Level.query.filter_by(slug=level["id"]).first()
        assert db_level.title == "Original name"


def test_a_published_levels_name_cannot_be_changed():
    app, client = _client()
    with app.app_context():
        token = _signup_and_login(app, client)
        level = _create_level(client, token)
        client.post(f"/api/levels/{level['id']}/beat", headers=_auth_headers(token))
        _publish(client, token, level["id"], title="Sky Castle")

        # Edit, re-beat, then try to publish again under a different name.
        client.patch(
            f"/api/levels/{level['id']}",
            json={"content": _valid_content(spawnPosition={"x": 144, "y": 144})},
            headers=_auth_headers(token),
        )
        client.post(f"/api/levels/{level['id']}/beat", headers=_auth_headers(token))
        response = _publish(client, token, level["id"], title="A Different Name")
        assert response.status_code == 409

        db_level = Level.query.filter_by(slug=level["id"]).first()
        assert db_level.title == "Sky Castle"
        # And the rejected attempt published nothing new.
        assert LevelVersion.query.filter_by(level_id=db_level.id).count() == 1


def test_republishing_without_a_title_keeps_the_name():
    app, client = _client()
    with app.app_context():
        token = _signup_and_login(app, client)
        level = _create_level(client, token)
        client.post(f"/api/levels/{level['id']}/beat", headers=_auth_headers(token))
        _publish(client, token, level["id"], title="Sky Castle")

        client.patch(
            f"/api/levels/{level['id']}",
            json={"content": _valid_content(spawnPosition={"x": 144, "y": 144})},
            headers=_auth_headers(token),
        )
        client.post(f"/api/levels/{level['id']}/beat", headers=_auth_headers(token))
        response = client.post(f"/api/levels/{level['id']}/publish", headers=_auth_headers(token))

        assert response.status_code == 200
        assert response.get_json()["title"] == "Sky Castle"

        db_level = Level.query.filter_by(slug=level["id"]).first()
        assert LevelVersion.query.filter_by(level_id=db_level.id).count() == 2


def test_save_rejects_a_title_and_nothing_in_that_request_takes_effect():
    """Saving isn't a way to rename anything, not even a draft that's
    never been published - and a request that tries is rejected whole,
    not half-applied."""
    app, client = _client()
    with app.app_context():
        token = _signup_and_login(app, client)
        level = _create_level(client, token, title="Working title")

        response = client.patch(
            f"/api/levels/{level['id']}",
            json={"title": "Sneaky", "content": _valid_content(spawnPosition={"x": 144, "y": 144})},
            headers=_auth_headers(token),
        )
        assert response.status_code == 400

        db_level = Level.query.filter_by(slug=level["id"]).first()
        assert db_level.title == "Working title"
        assert db_level.draft_content["spawnPosition"] != {"x": 144, "y": 144}


def test_create_level_with_a_too_long_title_is_rejected():
    app, client = _client()
    with app.app_context():
        token = _signup_and_login(app, client)
        response = client.post(
            "/api/levels", json={"title": "x" * (MAX_TITLE_LENGTH + 1)}, headers=_auth_headers(token)
        )
        assert response.status_code == 400


def test_level_reports_whether_it_has_been_published():
    """What tells the editor whether a level still needs its one-time
    name - and it stays true for a level demoted back to testing by a
    post-publish edit, since its name is locked either way."""
    app, client = _client()
    with app.app_context():
        token = _signup_and_login(app, client)
        level = _create_level(client, token)

        before = client.get(f"/api/levels/{level['id']}", headers=_auth_headers(token)).get_json()
        assert before["has_been_published"] is False

        client.post(f"/api/levels/{level['id']}/beat", headers=_auth_headers(token))
        _publish(client, token, level["id"], title="Sky Castle")
        after = client.get(f"/api/levels/{level['id']}", headers=_auth_headers(token)).get_json()
        assert after["has_been_published"] is True

        client.patch(
            f"/api/levels/{level['id']}",
            json={"content": _valid_content()},
            headers=_auth_headers(token),
        )
        demoted = client.get(f"/api/levels/{level['id']}", headers=_auth_headers(token)).get_json()
        assert demoted["visibility_state"] == "testing"
        assert demoted["has_been_published"] is True

        # The list view carries it too.
        listed = client.get("/api/levels", headers=_auth_headers(token)).get_json()
        assert listed[0]["has_been_published"] is True
        


# --- saving identical content is a no-op ---


def test_save_with_identical_content_keeps_the_beat_confirmation():
    """The real point of this: identical-content saves must not clear a
    beat, which is what makes "publish always saves first" safe."""
    app, client = _client()
    with app.app_context():
        token = _signup_and_login(app, client)
        level = _create_level(client, token)
        client.post(f"/api/levels/{level['id']}/beat", headers=_auth_headers(token))

        current = client.get(f"/api/levels/{level['id']}", headers=_auth_headers(token)).get_json()
        response = client.patch(
            f"/api/levels/{level['id']}",
            json={"content": current["draft_content"]},
            headers=_auth_headers(token),
        )

        assert response.status_code == 200
        assert response.get_json()["draft_beaten_at"] is not None


def test_save_with_identical_content_does_not_demote_a_published_level():
    app, client = _client()
    with app.app_context():
        token = _signup_and_login(app, client)
        level = _create_level(client, token)
        client.post(f"/api/levels/{level['id']}/beat", headers=_auth_headers(token))
        _publish(client, token, level["id"], title="Sky Castle")

        current = client.get(f"/api/levels/{level['id']}", headers=_auth_headers(token)).get_json()
        response = client.patch(
            f"/api/levels/{level['id']}",
            json={"content": current["draft_content"]},
            headers=_auth_headers(token),
        )

        assert response.status_code == 200
        assert response.get_json()["visibility_state"] == "published"


def test_save_with_genuinely_different_content_still_clears_the_beat():
    """The exception above is narrow - real edits still behave exactly
    as before."""
    app, client = _client()
    with app.app_context():
        token = _signup_and_login(app, client)
        level = _create_level(client, token)
        client.post(f"/api/levels/{level['id']}/beat", headers=_auth_headers(token))

        response = client.patch(
            f"/api/levels/{level['id']}",
            json={"content": _valid_content(spawnPosition={"x": 208, "y": 208})},
            headers=_auth_headers(token),
        )

        assert response.status_code == 200
        assert response.get_json()["draft_beaten_at"] is None
        


# --- draft cap ---


def test_create_level_is_refused_at_the_draft_cap():
    app, client = _client()
    with app.app_context():
        token = _signup_and_login(app, client)
        for i in range(MAX_DRAFT_LEVELS):
            response = client.post("/api/levels", json={"title": f"Draft {i}"}, headers=_auth_headers(token))
            assert response.status_code == 201

        over_cap = client.post("/api/levels", json={"title": "One too many"}, headers=_auth_headers(token))
        assert over_cap.status_code == 409


def test_publishing_a_draft_frees_a_slot_for_a_new_one():
    app, client = _client()
    with app.app_context():
        token = _signup_and_login(app, client)
        levels = []
        for i in range(MAX_DRAFT_LEVELS):
            created = client.post(
                "/api/levels", json={"title": f"Draft {i}"}, headers=_auth_headers(token)
            ).get_json()
            levels.append(created)

        over_cap = client.post("/api/levels", json={"title": "Blocked"}, headers=_auth_headers(token))
        assert over_cap.status_code == 409

        client.post(f"/api/levels/{levels[0]['id']}/beat", headers=_auth_headers(token))
        publish_response = _publish(client, token, levels[0]["id"], title="Now published")
        assert publish_response.status_code == 200

        now_allowed = client.post(
            "/api/levels", json={"title": "Room again"}, headers=_auth_headers(token)
        )
        assert now_allowed.status_code == 201


# --- publishing identical content is always rejected ---


def test_republishing_identical_content_is_rejected_as_a_no_op():
    app, client = _client()
    with app.app_context():
        token = _signup_and_login(app, client)
        level = _create_level(client, token)
        client.post(f"/api/levels/{level['id']}/beat", headers=_auth_headers(token))
        _publish(client, token, level["id"], title="Sky Castle")

        # No edit in between - beat again, same content, try to publish.
        client.post(f"/api/levels/{level['id']}/beat", headers=_auth_headers(token))
        response = client.post(f"/api/levels/{level['id']}/publish", headers=_auth_headers(token))

        assert response.status_code == 409
        db_level = Level.query.filter_by(slug=level["id"]).first()
        assert LevelVersion.query.filter_by(level_id=db_level.id).count() == 1


def test_republishing_genuinely_different_content_is_still_allowed():
    app, client = _client()
    with app.app_context():
        token = _signup_and_login(app, client)
        level = _create_level(client, token)
        client.post(f"/api/levels/{level['id']}/beat", headers=_auth_headers(token))
        _publish(client, token, level["id"], title="Sky Castle")

        client.patch(
            f"/api/levels/{level['id']}",
            json={"content": _valid_content(spawnPosition={"x": 208, "y": 208})},
            headers=_auth_headers(token),
        )
        client.post(f"/api/levels/{level['id']}/beat", headers=_auth_headers(token))
        response = client.post(f"/api/levels/{level['id']}/publish", headers=_auth_headers(token))

        assert response.status_code == 200
        db_level = Level.query.filter_by(slug=level["id"]).first()
        assert LevelVersion.query.filter_by(level_id=db_level.id).count() == 2


# --- published-total cap (levels + all their versions) ---


def _pad_version_count_to(app, level_slug, target_count):
    """Directly inserts LevelVersion rows (bypassing the API) so a cap
    boundary test doesn't need hundreds of slow, real HTTP publishes
    just to set up its starting state."""
    with app.app_context():
        level = Level.query.filter_by(slug=level_slug).first()
        existing = LevelVersion.query.filter_by(level_id=level.id).count()
        for i in range(existing, target_count):
            db.session.add(
                LevelVersion(
                    level_id=level.id,
                    version_number=i + 1,
                    content=_valid_content(spawnPosition={"x": 48 + (i % 400) * 32, "y": 48}),
                    beaten_at=utc_now(),
                )
            )
        db.session.commit()


def test_publish_is_refused_when_it_would_exceed_the_published_total_cap():
    app, client = _client()
    with app.app_context():
        token = _signup_and_login(app, client)

        padding_level = _create_level(client, token, title="Padding")
        client.post(f"/api/levels/{padding_level['id']}/beat", headers=_auth_headers(token))
        _publish(client, token, padding_level["id"], title="Padding")
        # 1 (padding level itself) + V versions + 1 (new level, first
        # publish) + 1 (its new version) must come out to 101.
        _pad_version_count_to(app, padding_level["id"], MAX_PUBLISHED_TOTAL - 2)

        new_level = _create_level(client, token, title="One too many")
        client.post(f"/api/levels/{new_level['id']}/beat", headers=_auth_headers(token))
        response = _publish(client, token, new_level["id"], title="One too many")

        assert response.status_code == 409
        db_level = Level.query.filter_by(slug=new_level["id"]).first()
        assert db_level.latest_published_version_id is None


def test_publish_succeeds_at_exactly_the_published_total_cap_boundary():
    app, client = _client()
    with app.app_context():
        token = _signup_and_login(app, client)

        padding_level = _create_level(client, token, title="Padding")
        client.post(f"/api/levels/{padding_level['id']}/beat", headers=_auth_headers(token))
        _publish(client, token, padding_level["id"], title="Padding")
        # Same arithmetic as above, one less - lands exactly at 100.
        _pad_version_count_to(app, padding_level["id"], MAX_PUBLISHED_TOTAL - 3)

        new_level = _create_level(client, token, title="Exactly at the limit")
        client.post(f"/api/levels/{new_level['id']}/beat", headers=_auth_headers(token))
        response = _publish(client, token, new_level["id"], title="Exactly at the limit")

        assert response.status_code == 200


def test_published_total_cap_does_not_count_another_users_levels():
    app, client = _client()
    with app.app_context():
        token_a = _signup_and_login(app, client, "capuser_a", "capuser_a@example.com")
        padding_level = _create_level(client, token_a, title="A's padding")
        client.post(f"/api/levels/{padding_level['id']}/beat", headers=_auth_headers(token_a))
        _publish(client, token_a, padding_level["id"], title="A's padding")
        _pad_version_count_to(app, padding_level["id"], MAX_PUBLISHED_TOTAL)

        token_b = _signup_and_login(app, client, "capuser_b", "capuser_b@example.com")
        level_b = _create_level(client, token_b, title="B's first level")
        client.post(f"/api/levels/{level_b['id']}/beat", headers=_auth_headers(token_b))
        response = _publish(client, token_b, level_b["id"], title="B's first level")

        assert response.status_code == 200