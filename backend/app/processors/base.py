"""
Base classes for all video processors.

To add a new model (e.g. WAN):
  1. Create  app/processors/wan/processor.py
  2. Decorate the class with  @register("WAN")
  3. Import it in  app/processors/__init__.py

That's it — no other changes needed.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional

from ..schemas.transform import TransformRequest


@dataclass
class ProcessorInput:
    file_path: Path
    config: TransformRequest
    model_id: str
    on_progress: Optional[Callable[[int, str], None]] = None


@dataclass
class SegmentOutput:
    path: Path
    width: int
    height: int
    frame_count: int
    fps: float
    duration_secs: float
    segment_index: int
    start_secs: float = 0.0
    end_secs: float = 0.0


@dataclass
class ProcessorOutput:
    segments: list[SegmentOutput] = field(default_factory=list)


class VideoProcessor(ABC):
    """
    Abstract base for a model-specific video transform processor.

    Subclasses must set:
        model_id              str  – e.g. "LTX"
        supported_extensions  set  – e.g. {".mp4", ".mov"}
    """

    model_id: str = ""
    supported_extensions: set[str] = {".mp4", ".mov", ".avi", ".webm"}

    @abstractmethod
    def process(self, inp: ProcessorInput) -> ProcessorOutput:
        """Run the full transform pipeline and return output segment paths."""
        ...

    @classmethod
    def accepts(cls, ext: str) -> bool:
        return ext.lower() in cls.supported_extensions
