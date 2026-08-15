from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "postgresql+psycopg://flowops:flowops@localhost:5432/flowops"
    classification_provider: str = "local"
    llm_api_key: str | None = None
    llm_model: str = "gpt-4o-mini"
    llm_base_url: str = "https://api.openai.com/v1"
    n8n_webhook_url: str | None = None
    app_name: str = "FlowOps API"
    log_level: str = "INFO"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()