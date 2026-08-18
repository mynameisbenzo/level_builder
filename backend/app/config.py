import os

def _normalize_database_url(url: str) -> str:
    """
    Normalizes a database URL to use the psycopg (v3) driver explicitly.
    Some providers (Neon included) hand out URLs starting with the legacy
    "postgres://" scheme, which SQLAlchemy 2.0 no longer accepts directly.
    """
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql://", 1)
    if url.startswith("postgresql://") and "+psycopg" not in url:
        url = url.replace("postgresql://", "postgresql+psycopg://", 1)
    return url


class Config:
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_DATABASE_URI = _normalize_database_url(
        os.environ.get("DATABASE_URL", "postgresql://localhost/level_builder_dev")
    )
    FRONTEND_ORIGIN = os.environ.get("FRONTEND_ORIGIN", "http://localhost:5173")
    
    GITHUB_URL = os.environ.get("GITHUB_URL", "https://github.com/mynameisbenzo/level_builder")
    PORTFOLIO_URL = os.environ.get("PORTFOLIO_URL", "")


class TestingConfig(Config):
    TESTING = True
    SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"


class DevelopmentConfig(Config):
    DEBUG = True


class ProductionConfig(Config):
    pass


config_by_name = {
    "testing": TestingConfig,
    "development": DevelopmentConfig,
    "production": ProductionConfig,
}