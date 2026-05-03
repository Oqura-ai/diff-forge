"""
In-memory job store.

Each transform request creates a Job that tracks status, progress, and output
paths.  This is intentionally simple — swap for Redis/DB when needed.

Thread-safety note: CPython's GIL makes simple dict reads/writes safe across
threads, which is all we do here.  No locking needed for this workload.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from ..schemas.transform import JobStatus


@dataclass
class Job:
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    model: str = ""
    status: JobStatus = JobStatus.pending
    progress: int = 0
    message: str = "Queued"
    input_path: Optional[Path] = None
    output_paths: list[Path] = field(default_factory=list)
    segments_meta: list[dict] = field(default_factory=list)
    error: Optional[str] = None


_store: dict[str, Job] = {}


def create(model: str, input_path: Path) -> Job:
    job = Job(model=model, input_path=input_path)
    _store[job.id] = job
    return job


def get(job_id: str) -> Optional[Job]:
    return _store.get(job_id)


def update(job_id: str, **kwargs: object) -> None:
    job = _store.get(job_id)
    if job:
        for k, v in kwargs.items():
            setattr(job, k, v)


def delete(job_id: str) -> bool:
    return _store.pop(job_id, None) is not None


def all_jobs() -> list[Job]:
    return list(_store.values())
