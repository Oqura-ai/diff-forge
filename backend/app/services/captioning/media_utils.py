"""
Prepare media files for vision model captioning.

- Images:   resize to ≤1024px on the long side and return as JPEG.
- Video/GIF (first_frame mode): extract the first frame as JPEG.
- Video/GIF (all_frames mode):  extract N evenly-spaced frames and compose a
                                 grid sheet. Cells that could not be filled
                                 (video shorter than requested frame count) are
                                 padded with white.
"""
from __future__ import annotations

import io
import math
import subprocess
import tempfile
from pathlib import Path
from typing import TYPE_CHECKING

from PIL import Image

if TYPE_CHECKING:
    from ...schemas.caption import FrameSheetConfig

_MAX_IMAGE_PX    = 1024
_DEFAULT_FRAME_H = 128  # per-frame height used when no explicit dimensions given


def prepare_for_captioning(
    file_bytes: bytes,
    filename: str,
    frame_config: "FrameSheetConfig | None" = None,
) -> tuple[bytes, str]:
    """Return (image_bytes, mime_type) suitable for sending to a vision model."""
    from ...schemas.caption import CaptionMode, FrameSheetConfig

    ext = Path(filename).suffix.lower()
    cfg = frame_config or FrameSheetConfig()

    if ext in {".mp4", ".mov", ".avi", ".webm", ".gif", ".webp"}:
        if cfg.mode == CaptionMode.first_frame:
            result = _make_first_frame(file_bytes, ext, cfg)
        else:
            result = _make_sprite_sheet(file_bytes, ext, cfg)
        return result, "image/jpeg"

    # Still image — mode/frame settings don't apply
    img = Image.open(io.BytesIO(file_bytes)).convert("RGB")
    img = _maybe_resize(img, _MAX_IMAGE_PX)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=88)
    return buf.getvalue(), "image/jpeg"


# ─── First frame ──────────────────────────────────────────────────────────────

def _make_first_frame(file_bytes: bytes, ext: str, cfg: "FrameSheetConfig") -> bytes:
    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        tmp.write(file_bytes)
        tmp_path = Path(tmp.name)
    try:
        frames = _extract_first_frame(tmp_path)
    finally:
        tmp_path.unlink(missing_ok=True)

    if not frames:
        raise RuntimeError("Could not extract the first frame from the media file")

    img = Image.open(io.BytesIO(frames[0])).convert("RGB")
    if cfg.frame_width is not None or cfg.frame_height is not None:
        img = _apply_dimensions(img, cfg)
    else:
        img = _maybe_resize(img, _MAX_IMAGE_PX)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=88)
    return buf.getvalue()


def _extract_first_frame(path: Path) -> list[bytes]:
    with tempfile.TemporaryDirectory() as tmp_dir:
        out_path = str(Path(tmp_dir) / "frame0001.jpg")
        subprocess.run(
            ["ffmpeg", "-i", str(path), "-frames:v", "1", "-q:v", "3", out_path],
            capture_output=True, timeout=30,
        )
        f = Path(out_path)
        return [f.read_bytes()] if f.exists() else []


# ─── Sprite sheet (grid layout only) ─────────────────────────────────────────

def _make_sprite_sheet(file_bytes: bytes, ext: str, cfg: "FrameSheetConfig") -> bytes:
    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        tmp.write(file_bytes)
        tmp_path = Path(tmp.name)
    try:
        frames = _extract_frames(tmp_path, cfg.frame_count)
    finally:
        tmp_path.unlink(missing_ok=True)

    if not frames:
        raise RuntimeError("Could not extract any frames from the media file")

    images = [Image.open(io.BytesIO(b)).convert("RGB") for b in frames]

    if cfg.frame_width is not None or cfg.frame_height is not None:
        images = [_apply_dimensions(img, cfg) for img in images]
    else:
        # Auto-size: give each frame a reasonable pixel budget
        per_frame_max = max(64, _MAX_IMAGE_PX // max(1, len(images)) * 2)
        images = [_maybe_resize(img, per_frame_max) for img in images]

    return _compose_grid(images, cfg)


def _compose_grid(images: list[Image.Image], cfg: "FrameSheetConfig") -> bytes:
    n    = len(images)
    cols = cfg.grid_cols or max(1, math.ceil(math.sqrt(n)))
    rows = cfg.grid_rows or max(1, math.ceil(n / cols))

    # Normalise all frames to the same cell size (first frame as reference)
    cell_w = images[0].width
    cell_h = images[0].height
    normalized = [img.resize((cell_w, cell_h), Image.LANCZOS) for img in images]

    # Pad with white when the video was shorter than the requested frame count
    total_cells = rows * cols
    if len(normalized) < total_cells:
        white = Image.new("RGB", (cell_w, cell_h), (255, 255, 255))
        normalized += [white] * (total_cells - len(normalized))

    sheet = Image.new("RGB", (cols * cell_w, rows * cell_h), (255, 255, 255))
    for i, img in enumerate(normalized[:total_cells]):
        r, c = divmod(i, cols)
        sheet.paste(img, (c * cell_w, r * cell_h))

    buf = io.BytesIO()
    sheet.save(buf, format="JPEG", quality=85)
    return buf.getvalue()


# ─── Frame extraction ─────────────────────────────────────────────────────────

def _extract_frames(path: Path, n: int) -> list[bytes]:
    """Extract up to n evenly-spaced frames using the ffmpeg thumbnail filter."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        out_pattern = str(Path(tmp_dir) / "frame%04d.jpg")
        cmd = [
            "ffmpeg", "-i", str(path),
            "-vsync", "0",
            "-vf", f"thumbnail={max(1, _count_frames(path) // n)},scale=-1:{_DEFAULT_FRAME_H}",
            "-frames:v", str(n),
            "-q:v", "3",
            out_pattern,
        ]
        subprocess.run(cmd, capture_output=True, timeout=60)
        frame_files = sorted(Path(tmp_dir).glob("*.jpg"))

        if not frame_files:
            # Fallback: grab first N frames if thumbnail filter produced nothing
            cmd_fallback = [
                "ffmpeg", "-i", str(path),
                "-vsync", "0",
                "-vf", f"scale=-1:{_DEFAULT_FRAME_H}",
                "-frames:v", str(n),
                "-q:v", "3",
                out_pattern,
            ]
            subprocess.run(cmd_fallback, capture_output=True, timeout=60)
            frame_files = sorted(Path(tmp_dir).glob("*.jpg"))

        return [f.read_bytes() for f in frame_files]


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _apply_dimensions(img: Image.Image, cfg: "FrameSheetConfig") -> Image.Image:
    """Resize to explicit cfg dimensions, preserving aspect ratio when only one axis is set."""
    if cfg.frame_width and cfg.frame_height:
        return img.resize((cfg.frame_width, cfg.frame_height), Image.LANCZOS)
    if cfg.frame_width:
        h = max(1, int(img.height * cfg.frame_width / img.width))
        return img.resize((cfg.frame_width, h), Image.LANCZOS)
    if cfg.frame_height:
        w = max(1, int(img.width * cfg.frame_height / img.height))
        return img.resize((w, cfg.frame_height), Image.LANCZOS)
    return img


def _count_frames(path: Path) -> int:
    """Quick ffprobe frame count (best-effort, defaults to 100)."""
    try:
        import json
        r = subprocess.run(
            ["ffprobe", "-v", "quiet", "-select_streams", "v:0",
             "-show_entries", "stream=nb_frames", "-of", "json", str(path)],
            capture_output=True, text=True, timeout=10,
        )
        data = json.loads(r.stdout)
        nb = data.get("streams", [{}])[0].get("nb_frames", "")
        return max(1, int(nb)) if nb and nb != "N/A" else 100
    except Exception:
        return 100


def _maybe_resize(img: Image.Image, max_px: int) -> Image.Image:
    if max(img.width, img.height) <= max_px:
        return img
    scale = max_px / max(img.width, img.height)
    return img.resize(
        (max(1, int(img.width * scale)), max(1, int(img.height * scale))),
        Image.LANCZOS,
    )
