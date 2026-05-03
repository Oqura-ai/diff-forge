"""
Caption API — v1.

POST /api/v1/caption
    Upload a media file + JSON config, get back a generated caption.

The endpoint accepts a multipart form with two fields:
  file    — the media file (image, GIF, MP4, WebP, …)
  config  — JSON-encoded CaptionRequestConfig

Example config (Azure):
{
  "provider": "azure",
  "system_prompt": "Describe this 2D sprite animation in one sentence.",
  "azure_config": {
    "endpoint": "https://my-resource.openai.azure.com/",
    "deployment": "gpt-4o-mini",
    "subscription_key": "...",
    "api_version": "2024-12-01-preview"
  }
}

Example config (OpenAI):
{
  "provider": "openai",
  "system_prompt": "...",
  "openai_config": { "api_key": "sk-...", "model": "gpt-4o" }
}

Example config (Gemini):
{
  "provider": "gemini",
  "system_prompt": "...",
  "gemini_config": { "api_key": "AIza...", "model": "gemini-2.5-flash" }
}
"""
from __future__ import annotations

import json

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from ...schemas.caption import CaptionProvider, CaptionRequestConfig, CaptionResponse
from ...services.captioning.media_utils import prepare_for_captioning

router = APIRouter(prefix="/caption", tags=["caption"])


@router.post("", response_model=CaptionResponse)
async def generate_caption(
    file:   UploadFile = File(...,  description="Media file to caption"),
    config: str        = Form(...,  description="JSON-encoded CaptionRequestConfig"),
) -> CaptionResponse:
    # ── Parse config ──────────────────────────────────────────────────────────
    try:
        cfg = CaptionRequestConfig(**json.loads(config))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid config: {exc}")

    # ── Read and prepare media ────────────────────────────────────────────────
    file_bytes = await file.read()
    filename   = file.filename or "media.bin"

    try:
        image_bytes, mime_type = prepare_for_captioning(file_bytes, filename)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Media preparation failed: {exc}")

    # ── Build provider captioner ──────────────────────────────────────────────
    try:
        if cfg.provider == CaptionProvider.azure:
            if not cfg.azure_config:
                raise HTTPException(400, "azure_config is required for provider=azure")
            from ...services.captioning.azure import AzureCaptioner
            captioner = AzureCaptioner(
                endpoint=cfg.azure_config.endpoint,
                deployment=cfg.azure_config.deployment,
                subscription_key=cfg.azure_config.subscription_key,
                api_version=cfg.azure_config.api_version,
            )
            model_id = cfg.azure_config.deployment

        elif cfg.provider == CaptionProvider.openai:
            if not cfg.openai_config:
                raise HTTPException(400, "openai_config is required for provider=openai")
            from ...services.captioning.openai_provider import OpenAICaptioner
            captioner = OpenAICaptioner(
                api_key=cfg.openai_config.api_key,
                model=cfg.openai_config.model,
            )
            model_id = cfg.openai_config.model

        elif cfg.provider == CaptionProvider.gemini:
            if not cfg.gemini_config:
                raise HTTPException(400, "gemini_config is required for provider=gemini")
            from ...services.captioning.gemini import GeminiCaptioner
            captioner = GeminiCaptioner(
                api_key=cfg.gemini_config.api_key,
                model=cfg.gemini_config.model,
            )
            model_id = cfg.gemini_config.model

        else:
            raise HTTPException(400, f"Unknown provider: {cfg.provider}")

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(500, f"Captioner init failed: {exc}")

    # ── Generate caption ──────────────────────────────────────────────────────
    try:
        caption = await captioner.generate(image_bytes, cfg.system_prompt, mime_type)
    except Exception as exc:
        raise HTTPException(500, f"Caption generation failed: {exc}")

    return CaptionResponse(
        caption=caption.strip("\""),
        provider=cfg.provider.value,
        model=model_id,
    )
