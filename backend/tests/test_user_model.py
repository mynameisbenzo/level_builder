from app.extensions import db
from app.main import create_app
from app.models.user import User


def test_can_create_and_query_a_user():
    app = create_app("testing")

    with app.app_context():
        db.create_all()

        user = User(username="lorenzo")
        db.session.add(user)
        db.session.commit()

        found = User.query.filter_by(username="lorenzo").first()

        assert found is not None
        assert found.username == "lorenzo"