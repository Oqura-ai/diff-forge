# Backend

The backend is a FastAPI application with two concerns: video transformation (async, job-based) and caption generation (synchronous proxy to AI providers).

Base URL: `http://localhost:8000`

---

## Application Entry — `main.py`

```python
app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3000"], ...)

# Mount routers
app.include_router(transform_router, prefix="/api/v1")
app.include_router(caption_router,   prefix="/api/v1")

# Health check
@app.get("/health")
def health():
    return { "status": "healthy", "registered_models": list_models() }
```

Processors are registered at import time via the `@register` decorator. `main.py` imports each processor module to trigger registration.

---

## Transform API — `api/v1/transform.py`

### `POST /api/v1/transform` — start a job

**Request** (`multipart/form-data`):
- `file` — the video file
- `model` — string, e.g. `"LTX"`
- `config` — JSON-encoded `TransformRequest`

```json
{
  "resolution": { "mode": "auto" },
  "frames":     { "mode": "auto" },
  "splits":          [3.5, 7.2],
  "frame_deletions": [5, 10],
  "apply_resolution": true,
  "apply_frames":     true
}
```

**What happens:**
1. Save uploaded file to `/tmp/diffforge_{job_id}/input.{ext}`
2. Create `Job(status=pending)` in job store
3. Dispatch `_background(job_id, ...)` as a background task (thread pool)
4. Return `JobResponse` immediately

**Response:**
```json
{ "job_id": "abc123", "status": "pending", "progress": 0, "segments": [] }
```

---

### `GET /api/v1/transform/{job_id}` — poll status

Returns current `JobResponse`. Poll every 800ms from the frontend.

```json
// While running:
{ "job_id": "abc123", "status": "processing", "progress": 45, "message": "Encoding segment 1/3" }

// When done:
{
  "job_id": "abc123",
  "status": "done",
  "progress": 100,
  "segments": [
    {
      "index": 0,
      "width": 832, "height": 480,
      "frame_count": 49, "fps": 24.0,
      "duration_secs": 2.04,
      "start_secs": 0.0, "end_secs": 2.04,
      "download_url": "/api/v1/transform/abc123/download/0"
    }
  ]
}
```

---

### `GET /api/v1/transform/{job_id}/download/{segment_index}`

Streams the output MP4 as `video/mp4`. The frontend downloads each segment by index after the job reaches `done`.

---

### `DELETE /api/v1/transform/{job_id}`

Deletes temp files and removes the job record. Called by the frontend after all segments are downloaded. Fire-and-forget — the frontend does not await this.

---

### `GET /api/v1/transform/models`

Returns `["LTX", "WAN"]` (whatever is registered in the processor registry).

---

### Background worker — `_background()`

```python
async def _background(job_id, file_path, model_id, config):
    update_job(job_id, status=JobStatus.processing)
    processor = get_processor(model_id)()   # instantiate
    output = await run_in_executor(
        None,
        processor.process,
        ProcessorInput(file_path, config, model_id, on_progress=lambda p, m: update_job(job_id, progress=p, message=m))
    )
    update_job(job_id, status=JobStatus.done, segments_meta=[...], output_paths=[...])
```

`run_in_executor(None, ...)` runs the blocking processor in the default thread pool, keeping the event loop free.

---

## Caption API — `api/v1/caption.py`

### `POST /api/v1/caption`

**Request** (`multipart/form-data`):
- `file` — the media file (video, image, or GIF)
- `config` — JSON-encoded `CaptionRequestConfig`

```json
{
  "provider": "openai",
  "system_prompt": "Describe this video clip in detail...",
  "openai": { "api_key": "sk-...", "model": "gpt-4o" }
}
```

**Flow:**
1. `prepare_for_captioning(file_bytes, filename)` → `(image_bytes, mime_type)`
2. Route by `config.provider`:
   - `azure`  → `AzureCaptioner(config.azure)`
   - `openai` → `OpenAICaptioner(config.openai)`
   - `gemini` → `GeminiCaptioner(config.gemini)`
3. `caption = captioner.generate(image_bytes, system_prompt, mime_type)`
4. Return `CaptionResponse(caption=caption.strip('"\''), ...)`

**Response:**
```json
{ "caption": "A person walks through a sunlit park...", "provider": "openai", "model": "gpt-4o" }
```

---

## Processing Pipeline — LTX Processor

Located at `processors/ltx/processor.py`. Registered as `"LTX"` via `@register('LTX')`.

### Step 1 — Probe

```bash
ffprobe -v quiet -print_format json -show_streams input.mp4
```

Extracts: `width`, `height`, `r_frame_rate` (rational string like `"24/1"` or `"24000/1001"`), `nb_frames`.

FPS parsing tries multiple fallbacks (`r_frame_rate` → `avg_frame_rate` → default 30).

### Step 2 — Decode

```bash
ffmpeg -i input.mp4 -f rawvideo -pix_fmt rgb24 pipe:1
```

Output piped as raw bytes → reshaped to `(N, H, W, 3)` numpy array. All frames in memory.

### Step 3 — Build segment boundaries

```python
split_frames = [int(t * fps) for t in config.splits]
boundaries = [0] + split_frames + [total_frames]
segments = [(boundaries[i], boundaries[i+1]) for i in range(len(boundaries)-1)]
```

If `splits` is empty, there is one segment: the full clip.

### Step 4 — Per-segment processing

For each `(start_frame, end_frame)`:

**a) Slice**
```python
frames = all_frames[start_frame:end_frame]
```

**b) Frame normalisation** (if `apply_frames` is true)
```python
from .steps.frame_norm import next_8n1, resample_bresenham
target = next_8n1(len(frames), min=FRAME_MIN, max=FRAME_MAX)
frames = resample_bresenham(frames, target)
```

**c) Frame deletions** (if any were requested)
```python
frames = [f for i, f in enumerate(frames) if i not in frame_deletions_set]
```

**d) Resolution normalisation** (if `apply_resolution` is true)
```python
from .steps.resolution_norm import compute_target_resolution, normalize_resolution
target_w, target_h = compute_target_resolution(config.resolution, src_w, src_h, multiple=32)
frames = [normalize_resolution(f, target_w, target_h) for f in frames]
```

**e) Encode**
```bash
ffmpeg -f rawvideo -pix_fmt rgb24 -s {W}x{H} -r {FPS} -i pipe:0
       -c:v libx264 -preset fast -crf 18 output_segment_N.mp4
```

Frames are piped in as raw bytes. `CRF 18` is visually lossless.

### `frame_norm.py`

`next_8n1(n, min, max)` — Python equivalent of `nearestValid8n1`:
```python
return max(min_val, round((n - 1) / 8)) * 8 + 1
```

`resample_bresenham(frames, target_count)` — see [algorithms.md](algorithms.md#bresenham-frame-resampling).

### `resolution_norm.py`

`normalize_resolution(frame, target_w, target_h)`:
- PIL `Image.resize(Lanczos)` to fit within target dimensions
- Black letterbox padding if aspect ratio doesn't match
- Returns numpy array (H, W, 3)

---

## Services — `services/jobs.py`

In-memory job store. Swap for Redis if you need multi-process or persistence across restarts.

```python
@dataclass
class Job:
    id: str
    model: str
    status: JobStatus          # pending | processing | done | failed
    progress: int              # 0–100
    message: str
    input_path: str
    output_paths: list[str]
    segments_meta: list[dict]
    error: str | None
```

Functions: `create(model, input_path)`, `get(job_id)`, `update(job_id, **kwargs)`, `delete(job_id)`, `all_jobs()`.

---

## Services — `services/captioning/media_utils.py`

`prepare_for_captioning(file_bytes, filename) → (image_bytes, mime_type)`:

**Still images**: resize to ≤1024px on the long side (Lanczos), return as JPEG.

**Videos and GIFs**:
```python
# Extract up to 8 evenly-spaced frames:
ffmpeg -i input -vf "select=..." -vsync 0 frame_%03d.jpg

# Build horizontal sprite sheet:
sheet_w = frame_w * num_frames
sheet = Image.new('RGB', (sheet_w, frame_h))
for i, frame in enumerate(frames):
    sheet.paste(frame, (i * frame_w, 0))
# Return as JPEG
```

Sprite sheets let single-image vision models (GPT-4V, Gemini) see temporal information from a video.

---

## Schemas

### `schemas/transform.py`

```python
class ResolutionMode(str, Enum):
    auto = 'auto'
    manual = 'manual'

class FramesMode(str, Enum):
    auto = 'auto'
    strict = 'strict'

class TransformRequest(BaseModel):
    resolution: ResolutionConfig
    frames: FramesConfig
    splits: list[float] = []
    frame_deletions: list[int] = []
    apply_resolution: bool = True
    apply_frames: bool = True
```

### `schemas/caption.py`

```python
class CaptionProvider(str, Enum):
    azure = 'azure'
    openai = 'openai'
    gemini = 'gemini'

class CaptionRequestConfig(BaseModel):
    provider: CaptionProvider
    system_prompt: str
    azure: AzureConfig | None = None
    openai: OpenAIConfig | None = None
    gemini: GeminiConfig | None = None
```
