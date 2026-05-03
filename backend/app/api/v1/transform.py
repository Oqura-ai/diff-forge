"""
Transform API — v1.

POST   /api/v1/transform
    Upload a video + config, start a background job.
    Returns { job_id, status, ... }

GET    /api/v1/transform/{job_id}
    Poll job status / progress.

GET    /api/v1/transform/{job_id}/download/{segment_index}
    Stream the processed MP4 for the given segment (0-based).

DELETE /api/v1/transform/{job_id}
    Clean up job files and remove from store.

GET    /api/v1/transform/models
    List registered model IDs.
"""
from __future__ import annotations

import asyncio
import json
import shutil
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from ...core.config import settings
from ...processors.base import ProcessorInput
from ...processors.registry import get_processor, list_models
from ...schemas.transform import JobResponse, JobStatus, SegmentMeta, TransformRequest
from ...services import jobs as job_store

router = APIRouter(prefix="/transform", tags=["transform"])
_executor = ThreadPoolExecutor(max_workers=settings.max_workers)


# ─── Background worker ────────────────────────────────────────────────────────

def _run_sync(job_id: str, model_id: str, file_path: Path, config: TransformRequest) -> None:
    """Runs the full processor pipeline in a thread-pool thread."""
    processor = get_processor(model_id)()

    def on_progress(pct: int, msg: str) -> None:
        job_store.update(job_id, progress=pct, message=msg)

    job_store.update(job_id, status=JobStatus.processing, message="Starting…")
    result = processor.process(ProcessorInput(
        file_path=file_path,
        config=config,
        model_id=model_id,
        on_progress=on_progress,
    ))

    output_paths = [seg.path for seg in result.segments]
    segments_meta = [
        {
            "index": seg.segment_index,
            "width": seg.width,
            "height": seg.height,
            "frame_count": seg.frame_count,
            "fps": seg.fps,
            "duration_secs": seg.duration_secs,
            "start_secs": seg.start_secs,
            "end_secs": seg.end_secs,
        }
        for seg in result.segments
    ]
    job_store.update(
        job_id,
        status=JobStatus.done,
        progress=100,
        message=f"Processed {len(result.segments)} segment(s)",
        output_paths=output_paths,
        segments_meta=segments_meta,
    )


async def _background(job_id: str, model_id: str, file_path: Path, config: TransformRequest) -> None:
    loop = asyncio.get_running_loop()
    try:
        await loop.run_in_executor(_executor, _run_sync, job_id, model_id, file_path, config)
    except Exception as exc:
        job_store.update(
            job_id,
            status=JobStatus.failed,
            message=str(exc),
            error=str(exc),
        )


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/models", summary="List registered model IDs")
def get_models() -> dict:
    return {"models": list_models()}


@router.post("", response_model=JobResponse, summary="Start a transform job")
async def start_transform(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(..., description="Video file (MP4, MOV, AVI, WEBM)"),
    model: str = Form("LTX", description="Target model ID"),
    config: str = Form("{}", description="JSON-encoded TransformRequest"),
) -> JobResponse:
    # Validate model
    try:
        get_processor(model)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    # Parse transform config
    try:
        cfg = TransformRequest(**json.loads(config))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid config: {exc}")

    # Save uploaded file
    job_id = str(uuid.uuid4())
    work_dir = settings.upload_dir / job_id
    work_dir.mkdir(parents=True)
    ext = Path(file.filename or "video.mp4").suffix.lower() or ".mp4"
    file_path = work_dir / f"input{ext}"

    content = await file.read()
    if len(content) > settings.max_upload_mb * 1_048_576:
        shutil.rmtree(work_dir, ignore_errors=True)
        raise HTTPException(status_code=413, detail="File exceeds size limit")

    file_path.write_bytes(content)

    # Create job record
    job = job_store.create(model=model, input_path=file_path)

    background_tasks.add_task(_background, job.id, model, file_path, cfg)

    return JobResponse(
        job_id=job.id,
        status=job.status,
        model=model,
        message="Job queued",
    )


@router.get("/{job_id}", response_model=JobResponse, summary="Poll job status")
def get_job(job_id: str) -> JobResponse:
    job = job_store.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")

    segments = None
    if job.status == JobStatus.done and job.segments_meta:
        segments = [
            SegmentMeta(
                **meta,
                download_url=f"/api/v1/transform/{job_id}/download/{meta['index']}",
            )
            for meta in job.segments_meta
        ]

    return JobResponse(
        job_id=job.id,
        status=job.status,
        progress=job.progress,
        message=job.message,
        model=job.model,
        segments=segments,
    )


@router.get(
    "/{job_id}/download/{segment_index}",
    summary="Download a processed segment",
    response_class=FileResponse,
)
def download_segment(job_id: str, segment_index: int = 0) -> FileResponse:
    job = job_store.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status != JobStatus.done:
        raise HTTPException(status_code=400, detail=f"Job not done (status: {job.status})")
    if segment_index >= len(job.output_paths):
        raise HTTPException(status_code=404, detail=f"Segment {segment_index} not found")

    path = job.output_paths[segment_index]
    if not path.exists():
        raise HTTPException(status_code=404, detail="Output file missing from disk")

    fname = f"processed_seg{segment_index}.mp4" if len(job.output_paths) > 1 else "processed.mp4"
    return FileResponse(path=path, media_type="video/mp4", filename=fname)


@router.delete("/{job_id}", summary="Clean up a job and its files")
def delete_job(job_id: str) -> dict:
    job = job_store.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")

    if job.input_path and job.input_path.parent.exists():
        shutil.rmtree(job.input_path.parent, ignore_errors=True)

    job_store.delete(job_id)
    return {"deleted": job_id}
