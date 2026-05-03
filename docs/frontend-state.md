# Frontend: State & Data Types

All core types live in `frontend/lib/dataset.ts` and `frontend/lib/model-config.ts`. Read these two files before anything else.

---

## `lib/dataset.ts`

### Primitive types

```typescript
type TargetModel = 'LTX' | 'WAN'
type MediaType   = 'video' | 'image' | 'gif'
```

Supported file extensions per type:
- `video` → `.mp4`
- `image` → `.jpg`, `.jpeg`, `.png`
- `gif`   → `.gif`, `.webp` (animated WebP treated as GIF)

### `MediaMetadata`

```typescript
interface MediaMetadata {
  width: number
  height: number
  frameCount: number
  durationSecs?: number   // undefined for still images
}
```

Populated by `lib/validation.ts` using browser Web APIs. The backend also produces this shape in `SegmentMeta` (via ffprobe), which is more accurate for frame counts.

### `ValidationIssue`

```typescript
interface ValidationIssue {
  type: 'resolution_width' | 'resolution_height' | 'frame_count' | 'load_error'
  message: string   // shown directly in the UI, e.g. "Width 854px — not ×32"
}
```

### `ValidationResult`

```typescript
interface ValidationResult {
  metadata: MediaMetadata
  issues: ValidationIssue[]
  isValid: boolean
  status: 'pending' | 'validated' | 'error'
}
```

`status: 'error'` means the file could not be loaded at all (corrupt file, unsupported codec). Files with `status: 'error'` are not retried by the validation loop.

### `DatasetFile`

```typescript
interface DatasetFile {
  id: string                // crypto.randomUUID() — stable across reloads
  name: string              // filename without extension
  type: MediaType
  file: File                // the actual browser File object (stored in IndexedDB)
  caption: string | null    // content of the .txt sidecar, or null
  mediaUrl: string          // blob: URL — INVALID after page reload (see below)
  validation?: ValidationResult
  splits?: number[]         // split time-points in seconds (video only)
}
```

**Critical**: `mediaUrl` is a `blob:` URL created with `URL.createObjectURL(file)`. It is only valid in the current browser session. On page reload, `persistence.ts` recreates all blob URLs from the `File` objects stored in IndexedDB. Never store a blob URL anywhere except in memory.

### `Dataset`

```typescript
interface Dataset {
  id: string
  name: string
  description: string
  targetModel: TargetModel
  files: DatasetFile[]
  issues: SanityIssue[]     // folder-level warnings from ingest
  createdAt: string         // ISO timestamp
  triggerWord?: string      // prepended to every caption on export
}
```

### `SanityIssue`

```typescript
interface SanityIssue {
  severity: 'error' | 'warning'
  type: 'orphan_txt' | 'unsupported_file' | 'empty_dataset'
  fileName: string
  message: string
}
```

These are produced by `processUploadedFolder()` during ingest and shown in the TransformPanel's Sanity Checks section. They describe folder-level problems (e.g. a `.txt` file with no matching media), not per-file validation issues.

---

## `lib/model-config.ts`

### `FrameRule`

```typescript
type FrameRule = '8n+1' | '4n+1' | 'any'
```

| Rule | Valid condition | Nearest-valid function |
|------|----------------|----------------------|
| `8n+1` | `n % 8 === 1` | `nearestValid8n1(n)` |
| `4n+1` | `n % 4 === 1` | `nearestValid4n1(n)` |
| `any` | always true | identity |

### `TransformConfig`

```typescript
interface TransformConfig {
  resolution: {
    mode: 'auto' | 'manual'
    width?: number             // used when mode === 'manual'
    height?: number
  }
  frames: {
    mode: 'auto' | 'strict'
    target?: number            // used when mode === 'strict'
  }
  applyResolution: boolean     // ON/OFF toggle — when false, resolution is not changed
  applyFrames: boolean         // ON/OFF toggle — when false, frame count is not changed
}
```

`TransformConfig` is used in two scopes:
- **Global** — held in `DatasetView.transformConfig`, applies to all files in the bulk transform
- **Per-item** — local state in `ItemEditWorkspace.itemConfig`, applies to one file only

Both scopes share the identical type and are processed by the same `computeTransformedMetadata()` function.

### `MODEL_CONFIGS`

```typescript
export const MODEL_CONFIGS: Record<string, ModelConfig> = {
  LTX: {
    id: 'LTX',
    name: 'LTX Video',
    resolution: { multiple: 32, minWidth: 64, minHeight: 64 },
    frames: { rule: '8n+1', min: 1, max: 257 },
  },
  WAN: {
    id: 'WAN',
    name: 'WAN',
    resolution: { multiple: 32, minWidth: 32, minHeight: 32 },
    frames: { rule: '4n+1', min: 1, max: 600 },
  },
}
```

Every component that needs model constraints reads from here. Adding a new model is a one-line config addition — see [`extending.md`](extending.md).

### Math functions

`nearestMultiple(value, multiple)` — round to nearest multiple, minimum one multiple:
```
nearestMultiple(854, 32) → 864
nearestMultiple(30, 32)  → 32   (floor is one multiple, not zero)
```

`nearestValid8n1(n)` — nearest integer satisfying `n ≡ 1 (mod 8)`:
```
nearestValid8n1(120) → 113   (14×8+1)
nearestValid8n1(49)  → 49    (already valid: 6×8+1)
```

`nearestValid4n1(n)` — nearest integer satisfying `n ≡ 1 (mod 4)`:
```
nearestValid4n1(120) → 121   (30×4+1)
nearestValid4n1(17)  → 17    (already valid: 4×4+1)
```

`computeTransformedMetadata(meta, cfg, model, fileType)` — the canonical transform function. The browser preview and the backend both use this exact logic:

```
if applyResolution:
    if mode === 'auto':
        width  = nearestMultiple(width,  model.resolution.multiple)
        height = nearestMultiple(height, model.resolution.multiple)
    elif mode === 'manual':
        width  = cfg.resolution.width  ?? width
        height = cfg.resolution.height ?? height

if applyFrames AND fileType is video or gif:
    if mode === 'auto':
        frameCount = nearestValidFrameCount(frameCount, model.frames.rule)
    elif mode === 'strict' AND target set:
        frameCount = cfg.frames.target
```

Returns updated `MediaMetadata`. Never mutates the input.

---

## History & Undo

`DatasetManager` holds:
```typescript
past: Dataset[][]    // max 50 entries
future: Dataset[][]
```

`commit(newDatasets)`:
1. Push current `datasets` onto `past` (pop oldest if > 50)
2. Clear `future`
3. Set `datasets = newDatasets`
4. Schedule debounced IndexedDB save (500ms)

`undo()`: pop from `past`, push current to `future`, update `datasets`
`redo()`: pop from `future`, push current to `past`, update `datasets`

**Every** change to `datasets` goes through `commit()`. If you add a new handler that modifies dataset data, it must call `commit()` — never call `setDatasets()` directly.
