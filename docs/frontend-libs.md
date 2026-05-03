# Frontend: Library Modules

All modules live in `frontend/lib/`. They contain no React — pure TypeScript logic, types, and API calls.

---

## `dataset.ts`

Core types (see [`frontend-state.md`](frontend-state.md)) plus folder ingest.

### `processUploadedFolder(files: FileList): { files: DatasetFile[], issues: SanityIssue[] }`

Called by `UploadDialog` when the user picks a folder.

```
1. Iterate all FileList entries
2. Sort into: supported media | .txt | unsupported
3. Build map: baseName → caption text  (from .txt files)
4. For each media file:
     id = crypto.randomUUID()
     mediaUrl = URL.createObjectURL(file)
     caption = captionMap.get(baseName) ?? null
     push DatasetFile
5. For each unmatched .txt: push SanityIssue { type: 'orphan_txt' }
6. For each unsupported file: push SanityIssue { type: 'unsupported_file' }
```

---

## `model-config.ts`

Model definitions and all math. See [`frontend-state.md`](frontend-state.md) for the type definitions.

The key function is `computeTransformedMetadata` — the single source of truth for what a transformed file's dimensions will be. Both the browser preview (in `ItemEditWorkspace`) and the backend processor use this same logic (Python equivalent in `ltx/processor.py`). If you change the transform logic, change it in both places.

---

## `validation.ts`

Browser-side validation using Web APIs. Zero network calls.

### `validateDatasetFile(file: DatasetFile, model: ModelConfig): Promise<ValidationResult>`

**Images** (jpg/jpeg/png):
```javascript
const img = new Image()
img.src = URL.createObjectURL(file.file)
await new Promise(resolve => { img.onload = resolve })
// width = img.naturalWidth, height = img.naturalHeight
// frameCount = 1, durationSecs = undefined
```

**GIF frame counting** — scans for Graphic Control Extension blocks:
```javascript
// Binary pattern: 0x21 0xF9 = GCE marker in GIF format
for (let i = 0; i < bytes.length - 1; i++) {
  if (bytes[i] === 0x21 && bytes[i+1] === 0xF9) count++
}
```

**WebP frame counting** — parses RIFF chunks:
```javascript
// "RIFF" at offset 0, "WEBP" at offset 8
// Each animation frame is an ANMF chunk (0x414E4D46)
```

**Video** (mp4):
```javascript
const video = document.createElement('video')
video.src = URL.createObjectURL(file.file)
await new Promise(resolve => { video.onloadedmetadata = resolve })
// width = video.videoWidth, height = video.videoHeight
// frameCount ≈ Math.round(video.duration * fps)
```

Note: browser frame count is an **approximation**. The backend uses ffprobe for exact values and will use those when creating the replacement `DatasetFile` after processing.

After extracting metadata, issues are generated:
- `resolution_width` if `width % model.resolution.multiple !== 0`
- `resolution_height` if `height % model.resolution.multiple !== 0`
- `frame_count` if `model.frames.rule !== 'any' && !isValidFrameCount(frameCount, model.frames)`

---

## `backend-client.ts`

Typed HTTP wrapper around the FastAPI endpoints.

```typescript
const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'
```

### Functions

**`startTransformJob(file, model, config)`** → `Promise<JobResponse>`

POST `/api/v1/transform` as `multipart/form-data`:
- `file`: the File object
- `model`: string (e.g. `"LTX"`)
- `config`: `JSON.stringify(TransformRequestPayload)`

```typescript
interface TransformRequestPayload {
  resolution: { mode: 'auto' | 'manual'; width?: number; height?: number }
  frames: { mode: 'auto' | 'strict'; target?: number }
  splits?: number[]           // time-points in seconds
  frame_deletions?: number[]  // 0-based frame indices to delete
  apply_resolution: boolean
  apply_frames: boolean
}
```

**`getTransformJob(jobId)`** → `Promise<JobResponse>`

GET `/api/v1/transform/{jobId}`

**`downloadSegment(jobId, segIdx)`** → `Promise<Blob>`

GET `/api/v1/transform/{jobId}/download/{segIdx}` — returns raw MP4 bytes as a Blob.

**`cleanupJob(jobId)`** → `Promise<void>`

DELETE `/api/v1/transform/{jobId}` — fire and forget.

**`pollUntilDone(jobId, onUpdate, signal, interval = 800)`** → `Promise<JobResponse>`

```typescript
while (true) {
  if (signal?.aborted) throw new DOMException('AbortError', 'AbortError')
  const job = await getTransformJob(jobId)
  onUpdate(job)
  if (job.status === 'done' || job.status === 'failed') return job
  await sleep(interval)
}
```

---

## `transform-utils.ts`

Orchestrates the full upload → poll → download → new-file-creation flow.

### `processVideoWithBackend(options)`

```typescript
{
  file: DatasetFile
  model: string
  config: TransformConfig
  splits: number[]
  frameDeletions?: number[]
  signal?: AbortSignal
  onProgress: (pct: number, msg: string) => void
}
```

**Flow:**

```
1. startTransformJob(file.file, model, payload)
   → payload maps TransformConfig to TransformRequestPayload
   → returns { job_id }

2. pollUntilDone(job_id, onUpdate, signal)
   → onUpdate fires onProgress(job.progress, job.message) on each tick
   → resolves with completed JobResponse containing segments[]

3. For each segment in segments[]:
     blob = await downloadSegment(job_id, seg.index)
     newFile = new File([blob], segmentName, { type: 'video/mp4' })
     mediaUrl = URL.createObjectURL(newFile)
     Push DatasetFile with:
       - metadata from seg (width, height, frame_count, fps, duration_secs)
       - validation: { status: 'validated', isValid: true, issues: [] }
       - caption: original file's caption (carried forward)

4. cleanupJob(job_id)   ← no await, fire and forget

5. return newFiles[]
```

Throws on abort or backend failure. The caller (`DatasetView.runBatch`) handles both.

---

## `caption-client.ts`

### Types

```typescript
type CaptionProvider = 'azure' | 'openai' | 'gemini'

type ProviderConfig =
  | { provider: 'azure';  endpoint: string; deployment: string; subscriptionKey: string; apiVersion: string }
  | { provider: 'openai'; apiKey: string; model: 'gpt-4o' | 'gpt-4.1' | 'gpt-4.1-mini' }
  | { provider: 'gemini'; apiKey: string; model: 'gemini-2.5-pro' | 'gemini-2.5-flash' | 'gemini-2.0-flash' }
```

### `generateCaption(file, providerConfig, systemPrompt)`

POST `/api/v1/caption` as `multipart/form-data`:
- `file`: the media file
- `config`: `JSON.stringify({ provider, system_prompt, [provider]: providerConfig })`

Returns the caption string. The backend strips leading/trailing quotes from the model's response.

---

## `export-utils.ts`

### `exportDatasetAsZip(dataset, options, onProgress)`

```typescript
options: { triggerWord?: string }
onProgress: (completed: number, total: number) => void
```

**Flow:**

```
1. Dynamic import of 'jszip' (lazy — keeps initial bundle small)
2. For each file in dataset.files:
     - Index padded to 4 digits: 0001, 0002, …
     - zip.file(`${idx}_${name}.mp4`, file.file.arrayBuffer())
     - If caption: zip.file(`${idx}_${name}.txt`, triggerText)
       where triggerText = triggerWord ? `${triggerWord}, ${caption}` : caption
3. zip.file('metadata.json', JSON.stringify(metaArray))
4. blob = await zip.generateAsync({ type: 'blob' })
5. <a download href=URL.createObjectURL(blob)>.click()
```

`onProgress` is called after each file is added, letting `ExportDialog` show a progress bar.

---

## `persistence.ts`

### Storage layout

| Data | Store | Key |
|------|-------|-----|
| Dataset metadata | localStorage | `vdm-datasets` |
| File binaries (File objects) | IndexedDB `DiffForgeDB` v1, store `files` | `file.id` |
| Blob URLs | not stored — recreated on load | — |

### `saveDatasets(datasets)`

Serialises each `Dataset` to JSON, replacing `file` (not serialisable) with `null` and `mediaUrl` with `''`. Stores each `File` object in IndexedDB under its UUID.

### `loadDatasets()`

Reads metadata from localStorage, then reads each `File` from IndexedDB, recreates `URL.createObjectURL(file)` for each one. Returns reconstructed `Dataset[]`.

### `purgeDatasetFiles(fileIds, mediaUrls)`

Called when a dataset is deleted:
1. `URL.revokeObjectURL(url)` for each blob URL — frees browser memory
2. Delete each file ID from IndexedDB

### Why debounced save?

`commit()` can fire rapidly (e.g. typing in a caption field). Debouncing to 500ms means IndexedDB writes happen at most twice per second instead of on every keystroke.

---

## `utils.ts`

```typescript
import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

Used everywhere for conditional Tailwind class composition. `twMerge` ensures conflicting classes (e.g. `p-2 p-4`) resolve to the last one rather than both applying.
