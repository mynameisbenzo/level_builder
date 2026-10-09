import jwt

from app.extensions import db
from tests.test_endless_api import _client, _player

SECRET = "test-race-secret"


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _decode(ticket):
    return jwt.decode(ticket, SECRET, algorithms=["HS256"], audience="race")


def test_a_free_account_gets_a_ticket_that_says_it_is_not_paid(clock):
    app, client = _client()
    app.config["RACE_TICKET_SECRET"] = SECRET
    with app.app_context():
        token, user = _player(app, client, clock)

        response = client.post("/api/race/ticket", headers=_auth(token))

        assert response.status_code == 200
        claims = _decode(response.get_json()["ticket"])
        assert claims["sub"] == user.public_id
        assert claims["username"] == "player"
        assert claims["paid"] is False
        assert claims["exp"] - claims["iat"] == 120


def test_a_paid_account_gets_a_ticket_that_says_it_may_host(clock):
    app, client = _client()
    app.config["RACE_TICKET_SECRET"] = SECRET
    with app.app_context():
        token, _ = _player(app, client, clock, paid=True)

        claims = _decode(client.post("/api/race/ticket", headers=_auth(token)).get_json()["ticket"])

        assert claims["paid"] is True


def test_no_login_means_no_ticket():
    app, client = _client()
    app.config["RACE_TICKET_SECRET"] = SECRET

    assert client.post("/api/race/ticket").status_code == 401


def test_races_are_off_until_a_secret_is_configured(clock):
    app, client = _client()
    app.config["RACE_TICKET_SECRET"] = ""
    with app.app_context():
        token, _ = _player(app, client, clock)

        response = client.post("/api/race/ticket", headers=_auth(token))

        assert response.status_code == 503
        assert response.get_json()["code"] == "races_unavailable"


def test_an_unverified_account_gets_no_ticket(clock):
    app, client = _client()
    app.config["RACE_TICKET_SECRET"] = SECRET
    with app.app_context():
        token, user = _player(app, client, clock)
        user.email_verified_at = None
        user.twitch_id = None
        db.session.commit()

        response = client.post("/api/race/ticket", headers=_auth(token))

        assert response.status_code == 403
        assert response.get_json()["code"] == "verification_required"


def test_a_ticket_is_useless_with_the_wrong_secret(clock):
    app, client = _client()
    app.config["RACE_TICKET_SECRET"] = SECRET
    with app.app_context():
        token, _ = _player(app, client, clock)
        ticket = client.post("/api/race/ticket", headers=_auth(token)).get_json()["ticket"]

    try:
        jwt.decode(ticket, "some-other-secret", algorithms=["HS256"], audience="race")
        raise AssertionError("should not decode")
    except jwt.InvalidSignatureError:
        pass