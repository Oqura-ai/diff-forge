# Setup & Repository Layout

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | 20+ | Frontend dev server and build |
| Python | 3.10+ | FastAPI backend |
| ffmpeg | any recent | Video decode/encode in the processor |
| ffprobe | same as ffmpeg | Video metadata probing (ships with ffmpeg) |

---

## Frontend

```bash
cd frontend
npm install
npm run dev        # → http://localhost:3000
npm run build      # production build
npm run lint       # ESLint
```

**Environment variables** — create `frontend/.env.local`:

```
NEXT_PUBLIC_API_URL=http://localhost:8000   # default; change if backend runs elsewhere
```

---

## Backend

```bash
cd backend
python -m venv .venv

# Activate:
source .venv/bin/activate          # macOS / Linux
.venv\Scripts\activate             # Windows

pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

`--reload` watches for file changes. Remove it in production.

### Docker

```bash
cd backend
docker build -t diffforge-backend .
docker run -p 8000:8000 diffforge-backend
```

---

## Running Both Together

Frontend and backend are completely independent. Start them in two terminals. The frontend calls the backend at `NEXT_PUBLIC_API_URL`; there is no shared build step.

---

## Repository Layout

```
vision-dataset-manager/
│
├── README.md
├── docs/
│   ├── setup.md                   ← you are here
│   ├── architecture.md
│   ├── frontend-state.md
│   ├── frontend-components.md
│   ├── frontend-libs.md
│   ├── backend.md
│   ├── algorithms.md
│   ├── data-flows.md
│   ├── extending.md
│   └── conventions.md
│
├── frontend/
│   ├── assets/
│   │   └── logo.png
│   ├── app/
│   │   ├── layout.tsx             ← HTML shell, fonts, dark mode
│   │   ├── page.tsx               ← renders <DatasetManager />
│   │   └── globals.css
│   │
│   ├── components/
│   │   ├── dataset-manager/       ← all application components (flat)
│   │   │   ├── DatasetManager.tsx
│   │   │   ├── DatasetView.tsx
│   │   │   ├── Sidebar.tsx
│   │   │   ├── MetadataBar.tsx
│   │   │   ├── TransformPanel.tsx
│   │   │   ├── CaptionPanel.tsx
│   │   │   ├── VideoGrid.tsx
│   │   │   ├── MediaCard.tsx
│   │   │   ├── VideoCard.tsx
│   │   │   ├── UploadDialog.tsx
│   │   │   ├── ExportDialog.tsx
│   │   │   ├── ItemDetailModal.tsx
│   │   │   ├── ItemEditWorkspace.tsx
│   │   │   ├── FrameGrid.tsx
│   │   │   └── PreviewModal.tsx
│   │   └── ui/                    ← shadcn/ui primitives — do not edit
│   │
│   ├── lib/
│   │   ├── dataset.ts             ← core types + folder ingest
│   │   ├── model-config.ts        ← model definitions + math
│   │   ├── validation.ts          ← browser-side media validation
│   │   ├── backend-client.ts      ← typed HTTP client for FastAPI
│   │   ├── transform-utils.ts     ← upload → poll → download flow
│   │   ├── caption-client.ts      ← caption API client
│   │   ├── export-utils.ts        ← ZIP packaging + download
│   │   ├── persistence.ts         ← IndexedDB + localStorage
│   │   └── utils.ts               ← cn() helper
│   │
│   ├── package.json
│   ├── tsconfig.json
│   └── next.config.ts
│
└── backend/
    ├── app/
    │   ├── main.py                ← FastAPI app, CORS, route mounting
    │   ├── core/
    │   │   └── config.py          ← Pydantic settings (env vars)
    │   ├── schemas/
    │   │   ├── transform.py       ← Pydantic request/response models
    │   │   └── caption.py
    │   ├── api/
    │   │   └── v1/
    │   │       ├── transform.py   ← transform endpoints + background worker
    │   │       └── caption.py     ← caption endpoint
    │   ├── processors/
    │   │   ├── base.py            ← abstract VideoProcessor + data classes
    │   │   ├── registry.py        ← model ID → class registry
    │   │   └── ltx/
    │   │       ├── processor.py   ← LTX transform pipeline
    │   │       ├── config.py      ← LTX constants
    │   │       └── steps/
    │   │           ├── frame_norm.py
    │   │           └── resolution_norm.py
    │   └── services/
    │       ├── jobs.py            ← in-memory job store
    │       └── captioning/
    │           ├── base.py
    │           ├── media_utils.py
    │           ├── azure.py
    │           ├── openai_provider.py
    │           └── gemini.py
    ├── requirements.txt
    └── Dockerfile
```
