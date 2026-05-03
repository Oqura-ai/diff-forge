"""
OpenAI captioner.

Supported models (top 3 vision-capable SOTA as of 2025):
  gpt-4o        — multimodal flagship, best quality
  gpt-4.1       — stronger reasoning + vision, released early 2025
  gpt-4.1-mini  — fast and cost-effective with vision
"""
from __future__ import annotations

import base64
from typing import Literal

from openai import AsyncOpenAI

from .base import BaseCaptioner

_DEFAULT_SYSTEM = (
    "You are a concise image description assistant. "
    "Generate a single-sentence caption describing the visual content."
)
_MAX_TOKENS = 300

OpenAIModel = Literal["gpt-4o", "gpt-4.1", "gpt-4.1-mini"]


class OpenAICaptioner(BaseCaptioner):
    def __init__(self, api_key: str, model: OpenAIModel = "gpt-4o") -> None:
        self.model_name = model
        self._client = AsyncOpenAI(api_key=api_key)

    async def generate(
        self,
        image_bytes: bytes,
        system_prompt: str,
        mime_type: str = "image/jpeg",
    ) -> str:
        b64 = base64.b64encode(image_bytes).decode()
        system = system_prompt.strip() or _DEFAULT_SYSTEM

        response = await self._client.chat.completions.create(
            model=self.model_name,
            messages=[
                {"role": "system", "content": system},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "Generate a caption for this image or animation."},
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:{mime_type};base64,{b64}"},
                        },
                    ],
                },
            ],
            max_tokens=_MAX_TOKENS,
            temperature=0.3,
        )
        return response.choices[0].message.content.strip()
