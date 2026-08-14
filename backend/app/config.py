import os


class Config:
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_DATABASE_URI = os.environ.get(
        "DATABASE_URL", "postgresql://localhost/level_builder_dev"
    )


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