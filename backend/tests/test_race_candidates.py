import time

import jwt

from tests.test_endless_api import _client, _creator, _live_level

SECRET = "test-race-secret"


def _internal_token(secret=SECRET, aud="race-internal", exp_in=60):
    now = int(time.time())
    return jwt.encode({"aud": aud, "iss": "race-worker", "iat": now, "exp": now + exp_in}, secret, algorithm="HS256")


def _post(client, body=None, token="default"):
    if token == "default":
        token = _internal_token()
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    return client.post("/api/race/candidates", json=body, headers=headers)


def _setup(clock, levels):
    """Levels is a list of (title, difficulty, deleted)."""
    app, client = _client()
    app.config["RACE_TICKET_SECRET"] = SECRET
    with app.app_context():
        creator = _creator(app, client, clock)
        for title, difficulty, deleted in levels:
            _live_level(creator, title=title, difficulty=difficulty, deleted=deleted)
    return app, client


def test_it_needs_the_workers_token(clock):
    app, client = _setup(clock, [("One", None, False)])
    with app.app_context():
        assert _post(client, {}, token=None).status_code == 401
        assert _post(client, {}, token="not-a-jwt").status_code == 401
        assert _post(client, {}, token=_internal_token(secret="other")).status_code == 401
        assert _post(client, {}, token=_internal_token(exp_in=-5)).status_code == 401


def test_a_players_ticket_cannot_call_it(clock):
    app, client = _setup(clock, [("One", None, False)])
    with app.app_context():
        assert _post(client, {}, token=_internal_token(aud="race")).status_code == 401


def test_it_is_off_until_a_secret_is_configured(clock):
    app, client = _setup(clock, [("One", None, False)])
    app.config["RACE_TICKET_SECRET"] = ""
    with app.app_context():
        assert _post(client, {}).status_code == 503


def test_any_draws_published_levels_labeled_or_not(clock):
    app, client = _setup(clock, [("Plain", None, False), ("Easy one", "easy", False)])
    with app.app_context():
        body = _post(client, {"category": "any"}).get_json()
        assert sorted(level["title"] for level in body["levels"]) == ["Easy one", "Plain"]
        first = body["levels"][0]
        assert set(first) == {"slug", "title", "owner_username", "difficulty", "thumbnail_url"}
        assert first["owner_username"] == "creator"


def test_a_named_category_only_draws_that_label(clock):
    app, client = _setup(clock, [("Plain", None, False), ("Easy one", "easy", False), ("Hard one", "hard", False)])
    with app.app_context():
        body = _post(client, {"category": "easy"}).get_json()
        assert [level["title"] for level in body["levels"]] == ["Easy one"]


def test_an_empty_category_returns_an_empty_list(clock):
    app, client = _setup(clock, [("Plain", None, False)])
    with app.app_context():
        response = _post(client, {"category": "tas"})
        assert response.status_code == 200
        assert response.get_json() == {"levels": []}


def test_deleted_levels_are_never_offered(clock):
    app, client = _setup(clock, [("Live", None, False), ("Gone", None, True)])
    with app.app_context():
        titles = [level["title"] for level in _post(client, {}).get_json()["levels"]]
        assert titles == ["Live"]


def test_at_most_four_distinct_levels_and_count_is_clamped(clock):
    app, client = _setup(clock, [(f"L{i}", None, False) for i in range(6)])
    with app.app_context():
        levels = _post(client, {"count": 99}).get_json()["levels"]
        assert len(levels) == 4
        assert len({level["slug"] for level in levels}) == 4
        assert len(_post(client, {"count": 2}).get_json()["levels"]) == 2
        assert len(_post(client, {"count": 0}).get_json()["levels"]) == 1
        assert len(_post(client, {"count": "lots"}).get_json()["levels"]) == 4


def test_an_unknown_category_is_rejected(clock):
    app, client = _setup(clock, [("One", None, False)])
    with app.app_context():
        response = _post(client, {"category": "impossible"})
        assert response.status_code == 400
        assert response.get_json()["code"] == "bad_category"