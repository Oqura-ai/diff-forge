# Key Algorithms

---

## Bresenham Frame Resampling

Used in two places that **must stay in sync**:
- Frontend: `bresenhamSourceMap()` in `components/dataset-manager/FrameGrid.tsx`
- Backend: `resample_bresenham()` in `processors/ltx/steps/frame_norm.py`

The algorithm distributes `target` output frames across `source` input frames as evenly as possible, without using floating-point division.

### Python (backend)

```python
def resample_bresenham(frames: list, target: int) -> list:
    n = len(frames)
    result = []
    error = 0
    for _ in range(target):
        result.append(frames[error // target])
        error += n
        if error >= target:
            error -= target
    return result
```

### TypeScript (frontend)

```typescript
export function bresenhamSourceMap(source: number, target: number): number[] {
  const map: number[] = []
  let error = 0
  for (let i = 0; i < target; i++) {
    map.push(Math.floor(error / target))
    error += source
    if (error >= target) error -= target
  }
  return map
}
```

### What it produces

```
source = 5 frames [A, B, C, D, E], target = 8
→ [A, A, B, B, C, C, D, E]   (upsampling — A and B each appear twice)

source = 5 frames [A, B, C, D, E], target = 3
→ [A, C, E]                   (downsampling — B and D skipped)
```

Properties:
- No frame is ever fully skipped when upsampling
- No two consecutive output frames differ by more than one source position
- Integer arithmetic only — identical results on any platform

### Why this matters for the FrameGrid

`FrameGrid.tsx` shows each output frame with a border colour indicating whether it is "original" (appears once) or "added by normalisation" (appears more than once, amber border). This visual is computed from `bresenhamSourceMap` — the same mapping the backend will use. What you see is exactly what gets encoded.

---

## Frame Rule Snapping

### Rules

| Rule | Valid condition | Example valid values |
|------|----------------|---------------------|
| `8n+1` | `n % 8 === 1` | 1, 9, 17, 25, 33, 41, 49, 57 … |
| `4n+1` | `n % 4 === 1` | 1, 5, 9, 13, 17, 21, 25, 29 … |
| `any` | always | any positive integer |

### Nearest-valid functions

```typescript
// frontend/lib/model-config.ts
function nearestValid8n1(n: number): number {
  return Math.max(1, Math.round((n - 1) / 8)) * 8 + 1
}

function nearestValid4n1(n: number): number {
  return Math.max(1, Math.round((n - 1) / 4)) * 4 + 1
}
```

```python
# backend/processors/ltx/steps/frame_norm.py
def next_8n1(n, min_val=1, max_val=257):
    return max(min_val, round((n - 1) / 8)) * 8 + 1
```

### Examples

```
nearestValid8n1(120) → round((120-1)/8)=round(14.875)=15 → 15*8+1=121   ✓
nearestValid8n1(49)  → round((49-1)/8)=round(6)=6        → 6*8+1=49     ✓ (no change)
nearestValid4n1(120) → round((120-1)/4)=round(29.75)=30  → 30*4+1=121   ✓
nearestValid4n1(17)  → round((17-1)/4)=round(4)=4        → 4*4+1=17     ✓ (no change)
```

---

## Stale Closure Pattern

This is the most important React pattern in the codebase. Get it wrong and batch operations silently lose data.

### The problem

React's `useState` setter closes over the current value at the time the closure is created. In an async loop:

```typescript
// WRONG
for (const file of files) {
  const segments = await processFile(file)
  onReplaceWithSegments(file.id, segments)
  // Each call reads 'datasets' from when THIS closure was created.
  // The second call overwrites the first — stale closure.
}
```

By the time the second `onReplaceWithSegments` fires, `datasets` inside `DatasetManager` still holds the pre-first-call value (because React batches state updates). The first replacement is silently lost.

### The fix

Collect all results synchronously after the async work, then commit once:

```typescript
// CORRECT
const results = await Promise.all(files.map(async (file) => {
  const segments = await processFile(file)
  return { fileId: file.id, newFiles: segments }
}))
onReplaceBatch(results)   // single commit, reads current 'datasets' once
```

This is why `DatasetManager` has separate `handleReplaceBatch` and `handleUpdateCaptionBatch` handlers. Any time you add a new batch async operation, use the same pattern.

---

## Two-Step Delete

The sidebar delete button uses an arm-then-confirm pattern to prevent accidental dataset deletion.

```typescript
const [armedId, setArmedId] = useState<string | null>(null)
const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

const handleDeleteClick = (id: string) => {
  if (armedId === id) {
    // Second click — execute
    clearTimeout(timerRef.current!)
    setArmedId(null)
    onDeleteDataset(id)
  } else {
    // First click — arm
    if (timerRef.current) clearTimeout(timerRef.current)
    setArmedId(id)
    timerRef.current = setTimeout(() => setArmedId(null), 3000)
  }
}
```

Armed state: button turns red and shows "Confirm". Auto-disarms after 3 seconds if not confirmed.

---

## Sprite Sheet Construction (Captioning)

When sending a video to a vision model for captioning, DiffForge extracts up to 8 evenly-spaced frames and composes them into a horizontal sprite sheet.

```python
# Select frame indices evenly across the video
n_frames = min(8, total_frames)
indices = [int(i * (total_frames - 1) / (n_frames - 1)) for i in range(n_frames)]

# Extract via ffmpeg
ffmpeg -i input -vf "select=eq(n\,{i0})+eq(n\,{i1})..." -vsync 0 frame_%03d.jpg

# Compose
sheet = Image.new('RGB', (frame_w * n_frames, frame_h))
for i, frame in enumerate(frames):
    sheet.paste(frame.resize((frame_w, frame_h), Resampling.LANCZOS), (i * frame_w, 0))
```

The result is a single JPEG showing the full temporal arc of the clip. Vision models accept a single image — this is the standard technique for giving them video context.
