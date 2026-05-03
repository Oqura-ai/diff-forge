from enum import Enum
from typing import Optional, List
from pydantic import BaseModel


class ResolutionMode(str, Enum):
    auto = "auto"
    manual = "manual"


class FramesMode(str, Enum):
    auto = "auto"
    strict = "strict"


class ResolutionConfig(BaseModel):
    mode: ResolutionMode = ResolutionMode.auto
    width: Optional[int] = None
    height: Optional[int] = None


class FramesConfig(BaseModel):
    mode: FramesMode = FramesMode.auto
    target: Optional[int] = None


class TransformRequest(BaseModel):
    resolution: ResolutionConfig = ResolutionConfig()
    frames: FramesConfig = FramesConfig()
    splits: Optional[List[float]] = None          # split time-points in seconds
    frame_deletions: Optional[List[int]] = None   # 0-based output frame indices to remove after normalisation
    apply_resolution: bool = True   # skip resolution normalisation when False
    apply_frames: bool = True        # skip frame normalisation when False


class JobStatus(str, Enum):
    pending = "pending"
    processing = "processing"
    done = "done"
    failed = "failed"


class SegmentMeta(BaseModel):
    index: int
    width: int
    height: int
    frame_count: int
    fps: float
    duration_secs: float
    start_secs: float
    end_secs: float
    download_url: str


class JobResponse(BaseModel):
    job_id: str
    status: JobStatus
    progress: int = 0
    message: str = ""
    model: str = ""
    segments: Optional[List[SegmentMeta]] = None
