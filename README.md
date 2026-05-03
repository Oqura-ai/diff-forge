<p align="center">
  <img src="./frontend/assets/logo.png" width="88" alt="DiffForge" />
</p>

<h1 align="center">DiffForge</h1>

<p align="center">
  Local-first dataset management for diffusion model fine-tuning.<br/>
  Ingest · Validate · Transform · Caption · Export
</p>

<p align="center">
<a href="https://github.com/Oqura-ai/diff-forge/stargazers"><img src="https://img.shields.io/github/stars/Oqura-ai/diff-forge?style=flat-square" alt="GitHub Stars"></a>
<a href="https://discord.gg/Q586EsTxjh">
  <img src="https://img.shields.io/badge/Discord-Join%20Community-5865F2?style=flat-square&logo=discord&logoColor=white" alt="Discord Server">
</a>
<a href="https://github.com/Oqura-ai/diff-forge/blob/main/LICENSE"><img src="https://img.shields.io/github/license/Oqura-ai/diff-forge?style=flat-square&color=purple" alt="License"></a>
<a href="https://github.com/Oqura-ai/diff-forge/commits/main"><img src="https://img.shields.io/github/last-commit/Oqura-ai/diff-forge?style=flat-square&color=blue" alt="Last Commit"></a>
<img src="https://img.shields.io/badge/Python-3.9%2B-blue?style=flat-square" alt="Python Version">
<a href="https://github.com/Oqura-ai/diff-forge/graphs/contributors"><img src="https://img.shields.io/github/contributors/Oqura-ai/diff-forge?style=flat-square&color=yellow" alt="Contributors"></a>
</p>

https://github.com/user-attachments/assets/80d7cf64-6d21-4665-b51d-d15630136336

## What It Does

Training a video diffusion model requires datasets where every clip satisfies strict frame-count and resolution rules. Getting there from raw footage is tedious: trim clips, normalize frames, resize to model-specific multiples, add captions, package everything correctly. DiffForge automates all of that in a browser-based editor backed by a local FastAPI service.

## Features

### Smart Ingest
Drop a folder of videos, images, or GIFs. DiffForge scans it, pairs `.txt` sidecar files with their media, flags orphaned captions and unsupported files, and loads everything into an indexed dataset in seconds. Session state persists across reloads via IndexedDB — your work is never lost.

### Model-Aware Validation
Every file is validated against the target model's constraints directly in the browser — no round-trip needed:

| Model | Resolution | Frame Rule | Frame Range |
|-------|-----------|------------|-------------|
| LTX Video | ×32 multiples, min 64px | 8n+1 | 1–257 |
| WAN | ×32 multiples, min 32px | 4n+1 | 1–600 |

Invalid files are flagged with specific issue messages (`Width 854px — not ×32`, `~120 frames — not 8n+1`).

### Bulk Transform
Apply resolution and frame normalisation to your entire dataset in one click:

- **Resolution** — Auto (round to nearest valid multiple) or Manual (explicit W×H)
- **Frames** — Auto (snap to nearest valid count per model rule) or Manual (fixed target)
- Both toggleable independently with ON/OFF switches

A 5-sample preview shows before/after metadata before you commit. Transforms run through the local backend using ffmpeg.

### Per-Item Editor
Open any file in a full-screen workspace for fine-grained control:

- **Item-level transform config** — override the global settings for just this file
- **Frame slicer** — split a clip into segments at arbitrary frame boundaries (manual or evenly-spaced)
- **Frame grid** — visualise every frame after normalisation; click to delete individual frames before encoding
- **Live "After Transform" preview** — resolution and frame count update as you type, immediately showing whether the output will be valid
- Progress updates (%, message) with cancel support

### AI Captioning
Generate text descriptions for every clip using three provider options:

| Provider | Models |
|----------|--------|
| Azure OpenAI | Any deployed vision model |
| OpenAI | gpt-4o, gpt-4.1, gpt-4.1-mini |
| Google Gemini | gemini-2.5-pro, gemini-2.5-flash, gemini-2.0-flash |

DiffForge builds a sprite sheet from up to 8 evenly-spaced frames and sends it to the vision model with a customisable system prompt. Preview 5 samples before running the full batch. Choose "empty only" or "override" mode.

### Dataset Export
Export your finished dataset as a ZIP ready to drop into a training script:

```
my-dataset.zip
├── 0001_clip_name.mp4
├── 0001_clip_name.txt     ← "token, caption text"
├── 0002_another_clip.mp4
├── 0002_another_clip.txt
└── metadata.json
```

Optional trigger word is prepended to every caption automatically.

### Undo / Redo
Every destructive action (transform, delete, caption update) is reversible. A 50-step history stack covers the full session.

## Getting Started

### Prerequisites
- Node.js 20+
- Python 3.10+
- ffmpeg on `$PATH`

### Frontend

```bash
cd frontend
npm install
npm run dev
# → http://localhost:3000
```

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Set `NEXT_PUBLIC_API_URL` in `frontend/.env.local` if the backend runs elsewhere (default: `http://localhost:8000`).

### Running via Docker

```bash
docker-compose -f docker-compose.yaml up --build
```

## Stack

**Frontend** — Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4 · shadcn/ui · JSZip · Lucide

**Backend** — FastAPI · Uvicorn · NumPy · Pillow · ffmpeg

## Model Support

| Model | Status |
|-------|--------|
| LTX Video | Full (transform + export) |
| WAN | Config + validation (processor coming) |

The processor system is pluggable — see [`docs/extending.md`](docs/extending.md) to add support for a new model in ~50 lines.

## Authors

- [Swaraj Biswal](https://github.com/SWARAJ-42)
- [Swadhin Biswal](https://github.com/swadhin505)  


## Contributing

If something here could be improved, please open an issue or submit a pull request.

### License

This project is licensed under the MIT License. See the `LICENSE` file for more details.

