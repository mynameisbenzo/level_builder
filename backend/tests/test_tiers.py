import pytest

from app.extensions import db
from app.main import create_app
from app.models.user import User, UserRole
from app.schemas.user import user_to_full_dict
from app.services.tiers import (
    TIER_ANONYMOUS,
    TIER_FREE,
    TIER_PAID,
    get_account_tier,
    is_paid_account,
)
from tests.test_endless_api import _client, _player, _status


def _user(role=UserRole.USER, is_paid=False):
    return User(username="someone", email="s@example.com", role=role, is_paid=is_paid)


def test_nobody_signed_in_is_anonymous():
    assert get_account_tier(None) == TIER_ANONYMOUS
    assert is_paid_account(None) is False


@pytest.mark.parametrize("role", [UserRole.OWNER, UserRole.DEVELOPER, UserRole.MODERATOR])
def test_staff_roles_are_paid_without_the_flag(role):
    user = _user(role=role, is_paid=False)

    assert get_account_tier(user) == TIER_PAID
    assert is_paid_account(user) is True


def test_a_regular_account_is_free_until_it_is_marked_paid():
    assert get_account_tier(_user()) == TIER_FREE
    assert get_account_tier(_user(is_paid=True)) == TIER_PAID


def test_a_new_account_is_not_paid_by_default():
    app = create_app("testing")
    with app.app_context():
        db.create_all()
        user = User(username="fresh", email="f@example.com")
        db.session.add(user)
        db.session.commit()

        assert user.is_paid is False


def test_the_owners_own_view_of_their_account_carries_the_tier():
    assert user_to_full_dict(_user())["tier"] == TIER_FREE
    assert user_to_full_dict(_user(is_paid=True))["tier"] == TIER_PAID
    assert user_to_full_dict(_user(role=UserRole.MODERATOR))["tier"] == TIER_PAID


def test_a_paid_flag_gives_endless_mode_the_paid_rules(clock):
    app, client = _client()
    with app.app_context():
        token, player = _player(app, client, clock)  # a plain account
        assert _status(client, token).get_json()["is_paid"] is False

        player.is_paid = True
        db.session.commit()

        body = _status(client, token).get_json()
        assert body["is_paid"] is True
        assert body["pool"] is None
        assert body["lives"]["adjustable"] is True


def _login_user_payload(app, client, username, email):
    """Signs an account up and in, returning the `user` object the login response carries."""
    app.config["DEBUG"] = True
    created = client.post("/api/users", json={"username": username, "email": email})
    client.post("/api/users/verify-email", json={"token": created.get_json()["dev_verification_token"]})
    link = client.post("/api/auth/request-login-link", json={"identifier": username})
    login = client.post("/api/auth/login", json={"token": link.get_json()["dev_login_token"]})
    return login.get_json()["user"]


def test_the_tier_shows_up_in_the_login_response():
    app, client = _client()
    with app.app_context():
        owner = _login_user_payload(app, client, "first", "first@example.com")  # the first account is the owner
        regular = _login_user_payload(app, client, "second", "second@example.com")

        assert owner["tier"] == "paid"
        assert regular["tier"] == "free"

        User.query.filter_by(username="second").first().is_paid = True
        db.session.commit()
        assert _login_user_payload_again(client, "second")["tier"] == "paid"


def _login_user_payload_again(client, username):
    link = client.post("/api/auth/request-login-link", json={"identifier": username})
    login = client.post("/api/auth/login", json={"token": link.get_json()["dev_login_token"]})
    return login.get_json()["user"]


# --- flask grant-paid / revoke-paid / list-paid ---


def _cli(app, *args):
    return app.test_cli_runner().invoke(args=list(args))


def _make_user(app, client, name):
    from tests.test_endless_api import _signup_and_login

    _signup_and_login(app, client, name, f"{name}@example.com")
    return User.query.filter_by(username=name).first()


def test_grant_and_revoke_paid_flip_the_flag():
    app, client = _client()
    with app.app_context():
        _make_user(app, client, "owner_account")  # the first account is the owner
        user = _make_user(app, client, "ann")
        assert get_account_tier(user) == TIER_FREE

        result = _cli(app, "grant-paid", "ann")
        assert result.exit_code == 0
        assert "ann is now paid" in result.output
        db.session.refresh(user)
        assert user.is_paid is True
        assert get_account_tier(user) == TIER_PAID

        result = _cli(app, "revoke-paid", "ann")
        assert result.exit_code == 0
        db.session.refresh(user)
        assert user.is_paid is False
        assert get_account_tier(user) == TIER_FREE


def test_granting_twice_or_revoking_an_unpaid_account_is_harmless():
    app, client = _client()
    with app.app_context():
        _make_user(app, client, "owner_account")
        _make_user(app, client, "ann")

        assert "isn't marked paid" in _cli(app, "revoke-paid", "ann").output
        _cli(app, "grant-paid", "ann")
        assert "already paid" in _cli(app, "grant-paid", "ann").output


def test_an_unknown_or_deleted_account_is_an_error():
    app, client = _client()
    with app.app_context():
        _make_user(app, client, "owner_account")
        gone = _make_user(app, client, "gone")
        gone.is_deleted = True
        db.session.commit()

        for name in ("nobody", "gone"):
            result = _cli(app, "grant-paid", name)
            assert result.exit_code != 0
            assert "no account named" in result.output


def test_revoking_a_staff_account_says_the_role_still_counts():
    app, client = _client()
    with app.app_context():
        owner = _make_user(app, client, "owner_account")
        owner.is_paid = True
        db.session.commit()

        result = _cli(app, "revoke-paid", "owner_account")

        assert "role still counts as paid" in result.output
        assert get_account_tier(owner) == TIER_PAID


def test_list_paid_shows_only_accounts_marked_by_hand():
    app, client = _client()
    with app.app_context():
        _make_user(app, client, "owner_account")
        _make_user(app, client, "ann")
        _make_user(app, client, "bob")
        assert "No accounts" in _cli(app, "list-paid").output

        _cli(app, "grant-paid", "bob")
        _cli(app, "grant-paid", "ann")

        assert _cli(app, "list-paid").output.split() == ["ann", "bob"]