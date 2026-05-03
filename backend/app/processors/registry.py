from __future__ import annotations

from .base import VideoProcessor

_registry: dict[str, type[VideoProcessor]] = {}


def register(model_id: str):
    """Class decorator that registers a processor under the given model ID."""
    def decorator(cls: type[VideoProcessor]) -> type[VideoProcessor]:
        _registry[model_id.upper()] = cls
        return cls
    return decorator


def get_processor(model_id: str) -> type[VideoProcessor]:
    cls = _registry.get(model_id.upper())
    if cls is None:
        available = list(_registry.keys())
        raise ValueError(
            f"No processor registered for model '{model_id}'. "
            f"Available: {available}"
        )
    return cls


def list_models() -> list[str]:
    return list(_registry.keys())
