import pytest

from app.extensions import db
from app.main import create_app
from app.models.level import Level
from app.models.play_attempt import PlayAttempt
from app.services.difficulty import (
    DIFFICULTY_LABELS,
    MIN_ATTEMPTS_FOR_LABEL,
    compute_difficulty_label,
    label_for_clear_rate,
)
from app.services.endless import ENDLESS_DIFFICULTIES
from tests.test_levels_api import _auth_headers, _create_level, _publish, _signup_and_login


def _client():
    app = create_app("testing")
    with app.app_context():
        db.create_all()
    return app, app.test_client()


def _published_level(app, client):
    """A published level owned by 'creator'; returns its slug."""
    owner_token = _signup_and_login(app, client, "creator", "c@example.com")
    level = _create_level(client, owner_token)
    client.post(f"/api/levels/{level['id']}/beat", headers=_auth_headers(owner_token))
    _publish(client, owner_token, level["id"])
    return level["id"], owner_token


def _slug_attempts(slug):
    level = Level.query.filter_by(slug=slug).first()
    return PlayAttempt.query.filter_by(level_id=level.id).all()


# --- the label thresholds (pure) ---


@pytest.mark.parametrize(
    "rate, label",
    [
        (1.0, "easy"),
        (0.50, "easy"),  # a boundary belongs to the easier label
        (0.4999, "normal"),
        (0.25, "normal"),
        (0.2499, "hard"),
        (0.05, "hard"),
        (0.0499, "very_hard"),
        (0.01, "very_hard"),
        (0.0099, "tas"),
        (0.0, "tas"),
    ],
)
def test_clear_rate_maps_to_the_documented_labels(rate, label):
    assert label_for_clear_rate(rate) == label


def test_no_label_until_enough_attempts():
    assert compute_difficulty_label(MIN_ATTEMPTS_FOR_LABEL - 1, MIN_ATTEMPTS_FOR_LABEL - 1) is None
    assert compute_difficulty_label(MIN_ATTEMPTS_FOR_LABEL, MIN_ATTEMPTS_FOR_LABEL) == "easy"


def test_the_minimum_is_ten_attempts():
    assert MIN_ATTEMPTS_FOR_LABEL == 10


def test_labels_match_the_endless_mode_categories():
    assert DIFFICULTY_LABELS == ENDLESS_DIFFICULTIES


# --- recording attempts through the public endpoints ---


def test_a_registered_players_play_is_recorded_as_an_attempt():
    app, client = _client()
    with app.app_context():
        slug, _owner = _published_level(app, client)
        player = _signup_and_login(app, client, "player", "p@example.com")

        client.post(f"/api/levels/{slug}/play", headers=_auth_headers(player))

        attempts = _slug_attempts(slug)
        assert len(attempts) == 1
        assert attempts[0].source == "direct"
        assert attempts[0].completed_at is None


def test_anonymous_plays_count_on_the_card_but_not_toward_difficulty():
    app, client = _client()
    with app.app_context():
        slug, _owner = _published_level(app, client)

        client.post(f"/api/levels/{slug}/play")
        client.post(f"/api/levels/{slug}/complete")

        level = Level.query.filter_by(slug=slug).first()
        assert level.play_count == 1
        assert level.completion_count == 1
        assert _slug_attempts(slug) == []


def test_a_completion_closes_the_players_open_attempt():
    app, client = _client()
    with app.app_context():
        slug, _owner = _published_level(app, client)
        player = _signup_and_login(app, client, "player", "p@example.com")

        client.post(f"/api/levels/{slug}/play", headers=_auth_headers(player))
        client.post(f"/api/levels/{slug}/complete", headers=_auth_headers(player))

        attempts = _slug_attempts(slug)
        assert len(attempts) == 1
        assert attempts[0].completed_at is not None


def test_every_try_is_its_own_attempt():
    """Cleared on the 5th try = 5 attempts, 1 completion."""
    app, client = _client()
    with app.app_context():
        slug, _owner = _published_level(app, client)
        player = _signup_and_login(app, client, "player", "p@example.com")

        for _ in range(5):
            client.post(f"/api/levels/{slug}/play", headers=_auth_headers(player))
        client.post(f"/api/levels/{slug}/complete", headers=_auth_headers(player))

        attempts = _slug_attempts(slug)
        assert len(attempts) == 5
        assert sum(1 for attempt in attempts if attempt.completed_at is not None) == 1


def test_a_completion_without_a_recorded_start_still_counts_as_a_try():
    app, client = _client()
    with app.app_context():
        slug, _owner = _published_level(app, client)
        player = _signup_and_login(app, client, "player", "p@example.com")

        client.post(f"/api/levels/{slug}/complete", headers=_auth_headers(player))

        attempts = _slug_attempts(slug)
        assert len(attempts) == 1
        assert attempts[0].completed_at is not None


# --- the label itself ---


def test_a_level_is_labeled_once_it_has_ten_registered_attempts():
    app, client = _client()
    with app.app_context():
        slug, _owner = _published_level(app, client)
        player = _signup_and_login(app, client, "player", "p@example.com")

        for _ in range(MIN_ATTEMPTS_FOR_LABEL - 1):
            client.post(f"/api/levels/{slug}/play", headers=_auth_headers(player))
        assert Level.query.filter_by(slug=slug).first().difficulty_label_cached is None

        client.post(f"/api/levels/{slug}/play", headers=_auth_headers(player))
        # 10 attempts, 0 clears: under 1%.
        assert Level.query.filter_by(slug=slug).first().difficulty_label_cached == "tas"


def test_the_label_follows_the_clear_rate():
    app, client = _client()
    with app.app_context():
        slug, _owner = _published_level(app, client)
        player = _signup_and_login(app, client, "player", "p@example.com")

        for _ in range(10):
            client.post(f"/api/levels/{slug}/play", headers=_auth_headers(player))
        assert Level.query.filter_by(slug=slug).first().difficulty_label_cached == "tas"

        # 1 of 10 cleared = 10% -> hard.
        client.post(f"/api/levels/{slug}/complete", headers=_auth_headers(player))
        assert Level.query.filter_by(slug=slug).first().difficulty_label_cached == "hard"

        # Four more tries, each cleared.
        for _ in range(4):
            client.post(f"/api/levels/{slug}/play", headers=_auth_headers(player))
            client.post(f"/api/levels/{slug}/complete", headers=_auth_headers(player))
        # 5 clears / 14 attempts = 35.7% -> normal
        assert Level.query.filter_by(slug=slug).first().difficulty_label_cached == "normal"

        for _ in range(3):
            client.post(f"/api/levels/{slug}/play", headers=_auth_headers(player))
            client.post(f"/api/levels/{slug}/complete", headers=_auth_headers(player))
        # 8 clears / 17 attempts = 47% -> still normal; one more pushes it past 50%.
        assert Level.query.filter_by(slug=slug).first().difficulty_label_cached == "normal"
        client.post(f"/api/levels/{slug}/play", headers=_auth_headers(player))
        client.post(f"/api/levels/{slug}/complete", headers=_auth_headers(player))
        # 9 / 18 = exactly 50% -> easy
        assert Level.query.filter_by(slug=slug).first().difficulty_label_cached == "easy"


def test_anonymous_plays_dont_move_the_label():
    app, client = _client()
    with app.app_context():
        slug, _owner = _published_level(app, client)

        for _ in range(MIN_ATTEMPTS_FOR_LABEL):
            client.post(f"/api/levels/{slug}/play")

        assert Level.query.filter_by(slug=slug).first().difficulty_label_cached is None