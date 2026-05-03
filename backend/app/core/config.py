from pathlib import Path
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    upload_dir: Path = Path("/tmp/vdm/uploads")
    output_dir: Path = Path("/tmp/vdm/outputs")
    max_upload_mb: int = 500
    max_workers: int = 2  # parallel transform jobs

    model_config = {"env_prefix": "VDM_"}


settings = Settings()
settings.upload_dir.mkdir(parents=True, exist_ok=True)
settings.output_dir.mkdir(parents=True, exist_ok=True)
