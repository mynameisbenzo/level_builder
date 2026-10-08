from app.api.levels import MAX_DRAFT_LEVELS, MAX_PUBLISHED_TOTAL, MAX_TITLE_LENGTH
from app.extensions import db
from app.main import create_app
from app.models.level import Level, LevelVisibilityState
from app.models.level_rating import LevelRating
from app.models.user import User
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


def test_save_rejects_a_published_level():
    """Publishing is final - a published level can't be edited at all."""
    app, client = _client()
    with app.app_context():
        token = _signup_and_login(app, client)
        level = _create_level(client, token)
        client.post(f"/api/levels/{level['id']}/beat", headers=_auth_headers(token))
        _publish(client, token, level['id'])

        response = client.patch(
            f"/api/levels/{level['id']}",
            json={"content": _valid_content(spawnPosition={"x": 208, "y": 208})},
            headers=_auth_headers(token),
        )
        assert response.status_code == 409

        db_level = Level.query.filter_by(slug=level["id"]).first()
        assert db_level.visibility_state.value == "published"
        assert db_level.draft_content["spawnPosition"] != {"x": 208, "y": 208}


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


def test_publish_publishes_the_level():
    app, client = _client()
    with app.app_context():
        token = _signup_and_login(app, client)
        level = _create_level(client, token)
        client.post(f"/api/levels/{level['id']}/beat", headers=_auth_headers(token))
        content_before = Level.query.filter_by(slug=level["id"]).first().draft_content

        response = _publish(client, token, level['id'])

        assert response.status_code == 200
        body = response.get_json()
        assert body["visibility_state"] == "published"
        assert body["has_been_published"] is True

        db_level = Level.query.filter_by(slug=level["id"]).first()
        assert db_level.published_at is not None
        assert db_level.draft_beaten_at is not None
        assert db_level.draft_content == content_before


def test_a_published_level_cannot_be_published_again():
    app, client = _client()
    with app.app_context():
        token = _signup_and_login(app, client)
        level = _create_level(client, token)
        client.post(f"/api/levels/{level['id']}/beat", headers=_auth_headers(token))
        _publish(client, token, level['id'])
        first_published_at = Level.query.filter_by(slug=level["id"]).first().published_at

        second = _publish(client, token, level['id'])

        assert second.status_code == 409
        assert Level.query.filter_by(slug=level["id"]).first().published_at == first_published_at


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
        assert body["owner_username"] == "creator"


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


def test_play_endpoint_content_is_frozen_after_an_attempted_edit():
    """
    A published level can't be edited, so an attempt to change it must
    leave what /play serves exactly as published.
    """
    app, client = _client()
    with app.app_context():
        token = _signup_and_login(app, client)
        level = _create_level(client, token)
        client.post(f"/api/levels/{level['id']}/beat", headers=_auth_headers(token))
        _publish(client, token, level['id'])
        before = client.get(f"/api/levels/{level['id']}/play").get_json()["content"]

        edit = client.patch(
            f"/api/levels/{level['id']}",
            json={"content": _valid_content(spawnPosition={"x": 208, "y": 208})},
            headers=_auth_headers(token),
        )
        assert edit.status_code == 409

        response = client.get(f"/api/levels/{level['id']}/play")
        assert response.status_code == 200
        assert response.get_json()["content"] == before


def test_record_play_counts_an_anonymous_request():
    app, client = _client()
    with app.app_context():
        token = _signup_and_login(app, client)
        level = _create_level(client, token)
        client.post(f"/api/levels/{level['id']}/beat", headers=_auth_headers(token))
        _publish(client, token, level['id'])

        # Deliberately no Authorization header - most plays are anonymous.
        response = client.post(f"/api/levels/{level['id']}/play")

        assert response.status_code == 200
        assert response.get_json()["play_count"] == 1


def test_record_play_counts_a_logged_in_non_owner():
    app, client = _client()
    with app.app_context():
        owner_token = _signup_and_login(app, client, username="creator", email="c@example.com")
        level = _create_level(client, owner_token)
        client.post(f"/api/levels/{level['id']}/beat", headers=_auth_headers(owner_token))
        _publish(client, owner_token, level['id'])

        other_token = _signup_and_login(app, client, username="visitor", email="v@example.com")
        response = client.post(f"/api/levels/{level['id']}/play", headers=_auth_headers(other_token))

        assert response.status_code == 200
        assert response.get_json()["play_count"] == 1


def test_record_completion_counts_a_logged_in_non_owner():
    app, client = _client()
    with app.app_context():
        owner_token = _signup_and_login(app, client, username="creator", email="c@example.com")
        level = _create_level(client, owner_token)
        client.post(f"/api/levels/{level['id']}/beat", headers=_auth_headers(owner_token))
        _publish(client, owner_token, level['id'])

        other_token = _signup_and_login(app, client, username="visitor", email="v@example.com")
        response = client.post(
            f"/api/levels/{level['id']}/complete", headers=_auth_headers(other_token)
        )

        assert response.status_code == 200
        assert response.get_json()["completion_count"] == 1


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
        assert db_level.published_at is None


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
        assert db_level.published_at is None


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

        # Neither publishing again under a new name nor a save with one
        # can rename it.
        response = _publish(client, token, level["id"], title="A Different Name")
        assert response.status_code == 409
        rename = client.patch(
            f"/api/levels/{level['id']}", json={"title": "Sneaky"}, headers=_auth_headers(token)
        )
        assert rename.status_code == 400

        db_level = Level.query.filter_by(slug=level["id"]).first()
        assert db_level.title == "Sky Castle"


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
    """What tells the editor whether a level is still a draft that needs
    its one-time name."""
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


def test_saving_a_published_level_is_rejected_even_with_identical_content():
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

        assert response.status_code == 409
        assert (
            client.get(f"/api/levels/{level['id']}", headers=_auth_headers(token)).get_json()[
                "visibility_state"
            ]
            == "published"
        )


def test_beating_a_published_level_is_rejected():
    app, client = _client()
    with app.app_context():
        token = _signup_and_login(app, client)
        level = _create_level(client, token)
        client.post(f"/api/levels/{level['id']}/beat", headers=_auth_headers(token))
        _publish(client, token, level["id"], title="Sky Castle")

        response = client.post(f"/api/levels/{level['id']}/beat", headers=_auth_headers(token))

        assert response.status_code == 409


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


# --- published-total cap (every level ever published, deleted ones included) ---


def _pad_published_levels_to(app, owner_username, target_count):
    """Directly inserts published Level rows (bypassing the API) so a cap
    boundary test doesn't need a hundred slow, real HTTP publishes just
    to set up its starting state."""
    with app.app_context():
        owner = User.query.filter_by(username=owner_username).first()
        existing = Level.query.filter_by(owner_id=owner.id).filter(Level.published_at.isnot(None)).count()
        for i in range(existing, target_count):
            db.session.add(
                Level(
                    owner_id=owner.id,
                    title=f"Padding {i}",
                    visibility_state=LevelVisibilityState.PUBLISHED,
                    draft_content=_valid_content(),
                    draft_beaten_at=utc_now(),
                    published_at=utc_now(),
                )
            )
        db.session.commit()


def test_publish_is_refused_when_it_would_exceed_the_published_total_cap():
    app, client = _client()
    with app.app_context():
        token = _signup_and_login(app, client)
        _pad_published_levels_to(app, "creator", MAX_PUBLISHED_TOTAL)

        new_level = _create_level(client, token, title="One too many")
        client.post(f"/api/levels/{new_level['id']}/beat", headers=_auth_headers(token))
        response = _publish(client, token, new_level["id"], title="One too many")

        assert response.status_code == 409
        db_level = Level.query.filter_by(slug=new_level["id"]).first()
        assert db_level.published_at is None


def test_publish_succeeds_at_exactly_the_published_total_cap_boundary():
    app, client = _client()
    with app.app_context():
        token = _signup_and_login(app, client)
        _pad_published_levels_to(app, "creator", MAX_PUBLISHED_TOTAL - 1)

        new_level = _create_level(client, token, title="Exactly at the limit")
        client.post(f"/api/levels/{new_level['id']}/beat", headers=_auth_headers(token))
        response = _publish(client, token, new_level["id"], title="Exactly at the limit")

        assert response.status_code == 200


def test_published_total_cap_does_not_count_another_users_levels():
    app, client = _client()
    with app.app_context():
        _signup_and_login(app, client, "capuser_a", "capuser_a@example.com")
        _pad_published_levels_to(app, "capuser_a", MAX_PUBLISHED_TOTAL)

        token_b = _signup_and_login(app, client, "capuser_b", "capuser_b@example.com")
        level_b = _create_level(client, token_b, title="B's first level")
        client.post(f"/api/levels/{level_b['id']}/beat", headers=_auth_headers(token_b))
        response = _publish(client, token_b, level_b["id"], title="B's first level")

        assert response.status_code == 200


# --- delete: a never-published draft is hard-deleted ---


def test_deleting_a_never_published_draft_removes_it_entirely():
    app, client = _client()
    with app.app_context():
        token = _signup_and_login(app, client)
        level = _create_level(client, token, title="Throwaway")

        response = client.delete(f"/api/levels/{level['id']}", headers=_auth_headers(token))
        assert response.status_code == 204

        get_response = client.get(f"/api/levels/{level['id']}", headers=_auth_headers(token))
        assert get_response.status_code == 404


def test_deleting_a_draft_frees_a_draft_cap_slot():
    app, client = _client()
    with app.app_context():
        token = _signup_and_login(app, client)

        levels = [_create_level(client, token, title=f"Draft {i}") for i in range(MAX_DRAFT_LEVELS)]
        blocked_response = client.post(
            "/api/levels", json={"title": "One too many"}, headers=_auth_headers(token)
        )
        assert blocked_response.status_code == 409

        client.delete(f"/api/levels/{levels[0]['id']}", headers=_auth_headers(token))

        freed_response = client.post(
            "/api/levels", json={"title": "Fits now"}, headers=_auth_headers(token)
        )
        assert freed_response.status_code == 201


# --- delete: an already-published level is soft-deleted instead ---


def test_deleting_a_published_level_soft_deletes_it():
    app, client = _client()
    with app.app_context():
        token = _signup_and_login(app, client)
        level = _create_level(client, token, title="Going away")
        client.post(f"/api/levels/{level['id']}/beat", headers=_auth_headers(token))
        _publish(client, token, level["id"], title="Going away")

        response = client.delete(f"/api/levels/{level['id']}", headers=_auth_headers(token))
        assert response.status_code == 204

        # The row itself survives - the owner can still see it, marked
        # deleted, unlike a hard-deleted draft's clean 404.
        get_response = client.get(f"/api/levels/{level['id']}", headers=_auth_headers(token))
        assert get_response.status_code == 200
        body = get_response.get_json()
        assert body["is_deleted"] is True
        assert body["visibility_state"] == "unpublished"


def test_a_soft_deleted_level_disappears_from_public_endpoints():
    app, client = _client()
    with app.app_context():
        token = _signup_and_login(app, client, "deletepublisher", "dp@example.com")
        level = _create_level(client, token, title="Was Public")
        client.post(f"/api/levels/{level['id']}/beat", headers=_auth_headers(token))
        _publish(client, token, level["id"], title="Was Public")

        # Confirm it's actually visible before deleting, so the
        # assertions below prove deletion caused the disappearance.
        assert client.get(f"/api/levels/{level['id']}/play").status_code == 200
        assert len(client.get("/api/levels/by-user/deletepublisher").get_json()) == 1

        client.delete(f"/api/levels/{level['id']}", headers=_auth_headers(token))

        assert client.get(f"/api/levels/{level['id']}/play").status_code == 404
        assert client.get("/api/levels/by-user/deletepublisher").get_json() == []


def test_a_soft_deleted_level_cannot_be_saved_beaten_or_published():
    app, client = _client()
    with app.app_context():
        token = _signup_and_login(app, client)
        level = _create_level(client, token, title="Locked After Deletion")
        client.post(f"/api/levels/{level['id']}/beat", headers=_auth_headers(token))
        _publish(client, token, level["id"], title="Locked After Deletion")
        client.delete(f"/api/levels/{level['id']}", headers=_auth_headers(token))

        save_response = client.patch(
            f"/api/levels/{level['id']}", json={"content": _valid_content()}, headers=_auth_headers(token)
        )
        assert save_response.status_code == 409

        beat_response = client.post(f"/api/levels/{level['id']}/beat", headers=_auth_headers(token))
        assert beat_response.status_code == 409

        publish_response = client.post(
            f"/api/levels/{level['id']}/publish", headers=_auth_headers(token)
        )
        assert publish_response.status_code == 409


def test_deleting_a_published_level_does_not_free_its_published_cap_slot():
    """
    Confirms the explicit design decision: a soft-deleted level keeps
    counting toward MAX_PUBLISHED_TOTAL forever - deleting it doesn't
    refund the lifetime slot it already consumed by being published.
    """
    app, client = _client()
    with app.app_context():
        token = _signup_and_login(app, client)

        level = _create_level(client, token, title="Uses a slot")
        client.post(f"/api/levels/{level['id']}/beat", headers=_auth_headers(token))
        _publish(client, token, level["id"], title="Uses a slot")
        # Exactly at the cap: this level plus MAX_PUBLISHED_TOTAL - 1 more.
        _pad_published_levels_to(app, "creator", MAX_PUBLISHED_TOTAL)

        client.delete(f"/api/levels/{level['id']}", headers=_auth_headers(token))

        new_level = _create_level(client, token, title="Should still be blocked")
        client.post(f"/api/levels/{new_level['id']}/beat", headers=_auth_headers(token))
        response = _publish(client, token, new_level["id"], title="Should still be blocked")

        assert response.status_code == 409


def test_deleting_an_already_deleted_level_is_rejected():
    app, client = _client()
    with app.app_context():
        token = _signup_and_login(app, client)
        level = _create_level(client, token, title="Only once")
        client.post(f"/api/levels/{level['id']}/beat", headers=_auth_headers(token))
        _publish(client, token, level["id"], title="Only once")
        client.delete(f"/api/levels/{level['id']}", headers=_auth_headers(token))

        response = client.delete(f"/api/levels/{level['id']}", headers=_auth_headers(token))

        assert response.status_code == 409


def test_deleting_someone_elses_level_is_not_found():
    app, client = _client()
    with app.app_context():
        owner_token = _signup_and_login(app, client, "owner1", "owner1@example.com")
        level = _create_level(client, owner_token, title="Not yours")

        other_token = _signup_and_login(app, client, "other1", "other1@example.com")
        response = client.delete(f"/api/levels/{level['id']}", headers=_auth_headers(other_token))

        assert response.status_code == 404


# --- like: a thumbs-up from the result modal ---


def test_rating_a_level_requires_authentication():
    app, client = _client()
    with app.app_context():
        owner_token = _signup_and_login(app, client)
        level = _create_level(client, owner_token)
        client.post(f"/api/levels/{level['id']}/beat", headers=_auth_headers(owner_token))
        _publish(client, owner_token, level["id"])

        response = client.post(f"/api/levels/{level['id']}/rate", json={"is_like": True})

        assert response.status_code == 401


def test_rating_a_level_with_a_like_succeeds():
    app, client = _client()
    with app.app_context():
        owner_token = _signup_and_login(app, client, "owner2", "owner2@example.com")
        level = _create_level(client, owner_token)
        client.post(f"/api/levels/{level['id']}/beat", headers=_auth_headers(owner_token))
        _publish(client, owner_token, level["id"])

        rater_token = _signup_and_login(app, client, "rater", "rater@example.com")
        response = client.post(
            f"/api/levels/{level['id']}/rate", json={"is_like": True}, headers=_auth_headers(rater_token)
        )

        assert response.status_code == 200
        assert response.get_json()["is_like"] is True


def test_rating_a_level_with_a_dislike_succeeds():
    app, client = _client()
    with app.app_context():
        owner_token = _signup_and_login(app, client, "owner2b", "owner2b@example.com")
        level = _create_level(client, owner_token)
        client.post(f"/api/levels/{level['id']}/beat", headers=_auth_headers(owner_token))
        _publish(client, owner_token, level["id"])

        rater_token = _signup_and_login(app, client, "rater0", "rater0@example.com")
        response = client.post(
            f"/api/levels/{level['id']}/rate", json={"is_like": False}, headers=_auth_headers(rater_token)
        )

        assert response.status_code == 200
        assert response.get_json()["is_like"] is False


def test_rating_a_level_twice_with_the_same_value_is_a_no_op_not_an_error():
    """
    The frontend doesn't track whether a click is someone's first
    rating or a repeat - the endpoint has to be safe to call more than
    once for the same (level, user) pair without erroring or creating a
    second row.
    """
    app, client = _client()
    with app.app_context():
        owner_token = _signup_and_login(app, client, "owner3", "owner3@example.com")
        level = _create_level(client, owner_token)
        client.post(f"/api/levels/{level['id']}/beat", headers=_auth_headers(owner_token))
        _publish(client, owner_token, level["id"])

        rater_token = _signup_and_login(app, client, "rater2", "rater2@example.com")
        first = client.post(
            f"/api/levels/{level['id']}/rate", json={"is_like": True}, headers=_auth_headers(rater_token)
        )
        second = client.post(
            f"/api/levels/{level['id']}/rate", json={"is_like": True}, headers=_auth_headers(rater_token)
        )

        assert first.status_code == 200
        assert second.status_code == 200

        with app.app_context():
            rating_count = LevelRating.query.filter_by(
                level_id=_internal_level_id(level["id"])
            ).count()
        assert rating_count == 1


def test_switching_a_rating_from_like_to_dislike_updates_the_same_row():
    app, client = _client()
    with app.app_context():
        owner_token = _signup_and_login(app, client, "owner3b", "owner3b@example.com")
        level = _create_level(client, owner_token)
        client.post(f"/api/levels/{level['id']}/beat", headers=_auth_headers(owner_token))
        _publish(client, owner_token, level["id"])

        rater_token = _signup_and_login(app, client, "rater2b", "rater2b@example.com")
        client.post(
            f"/api/levels/{level['id']}/rate", json={"is_like": True}, headers=_auth_headers(rater_token)
        )
        switched = client.post(
            f"/api/levels/{level['id']}/rate", json={"is_like": False}, headers=_auth_headers(rater_token)
        )

        assert switched.status_code == 200
        assert switched.get_json()["is_like"] is False

        with app.app_context():
            ratings = LevelRating.query.filter_by(level_id=_internal_level_id(level["id"])).all()
        assert len(ratings) == 1
        assert ratings[0].is_like is False


def test_rating_a_level_without_is_like_returns_400():
    app, client = _client()
    with app.app_context():
        owner_token = _signup_and_login(app, client, "owner3c", "owner3c@example.com")
        level = _create_level(client, owner_token)
        client.post(f"/api/levels/{level['id']}/beat", headers=_auth_headers(owner_token))
        _publish(client, owner_token, level["id"])

        response = client.post(f"/api/levels/{level['id']}/rate", headers=_auth_headers(owner_token))

        assert response.status_code == 400


def test_rating_an_unpublished_level_returns_404():
    app, client = _client()
    with app.app_context():
        owner_token = _signup_and_login(app, client, "owner4", "owner4@example.com")
        level = _create_level(client, owner_token)

        response = client.post(
            f"/api/levels/{level['id']}/rate", json={"is_like": True}, headers=_auth_headers(owner_token)
        )

        assert response.status_code == 404


def test_rating_an_unknown_slug_returns_404():
    app, client = _client()
    with app.app_context():
        token = _signup_and_login(app, client)

        response = client.post(
            "/api/levels/NOPE-NOPE-NOPE-NOPE/rate", json={"is_like": True}, headers=_auth_headers(token)
        )

        assert response.status_code == 404


def test_rating_a_deleted_level_returns_404():
    app, client = _client()
    with app.app_context():
        owner_token = _signup_and_login(app, client, "owner5", "owner5@example.com")
        level = _create_level(client, owner_token)
        client.post(f"/api/levels/{level['id']}/beat", headers=_auth_headers(owner_token))
        _publish(client, owner_token, level["id"])
        client.delete(f"/api/levels/{level['id']}", headers=_auth_headers(owner_token))

        rater_token = _signup_and_login(app, client, "rater3", "rater3@example.com")
        response = client.post(
            f"/api/levels/{level['id']}/rate", json={"is_like": True}, headers=_auth_headers(rater_token)
        )

        assert response.status_code == 404


def _internal_level_id(slug: str) -> int:
    return Level.query.filter_by(slug=slug).first().id