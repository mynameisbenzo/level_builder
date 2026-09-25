from datetime import timedelta

from app.extensions import db
from app.main import create_app
from app.models.refresh_token import RefreshToken
from app.models.user import User
from app.utils.time import utc_now


def _client():
    app = create_app("testing")
    with app.app_context():
        db.create_all()
    return app, app.test_client()


def _signup(client, username="lorenzo", email="l@example.com"):
    return client.post("/api/users", json={"username": username, "email": email}).get_json()


def _login(app, client, identifier="lorenzo") -> dict:
    """Goes through the real request-login-link -> login flow to get a
    genuine access_token + refresh_token pair."""
    app.config["DEBUG"] = True
    request_response = client.post("/api/auth/request-login-link", json={"identifier": identifier})
    login_token = request_response.get_json()["dev_login_token"]
    login_response = client.post("/api/auth/login", json={"token": login_token})
    return login_response.get_json()


# --- login issues a refresh token too ---


def test_login_issues_a_refresh_token_alongside_the_access_token():
    app, client = _client()
    with app.app_context():
        _signup(client)
        body = _login(app, client)
        assert "access_token" in body
        assert "refresh_token" in body


# --- refresh ---


def test_refresh_with_valid_token_issues_a_new_pair():
    app, client = _client()
    with app.app_context():
        _signup(client)
        login_body = _login(app, client)

        response = client.post(
            "/api/auth/refresh", json={"refresh_token": login_body["refresh_token"]}
        )

        assert response.status_code == 200
        refreshed = response.get_json()
        assert "access_token" in refreshed
        assert "refresh_token" in refreshed
        # A genuinely new refresh token, not the same one handed back.
        assert refreshed["refresh_token"] != login_body["refresh_token"]


def test_refresh_rotates_the_old_token_to_revoked():
    app, client = _client()
    with app.app_context():
        _signup(client)
        login_body = _login(app, client)

        client.post("/api/auth/refresh", json={"refresh_token": login_body["refresh_token"]})

        old_token = RefreshToken.query.filter_by(token=login_body["refresh_token"]).first()
        assert old_token.revoked_at is not None


def test_refresh_new_access_token_has_correct_identity():
    from flask_jwt_extended import decode_token

    app, client = _client()
    with app.app_context():
        user = _signup(client)
        login_body = _login(app, client)

        response = client.post(
            "/api/auth/refresh", json={"refresh_token": login_body["refresh_token"]}
        )
        decoded = decode_token(response.get_json()["access_token"])
        assert decoded["sub"] == user["id"]


def test_refresh_with_an_already_used_old_token_is_rejected_and_invalidates_the_session():
    """
    Reuse detection: presenting a refresh token that was already rotated
    away is treated as a signal of theft, not ordinary expiry - the
    response revokes every other active refresh token for that user too.
    """
    app, client = _client()
    with app.app_context():
        _signup(client)
        login_body = _login(app, client)
        original_refresh_token = login_body["refresh_token"]

        # Legitimate rotation - the "real" client's flow.
        first_refresh = client.post(
            "/api/auth/refresh", json={"refresh_token": original_refresh_token}
        )
        assert first_refresh.status_code == 200
        still_active_token = first_refresh.get_json()["refresh_token"]

        # An attacker (or a stale second tab) replays the OLD,
        # already-rotated-away token.
        replay_attempt = client.post(
            "/api/auth/refresh", json={"refresh_token": original_refresh_token}
        )
        assert replay_attempt.status_code == 401

        # The legitimate, still-active token from the real rotation
        # above is now ALSO revoked as a result - the whole session was
        # invalidated, not just the replayed token rejected.
        now_also_revoked = RefreshToken.query.filter_by(token=still_active_token).first()
        assert now_also_revoked.revoked_at is not None

        second_refresh_attempt = client.post(
            "/api/auth/refresh", json={"refresh_token": still_active_token}
        )
        assert second_refresh_attempt.status_code == 401


def test_refresh_with_expired_token_is_rejected():
    app, client = _client()
    with app.app_context():
        _signup(client)
        login_body = _login(app, client)

        token = RefreshToken.query.filter_by(token=login_body["refresh_token"]).first()
        token.expires_at = utc_now() - timedelta(minutes=1)
        db.session.commit()

        response = client.post(
            "/api/auth/refresh", json={"refresh_token": login_body["refresh_token"]}
        )
        assert response.status_code == 410


def test_refresh_with_unknown_token_returns_404():
    app, client = _client()
    with app.app_context():
        response = client.post("/api/auth/refresh", json={"refresh_token": "not-a-real-token"})
        assert response.status_code == 404


def test_refresh_missing_token_returns_400():
    app, client = _client()
    with app.app_context():
        response = client.post("/api/auth/refresh", json={})
        assert response.status_code == 400


def test_refresh_rejects_a_since_suspended_users_token():
    app, client = _client()
    with app.app_context():
        user = _signup(client)
        login_body = _login(app, client)

        User.query.filter_by(public_id=user["id"]).first().is_suspended = True
        db.session.commit()

        response = client.post(
            "/api/auth/refresh", json={"refresh_token": login_body["refresh_token"]}
        )
        assert response.status_code == 403


# --- logout ---


def test_logout_revokes_the_refresh_token():
    app, client = _client()
    with app.app_context():
        _signup(client)
        login_body = _login(app, client)

        response = client.post(
            "/api/auth/logout", json={"refresh_token": login_body["refresh_token"]}
        )
        assert response.status_code == 204

        refresh_attempt = client.post(
            "/api/auth/refresh", json={"refresh_token": login_body["refresh_token"]}
        )
        # Rejected as reuse-of-a-revoked-token, same as any other
        # already-revoked token would be - logout doesn't need its own
        # separate error path for this.
        assert refresh_attempt.status_code == 401


def test_logout_with_unknown_token_still_returns_204():
    """Enumeration-safe, same principle as the rest of this auth
    system - logout never reveals whether a token was ever real."""
    app, client = _client()
    with app.app_context():
        response = client.post("/api/auth/logout", json={"refresh_token": "not-a-real-token"})
        assert response.status_code == 204


def test_logout_missing_token_returns_400():
    app, client = _client()
    with app.app_context():
        response = client.post("/api/auth/logout", json={})
        assert response.status_code == 400