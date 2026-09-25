from datetime import timedelta

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
        assert response.get_json()["email_verified_at"] is not None

        refetched_user = User.query.filter_by(public_id=user_id).first()
        assert refetched_user.email_verified_at is not None

        refetched_token = db.session.get(EmailVerificationToken, token.id)
        assert refetched_token.used_at is not None


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