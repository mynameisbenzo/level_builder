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


def test_get_user_by_id_shows_email_when_not_hidden():
    app, client = _client()
    with app.app_context():
        create = client.post("/api/users", json={"username": "public", "email": "visible@example.com"})
        user_id = create.get_json()["id"]

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
        untouched = db.session.get(User, victim_id)
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
        deleted = db.session.get(User, user_id)
        assert deleted.is_deleted is True
        assert deleted.email is None
        assert deleted.twitch_id is None
        assert deleted.username == f"deleted_user_{user_id}"


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
        untouched = db.session.get(User, victim_id)
        assert untouched.is_deleted is False