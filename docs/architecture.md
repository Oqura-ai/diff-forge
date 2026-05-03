# Architecture & Mental Model

## The Big Picture

Before reading individual files, understand the overall shape of the system.

**The browser holds all state.** There is no user account, no server-side session, no database. Every dataset, every file reference, every transform config lives in React state inside `DatasetManager` and is periodically serialised to IndexedDB so it survives page reloads.

**The backend is a dumb worker.** It receives a video file, transforms it, and exposes the output for download. It holds no persistent state — jobs are in-memory and deleted after download. If you restart the backend mid-job, that job is lost (the frontend will show an error and you can retry).

**Transforms are pull-based.** The frontend uploads the file, polls for completion, then downloads each output segment as a `Blob`. Once downloaded, it creates new `DatasetFile` objects with blob URLs and replaces the original in React state. The backend can then be cleaned up.

**Validation runs in the browser.** Frame count, resolution, and model constraints are checked using `HTMLVideoElement` / `HTMLImageElement` / binary GIF parsing — no backend call needed. This makes the validation panel instant.

**Captioning goes directly to the AI provider.** The backend acts as a thin proxy — it extracts frames, composes a sprite sheet, and forwards the image to Azure/OpenAI/Gemini with your configured credentials. No captions are stored server-side.

---

## System Diagram

```
┌─────────────────────────────────────────────────────┐
│                   Browser (Next.js)                 │
│                                                     │
│  ┌──────────────────────────────────────────────┐   │
│  │ DatasetManager  (root state + history)       │   │
│  │  datasets[]  past[]  future[]                │   │
│  │  commit() → IndexedDB (debounced 500ms)      │   │
│  └───────────────┬──────────────────────────────┘   │
│                  │ props + callbacks                 │
│  ┌───────────────▼──────────────────────────────┐   │
│  │ DatasetView  (active dataset UI)             │   │
│  │  transformConfig  captionConfig              │   │
│  │  selectedIds  batchState                     │   │
│  │  ┌────────────┐  ┌──────────────────────┐   │   │
│  │  │TransformTab│  │   Caption Tab         │   │   │
│  │  │TransformPnl│  │CaptionPanel           │   │   │
│  │  │VideoGrid   │  │CaptionGrid            │   │   │
│  │  └────────────┘  └──────────────────────┘   │   │
│  └──────────────────────────────────────────────┘   │
│                                                     │
│  Persistence: IndexedDB (File blobs) + localStorage │
└──────────────────────┬──────────────────────────────┘
                       │ HTTP  localhost:8000
┌──────────────────────▼──────────────────────────────┐
│                  FastAPI Backend                     │
│                                                     │
│  POST   /api/v1/transform         start job         │
│  GET    /api/v1/transform/{id}    poll status       │
│  GET    /api/v1/transform/{id}/download/{n}         │
│  DELETE /api/v1/transform/{id}    cleanup           │
│                                                     │
│  Processor registry                                 │
│  ├── LTX  (ffprobe → decode → resample → encode)   │
│  └── WAN  (coming soon)                             │
│                                                     │
│  POST /api/v1/caption                               │
│  └── sprite sheet → Azure / OpenAI / Gemini        │
└─────────────────────────────────────────────────────┘
```

---

## Key Design Decisions

### Why no server-side persistence?
DiffForge is a local tool. Keeping state in the browser removes the need for a database, authentication, or server management. Everything is yours, on your machine.

### Why poll instead of websockets?
Polling (every 800ms) is simpler to implement, debug, and deploy. For the job durations involved (seconds to a few minutes), the latency difference is imperceptible.

### Why does the backend re-encode with ffmpeg instead of streaming the original?
The processor needs to decode all frames into numpy arrays to apply the Bresenham resample and resolution normalisation. Re-encoding with libx264 is unavoidable. CRF 18 is visually lossless for training data.

### Why is captioning proxied through the backend instead of called directly from the browser?
API keys should not live in browser-side code. The backend receives the config (including credentials) per-request — nothing is stored.

### Why `commit()` instead of `setState()` directly?
Every mutation to `datasets` goes through `commit()`. This is the single chokepoint that pushes to the undo stack and schedules persistence. Direct `setState` would silently bypass history and persistence.

---

## State Ownership at a Glance

| State | Lives in | Persists |
|-------|---------|---------|
| `datasets[]` | `DatasetManager` | IndexedDB + localStorage |
| Undo / redo stacks | `DatasetManager` | Session only |
| Active dataset selection | `DatasetManager` | Session only |
| Transform config (global) | `DatasetView` | Session only |
| Caption config | `DatasetView` | Session only |
| Selected file IDs | `DatasetView` | Session only |
| Per-item transform config | `ItemEditWorkspace` | Session only (resets on nav) |
| Split points | `DatasetFile.splits` via `handleSaveSplits` | IndexedDB |
| Caption text | `DatasetFile.caption` via `handleUpdateCaption` | IndexedDB |
