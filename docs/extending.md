# Extending DiffForge

---

## Adding a New Model

Adding a model involves a small frontend change (config + UI) and a new backend processor class.

### 1. Frontend — add the model config

In `frontend/lib/dataset.ts`:
```typescript
export type TargetModel = 'LTX' | 'WAN' | 'MYMODEL'
```

In `frontend/lib/model-config.ts`:
```typescript
export const MODEL_CONFIGS: Record<string, ModelConfig> = {
  // ... existing entries ...
  MYMODEL: {
    id: 'MYMODEL',
    name: 'My Model',
    resolution: { multiple: 16, minWidth: 64, minHeight: 64 },
    frames: { rule: 'any', min: 1, max: 300 },
  },
}
```

If your model uses a new frame rule (e.g. `16n+1`):

```typescript
// dataset.ts
export type FrameRule = '8n+1' | '4n+1' | '16n+1' | 'any'

// model-config.ts
export function nearestValid16n1(frames: number): number {
  return Math.max(1, Math.round((frames - 1) / 16)) * 16 + 1
}

export function nearestValidFrameCount(frames: number, rule: FrameRule): number {
  if (rule === '8n+1')  return nearestValid8n1(frames)
  if (rule === '4n+1')  return nearestValid4n1(frames)
  if (rule === '16n+1') return nearestValid16n1(frames)
  return Math.max(1, frames)
}

export function isValidFrameCount(frameCount: number, c: FrameConstraint): boolean {
  if (frameCount < c.min || frameCount > c.max) return false
  if (c.rule === 'any')   return true
  if (c.rule === '8n+1')  return frameCount % 8  === 1
  if (c.rule === '4n+1')  return frameCount % 4  === 1
  if (c.rule === '16n+1') return frameCount % 16 === 1
  return true
}
```

### 2. Frontend — add to the upload dialog

In `frontend/components/dataset-manager/UploadDialog.tsx`, add a `<SelectItem>`:

```tsx
<SelectItem value="MYMODEL">My Model</SelectItem>
```

That is all for the frontend. Every component reads from `MODEL_CONFIGS` dynamically — labels, frame rule strings, validation messages all adapt automatically. No other files need to change.

### 3. Backend — create the processor

Create `backend/app/processors/mymodel/`:

```
mymodel/
├── __init__.py         (empty)
├── processor.py        (main class)
├── config.py           (constants)
└── steps/              (optional: split out heavy logic)
```

**`processor.py`:**

```python
from app.processors.base import VideoProcessor, ProcessorInput, ProcessorOutput, SegmentOutput
from app.processors.registry import register

@register('MYMODEL')
class MyModelProcessor(VideoProcessor):
    SUPPORTED_EXTENSIONS = {'.mp4', '.mov', '.avi'}

    def process(self, inp: ProcessorInput) -> ProcessorOutput:
        """
        inp.file_path     — absolute path to the uploaded file
        inp.config        — TransformRequest (resolution, frames, splits, etc.)
        inp.model_id      — 'MYMODEL'
        inp.on_progress   — callable(pct: int, message: str)
        """
        inp.on_progress(0, 'Starting…')

        # 1. Probe with ffprobe
        # 2. Decode to numpy frames
        # 3. Apply resolution + frame normalisation per segment
        # 4. Encode each segment with ffmpeg
        # 5. Return SegmentOutput objects

        segments = []
        # … your implementation …
        segments.append(SegmentOutput(
            path='/tmp/…/seg_0.mp4',
            width=832, height=480,
            frame_count=49, fps=24.0,
            duration_secs=2.04,
            segment_index=0,
            start_secs=0.0, end_secs=2.04,
        ))

        inp.on_progress(100, 'Done')
        return ProcessorOutput(segments=segments)
```

You can copy `processors/ltx/processor.py` as a starting point — the ffprobe/ffmpeg shell-out code is reusable.

### 4. Backend — register the processor

In `backend/app/main.py`, add an import:

```python
import app.processors.mymodel.processor   # triggers @register('MYMODEL')
```

The API, job store, polling, download, and cleanup endpoints all work without any changes.

---

## Adding a Caption Provider

### 1. Frontend — add the provider type

In `frontend/lib/caption-client.ts`:

```typescript
// Add to the CaptionProvider type
type CaptionProvider = 'azure' | 'openai' | 'gemini' | 'myprovider'

// Add to the ProviderConfig union
type ProviderConfig =
  | { provider: 'myprovider'; apiKey: string; model: string }
  | // ... existing entries

// Add model list if applicable
export const MYPROVIDER_MODELS = [
  { id: 'model-v1', label: 'My Model v1' },
  { id: 'model-v2', label: 'My Model v2' },
]
```

### 2. Frontend — add to the CaptionPanel UI

In `frontend/components/dataset-manager/CaptionPanel.tsx`:

```tsx
// Add radio option in the Provider section
<label>
  <input type="radio" value="myprovider" ... />
  My Provider
</label>

// Add credential fields (conditionally rendered when myprovider selected)
{captionConfig.provider === 'myprovider' && (
  <div>
    <Input placeholder="API Key" ... />
    <Select /* model dropdown */ ... />
  </div>
)}
```

### 3. Backend — add the schema

In `backend/app/schemas/caption.py`:

```python
class CaptionProvider(str, Enum):
    azure = 'azure'
    openai = 'openai'
    gemini = 'gemini'
    myprovider = 'myprovider'        # ← add

class MyProviderConfig(BaseModel):
    api_key: str
    model: str

class CaptionRequestConfig(BaseModel):
    # ... existing fields ...
    myprovider: MyProviderConfig | None = None   # ← add
```

### 4. Backend — implement the captioner

Create `backend/app/services/captioning/myprovider.py`:

```python
from .base import BaseCaptioner

class MyProviderCaptioner(BaseCaptioner):
    def __init__(self, config: MyProviderConfig):
        self.config = config

    def generate(self, image_bytes: bytes, system_prompt: str, mime_type: str) -> str:
        """
        image_bytes  — JPEG bytes (single image or sprite sheet for video)
        system_prompt — user's custom instruction
        mime_type    — 'image/jpeg'
        Returns the caption string. Strip surrounding quotes if the model adds them.
        """
        import base64
        b64 = base64.b64encode(image_bytes).decode()

        # Call your provider's API here
        response = my_sdk.chat(
            model=self.config.model,
            messages=[
                { "role": "system", "content": system_prompt },
                { "role": "user", "content": [{ "type": "image", "data": b64 }] },
            ]
        )
        return response.text.strip('"\'')
```

### 5. Backend — wire into the route

In `backend/app/api/v1/caption.py`:

```python
from app.services.captioning.myprovider import MyProviderCaptioner

# In the route handler:
elif config.provider == CaptionProvider.myprovider:
    captioner = MyProviderCaptioner(config.myprovider)
```

Done. The rest of the caption pipeline (sprite sheet generation, response trimming, error handling) is shared.
