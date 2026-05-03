from __future__ import annotations

from abc import ABC, abstractmethod


class BaseCaptioner(ABC):
    """Abstract base for all captioning providers."""

    model_name: str = ""

    @abstractmethod
    async def generate(
        self,
        image_bytes: bytes,
        system_prompt: str,
        mime_type: str = "image/jpeg",
    ) -> str:
        """Generate a caption for the given image bytes."""
        ...
