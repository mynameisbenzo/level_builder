import os

from flask import Flask, jsonify, render_template
from flask_cors import CORS
from flask_jwt_extended import JWTManager

from app.config import config_by_name
from app.extensions import db, migrate

TECH_STACK = [
    "SvelteKit",
    "Phaser 4",
    "Flask",
    "PostgreSQL (Neon)",
    "Render",
    "GitHub Actions",
]


def create_app(config_name: str = "development") -> Flask:
    if config_name == "production" and not os.environ.get("JWT_SECRET_KEY"):
        raise RuntimeError(
            "JWT_SECRET_KEY must be set in the environment when running under "
            "the production config - refusing to start with a random, "
            "regenerated-on-every-restart secret in production."
        )

    app = Flask(__name__)
    app.config.from_object(config_by_name[config_name])

    db.init_app(app)
    migrate.init_app(app, db)
    CORS(app, origins=[app.config["FRONTEND_ORIGIN"]])
    jwt = JWTManager(app)

    @jwt.unauthorized_loader
    def handle_missing_jwt(reason: str):
        return jsonify({"error": reason}), 401

    @jwt.invalid_token_loader
    def handle_invalid_jwt(reason: str):
        return jsonify({"error": reason}), 401

    @jwt.expired_token_loader
    def handle_expired_jwt(_jwt_header, _jwt_payload):
        return jsonify({"error": "token has expired"}), 401

    from app.models.email_verification import EmailVerificationToken  # noqa: F401
    from app.models.endless import EndlessLifeLoss, EndlessRun, EndlessRunLevel  # noqa: F401
    from app.models.level import Level  # noqa: F401
    from app.models.level_ghost import LevelGhost  # noqa: F401
    from app.models.level_playtime import LevelPlaytime  # noqa: F401
    from app.models.level_record import LevelRecord  # noqa: F401
    from app.models.level_rating import LevelRating  # noqa: F401
    from app.models.login_link_request import LoginLinkRequest  # noqa: F401
    from app.models.login_token import LoginToken  # noqa: F401
    from app.models.play_attempt import PlayAttempt  # noqa: F401
    from app.models.refresh_token import RefreshToken  # noqa: F401
    from app.models.twitch_signup_token import TwitchSignupToken  # noqa: F401
    from app.models.user import User  # noqa: F401

    from app.api.auth import auth_bp
    from app.api.endless import endless_bp
    from app.api.ghosts import ghosts_bp
    from app.api.levels import levels_bp
    from app.api.playtime import playtime_bp
    from app.api.race import race_bp
    from app.api.users import users_bp

    app.register_blueprint(users_bp)
    app.register_blueprint(auth_bp)
    app.register_blueprint(levels_bp)
    app.register_blueprint(endless_bp)
    app.register_blueprint(ghosts_bp)
    app.register_blueprint(playtime_bp)
    app.register_blueprint(race_bp)

    from app.cli import register_cli

    register_cli(app)
    
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