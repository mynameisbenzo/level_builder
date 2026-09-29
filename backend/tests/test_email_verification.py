from datetime import timedelta

from app.api.users import MAX_RESEND_REQUESTS_PER_WINDOW
from app.extensions import db
from app.main import create_app
from app.models.email_verification import EmailVerificationToken
from app.models.user import User
from app.utils.time import utc_now


def _client():
    app = create_app("testing")
    with app.app_context():
        db.create_all()
    return app, app.test_client()


def _internal_id(public_id: str) -> int:
    """See test_auth.py's _internal_id - same reasoning: response bodies
    only ever expose public_id, but EmailVerificationToken.user_id is
    the internal FK."""
    return User.query.filter_by(public_id=public_id).first().id


def test_testing_config_never_has_a_real_resend_key():
    """
    Guards against a real regression: if this were ever removed, adding
    a real RESEND_API_KEY to a local .env would make every test run
    silently attempt real Resend API calls.
    """
    app = create_app("testing")
    assert app.config["RESEND_API_KEY"] == ""


def test_signing_up_with_email_issues_a_verification_token():
    app, client = _client()
    with app.app_context():
        create = client.post("/api/users", json={"username": "verifyme", "email": "v@example.com"})
        user_id = create.get_json()["id"]

        token = EmailVerificationToken.query.filter_by(user_id=_internal_id(user_id)).first()
        assert token is not None
        assert token.used_at is None
        assert token.is_valid() is True


def test_signing_up_with_only_twitch_issues_no_token():
    app, client = _client()
    with app.app_context():
        create = client.post(
            "/api/users", json={"username": "streamer", "twitch_id": "123", "twitch_display_name": "S"}
        )
        user_id = create.get_json()["id"]

        assert EmailVerificationToken.query.filter_by(user_id=_internal_id(user_id)).first() is None


def test_dev_verification_token_included_in_response_when_debug():
    app, client = _client()
    app.config["DEBUG"] = True
    with app.app_context():
        response = client.post("/api/users", json={"username": "debuguser", "email": "d@example.com"})
        body = response.get_json()
        assert "dev_verification_token" in body

        # And it's the real, usable token, not a decoy.
        token = EmailVerificationToken.query.filter_by(user_id=_internal_id(body["id"])).first()
        assert body["dev_verification_token"] == token.token


def test_dev_verification_token_absent_when_not_debug():
    app, client = _client()
    with app.app_context():
        response = client.post("/api/users", json={"username": "produser", "email": "p@example.com"})
        assert "dev_verification_token" not in response.get_json()


def test_verify_email_with_valid_token_marks_user_verified():
    app, client = _client()
    with app.app_context():
        create = client.post("/api/users", json={"username": "toverify", "email": "tv@example.com"})
        user_id = create.get_json()["id"]
        token = EmailVerificationToken.query.filter_by(user_id=_internal_id(user_id)).first()

        response = client.post("/api/users/verify-email", json={"token": token.token})
        assert response.status_code == 200
        assert response.get_json()["user"]["email_verified_at"] is not None

        refetched_user = User.query.filter_by(public_id=user_id).first()
        assert refetched_user.email_verified_at is not None

        refetched_token = db.session.get(EmailVerificationToken, token.id)
        assert refetched_token.used_at is not None


def test_verify_email_also_issues_a_working_session():
    """
    A genuine verification-link click proves the same thing a
    login-link click does (control of the account's email), so it's
    now a valid way to establish a session too - not just a separate
    step someone has to additionally go through via /login afterward.
    """
    app, client = _client()
    with app.app_context():
        create = client.post("/api/users", json={"username": "sessioned", "email": "se@example.com"})
        user_id = create.get_json()["id"]
        token = EmailVerificationToken.query.filter_by(user_id=_internal_id(user_id)).first()

        response = client.post("/api/users/verify-email", json={"token": token.token})
        body = response.get_json()

        assert "access_token" in body
        assert "refresh_token" in body
        assert body["user"]["id"] == user_id

        # And the access token genuinely works for an authenticated
        # request, not just present in the response.
        profile_response = client.patch(
            f"/api/users/{user_id}",
            json={"username": "sessioned"},
            headers={"Authorization": f"Bearer {body['access_token']}"},
        )
        assert profile_response.status_code == 200


def test_verify_email_rejects_a_suspended_users_token():
    """Defense in depth, same as every other real login moment - the
    account could have been suspended/deleted in the time between
    signing up and clicking the link."""
    app, client = _client()
    with app.app_context():
        create = client.post(
            "/api/users", json={"username": "suspendedverify", "email": "sv@example.com"}
        )
        user_id = create.get_json()["id"]
        User.query.filter_by(public_id=user_id).first().is_suspended = True
        db.session.commit()

        token = EmailVerificationToken.query.filter_by(user_id=_internal_id(user_id)).first()
        response = client.post("/api/users/verify-email", json={"token": token.token})
        assert response.status_code == 403

        # And the token wasn't burned by the rejected attempt - the
        # account could still verify later if it's ever reinstated.
        refetched_token = db.session.get(EmailVerificationToken, token.id)
        assert refetched_token.used_at is None


def test_verify_email_with_unknown_token_returns_404():
    app, client = _client()
    with app.app_context():
        response = client.post("/api/users/verify-email", json={"token": "not-a-real-token"})
        assert response.status_code == 404


def test_verify_email_missing_token_returns_400():
    app, client = _client()
    with app.app_context():
        response = client.post("/api/users/verify-email", json={})
        assert response.status_code == 400


def test_verify_email_already_used_token_is_rejected():
    app, client = _client()
    with app.app_context():
        create = client.post("/api/users", json={"username": "reuser", "email": "re@example.com"})
        user_id = create.get_json()["id"]
        token = EmailVerificationToken.query.filter_by(user_id=_internal_id(user_id)).first()

        first = client.post("/api/users/verify-email", json={"token": token.token})
        assert first.status_code == 200

        second = client.post("/api/users/verify-email", json={"token": token.token})
        assert second.status_code == 410


def test_verify_email_expired_token_is_rejected():
    app, client = _client()
    with app.app_context():
        create = client.post("/api/users", json={"username": "expireduser", "email": "ex@example.com"})
        user_id = create.get_json()["id"]
        token = EmailVerificationToken.query.filter_by(user_id=_internal_id(user_id)).first()

        # Simulate a token issued a while ago, past its 24h lifetime.
        token.expires_at = utc_now() - timedelta(hours=1)
        db.session.commit()

        response = client.post("/api/users/verify-email", json={"token": token.token})
        assert response.status_code == 410

def _auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _login(app, client, username: str) -> str:
    """Logs in via the magic-link flow (works whether or not the
    account is email-verified - verification and login are separate
    concerns), returning a real access token."""
    app.config["DEBUG"] = True
    request_response = client.post("/api/auth/request-login-link", json={"identifier": username})
    login_token = request_response.get_json()["dev_login_token"]
    login_response = client.post("/api/auth/login", json={"token": login_token})
    return login_response.get_json()["access_token"]


def test_resend_verification_email_issues_a_new_token():
    app, client = _client()
    with app.app_context():
        app.config["DEBUG"] = True
        client.post("/api/users", json={"username": "resenduser", "email": "resend@example.com"})
        token = _login(app, client, "resenduser")
        user_id = _internal_id_by_username("resenduser")

        original_token = EmailVerificationToken.query.filter_by(user_id=user_id).first()

        response = client.post("/api/users/resend-verification-email", headers=_auth_headers(token))

        assert response.status_code == 200
        assert "dev_verification_token" in response.get_json()

        tokens = EmailVerificationToken.query.filter_by(user_id=user_id).all()
        assert len(tokens) == 2
        new_token = next(t for t in tokens if t.id != original_token.id)
        assert new_token.is_valid() is True


def test_resend_verification_email_new_token_actually_verifies():
    app, client = _client()
    with app.app_context():
        app.config["DEBUG"] = True
        client.post("/api/users", json={"username": "resendverify", "email": "rv@example.com"})
        token = _login(app, client, "resendverify")

        resend_response = client.post("/api/users/resend-verification-email", headers=_auth_headers(token))
        new_token_value = resend_response.get_json()["dev_verification_token"]

        verify_response = client.post("/api/users/verify-email", json={"token": new_token_value})
        assert verify_response.status_code == 200
        assert verify_response.get_json()["user"]["email_verified_at"] is not None


def test_resend_verification_email_does_not_invalidate_the_original_token():
    app, client = _client()
    with app.app_context():
        app.config["DEBUG"] = True
        create = client.post("/api/users", json={"username": "keepsoriginal", "email": "ko@example.com"})
        original_token_value = create.get_json()["dev_verification_token"]
        token = _login(app, client, "keepsoriginal")

        client.post("/api/users/resend-verification-email", headers=_auth_headers(token))

        verify_response = client.post("/api/users/verify-email", json={"token": original_token_value})
        assert verify_response.status_code == 200


def test_resend_verification_email_requires_authentication():
    app, client = _client()
    with app.app_context():
        response = client.post("/api/users/resend-verification-email")
        assert response.status_code == 401


def test_resend_verification_email_rejects_an_already_verified_account():
    app, client = _client()
    with app.app_context():
        app.config["DEBUG"] = True
        create = client.post("/api/users", json={"username": "alreadyverified", "email": "av@example.com"})
        token_value = create.get_json()["dev_verification_token"]
        client.post("/api/users/verify-email", json={"token": token_value})
        access_token = _login(app, client, "alreadyverified")

        response = client.post(
            "/api/users/resend-verification-email", headers=_auth_headers(access_token)
        )

        assert response.status_code == 409


def test_resend_verification_email_rejects_a_twitch_only_account():
    app, client = _client()
    with app.app_context():
        app.config["DEBUG"] = True
        client.post("/api/users", json={"username": "twitchonly", "twitch_id": "111"})
        token = _login(app, client, "twitchonly")

        response = client.post("/api/users/resend-verification-email", headers=_auth_headers(token))

        assert response.status_code == 400


def test_resend_verification_email_is_rate_limited():
    """
    The count includes the token signup itself already issued - not
    just resends - since that's still a verification email this
    account was just sent. One slot is already spent before any resend
    call happens, so only MAX_RESEND_REQUESTS_PER_WINDOW - 1 further
    calls succeed before the limit kicks in.
    """
    app, client = _client()
    with app.app_context():
        app.config["DEBUG"] = True
        client.post("/api/users", json={"username": "ratelimited", "email": "rl@example.com"})
        token = _login(app, client, "ratelimited")

        for _ in range(MAX_RESEND_REQUESTS_PER_WINDOW - 1):
            response = client.post(
                "/api/users/resend-verification-email", headers=_auth_headers(token)
            )
            assert response.status_code == 200

        blocked_response = client.post(
            "/api/users/resend-verification-email", headers=_auth_headers(token)
        )
        assert blocked_response.status_code == 429


def test_resend_verification_email_rate_limit_is_per_account():
    app, client = _client()
    with app.app_context():
        app.config["DEBUG"] = True
        client.post("/api/users", json={"username": "ratelimiteda", "email": "rla@example.com"})
        token_a = _login(app, client, "ratelimiteda")
        for _ in range(MAX_RESEND_REQUESTS_PER_WINDOW):
            client.post("/api/users/resend-verification-email", headers=_auth_headers(token_a))

        client.post("/api/users", json={"username": "ratelimitedb", "email": "rlb@example.com"})
        token_b = _login(app, client, "ratelimitedb")

        response = client.post("/api/users/resend-verification-email", headers=_auth_headers(token_b))

        assert response.status_code == 200


def _internal_id_by_username(username: str) -> int:
    return User.query.filter_by(username=username).first().id