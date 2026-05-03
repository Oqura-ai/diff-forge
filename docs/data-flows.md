# Data Flows

End-to-end traces for every major operation.

---

## Upload a Dataset

```
User clicks "New Dataset"
  → UploadDialog opens

User picks a folder
  → <input webkitdirectory> fires onChange
  → processUploadedFolder(fileList)
      Pairs .txt sidecars with media files
      Returns { files: DatasetFile[], issues: SanityIssue[] }
  → Scan results shown: N videos, M images, K orphan captions

User fills name / description / target model → Submit
  → handleAddDataset(dataset)
  → DatasetManager.commit([...datasets, dataset])
  → debounced save to IndexedDB + localStorage
  → selectedId = dataset.id

Validation effect fires (DatasetManager useEffect)
  → For each file without validation:
      validateDatasetFile(file, modelConfig)   ← browser Web APIs, no network
      → handleSetValidation(file.id, result)
      → commit (ValidationResult stored in file.validation)
  → Runs one file at a time until all validated
```

---

## Bulk Transform

```
User configures TransformPanel
  → DatasetView.transformConfig updates (no commit — local UI state)

User clicks "Apply to all N" (or selects files first)
  → DatasetView.runBatch() starts
  → batchState = { completed: 0, total: N, message: 'Starting…' }

For each file (Promise.all — parallel):
  1. backend-client.startTransformJob(file.file, model, payload)
       POST /api/v1/transform  multipart/form-data
       → { job_id }

  2. backend-client.pollUntilDone(job_id, onUpdate, signal)
       GET /api/v1/transform/{id}  every 800ms
       → onUpdate fires batchState.message = job.message
       → resolves when status === 'done'

  3. For each segment in job.segments[]:
       blob = downloadSegment(job_id, seg.index)
       newFile = new File([blob], name, { type: 'video/mp4' })
       Create DatasetFile with metadata from seg, carry forward caption

  4. Return { fileId: file.id, newFiles }

Collect all results, then:
  → onReplaceBatch(allResults)         ← single commit
  → DatasetManager replaces originals, purges old blob URLs
  → batchState = null
```

---

## Per-Item Edit & Process

```
User opens ItemEditWorkspace for a file
  → itemConfig = copy of global transformConfig
  → splits = file.splits ?? []

User adjusts itemConfig (resolution mode, frames target, etc.)
  → computeTransformedMetadata() runs on every render
  → "After Transform" panel updates live

User stages splits (FrameSlicerPanel)
  → splits state updates locally
  → "Splits summary" badges update

User optionally opens FrameGrid
  → bresenhamSourceMap() maps source → output frames
  → User clicks frames to add to deletedFrames set

User clicks "Process video"
  → handleSaveSplits(file.id, splits)   ← persist split config
  → processVideoWithBackend({ file, itemConfig, splits, deletedFrames, signal, onProgress })
      upload → poll → download segments (same as bulk, but for one file)
  → setProcessState({ phase: 'running', progress, message }) on each tick
  → On success:
      onReplaceWithSegments(file.id, newFiles)   ← commit
      setTimeout(onClose, 1200)
  → On error: show error state
  → On cancel: abortRef.current.abort()
```

---

## AI Captioning

```
User opens Caption tab
  → Selects provider (Azure / OpenAI / Gemini)
  → Fills credentials + chooses model
  → Writes system prompt
  → Selects sampling mode (empty-only | override)
  → No commits yet — all local UI state in CaptionPanel

User clicks "Preview 5 samples"
  → Pick 5 random files (or 5 without captions in empty-only mode)
  → Run caption generation for each, show results in PreviewModal
  → User can cancel or proceed

User clicks "Generate for all" (or "Generate selected")
  → DatasetView.runCaptionBatch() starts
  → Sequential (not parallel — avoids rate limits):
      for each target file:
        generateCaption(file.file, providerConfig, systemPrompt)
          POST /api/v1/caption  multipart/form-data
          Backend: prepare_for_captioning() → sprite sheet JPEG
          Backend: call Azure/OpenAI/Gemini with sprite + system prompt
          Return caption string
        Collect { fileId, caption }
        Update batchState.completed++

  → onUpdateCaptionBatch(allUpdates)   ← single commit
  → Caption badges update to green "Captioned"
```

---

## Export

```
User opens ExportDialog
  → Shows stats: N files, M captioned

User sets trigger word (optional)
  → onUpdateTriggerWord(word) → commit (stored in dataset.triggerWord)

User clicks "Export"
  → exportDatasetAsZip(dataset, { triggerWord }, onProgress)
      Dynamic import of jszip
      For each file (index i, 1-based, padded to 4 digits):
        zip.file(`${idx}_${name}.mp4`, file.file.arrayBuffer())
        if caption:
          text = triggerWord ? `${triggerWord}, ${caption}` : caption
          zip.file(`${idx}_${name}.txt`, text)
      zip.file('metadata.json', JSON.stringify([...]))
      onProgress(i, total) → progress bar updates
      blob = await zip.generateAsync({ type: 'blob' })
      <a href=blob download=datasetName.zip>.click()

→ Browser save dialog opens
→ User downloads dataset_name.zip
```

---

## Persistence — Save/Load Cycle

### On every `commit()`

```
DatasetManager.commit(newDatasets)
  → setDatasets(newDatasets)
  → push to history
  → clearTimeout(saveTimer)
  → saveTimer = setTimeout(() => saveDatasets(newDatasets), 500)
```

### `saveDatasets()` detail

```
For each dataset:
  serialise to JSON (File → null, mediaUrl → '')

For each file across all datasets:
  IndexedDB.put(file.id, file.file)   ← stores the binary File object

localStorage.setItem('vdm-datasets', JSON.stringify(serialised))
```

### On page load (`DatasetManager useEffect([])`)

```
loadDatasets()
  → JSON.parse(localStorage.getItem('vdm-datasets'))
  → For each file:
      file.file = await IndexedDB.get(file.id)
      file.mediaUrl = URL.createObjectURL(file.file)
  → return reconstructed Dataset[]

setDatasets(loaded)
→ Validation effect fires for any file with status 'pending'
```
