from flask import Flask
from flask_cors import CORS

from app.config import config_by_name
from app.extensions import db


def create_app(config_name: str = "development") -> Flask:
    app = Flask(__name__)
    app.config.from_object(config_by_name[config_name])

    db.init_app(app)
    CORS(app, origins=[app.config["FRONTEND_ORIGIN"]])

    from app.models import user  # noqa: F401  (registers model with SQLAlchemy)

    @app.get("/health")
    def health_check():
        return {"status": "ok"}

    return app