from flask import Flask, render_template
from flask_cors import CORS

from app.config import config_by_name
from app.extensions import db

TECH_STACK = [
    "SvelteKit",
    "Phaser 4",
    "Flask",
    "PostgreSQL (Neon)",
    "Render",
    "GitHub Actions",
]


def create_app(config_name: str = "development") -> Flask:
    app = Flask(__name__)
    app.config.from_object(config_by_name[config_name])

    db.init_app(app)
    CORS(app, origins=[app.config["FRONTEND_ORIGIN"]])

    from app.models import user  # noqa: F401  (registers model with SQLAlchemy)

    @app.get("/")
    def landing_page():
        return render_template(
            "index.html",
            tech_stack=TECH_STACK,
            frontend_url=app.config["FRONTEND_ORIGIN"],
            github_url=app.config["GITHUB_URL"],
            portfolio_url=app.config["PORTFOLIO_URL"],
        )

    @app.get("/health")
    def health_check():
        return {"status": "ok"}

    return app