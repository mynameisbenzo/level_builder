from datetime import datetime, timedelta, timezone

from app.extensions import db
from app.main import create_app
from app.models.login_link_request import LoginLinkRequest
from app.models.login_token import LoginToken
from app.models.user import User


def _client():
    app = create_app("testing")
    with app.app_context():
        db.create_all()
    return app, app.test_client()


def _signup(client, username="lorenzo", email="l@example.com"):
    return client.post("/api/users", json={"username": username, "email": email}).get_json()


# --- request-login-link ---


def test_request_login_link_by_username_issues_a_token():
    app, client = _client()
    with app.app_context():
        user = _signup(client)
        client.post("/api/auth/request-login-link", json={"identifier": "lorenzo"})
        token = LoginToken.query.filter_by(user_id=user["id"]).first()
        assert token is not None
        assert token.is_valid() is True


def test_request_login_link_by_email_issues_a_token():
    app, client = _client()
    with app.app_context():
        user = _signup(client)
        client.post("/api/auth/request-login-link", json={"identifier": "l@example.com"})
        assert LoginToken.query.filter_by(user_id=user["id"]).first() is not None


def test_request_login_link_matching_is_case_insensitive():
    app, client = _client()
    with app.app_context():
        user = _signup(client, username="Lorenzo", email="L@Example.com")
        client.post("/api/auth/request-login-link", json={"identifier": "L@EXAMPLE.COM"})
        assert LoginToken.query.filter_by(user_id=user["id"]).first() is not None


def test_request_login_link_response_identical_whether_account_exists_or_not():
    """The core enumeration-safety guarantee - this must be true, not just documented."""
    app, client = _client()
    with app.app_context():
        _signup(client, username="realuser", email="real@example.com")

        real_response = client.post(
            "/api/auth/request-login-link", json={"identifier": "realuser"}
        )
        fake_response = client.post(
            "/api/auth/request-login-link", json={"identifier": "no-such-user"}
        )

        assert real_response.status_code == fake_response.status_code == 200
        assert real_response.get_json() == fake_response.get_json()


def test_request_login_link_missing_identifier_returns_400():
    app, client = _client()
    with app.app_context():
        response = client.post("/api/auth/request-login-link", json={})
        assert response.status_code == 400


def test_request_login_link_suspended_user_gets_no_token():
    app, client = _client()
    with app.app_context():
        user = _signup(client)
        db.session.get(User, user["id"]).is_suspended = True
        db.session.commit()

        response = client.post("/api/auth/request-login-link", json={"identifier": "lorenzo"})

        assert response.status_code == 200
        assert LoginToken.query.filter_by(user_id=user["id"]).first() is None


def test_dev_login_token_present_in_debug_when_account_found():
    app, client = _client()
    app.config["DEBUG"] = True
    with app.app_context():
        _signup(client)
        response = client.post("/api/auth/request-login-link", json={"identifier": "lorenzo"})
        assert "dev_login_token" in response.get_json()


def test_dev_login_token_absent_when_account_not_found_even_in_debug():
    app, client = _client()
    app.config["DEBUG"] = True
    with app.app_context():
        response = client.post("/api/auth/request-login-link", json={"identifier": "nobody"})
        assert "dev_login_token" not in response.get_json()


def test_dev_login_token_absent_when_not_in_debug():
    app, client = _client()
    with app.app_context():
        _signup(client)
        response = client.post("/api/auth/request-login-link", json={"identifier": "lorenzo"})
        assert "dev_login_token" not in response.get_json()


# --- rate limiting ---


def test_fourth_request_within_window_is_rate_limited():
    app, client = _client()
    with app.app_context():
        _signup(client)
        for _ in range(3):
            response = client.post("/api/auth/request-login-link", json={"identifier": "lorenzo"})
            assert response.status_code == 200

        fourth = client.post("/api/auth/request-login-link", json={"identifier": "lorenzo"})
        assert fourth.status_code == 429


def test_rate_limit_applies_equally_to_nonexistent_identifiers():
    """Enumeration-safety for the rate limit itself - a made-up identifier
    gets blocked on the same schedule as a real one."""
    app, client = _client()
    with app.app_context():
        for _ in range(3):
            client.post("/api/auth/request-login-link", json={"identifier": "totally-made-up"})

        fourth = client.post("/api/auth/request-login-link", json={"identifier": "totally-made-up"})
        assert fourth.status_code == 429


def test_rate_limit_is_scoped_per_identifier():
    app, client = _client()
    with app.app_context():
        _signup(client, username="userone", email="one@example.com")
        _signup(client, username="usertwo", email="two@example.com")

        for _ in range(3):
            client.post("/api/auth/request-login-link", json={"identifier": "userone"})

        # A different identifier isn't affected by userone's count.
        response = client.post("/api/auth/request-login-link", json={"identifier": "usertwo"})
        assert response.status_code == 200


def test_rate_limit_old_requests_outside_window_do_not_count():
    app, client = _client()
    with app.app_context():
        _signup(client)
        # Simulate 3 requests from over a day ago - shouldn't count
        # against the current window.
        for _ in range(3):
            old_request = LoginLinkRequest(identifier="lorenzo")
            old_request.requested_at = datetime.now(timezone.utc) - timedelta(days=2)
            db.session.add(old_request)
        db.session.commit()

        response = client.post("/api/auth/request-login-link", json={"identifier": "lorenzo"})
        assert response.status_code == 200


# --- login (consuming the token) ---


def test_login_with_valid_token_returns_access_token_and_user():
    app, client = _client()
    with app.app_context():
        user = _signup(client)
        client.post("/api/auth/request-login-link", json={"identifier": "lorenzo"})
        token = LoginToken.query.filter_by(user_id=user["id"]).first()

        response = client.post("/api/auth/login", json={"token": token.token})

        assert response.status_code == 200
        body = response.get_json()
        assert "access_token" in body
        assert body["user"]["id"] == user["id"]


def test_login_marks_the_token_used():
    app, client = _client()
    with app.app_context():
        user = _signup(client)
        client.post("/api/auth/request-login-link", json={"identifier": "lorenzo"})
        token = LoginToken.query.filter_by(user_id=user["id"]).first()

        client.post("/api/auth/login", json={"token": token.token})

        refetched = db.session.get(LoginToken, token.id)
        assert refetched.used_at is not None


def test_login_issues_a_jwt_with_the_correct_user_identity():
    from flask_jwt_extended import decode_token

    app, client = _client()
    with app.app_context():
        user = _signup(client)
        client.post("/api/auth/request-login-link", json={"identifier": "lorenzo"})
        token = LoginToken.query.filter_by(user_id=user["id"]).first()

        response = client.post("/api/auth/login", json={"token": token.token})
        access_token = response.get_json()["access_token"]

        decoded = decode_token(access_token)
        assert decoded["sub"] == str(user["id"])


def test_login_with_unknown_token_returns_404():
    app, client = _client()
    with app.app_context():
        response = client.post("/api/auth/login", json={"token": "not-a-real-token"})
        assert response.status_code == 404


def test_login_missing_token_returns_400():
    app, client = _client()
    with app.app_context():
        response = client.post("/api/auth/login", json={})
        assert response.status_code == 400


def test_login_with_already_used_token_is_rejected():
    app, client = _client()
    with app.app_context():
        user = _signup(client)
        client.post("/api/auth/request-login-link", json={"identifier": "lorenzo"})
        token = LoginToken.query.filter_by(user_id=user["id"]).first()

        first = client.post("/api/auth/login", json={"token": token.token})
        assert first.status_code == 200

        second = client.post("/api/auth/login", json={"token": token.token})
        assert second.status_code == 410


def test_login_with_expired_token_is_rejected():
    app, client = _client()
    with app.app_context():
        user = _signup(client)
        client.post("/api/auth/request-login-link", json={"identifier": "lorenzo"})
        token = LoginToken.query.filter_by(user_id=user["id"]).first()

        token.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
        db.session.commit()

        response = client.post("/api/auth/login", json={"token": token.token})
        assert response.status_code == 410


def test_login_rejects_a_since_suspended_users_token():
    """The link was requested while the account was fine, but it got
    suspended before the link was actually clicked."""
    app, client = _client()
    with app.app_context():
        user = _signup(client)
        client.post("/api/auth/request-login-link", json={"identifier": "lorenzo"})
        token = LoginToken.query.filter_by(user_id=user["id"]).first()

        db.session.get(User, user["id"]).is_suspended = True
        db.session.commit()

        response = client.post("/api/auth/login", json={"token": token.token})
        assert response.status_code == 403