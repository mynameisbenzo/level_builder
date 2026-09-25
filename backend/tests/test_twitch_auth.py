from datetime import timedelta

from app.extensions import db
from app.main import create_app
from app.models.twitch_signup_token import TwitchSignupToken
from app.models.user import User
from app.utils.time import utc_now


def _client():
    app = create_app("testing")
    with app.app_context():
        db.create_all()
    return app, app.test_client()


def _mock_twitch(monkeypatch, twitch_id="123456", display_name="CoolStreamer"):
    """
    Replaces the two real calls to Twitch's own servers with a fixed,
    successful result - these are exactly the two calls this whole
    session can't genuinely exercise end-to-end (no real Twitch
    account, no real user consent, no real redirect). Everything
    downstream of them (matching an existing account, the new-signup
    bridge token, account creation) is real and fully exercised.
    """
    import app.api.auth as auth_module

    monkeypatch.setattr(auth_module, "exchange_code_for_token", lambda code, redirect_uri: "fake-twitch-access-token")
    monkeypatch.setattr(auth_module, "get_twitch_identity", lambda access_token: (twitch_id, display_name))


def _mock_twitch_failure(monkeypatch):
    import app.api.auth as auth_module
    from app.services.twitch import TwitchAuthError

    def raise_error(*args, **kwargs):
        raise TwitchAuthError("simulated Twitch failure")

    monkeypatch.setattr(auth_module, "exchange_code_for_token", raise_error)


# --- /twitch/callback ---


def test_twitch_callback_new_identity_returns_needs_username(monkeypatch):
    app, client = _client()
    with app.app_context():
        _mock_twitch(monkeypatch, twitch_id="999", display_name="BrandNewStreamer")

        response = client.post(
            "/api/auth/twitch/callback", json={"code": "fake-code", "redirect_uri": "https://localhost:5173/x"}
        )

        assert response.status_code == 200
        body = response.get_json()
        assert body["needs_username"] is True
        assert "signup_token" in body
        assert body["suggested_username"] == "BrandNewStreamer"
        # No account was actually created yet - just the bridge token.
        assert User.query.filter_by(twitch_id="999").first() is None


def test_twitch_callback_existing_identity_logs_in(monkeypatch):
    app, client = _client()
    with app.app_context():
        # An account that already linked this exact twitch_id previously.
        client.post(
            "/api/users",
            json={"username": "existinguser", "twitch_id": "555", "twitch_display_name": "Existing"},
        )
        _mock_twitch(monkeypatch, twitch_id="555", display_name="Existing")

        response = client.post(
            "/api/auth/twitch/callback", json={"code": "fake-code", "redirect_uri": "https://localhost:5173/x"}
        )

        assert response.status_code == 200
        body = response.get_json()
        assert "access_token" in body
        assert "refresh_token" in body
        assert body["user"]["username"] == "existinguser"
        assert "needs_username" not in body


def test_twitch_callback_rejects_a_suspended_users_identity(monkeypatch):
    app, client = _client()
    with app.app_context():
        create = client.post(
            "/api/users",
            json={"username": "suspendeduser", "twitch_id": "777", "twitch_display_name": "S"},
        )
        User.query.filter_by(public_id=create.get_json()["id"]).first().is_suspended = True
        db.session.commit()

        _mock_twitch(monkeypatch, twitch_id="777", display_name="S")

        response = client.post(
            "/api/auth/twitch/callback", json={"code": "fake-code", "redirect_uri": "https://localhost:5173/x"}
        )
        assert response.status_code == 403


def test_twitch_callback_missing_code_returns_400():
    app, client = _client()
    with app.app_context():
        response = client.post(
            "/api/auth/twitch/callback", json={"redirect_uri": "https://localhost:5173/x"}
        )
        assert response.status_code == 400


def test_twitch_callback_missing_redirect_uri_returns_400():
    app, client = _client()
    with app.app_context():
        response = client.post("/api/auth/twitch/callback", json={"code": "fake-code"})
        assert response.status_code == 400


def test_twitch_callback_exchange_failure_returns_502_without_leaking_details(monkeypatch):
    app, client = _client()
    with app.app_context():
        _mock_twitch_failure(monkeypatch)

        response = client.post(
            "/api/auth/twitch/callback", json={"code": "bad-code", "redirect_uri": "https://localhost:5173/x"}
        )
        assert response.status_code == 502
        # The real exception message ("simulated Twitch failure") should
        # never reach the client - only a generic, safe message.
        assert "simulated Twitch failure" not in response.get_json()["error"]


# --- /twitch/finish-signup ---


def test_twitch_finish_signup_creates_account_and_logs_in(monkeypatch):
    app, client = _client()
    with app.app_context():
        _mock_twitch(monkeypatch, twitch_id="222", display_name="NewPerson")
        callback = client.post(
            "/api/auth/twitch/callback", json={"code": "fake-code", "redirect_uri": "https://localhost:5173/x"}
        )
        signup_token = callback.get_json()["signup_token"]

        response = client.post(
            "/api/auth/twitch/finish-signup", json={"signup_token": signup_token, "username": "chosenname"}
        )

        assert response.status_code == 200
        body = response.get_json()
        assert "access_token" in body
        assert "refresh_token" in body
        assert body["user"]["username"] == "chosenname"

        created = User.query.filter_by(username="chosenname").first()
        assert created is not None
        assert created.twitch_id == "222"
        assert created.twitch_display_name == "NewPerson"


def test_twitch_finish_signup_uses_the_tokens_twitch_id_not_client_supplied(monkeypatch):
    """
    The core security property this whole token exists for: even if the
    client tries to sneak a different twitch_id into this request, it's
    ignored - only username is ever read from the request body here.
    """
    app, client = _client()
    with app.app_context():
        _mock_twitch(monkeypatch, twitch_id="333", display_name="RealPerson")
        callback = client.post(
            "/api/auth/twitch/callback", json={"code": "fake-code", "redirect_uri": "https://localhost:5173/x"}
        )
        signup_token = callback.get_json()["signup_token"]

        response = client.post(
            "/api/auth/twitch/finish-signup",
            json={
                "signup_token": signup_token,
                "username": "chosenname2",
                "twitch_id": "999999",  # An attempted spoof - must be ignored.
                "twitch_display_name": "Spoofed",
            },
        )

        assert response.status_code == 200
        created = User.query.filter_by(username="chosenname2").first()
        assert created.twitch_id == "333"
        assert created.twitch_display_name == "RealPerson"


def test_twitch_finish_signup_with_taken_username_is_rejected(monkeypatch):
    app, client = _client()
    with app.app_context():
        client.post("/api/users", json={"username": "alreadytaken", "email": "a@example.com"})

        _mock_twitch(monkeypatch, twitch_id="444", display_name="D")
        callback = client.post(
            "/api/auth/twitch/callback", json={"code": "fake-code", "redirect_uri": "https://localhost:5173/x"}
        )
        signup_token = callback.get_json()["signup_token"]

        response = client.post(
            "/api/auth/twitch/finish-signup", json={"signup_token": signup_token, "username": "alreadytaken"}
        )
        assert response.status_code == 409


def test_twitch_finish_signup_with_unknown_token_returns_404():
    app, client = _client()
    with app.app_context():
        response = client.post(
            "/api/auth/twitch/finish-signup", json={"signup_token": "not-a-real-token", "username": "x"}
        )
        assert response.status_code == 404


def test_twitch_finish_signup_with_already_used_token_is_rejected(monkeypatch):
    app, client = _client()
    with app.app_context():
        _mock_twitch(monkeypatch, twitch_id="666", display_name="D")
        callback = client.post(
            "/api/auth/twitch/callback", json={"code": "fake-code", "redirect_uri": "https://localhost:5173/x"}
        )
        signup_token = callback.get_json()["signup_token"]

        first = client.post(
            "/api/auth/twitch/finish-signup", json={"signup_token": signup_token, "username": "firstuse"}
        )
        assert first.status_code == 200

        second = client.post(
            "/api/auth/twitch/finish-signup", json={"signup_token": signup_token, "username": "seconduse"}
        )
        assert second.status_code == 410


def test_twitch_finish_signup_with_expired_token_is_rejected(monkeypatch):
    app, client = _client()
    with app.app_context():
        _mock_twitch(monkeypatch, twitch_id="888", display_name="D")
        callback = client.post(
            "/api/auth/twitch/callback", json={"code": "fake-code", "redirect_uri": "https://localhost:5173/x"}
        )
        signup_token_value = callback.get_json()["signup_token"]

        token = TwitchSignupToken.query.filter_by(token=signup_token_value).first()
        token.expires_at = utc_now() - timedelta(minutes=1)
        db.session.commit()

        response = client.post(
            "/api/auth/twitch/finish-signup", json={"signup_token": signup_token_value, "username": "x"}
        )
        assert response.status_code == 410


def test_twitch_finish_signup_missing_username_returns_400(monkeypatch):
    app, client = _client()
    with app.app_context():
        _mock_twitch(monkeypatch, twitch_id="111", display_name="D")
        callback = client.post(
            "/api/auth/twitch/callback", json={"code": "fake-code", "redirect_uri": "https://localhost:5173/x"}
        )
        signup_token = callback.get_json()["signup_token"]

        response = client.post("/api/auth/twitch/finish-signup", json={"signup_token": signup_token})
        assert response.status_code == 400


def test_twitch_finish_signup_missing_token_returns_400():
    app, client = _client()
    with app.app_context():
        response = client.post("/api/auth/twitch/finish-signup", json={"username": "x"})
        assert response.status_code == 400


# --- /twitch/link ---


def _login(app, client, identifier="lorenzo") -> dict:
    """Goes through the real request-login-link -> login flow to get a
    genuine access_token, for a user linking Twitch onto an already-
    existing, email-based account."""
    app.config["DEBUG"] = True
    request_response = client.post("/api/auth/request-login-link", json={"identifier": identifier})
    login_token = request_response.get_json()["dev_login_token"]
    login_response = client.post("/api/auth/login", json={"token": login_token})
    return login_response.get_json()


def test_twitch_link_attaches_identity_to_the_authenticated_account(monkeypatch):
    app, client = _client()
    with app.app_context():
        client.post("/api/users", json={"username": "emailuser", "email": "e@example.com"})
        login_body = _login(app, client, "emailuser")

        _mock_twitch(monkeypatch, twitch_id="1000", display_name="LinkedHandle")

        response = client.post(
            "/api/auth/twitch/link",
            json={"code": "fake-code", "redirect_uri": "https://localhost:5173/profile/link-twitch/callback"},
            headers={"Authorization": f"Bearer {login_body['access_token']}"},
        )

        assert response.status_code == 200
        body = response.get_json()
        assert body["twitch_id"] == "1000"
        assert body["twitch_display_name"] == "LinkedHandle"
        # Still the same account, not a different one - email untouched.
        assert body["email"] == "e@example.com"
        assert body["username"] == "emailuser"

        linked = User.query.filter_by(username="emailuser").first()
        assert linked.twitch_id == "1000"


def test_twitch_link_without_a_token_is_rejected():
    app, client = _client()
    with app.app_context():
        response = client.post(
            "/api/auth/twitch/link",
            json={"code": "fake-code", "redirect_uri": "https://localhost:5173/profile/link-twitch/callback"},
        )
        assert response.status_code == 401


def test_twitch_link_rejects_an_account_that_already_has_a_linked_identity(monkeypatch):
    app, client = _client()
    with app.app_context():
        client.post(
            "/api/users",
            json={"username": "alreadylinked", "email": "a@example.com", "twitch_id": "existing"},
        )
        login_body = _login(app, client, "alreadylinked")

        _mock_twitch(monkeypatch, twitch_id="2000", display_name="NewHandle")

        response = client.post(
            "/api/auth/twitch/link",
            json={"code": "fake-code", "redirect_uri": "https://localhost:5173/profile/link-twitch/callback"},
            headers={"Authorization": f"Bearer {login_body['access_token']}"},
        )
        assert response.status_code == 409

        # Untouched - still the original linked identity, not overwritten.
        untouched = User.query.filter_by(username="alreadylinked").first()
        assert untouched.twitch_id == "existing"


def test_twitch_link_never_logs_into_a_different_account_that_already_owns_this_identity(monkeypatch):
    """
    The core security property: if the Twitch identity being linked
    already belongs to a DIFFERENT account, this must reject with a
    conflict - never quietly succeed as if it had logged into that
    other account instead.
    """
    app, client = _client()
    with app.app_context():
        client.post(
            "/api/users",
            json={"username": "originalowner", "twitch_id": "3000", "twitch_display_name": "Original"},
        )
        client.post("/api/users", json={"username": "wouldbelinker", "email": "w@example.com"})
        login_body = _login(app, client, "wouldbelinker")

        _mock_twitch(monkeypatch, twitch_id="3000", display_name="Original")

        response = client.post(
            "/api/auth/twitch/link",
            json={"code": "fake-code", "redirect_uri": "https://localhost:5173/profile/link-twitch/callback"},
            headers={"Authorization": f"Bearer {login_body['access_token']}"},
        )

        assert response.status_code == 409
        # No access/refresh token pair for the OTHER account was ever
        # issued - a 409 response has neither, but confirm explicitly.
        body = response.get_json()
        assert "access_token" not in body
        assert "refresh_token" not in body

        # The requesting account is genuinely still un-linked.
        requester = User.query.filter_by(username="wouldbelinker").first()
        assert requester.twitch_id is None


def test_twitch_link_missing_code_returns_400():
    app, client = _client()
    with app.app_context():
        client.post("/api/users", json={"username": "someone", "email": "s@example.com"})
        login_body = _login(app, client, "someone")

        response = client.post(
            "/api/auth/twitch/link",
            json={"redirect_uri": "https://localhost:5173/profile/link-twitch/callback"},
            headers={"Authorization": f"Bearer {login_body['access_token']}"},
        )
        assert response.status_code == 400


def test_twitch_link_exchange_failure_returns_502(monkeypatch):
    app, client = _client()
    with app.app_context():
        client.post("/api/users", json={"username": "someone2", "email": "s2@example.com"})
        login_body = _login(app, client, "someone2")

        _mock_twitch_failure(monkeypatch)

        response = client.post(
            "/api/auth/twitch/link",
            json={"code": "bad-code", "redirect_uri": "https://localhost:5173/profile/link-twitch/callback"},
            headers={"Authorization": f"Bearer {login_body['access_token']}"},
        )
        assert response.status_code == 502