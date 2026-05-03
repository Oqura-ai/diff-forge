"""
Resolution normalization for video frames (numpy RGB arrays).

Ported from gif_normalization/preprocess/resolution_normalization.py
and adapted for video (no RGBA, no palette, no GIF-specific logic).

Strategy (mirrors the GIF pipeline):
  1. Pad symmetrically to target dimensions using the pad colour.
  2. No cropping — only padding + scaling.
  3. Aspect ratio is preserved throughout.
  4. Scaling uses NEAREST for pixel-accurate content (pixel art / sprites)
     and LANCZOS for photographic / naturalistic content.
"""
from __future__ import annotations

import math
import numpy as np
from PIL import Image

# Pillow >= 10 moved resample constants; keep compat with both
try:
    _NEAREST = Image.Resampling.NEAREST
except AttributeError:
    _NEAREST = Image.NEAREST  # type: ignore[attr-defined]


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _round_to_multiple(n: int, m: int) -> int:
    """Round *n* to the nearest multiple of *m* (minimum *m*)."""
    return max(m, round(n / m) * m)


def _ceil_to_multiple(n: int, m: int) -> int:
    return max(m, math.ceil(n / m) * m)


def _detect_bg_from_borders(frame: np.ndarray) -> tuple[int, int, int]:
    """
    Sample the outermost pixel ring of *frame* and return the most common RGB.
    Matches the heuristic in the original resolution_normalization.py.
    """
    import collections
    h, w = frame.shape[:2]
    border: list[tuple] = []
    border.extend(map(tuple, frame[0, :, :3].tolist()))      # top row
    border.extend(map(tuple, frame[-1, :, :3].tolist()))     # bottom row
    border.extend(map(tuple, frame[1:-1, 0, :3].tolist()))   # left col
    border.extend(map(tuple, frame[1:-1, -1, :3].tolist()))  # right col
    counter = collections.Counter(border)
    return counter.most_common(1)[0][0]  # type: ignore[return-value]


def _pad_frame(
    frame: np.ndarray,
    target_w: int,
    target_h: int,
    pad_color: tuple[int, int, int],
) -> np.ndarray:
    """
    Scale frame to fit within (target_w × target_h) preserving aspect ratio,
    then symmetrically pad the remainder with pad_color.

    This is equivalent to the GIF pipeline's pad-to-square + resize steps
    but handles arbitrary (non-square) target dimensions.
    """
    h, w = frame.shape[:2]
    scale = min(target_w / w, target_h / h)
    # Clamp to target dims to guard against floating-point rounding overflow
    new_w = min(target_w, int(round(w * scale)))
    new_h = min(target_h, int(round(h * scale)))

    img = Image.fromarray(frame.astype(np.uint8))
    img = img.resize((new_w, new_h), _NEAREST)
    resized = np.array(img)

    canvas = np.full((target_h, target_w, 3), pad_color, dtype=np.uint8)
    y_off = (target_h - new_h) // 2
    x_off = (target_w - new_w) // 2
    canvas[y_off:y_off + new_h, x_off:x_off + new_w] = resized[:, :, :3]
    return canvas


# ─── Public API ──────────────────────────────────────────────────────────────

def compute_target_resolution(
    orig_w: int,
    orig_h: int,
    multiple: int,
    min_side: int,
    mode: str = "auto",
    manual_w: int | None = None,
    manual_h: int | None = None,
) -> tuple[int, int]:
    """
    Compute (target_width, target_height) according to the config.

    auto   — round each dimension to the nearest *multiple*, clamp so
             the short side >= min_side.
    manual — use exactly the user-supplied values, no rounding or clamping.
             The user has already been warned via the frontend that non-multiples
             may break training rules; honouring their choice is intentional.
    """
    if mode == "manual" and manual_w is not None and manual_h is not None:
        # Exact user values — do NOT snap to multiple, do NOT enforce min_side
        return manual_w, manual_h

    # auto path
    tw = _round_to_multiple(orig_w, multiple)
    th = _round_to_multiple(orig_h, multiple)

    if min(tw, th) < min_side:
        scale = min_side / min(tw, th)
        tw = _ceil_to_multiple(int(round(tw * scale)), multiple)
        th = _ceil_to_multiple(int(round(th * scale)), multiple)

    return tw, th


def normalize_resolution(
    frames: list[np.ndarray],
    target_w: int,
    target_h: int,
    pad_color: tuple[int, int, int] | None = None,
) -> list[np.ndarray]:
    """
    Resize every frame to exactly (target_w × target_h) using
    aspect-ratio-preserving scale + symmetric padding.

    pad_color defaults to the border heuristic from the first frame
    (same as resolution_normalization.py in the GIF pipeline).
    """
    if not frames:
        raise ValueError("normalize_resolution: received empty frame list")

    if pad_color is None:
        pad_color = _detect_bg_from_borders(frames[0])

    # Fast path — nothing to do
    h, w = frames[0].shape[:2]
    if w == target_w and h == target_h:
        return frames

    return [_pad_frame(f, target_w, target_h, pad_color) for f in frames]
