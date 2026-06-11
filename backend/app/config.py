from pydantic import model_validator
from pydantic_settings import BaseSettings

# Placeholder secrets that must never be used outside development.
PLACEHOLDER_SECRETS = frozenset(
    {
        "change-me-in-production",
        "change-me-in-production-use-env-var",
    }
)


class Settings(BaseSettings):
    app_name: str = "StarRocks Permission Manager"
    environment: str = "development"  # set SRPM_ENVIRONMENT=production to enforce a real secret
    jwt_secret: str = "change-me-in-production-use-env-var"  # noqa: S105
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60
    cache_ttl_seconds: int = 60
    # Comma-separated list of allowed CORS origins (browser cross-origin reads).
    cors_origins: str = "http://localhost:5173"

    model_config = {"env_prefix": "SRPM_"}

    @property
    def is_default_secret(self) -> bool:
        return self.jwt_secret in PLACEHOLDER_SECRETS

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @model_validator(mode="after")
    def _require_secret_in_production(self) -> "Settings":
        if self.environment.lower() == "production" and self.is_default_secret:
            raise ValueError(
                "SRPM_JWT_SECRET must be set to a strong, non-default value when "
                "SRPM_ENVIRONMENT=production (the default placeholder is not allowed)."
            )
        return self


settings = Settings()
