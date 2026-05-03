# Frontend: Components

## Component Hierarchy

```
app/page.tsx
└── DatasetManager              root — all datasets, history, persistence
    ├── Sidebar                 dataset list, mobile drawer
    ├── MetadataBar             stats, undo/redo, save, export
    └── DatasetView             active dataset — tabs + modals
        │
        ├── [Transform tab]
        │   ├── TransformPanel  config sidebar (resolution, frames, apply)
        │   ├── VideoGrid       grid of MediaCards
        │   │   └── MediaCard   one file — thumbnail, badges, checkbox
        │   ├── PreviewModal    5-sample before/after preview
        │   └── ItemDetailModal full-screen single-file view
        │       └── ItemEditWorkspace
        │           └── FrameGrid     frame thumbnail picker
        │
        └── [Caption tab]
            ├── CaptionPanel    provider config sidebar
            └── CaptionGrid
                └── CaptionDetail  focused caption editor
```

**State ownership**: `DatasetManager` owns all `Dataset[]`. `DatasetView` owns UI state (selected IDs, modal visibility, transform/caption config). Child components receive data and callbacks only — they hold no persistent data.

---

## `DatasetManager.tsx`

The root component. The only component that writes to the history stack and calls persistence.

### State

```typescript
datasets: Dataset[]
past: Dataset[][]        // undo stack, max 50
future: Dataset[][]      // redo stack
selectedId: string | null
uploadOpen: boolean
exportOpen: boolean
validatingId: string | null
```

### Handlers (passed as props throughout the tree)

| Handler | What it does |
|---------|-------------|
| `handleAddDataset(dataset)` | Appends new dataset, auto-selects it, commits |
| `handleDeleteDataset(id)` | Removes dataset, revokes blob URLs, purges IndexedDB |
| `handleApplyTransform(datasetId, config)` | Applies transform config to all files — updates stored metadata |
| `handleApplyTransformToSelected(datasetId, fileIds, config)` | Same for a subset |
| `handleReplaceWithSegments(fileId, newFiles)` | Swaps one file for N segment files (single-file variant) |
| `handleReplaceBatch(replacements)` | Atomic swap for multiple files at once |
| `handleUpdateCaption(fileId, caption)` | Single caption update |
| `handleUpdateCaptionBatch(updates)` | Atomic batch caption update |
| `handleSaveSplits(fileId, splits)` | Persist split config without processing |
| `handleDeleteFiles(fileIds)` | Remove files from active dataset |

**Why `handleReplaceBatch` and `handleUpdateCaptionBatch` exist** — see the [stale closure explanation in algorithms.md](algorithms.md#stale-closure-pattern).

### Validation effect

```typescript
useEffect(() => {
  const file = dataset.files.find(f => !f.validation || f.validation.status === 'pending')
  if (!file) return
  validateDatasetFile(file, modelConfig).then(result => {
    handleSetValidation(file.id, result)
  })
}, [datasets, selectedId])
```

Runs one file at a time in sequence (not in parallel) to avoid hammering the browser with concurrent `HTMLVideoElement` loads.

---

## `DatasetView.tsx`

Manages UI state for the active dataset. Calls handlers from `DatasetManager` — never commits directly.

### State

```typescript
selectedIds: Set<string>          // files selected for batch ops
transformConfig: TransformConfig  // global transform settings
captionConfig: CaptionConfig      // caption provider settings
batchState: BatchState | null     // { completed, total, message } while running
detailFileId: string | null       // file open in ItemDetailModal
editFileId: string | null         // file open in ItemEditWorkspace
activeTab: 'transform' | 'caption'
```

### `runBatch()` — bulk transform

```
1. Collect target files (selected, or all if none selected)
2. Promise.all: for each file:
     upload → poll → download segments → return { fileId, newFiles }
3. onReplaceBatch(allResults)   ← single atomic commit
```

### `runCaptionBatch()` — bulk captioning

```
1. Collect target files
2. Sequential (not parallel — avoids provider rate limits):
     for each file: generateCaption() → collect { fileId, caption }
3. onUpdateCaptionBatch(allUpdates)   ← single atomic commit
```

---

## `TransformPanel.tsx`

Left sidebar for transform configuration. Purely presentational — all state lives in `DatasetView`.

### Sections

1. **Sanity Checks** — errors/warnings from `Dataset.issues`
2. **Resolution** — ON/OFF toggle + `auto`/`manual` segmented control + W/H inputs when manual
3. **Frames** — ON/OFF toggle + `auto`/`strict` segmented control + target input when strict
4. **Apply** — "Apply to all N" or "Apply to X selected" buttons

### ON/OFF toggle pattern

```tsx
<button
  onClick={() => onConfigChange({ ...config, applyResolution: !config.applyResolution })}
  className={cn(
    'text-[10px] px-1.5 py-0.5 rounded border transition-colors font-medium',
    config.applyResolution
      ? 'border-emerald-500/60 text-emerald-500 bg-emerald-500/10'
      : 'border-border text-muted-foreground',
  )}
>
  {config.applyResolution ? 'ON' : 'OFF'}
</button>
```

When OFF, the mode controls are hidden with `{config.applyResolution && <>...</>}`. The config value is preserved — toggling back ON restores the last mode/value.

The Frames section uses `modelConfig.frames.rule !== 'any'` (not a hardcoded `=== '8n+1'`) so the label and messages automatically adapt to any model's frame rule.

---

## `ItemEditWorkspace.tsx`

Full-screen per-item editor. Opens as a Dialog over `DatasetView`.

### Local state

```typescript
itemConfig: TransformConfig     // copy of global config, independently editable
splits: number[]                // split time-points in seconds
processState: ProcessState      // { phase: idle|running|done|error, progress, message }
showFrameGrid: boolean
deletedFrames: Set<number>      // 0-based frame indices marked for removal
```

On mount and on file navigation (`useEffect([file.id])`), `itemConfig` is reinitialised from the global `transformConfig` prop. Changes are local — they do not affect the global config.

### "After Transform" preview

Computed on every render using `computeTransformedMetadata`:

```typescript
const transformed = computeTransformedMetadata(meta, itemConfig, modelConfig, file.type)
// afterWidth, afterHeight, afterFrames — update live as config changes
```

Green border = output will be valid for the target model. Red border = still invalid.

### Processing flow

```
1. handleProcess() → processVideoWithBackend(file, model, itemConfig, splits, deletedFrames)
2. onProgress callback → setProcessState({ phase: 'running', progress, message })
3. On success → onReplaceWithSegments(file.id, newFiles), then setTimeout(onClose, 1200)
4. On error   → setProcessState({ phase: 'error', message })
5. On cancel  → abortRef.current.abort()
```

### AbortController wiring

```typescript
const abortRef = useRef<AbortController | null>(null)

const handleProcess = async () => {
  abortRef.current?.abort()              // cancel any previous job
  const ctrl = new AbortController()
  abortRef.current = ctrl
  // pass ctrl.signal into processVideoWithBackend
}

useEffect(() => () => { abortRef.current?.abort() }, [])  // cleanup on unmount
```

When the signal fires, `pollUntilDone` and `downloadSegment` both check `signal.aborted` and throw `AbortError`. The catch block in `handleProcess` silently returns on `AbortError`.

---

## `FrameGrid.tsx`

Shows all frames of a video after normalisation. Lets the user mark individual frames for deletion before the backend processes the file.

### Props

```typescript
{
  mediaUrl: string           // blob URL of the source video
  fps: number
  durationSecs: number
  sourceFrameCount: number   // original frame count
  targetFrameCount: number   // frame count after snapping to valid value
  deletedFrames: Set<number>
  onDeleteChange: (s: Set<number>) => void
  onClose: () => void
}
```

### How frame mapping works

`bresenhamSourceMap(sourceFrameCount, targetFrameCount)` returns an array of length `targetFrameCount` where each element is the source frame index that maps to that output position. This mirrors the backend's `resample_bresenham()` exactly. Frames that appear more than once are "added by normalisation" (amber border); frames appearing once are "original" (gray border).

### Thumbnail extraction

Uses `OffscreenCanvas` + `videoElement.currentTime` seeks to paint each frame. Thumbnails are extracted in batches of 10 and state is updated per-batch to avoid blocking the main thread.

### Exported helper

```typescript
export function nextValid8n1(n: number, min = 9, max = 257): number
```

Used by `ItemEditWorkspace` to compute the default `targetFrameCount` when the user hasn't set a manual target.

---

## `Sidebar.tsx`

Dataset list with a two-step delete pattern:

```
First click  → arm the dataset (show red confirm state, auto-disarm after 3s)
Second click → execute delete
```

Status icons next to each dataset name:
- Spinner → validation in progress
- Green checkmark → all files valid
- Orange alert → one or more validation errors

Mobile: renders as a slide-out overlay (triggered by a hamburger button in `DatasetView`).

---

## `MetadataBar.tsx`

Horizontal bar at the top of the active dataset view. Shows:
- Dataset name + target model badge
- Validation counts (valid / invalid / pending)
- File type breakdown (videos, images, GIFs, captioned)
- Undo / Redo buttons (desktop only)
- Save + Export buttons

---

## `UploadDialog.tsx`

Folder selection and dataset creation.

`<input webkitdirectory multiple>` opens the OS folder picker. On change, `processUploadedFolder(fileList)` scans files:

1. Separate into supported media and `.txt` files
2. Build `baseName → caption` map from `.txt` files
3. For each media file: create `DatasetFile` with matching caption if present
4. Track unmatched `.txt` files as `SanityIssue { type: 'orphan_txt' }`
5. Track unrecognised files as `SanityIssue { type: 'unsupported_file' }`

---

## `ExportDialog.tsx`

Calls `exportDatasetAsZip(dataset, options, onProgress)` from `lib/export-utils.ts`.

Files are numbered with zero-padded 4-digit indices (`0001_`, `0002_`, …) — the standard format expected by most fine-tuning scripts (Kohya, SimpleTuner, etc.).

---

## `MediaCard.tsx`

One card in `VideoGrid`. Handles:
- **Thumbnail** — `<img>` for images/GIFs, `<video muted loop>` that plays on `onMouseEnter`
- **Format badge** — mp4 / jpg / png / gif
- **Validation badge** — spinner / green check / red error count
- **Caption badge** — "Captioned" or "No caption"
- **Resolution chip** — shown once validation completes
- **Hover delete button** — bottom-right corner
- **Selection checkbox** — appears on hover, stays visible when checked

Cards are keyboard-navigable (`tabIndex={0}`, `onKeyDown`).

---

## `PreviewModal.tsx`

Shows a random sample of up to 5 files with their current and post-transform metadata before the user commits a bulk transform. Lets the user verify settings are correct before running the full batch through the backend.
