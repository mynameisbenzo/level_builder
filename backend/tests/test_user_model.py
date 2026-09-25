from app.extensions import db
from app.main import create_app
from app.models.user import User


def test_can_create_and_query_a_user():
    app = create_app("testing")

    with app.app_context():
        db.create_all()

        user = User(username="lorenzo", email="l@example.com")
        db.session.add(user)
        db.session.commit()

        found = User.query.filter_by(username="lorenzo").first()

        assert found is not None
        assert found.username == "lorenzo"


def test_public_id_is_auto_generated_and_distinct_from_the_internal_id():
    app = create_app("testing")

    with app.app_context():
        db.create_all()

        user = User(username="lorenzo", email="l@example.com")
        db.session.add(user)
        db.session.commit()

        assert user.public_id is not None
        assert user.public_id != str(user.id)
        # XXXX-XXXX-XXXX-XXXX
        assert len(user.public_id) == 19
        assert user.public_id.count("-") == 3


def test_public_id_is_unique_across_users():
    app = create_app("testing")

    with app.app_context():
        db.create_all()

        first = User(username="userone", email="one@example.com")
        second = User(username="usertwo", email="two@example.com")
        db.session.add_all([first, second])
        db.session.commit()

        assert first.public_id != second.public_id