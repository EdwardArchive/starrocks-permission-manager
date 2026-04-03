from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_name: str = "StarRocks Permission Manager"
    jwt_secret: str = "change-me-in-production-use-env-var"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60
    cache_ttl_seconds: int = 60

    model_config = {"env_prefix": "SRPM_"}


settings = Settings()
