"""
Google Gemini captioner.

Uses the new `google-genai` unified SDK (pip install google-genai),
which is the currently recommended package for Gemini 2.x.

Supported models (top 3 SOTA as of 2025):
  gemini-2.5-pro    — most capable, best reasoning + vision
  gemini-2.5-flash  — fast with strong vision, best cost/quality balance
  gemini-2.0-flash  — fast, cost-effective, good for bulk captioning
"""
from __future__ import annotations

from typing import Literal

from .base import BaseCaptioner

_DEFAULT_PROMPT = (
    "Generate a single concise sentence describing the visual content "
    "of this image or animation."
)

GeminiModel = Literal[
    "gemini-2.5-pro",
    "gemini-2.5-flash",
    "gemini-2.0-flash",
]


class GeminiCaptioner(BaseCaptioner):
    def __init__(self, api_key: str, model: GeminiModel = "gemini-2.5-flash") -> None:
        self.model_name = model
        self._api_key   = api_key

    async def generate(
        self,
        image_bytes: bytes,
        system_prompt: str,
        mime_type: str = "image/jpeg",
    ) -> str:
        # Lazy import so missing package only fails at call time
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=self._api_key)

        user_text = system_prompt.strip() or _DEFAULT_PROMPT

        response = await client.aio.models.generate_content(
            model=self.model_name,
            contents=[
                types.Content(
                    role="user",
                    parts=[
                        types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
                        types.Part.from_text(user_text),
                    ],
                )
            ],
            config=types.GenerateContentConfig(
                max_output_tokens=300,
                temperature=0.3,
            ),
        )
        return response.text.strip()
