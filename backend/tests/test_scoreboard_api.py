from datetime import timedelta

from app.extensions import db
from app.models.endless import RUN_MODE_ENDLESS, RUN_MODE_SCOREBOARD, EndlessRun
from app.utils.time import utc_now
from tests.test_endless_api import (
    _client,
    _creator,
    _headers,
    _live_level,
    _player,
    _post,
    _start,
    clock,  # noqa: F401 - the fixture
    frozen_labels,  # noqa: F401 - the fixture
)


def _board(client, token=None, **params):
    query = "&".join(f"{key}={value}" for key, value in params.items())
    headers = _headers(token) if token else {}
    return client.get(f"/api/endless/scoreboard?{query}", headers=headers)


def _finished_run(user, score, difficulty=None, mode=RUN_MODE_SCOREBOARD, ended_minutes_ago=0, active=False):
    run = EndlessRun(
        user_id=user.id,
        mode=mode,
        difficulty=difficulty,
        starting_lives=5,
        lives_remaining=0,
        levels_cleared=score,
        score=score,
        is_active=active,
        started_at=utc_now() - timedelta(hours=1),
        ended_at=None if active else utc_now() - timedelta(minutes=ended_minutes_ago),
    )
    db.session.add(run)
    db.session.commit()
    return run


def _users(app, client, clock, names):
    users = []
    for name in names:
        _token, user = _player(app, client, clock, username=name, email=f"{name}@example.com")
        users.append(user)
    return users


def test_the_board_is_public_and_empty_to_start(clock):
    app, client = _client()
    with app.app_context():
        response = _board(client)

        assert response.status_code == 200
        assert response.get_json() == {"difficulty": "any", "total": 0, "entries": []}


def test_every_finished_run_is_its_own_row_best_first(clock):
    app, client = _client()
    with app.app_context():
        ann, bob = _users(app, client, clock, ["ann", "bob"])
        _finished_run(ann, 12)
        _finished_run(ann, 20)
        _finished_run(bob, 15)
        _finished_run(ann, 7)

        body = _board(client).get_json()

        assert body["total"] == 4
        assert [(e["username"], e["score"], e["rank"]) for e in body["entries"]] == [
            ("ann", 20, 1),
            ("bob", 15, 2),
            ("ann", 12, 3),
            ("ann", 7, 4),
        ]


def test_equal_scores_share_a_rank_and_the_earlier_finish_is_listed_first(clock):
    app, client = _client()
    with app.app_context():
        ann, bob, cy = _users(app, client, clock, ["ann", "bob", "cy"])
        _finished_run(ann, 10, ended_minutes_ago=5)
        _finished_run(bob, 10, ended_minutes_ago=30)
        _finished_run(cy, 4)

        entries = _board(client).get_json()["entries"]

        assert [(e["username"], e["rank"]) for e in entries] == [("bob", 1), ("ann", 1), ("cy", 3)]


def test_each_difficulty_is_its_own_board(clock):
    app, client = _client()
    with app.app_context():
        (ann,) = _users(app, client, clock, ["ann"])
        _finished_run(ann, 30, difficulty=None)
        _finished_run(ann, 8, difficulty="hard")
        _finished_run(ann, 5, difficulty="easy")

        assert [e["score"] for e in _board(client).get_json()["entries"]] == [30]
        assert [e["score"] for e in _board(client, difficulty="any").get_json()["entries"]] == [30]
        hard = _board(client, difficulty="hard").get_json()
        assert hard["difficulty"] == "hard"
        assert [e["score"] for e in hard["entries"]] == [8]
        assert _board(client, difficulty="tas").get_json()["entries"] == []


def test_only_finished_scored_scoreboard_runs_count(clock):
    app, client = _client()
    with app.app_context():
        (ann,) = _users(app, client, clock, ["ann"])
        _finished_run(ann, 9, active=True)  # still being played
        _finished_run(ann, 6, mode=RUN_MODE_ENDLESS)  # endless isn't scored
        _finished_run(ann, 0)  # scored nothing
        _finished_run(ann, 3)

        assert [e["score"] for e in _board(client).get_json()["entries"]] == [3]


def test_deleted_and_suspended_accounts_are_left_off(clock):
    app, client = _client()
    with app.app_context():
        ann, bob, cy = _users(app, client, clock, ["ann", "bob", "cy"])
        _finished_run(ann, 9)
        _finished_run(bob, 8)
        _finished_run(cy, 7)
        bob.is_deleted = True
        cy.is_suspended = True
        db.session.commit()

        entries = _board(client).get_json()["entries"]

        assert [e["username"] for e in entries] == ["ann"]


def test_a_logged_in_viewer_sees_their_own_runs_flagged(clock):
    app, client = _client()
    with app.app_context():
        token, ann = _player(app, client, clock, username="ann", email="ann@example.com")
        (bob,) = _users(app, client, clock, ["bob"])
        _finished_run(ann, 5)
        _finished_run(bob, 9)

        signed_in = _board(client, token).get_json()["entries"]
        anonymous = _board(client).get_json()["entries"]

        assert [(e["username"], e["is_you"]) for e in signed_in] == [("bob", False), ("ann", True)]
        assert not any(e["is_you"] for e in anonymous)


def test_paging_keeps_ranks_going_across_pages(clock):
    app, client = _client()
    with app.app_context():
        (ann,) = _users(app, client, clock, ["ann"])
        for score in (10, 9, 9, 7, 5):
            _finished_run(ann, score)

        first = _board(client, limit=2).get_json()
        second = _board(client, limit=2, offset=2).get_json()

        assert first["total"] == 5
        assert [(e["score"], e["rank"]) for e in first["entries"]] == [(10, 1), (9, 2)]
        assert [(e["score"], e["rank"]) for e in second["entries"]] == [(9, 2), (7, 4)]


def test_bad_parameters_are_rejected(clock):
    app, client = _client()
    with app.app_context():
        for params in (
            {"difficulty": "impossible"},
            {"limit": 0},
            {"limit": 101},
            {"limit": "many"},
            {"offset": -1},
        ):
            response = _board(client, **params)
            assert response.status_code == 400, params
            assert "code" in response.get_json()


def test_a_played_run_lands_on_the_board_when_it_ends(clock, frozen_labels):
    app, client = _client()
    with app.app_context():
        token, _player_row = _player(app, client, clock)
        creator = _creator(app, client, clock)
        _live_level(creator, title="Hard one", difficulty="hard")

        _start(client, token, mode="scoreboard", difficulty="hard")
        assert _board(client, difficulty="hard").get_json()["entries"] == []

        _post(client, token, "/runs/current/begin")
        _post(client, token, "/runs/current/clear")
        _post(client, token, "/runs/current/begin")
        _post(client, token, "/runs/current/clear")
        # Still being played, so not listed yet.
        assert _board(client, difficulty="hard").get_json()["total"] == 0

        _post(client, token, "/runs/current/quit")

        entries = _board(client, difficulty="hard").get_json()["entries"]
        assert [(e["username"], e["score"], e["levels_cleared"]) for e in entries] == [("player", 2, 2)]