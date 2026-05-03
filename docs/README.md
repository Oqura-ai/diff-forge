# DiffForge — Contributor Docs

Internal technical reference. Start here and follow links as needed.

| Doc | What you'll learn |
|-----|------------------|
| [setup.md](setup.md) | Dev environment, env vars, commands, full repo layout |
| [architecture.md](architecture.md) | Mental model, system diagram, key design decisions, state ownership table |
| [frontend-state.md](frontend-state.md) | Every type and interface, model configs, math functions, history/undo |
| [frontend-components.md](frontend-components.md) | Component tree, per-component state, handlers, and gotchas |
| [frontend-libs.md](frontend-libs.md) | Every `lib/` module: validation, API client, transform utils, persistence, export |
| [backend.md](backend.md) | All API routes with request/response shapes, LTX processor pipeline, captioning proxy |
| [algorithms.md](algorithms.md) | Bresenham resampling, frame rule snapping, stale closure fix, sprite sheets |
| [data-flows.md](data-flows.md) | End-to-end traces: upload, bulk transform, per-item edit, captioning, export |
| [extending.md](extending.md) | Step-by-step: add a new model or caption provider |
| [conventions.md](conventions.md) | Naming, state rules, backend patterns, common bugs with root causes |

## Suggested reading order

**Completely new to the codebase?**
→ architecture.md → frontend-state.md → frontend-components.md → data-flows.md

**Fixing a bug?**
→ conventions.md (check common bugs first) → relevant component or lib doc

**Adding a new model?**
→ extending.md → algorithms.md (for frame rule math) → backend.md (processor pipeline)

**Adding a caption provider?**
→ extending.md → backend.md (captioning section)
