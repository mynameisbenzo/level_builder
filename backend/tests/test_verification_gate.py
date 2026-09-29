from app.extensions import db
from app.main import create_app


def _client():
    app = create_app("testing")
    with app.app_context():
        db.create_all()
    return app, app.test_client()


def _auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _signup_and_login(client, username, email=None, twitch_id=None) -> str:
    """
    Deliberately does NOT verify email - unlike
    test_levels_api.py's own _signup_and_login helper, these tests are
    specifically about what an unverified (or Twitch-linked) user can
    and can't do, so leaving verification out is the point.
    """
    payload = {"username": username}
    if email is not None:
        payload["email"] = email
    if twitch_id is not None:
        payload["twitch_id"] = twitch_id
    client.post("/api/users", json=payload)
    request_response = client.post("/api/auth/request-login-link", json={"identifier": username})
    login_token = request_response.get_json()["dev_login_token"]
    login_response = client.post("/api/auth/login", json={"token": login_token})
    return login_response.get_json()["access_token"]


def _verify(client, username, email) -> None:
    create_response = client.post("/api/users", json={"username": username, "email": email})
    verification_token = create_response.get_json()["dev_verification_token"]
    client.post("/api/users/verify-email", json={"token": verification_token})


UNVERIFIED_ERROR_FRAGMENT = "verify your email"


# --- an unverified, non-Twitch user is blocked from every level action ---


def test_unverified_user_cannot_create_a_level():
    app, client = _client()
    with app.app_context():
        app.config["DEBUG"] = True
        token = _signup_and_login(client, "unverified1", email="u1@example.com")

        response = client.post("/api/levels", json={"title": "My Level"}, headers=_auth_headers(token))

        assert response.status_code == 403
        assert UNVERIFIED_ERROR_FRAGMENT in response.get_json()["error"]


def test_unverified_user_cannot_list_their_levels():
    app, client = _client()
    with app.app_context():
        app.config["DEBUG"] = True
        token = _signup_and_login(client, "unverified2", email="u2@example.com")

        response = client.get("/api/levels", headers=_auth_headers(token))

        assert response.status_code == 403
        assert UNVERIFIED_ERROR_FRAGMENT in response.get_json()["error"]


def test_unverified_user_cannot_get_save_beat_or_publish_an_existing_level():
    """
    Covers the case where a user was verified when they created a
    level, then lost verification later (e.g. an email change) - the
    gate applies to the four _get_owned_level-based endpoints even for
    a level that already exists, not just to creating a new one.
    """
    app, client = _client()
    with app.app_context():
        app.config["DEBUG"] = True

        # Create the level while genuinely verified...
        _verify(client, "wasverified", "wv@example.com")
        request_response = client.post("/api/auth/request-login-link", json={"identifier": "wasverified"})
        login_token = request_response.get_json()["dev_login_token"]
        token = client.post("/api/auth/login", json={"token": login_token}).get_json()["access_token"]
        create_response = client.post("/api/levels", json={"title": "My Level"}, headers=_auth_headers(token))
        slug = create_response.get_json()["id"]

        # ...then simulate losing verification (e.g. an email change
        # clearing email_verified_at) directly in the database, since
        # there's no API path to un-verify an account otherwise.
        from app.models.user import User

        user = User.query.filter_by(username="wasverified").first()
        user.email_verified_at = None
        db.session.commit()

        get_response = client.get(f"/api/levels/{slug}", headers=_auth_headers(token))
        assert get_response.status_code == 403
        assert UNVERIFIED_ERROR_FRAGMENT in get_response.get_json()["error"]

        save_response = client.patch(
            f"/api/levels/{slug}", json={"content": {}}, headers=_auth_headers(token)
        )
        assert save_response.status_code == 403

        beat_response = client.post(f"/api/levels/{slug}/beat", headers=_auth_headers(token))
        assert beat_response.status_code == 403

        publish_response = client.post(
            f"/api/levels/{slug}/publish", json={"title": "My Level"}, headers=_auth_headers(token)
        )
        assert publish_response.status_code == 403


# --- a Twitch-linked user is exempt, even with no verified email ---


def test_twitch_linked_user_can_create_a_level_without_email_verification():
    app, client = _client()
    with app.app_context():
        app.config["DEBUG"] = True
        token = _signup_and_login(client, "twitchuser", twitch_id="12345")

        response = client.post("/api/levels", json={"title": "My Level"}, headers=_auth_headers(token))

        assert response.status_code == 201


def test_twitch_linked_user_with_an_unverified_email_is_still_exempt():
    """A user can have both an email and a Twitch link - the Twitch
    link alone is enough, regardless of the email's own verification
    state."""
    app, client = _client()
    with app.app_context():
        app.config["DEBUG"] = True
        client.post(
            "/api/users",
            json={"username": "both", "email": "both@example.com", "twitch_id": "999"},
        )
        request_response = client.post("/api/auth/request-login-link", json={"identifier": "both"})
        login_token = request_response.get_json()["dev_login_token"]
        token = client.post("/api/auth/login", json={"token": login_token}).get_json()["access_token"]

        response = client.post("/api/levels", json={"title": "My Level"}, headers=_auth_headers(token))

        assert response.status_code == 201


# --- a verified email user is unaffected ---


def test_verified_email_user_can_create_a_level():
    app, client = _client()
    with app.app_context():
        app.config["DEBUG"] = True
        _verify(client, "verified1", "v1@example.com")
        request_response = client.post("/api/auth/request-login-link", json={"identifier": "verified1"})
        login_token = request_response.get_json()["dev_login_token"]
        token = client.post("/api/auth/login", json={"token": login_token}).get_json()["access_token"]

        response = client.post("/api/levels", json={"title": "My Level"}, headers=_auth_headers(token))

        assert response.status_code == 201


# --- account actions stay unrestricted regardless of verification ---


def test_unverified_user_can_still_edit_their_own_account():
    app, client = _client()
    with app.app_context():
        app.config["DEBUG"] = True
        create_response = client.post("/api/users", json={"username": "unverified3", "email": "u3@example.com"})
        public_id = create_response.get_json()["id"]
        request_response = client.post("/api/auth/request-login-link", json={"identifier": "unverified3"})
        login_token = request_response.get_json()["dev_login_token"]
        token = client.post("/api/auth/login", json={"token": login_token}).get_json()["access_token"]

        response = client.patch(
            f"/api/users/{public_id}",
            json={"hide_email": True},
            headers=_auth_headers(token),
        )

        assert response.status_code == 200


def test_unverified_user_can_still_delete_their_own_account():
    app, client = _client()
    with app.app_context():
        app.config["DEBUG"] = True
        create_response = client.post("/api/users", json={"username": "unverified4", "email": "u4@example.com"})
        public_id = create_response.get_json()["id"]
        request_response = client.post("/api/auth/request-login-link", json={"identifier": "unverified4"})
        login_token = request_response.get_json()["dev_login_token"]
        token = client.post("/api/auth/login", json={"token": login_token}).get_json()["access_token"]

        response = client.delete(f"/api/users/{public_id}", headers=_auth_headers(token))

        assert response.status_code == 204


# --- public, unauthenticated endpoints stay visible regardless ---


def test_a_lapsed_creators_already_published_level_stays_publicly_visible():
    app, client = _client()
    with app.app_context():
        app.config["DEBUG"] = True
        _verify(client, "publisher", "pub@example.com")
        request_response = client.post("/api/auth/request-login-link", json={"identifier": "publisher"})
        login_token = request_response.get_json()["dev_login_token"]
        token = client.post("/api/auth/login", json={"token": login_token}).get_json()["access_token"]

        create_response = client.post("/api/levels", json={"title": "Public Level"}, headers=_auth_headers(token))
        slug = create_response.get_json()["id"]
        client.post(f"/api/levels/{slug}/beat", headers=_auth_headers(token))
        client.post(f"/api/levels/{slug}/publish", json={"title": "Public Level"}, headers=_auth_headers(token))

        from app.models.user import User

        user = User.query.filter_by(username="publisher").first()
        user.email_verified_at = None
        db.session.commit()

        play_response = client.get(f"/api/levels/{slug}/play")
        assert play_response.status_code == 200

        by_user_response = client.get("/api/levels/by-user/publisher")
        assert by_user_response.status_code == 200
        assert len(by_user_response.get_json()) == 1