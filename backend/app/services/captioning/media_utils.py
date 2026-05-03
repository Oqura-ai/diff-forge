"""
Prepare media files for vision model captioning.

- Images:  resize to ≤1024px on the long side and return as JPEG.
- GIF / video:  extract up to 8 evenly-spaced frames and compose a
                horizontal sprite sheet — gives the model the full
                animation context in a single image.
"""
from __future__ import annotations

import io
import subprocess
import tempfile
from pathlib import Path

from PIL import Image

_MAX_IMAGE_PX  = 1024   # long side limit for still images
_SPRITE_FRAMES = 8      # number of frames to include in a sprite sheet
_SPRITE_HEIGHT = 128    # height of each frame cell in the sprite sheet


def prepare_for_captioning(
    file_bytes: bytes,
    filename: str,
) -> tuple[bytes, str]:
    """
    Return (image_bytes, mime_type) suitable for sending to a vision model.
    """
    ext = Path(filename).suffix.lower()

    if ext in {".mp4", ".mov", ".avi", ".webm", ".gif", ".webp"}:
        sheet = _make_sprite_sheet(file_bytes, ext)
        return sheet, "image/jpeg"

    # Still image path
    img = Image.open(io.BytesIO(file_bytes)).convert("RGB")
    img = _maybe_resize(img, _MAX_IMAGE_PX)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=88)
    return buf.getvalue(), "image/jpeg"


# ─── Sprite sheet ─────────────────────────────────────────────────────────────

def _make_sprite_sheet(file_bytes: bytes, ext: str) -> bytes:
    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        tmp.write(file_bytes)
        tmp_path = Path(tmp.name)

    try:
        frames = _extract_frames(tmp_path, _SPRITE_FRAMES)
    finally:
        tmp_path.unlink(missing_ok=True)

    if not frames:
        raise RuntimeError("Could not extract any frames from the media file")

    images = [Image.open(io.BytesIO(b)).convert("RGB") for b in frames]
    images = [_maybe_resize(img, _MAX_IMAGE_PX // _SPRITE_FRAMES * 2) for img in images]

    h      = min(img.height for img in images)
    scaled = [img.resize((int(img.width * h / img.height), h), Image.LANCZOS) for img in images]
    total_w = sum(img.width for img in scaled)

    # Cap total width so the sheet doesn't exceed what models can handle
    if total_w > _MAX_IMAGE_PX * 2:
        ratio  = (_MAX_IMAGE_PX * 2) / total_w
        scaled = [img.resize((max(1, int(img.width * ratio)), max(1, int(img.height * ratio))), Image.LANCZOS)
                  for img in scaled]
        total_w = sum(img.width for img in scaled)

    sheet = Image.new("RGB", (total_w, scaled[0].height), (0, 0, 0))
    x = 0
    for img in scaled:
        sheet.paste(img, (x, 0))
        x += img.width

    buf = io.BytesIO()
    sheet.save(buf, format="JPEG", quality=85)
    return buf.getvalue()


def _extract_frames(path: Path, n: int) -> list[bytes]:
    """
    Use ffmpeg to extract `n` evenly-spaced frames from a video/GIF.
    Returns a list of JPEG bytes (one per frame).
    """
    with tempfile.TemporaryDirectory() as tmp_dir:
        out_pattern = str(Path(tmp_dir) / "frame%04d.jpg")

        cmd = [
            "ffmpeg", "-i", str(path),
            "-vsync", "0",
            "-vf", f"thumbnail={max(1, _count_frames(path) // n)},scale=-1:{_SPRITE_HEIGHT}",
            "-frames:v", str(n),
            "-q:v", "3",
            out_pattern,
        ]
        subprocess.run(cmd, capture_output=True, timeout=60)

        frame_files = sorted(Path(tmp_dir).glob("*.jpg"))

        # Fallback: just grab first N frames if thumbnail filter produced nothing
        if not frame_files:
            cmd_fallback = [
                "ffmpeg", "-i", str(path),
                "-vsync", "0",
                "-vf", f"scale=-1:{_SPRITE_HEIGHT}",
                "-frames:v", str(n),
                "-q:v", "3",
                out_pattern,
            ]
            subprocess.run(cmd_fallback, capture_output=True, timeout=60)
            frame_files = sorted(Path(tmp_dir).glob("*.jpg"))

        return [f.read_bytes() for f in frame_files]


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
    return img.resize((max(1, int(img.width * scale)), max(1, int(img.height * scale))), Image.LANCZOS)
