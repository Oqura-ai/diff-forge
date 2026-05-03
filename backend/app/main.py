from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Import processors package so all @register decorators fire before any
# request hits the API.
import app.processors  # noqa: F401

from app.api.v1.transform import router as transform_router
from app.api.v1.caption   import router as caption_router

app = FastAPI(
    title="DiffForge API",
    version="0.1.0",
    description="Modular video transform backend. Supports LTX 2.3 today; "
                "add new models by dropping a processor under app/processors/.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(transform_router, prefix="/api/v1")
app.include_router(caption_router,   prefix="/api/v1")


@app.get("/", tags=["health"])
def root():
    return {"status": "ok"}


@app.get("/health", tags=["health"])
def health():
    from app.processors.registry import list_models
    return {"status": "healthy", "registered_models": list_models()}
