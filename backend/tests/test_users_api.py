from app.extensions import db
from app.main import create_app
from app.models.user import User


def _client():
    app = create_app("testing")
    with app.app_context():
        db.create_all()
    return app, app.test_client()


def _get_access_token(app, client, identifier: str) -> str:
    """Goes through the real request-login-link -> login flow to get a
    genuine, working JWT - not a hand-constructed stand-in."""
    app.config["DEBUG"] = True
    request_response = client.post("/api/auth/request-login-link", json={"identifier": identifier})
    login_token = request_response.get_json()["dev_login_token"]
    login_response = client.post("/api/auth/login", json={"token": login_token})
    return login_response.get_json()["access_token"]


def _auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_create_user_with_email_succeeds():
    app, client = _client()
    with app.app_context():
        response = client.post("/api/users", json={"username": "lorenzo", "email": "l@example.com"})

        assert response.status_code == 201
        body = response.get_json()
        assert body["username"] == "lorenzo"
        assert body["email"] == "l@example.com"
        # First user in a fresh database - correctly becomes Owner, not
        # a regular user. See test_first_user_created_becomes_owner for
        # the dedicated test of this rule.
        assert body["role"] == "owner"


def test_create_user_with_only_twitch_succeeds():
    app, client = _client()
    with app.app_context():
        response = client.post(
            "/api/users",
            json={"username": "streamer", "twitch_id": "999", "twitch_display_name": "StreamerName"},
        )

        assert response.status_code == 201
        assert response.get_json()["twitch_display_name"] == "StreamerName"


def test_first_user_created_becomes_owner():
    app, client = _client()
    with app.app_context():
        response = client.post("/api/users", json={"username": "first", "email": "first@example.com"})
        assert response.get_json()["role"] == "owner"


def test_second_user_created_stays_regular_user():
    app, client = _client()
    with app.app_context():
        client.post("/api/users", json={"username": "first", "email": "first@example.com"})
        response = client.post("/api/users", json={"username": "second", "email": "second@example.com"})
        assert response.get_json()["role"] == "user"


def test_create_user_missing_username_is_rejected():
    app, client = _client()
    with app.app_context():
        response = client.post("/api/users", json={"email": "l@example.com"})
        assert response.status_code == 400


def test_create_user_missing_both_email_and_twitch_is_rejected():
    app, client = _client()
    with app.app_context():
        response = client.post("/api/users", json={"username": "ghost"})
        assert response.status_code == 400


def test_create_user_duplicate_username_is_rejected():
    app, client = _client()
    with app.app_context():
        client.post("/api/users", json={"username": "lorenzo", "email": "a@example.com"})
        response = client.post("/api/users", json={"username": "lorenzo", "email": "b@example.com"})
        assert response.status_code == 409


def test_create_user_duplicate_email_is_rejected():
    app, client = _client()
    with app.app_context():
        client.post("/api/users", json={"username": "first", "email": "shared@example.com"})
        response = client.post("/api/users", json={"username": "second", "email": "shared@example.com"})
        assert response.status_code == 409


def test_create_user_race_condition_on_username_is_handled_cleanly(monkeypatch):
    """
    Simulates two near-simultaneous signups for the same username: by
    the time this request's own pre-check ran, the row didn't exist yet
    - but a colliding row lands (a real, separate insert) before this
    request's own commit. Only the database's unique constraint is
    actually race-proof; this confirms the endpoint converts that into
    a clean, specific 409 rather than an unhandled 500.
    """
    app, client = _client()
    with app.app_context():
        # The "other" concurrent request that wins the race.
        client.post("/api/users", json={"username": "raceuser", "email": "first@example.com"})

        import app.services.users as users_service

        real_check = users_service.username_is_taken
        call_count = {"n": 0}

        def flaky_precheck(*args, **kwargs):
            call_count["n"] += 1
            # First call is this request's own pre-check - simulate it
            # missing the race. Later calls (the post-rollback
            # re-check) see reality, same as production would.
            if call_count["n"] == 1:
                return False
            return real_check(*args, **kwargs)

        monkeypatch.setattr(users_service, "username_is_taken", flaky_precheck)

        response = client.post("/api/users", json={"username": "raceuser", "email": "second@example.com"})
        assert response.status_code == 409
        assert response.get_json()["error"] == "username is already taken"

        # And genuinely only one row exists with that username - the
        # database's own constraint did its job here, nothing got
        # corrupted by the failed second insert.
        assert User.query.filter_by(username="raceuser").count() == 1


def test_get_user_by_id_respects_hidden_email():
    app, client = _client()
    with app.app_context():
        create = client.post(
            "/api/users", json={"username": "private", "email": "hidden@example.com"}
        )
        user_id = create.get_json()["id"]
        token = _get_access_token(app, client, "private")
        client.patch(f"/api/users/{user_id}", json={"hide_email": True}, headers=_auth_headers(token))

        response = client.get(f"/api/users/{user_id}")
        assert response.status_code == 200
        body = response.get_json()
        assert "email" not in body


def test_email_is_hidden_by_default_on_signup():
    """Email defaults to private now - a fresh signup, with no explicit
    action taken, shouldn't show it publicly."""
    app, client = _client()
    with app.app_context():
        create = client.post("/api/users", json={"username": "fresh", "email": "fresh@example.com"})
        user_id = create.get_json()["id"]

        assert create.get_json()["hide_email"] is True

        response = client.get(f"/api/users/{user_id}")
        assert "email" not in response.get_json()


def test_get_user_by_id_shows_email_when_not_hidden():
    app, client = _client()
    with app.app_context():
        create = client.post("/api/users", json={"username": "public", "email": "visible@example.com"})
        user_id = create.get_json()["id"]
        # Email defaults to hidden now - this test is specifically about
        # what happens once the owner explicitly opts back in, not about
        # a fresh signup's default state (see
        # test_email_is_hidden_by_default_on_signup for that).
        token = _get_access_token(app, client, "public")
        client.patch(f"/api/users/{user_id}", json={"hide_email": False}, headers=_auth_headers(token))

        response = client.get(f"/api/users/{user_id}")
        assert response.get_json()["email"] == "visible@example.com"


def test_get_user_by_id_not_found():
    app, client = _client()
    with app.app_context():
        response = client.get("/api/users/999")
        assert response.status_code == 404


def test_get_user_by_username():
    app, client = _client()
    with app.app_context():
        client.post("/api/users", json={"username": "findme", "email": "findme@example.com"})

        response = client.get("/api/users/by-username/findme")
        assert response.status_code == 200
        assert response.get_json()["username"] == "findme"


def test_get_user_by_username_not_found():
    app, client = _client()
    with app.app_context():
        response = client.get("/api/users/by-username/nobody")
        assert response.status_code == 404


def test_patch_user_updates_username():
    app, client = _client()
    with app.app_context():
        create = client.post("/api/users", json={"username": "old_name", "email": "a@example.com"})
        user_id = create.get_json()["id"]
        token = _get_access_token(app, client, "old_name")

        response = client.patch(
            f"/api/users/{user_id}", json={"username": "new_name"}, headers=_auth_headers(token)
        )
        assert response.status_code == 200
        assert response.get_json()["username"] == "new_name"


def test_patch_user_to_duplicate_username_is_rejected():
    app, client = _client()
    with app.app_context():
        client.post("/api/users", json={"username": "taken", "email": "a@example.com"})
        create2 = client.post("/api/users", json={"username": "other", "email": "b@example.com"})
        user_id = create2.get_json()["id"]
        token = _get_access_token(app, client, "other")

        response = client.patch(
            f"/api/users/{user_id}", json={"username": "taken"}, headers=_auth_headers(token)
        )
        assert response.status_code == 409


def test_patch_user_race_condition_on_username_is_handled_cleanly(monkeypatch):
    """Same reasoning as the create_user version - a concurrent request
    claiming the same username in the window between this request's
    check and its own commit shouldn't surface as a raw 500."""
    app, client = _client()
    with app.app_context():
        client.post("/api/users", json={"username": "taken_by_race", "email": "a@example.com"})
        create2 = client.post("/api/users", json={"username": "other", "email": "b@example.com"})
        user_id = create2.get_json()["id"]
        token = _get_access_token(app, client, "other")

        import app.api.users as users_module

        monkeypatch.setattr(users_module, "username_is_taken", lambda *args, **kwargs: False)

        response = client.patch(
            f"/api/users/{user_id}", json={"username": "taken_by_race"}, headers=_auth_headers(token)
        )
        assert response.status_code == 409


def test_patch_user_without_a_token_is_rejected():
    app, client = _client()
    with app.app_context():
        create = client.post("/api/users", json={"username": "someone", "email": "a@example.com"})
        user_id = create.get_json()["id"]

        response = client.patch(f"/api/users/{user_id}", json={"username": "new_name"})
        assert response.status_code == 401


def test_patch_user_with_someone_elses_token_is_rejected():
    app, client = _client()
    with app.app_context():
        create1 = client.post("/api/users", json={"username": "victim", "email": "v@example.com"})
        victim_id = create1.get_json()["id"]
        client.post("/api/users", json={"username": "attacker", "email": "atk@example.com"})
        attacker_token = _get_access_token(app, client, "attacker")

        response = client.patch(
            f"/api/users/{victim_id}",
            json={"username": "hijacked"},
            headers=_auth_headers(attacker_token),
        )
        assert response.status_code == 403

        # And the victim's username is genuinely untouched, not just a
        # rejected-but-still-applied response.
        untouched = User.query.filter_by(public_id=victim_id).first()
        assert untouched.username == "victim"


def test_delete_user_soft_deletes_and_scrubs_pii():
    app, client = _client()
    with app.app_context():
        create = client.post(
            "/api/users",
            json={"username": "leaving", "email": "leaving@example.com", "twitch_id": "555"},
        )
        user_id = create.get_json()["id"]
        token = _get_access_token(app, client, "leaving")

        response = client.delete(f"/api/users/{user_id}", headers=_auth_headers(token))
        assert response.status_code == 204

        # Now invisible through the public API...
        assert client.get(f"/api/users/{user_id}").status_code == 404

        # ...and actually scrubbed at the data layer, not just hidden.
        deleted = User.query.filter_by(public_id=user_id).first()
        assert deleted.is_deleted is True
        assert deleted.email is None
        assert deleted.twitch_id is None
        assert deleted.username == f"deleted_user_{deleted.id}"


def test_delete_nonexistent_user_returns_404():
    app, client = _client()
    with app.app_context():
        # A token that claims to be user 999, which doesn't exist - this
        # specifically exercises "authenticated as this ID, but no such
        # user" rather than an ownership mismatch (401) or a missing-
        # token case, either of which id 999 would also trigger.
        from flask_jwt_extended import create_access_token

        with app.app_context():
            fake_token = create_access_token(identity="999")

        response = client.delete("/api/users/999", headers=_auth_headers(fake_token))
        assert response.status_code == 404


def test_delete_user_without_a_token_is_rejected():
    app, client = _client()
    with app.app_context():
        create = client.post("/api/users", json={"username": "someone", "email": "a@example.com"})
        user_id = create.get_json()["id"]

        response = client.delete(f"/api/users/{user_id}")
        assert response.status_code == 401


def test_delete_user_with_someone_elses_token_is_rejected():
    app, client = _client()
    with app.app_context():
        create1 = client.post("/api/users", json={"username": "victim", "email": "v@example.com"})
        victim_id = create1.get_json()["id"]
        client.post("/api/users", json={"username": "attacker", "email": "atk@example.com"})
        attacker_token = _get_access_token(app, client, "attacker")

        response = client.delete(f"/api/users/{victim_id}", headers=_auth_headers(attacker_token))
        assert response.status_code == 403

        # Confirm the victim's account is genuinely untouched.
        untouched = User.query.filter_by(public_id=victim_id).first()
        assert untouched.is_deleted is False