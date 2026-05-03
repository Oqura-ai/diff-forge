"""
Azure OpenAI captioner.

Uses the same AzureOpenAI client pattern from the reference implementation
(generate_prompt_azure.py), adapted for async and generalised input.
"""
from __future__ import annotations

import base64

from openai import AsyncAzureOpenAI

from .base import BaseCaptioner

_DEFAULT_SYSTEM = (
    "You are a concise image description assistant. "
    "Generate a single-sentence caption describing the visual content."
)
_MAX_TOKENS = 300


class AzureCaptioner(BaseCaptioner):
    def __init__(
        self,
        endpoint: str,
        deployment: str,
        subscription_key: str,
        api_version: str = "2024-12-01-preview",
    ) -> None:
        self.model_name = deployment
        self._client = AsyncAzureOpenAI(
            azure_endpoint=endpoint,
            api_key=subscription_key,
            api_version=api_version,
        )

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
