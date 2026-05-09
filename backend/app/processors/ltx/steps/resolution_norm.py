"""
Resolution normalization for video frames (numpy RGB arrays).

Resize modes
────────────
scale         — Direct stretch/squish to the target dimensions.
                Does not preserve aspect ratio.

pad           — Scale to fit entirely within the target, then fill the
                remaining area with a symmetrical border sampled from the
                source frame's outermost pixel ring. Aspect ratio preserved.

crop_h        — Fit to the target height, then centre-crop the width
                symmetrically (removes equal amounts on the left and right).
                Falls back to symmetric padding when the source is narrower
                than the target at the fitted height.

crop_v        — Fit to the target width, then centre-crop the height
                symmetrically (removes equal amounts on the top and bottom).
                Falls back to symmetric padding when the source is shorter
                than the target at the fitted width.

crop_uniform  — Scale to cover the full target (both sides ≥ target),
                then centre-crop all four sides symmetrically. Equivalent to
                CSS "object-fit: cover".

Scaling algorithm
─────────────────
All resize operations use Lanczos resampling (a truncated sinc filter with
a 3-lobe kernel). Lanczos is the highest-quality discrete resampler
available in Pillow: it is the standard recommendation for downscaling
(preserves fine detail, no aliasing) and upscaling (minimal ringing
compared with bicubic for photographic content). For pixel-art content
Lanczos also outperforms nearest-neighbour at non-integer scale factors
because nearest-neighbour produces severe step aliasing along diagonal
edges; at integer scale factors the results are equivalent.
"""
from __future__ import annotations

import math
import numpy as np
from PIL import Image

# Pillow >= 10 moved resample constants; keep compat with both
try:
    _LANCZOS = Image.Resampling.LANCZOS
except AttributeError:
    _LANCZOS = Image.LANCZOS  # type: ignore[attr-defined]


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _round_to_multiple(n: int, m: int) -> int:
    """Round *n* to the nearest multiple of *m* (minimum *m*)."""
    return max(m, round(n / m) * m)


def _ceil_to_multiple(n: int, m: int) -> int:
    return max(m, math.ceil(n / m) * m)


def _detect_bg_from_borders(frame: np.ndarray) -> tuple[int, int, int]:
    """
    Sample the outermost pixel ring of *frame* and return the most common RGB.
    Used as automatic padding colour for pad mode.
    """
    import collections
    h, w = frame.shape[:2]
    border: list[tuple] = []
    border.extend(map(tuple, frame[0, :, :3].tolist()))
    border.extend(map(tuple, frame[-1, :, :3].tolist()))
    border.extend(map(tuple, frame[1:-1, 0, :3].tolist()))
    border.extend(map(tuple, frame[1:-1, -1, :3].tolist()))
    counter = collections.Counter(border)
    return counter.most_common(1)[0][0]  # type: ignore[return-value]


def _pil(frame: np.ndarray) -> Image.Image:
    return Image.fromarray(frame.astype(np.uint8))


def _arr(img: Image.Image) -> np.ndarray:
    return np.array(img)


def _make_canvas(
    w: int, h: int, color: tuple[int, int, int]
) -> Image.Image:
    return Image.new("RGB", (w, h), color)


# ─── Per-frame resize functions ───────────────────────────────────────────────

def _resize_scale(
    frame: np.ndarray,
    tw: int, th: int,
    _pad_color: tuple[int, int, int],
) -> np.ndarray:
    """Stretch/squish to exact target dimensions — no aspect-ratio preservation."""
    img = _pil(frame).resize((tw, th), _LANCZOS)
    return _arr(img)


def _resize_pad(
    frame: np.ndarray,
    tw: int, th: int,
    pad_color: tuple[int, int, int],
) -> np.ndarray:
    """Fit inside target, pad remainder symmetrically."""
    h, w = frame.shape[:2]
    scale = min(tw / w, th / h)
    nw = min(tw, int(round(w * scale)))
    nh = min(th, int(round(h * scale)))

    img     = _pil(frame).resize((nw, nh), _LANCZOS)
    canvas  = _make_canvas(tw, th, pad_color)
    canvas.paste(img, ((tw - nw) // 2, (th - nh) // 2))
    return _arr(canvas)


def _resize_crop_h(
    frame: np.ndarray,
    tw: int, th: int,
    pad_color: tuple[int, int, int],
) -> np.ndarray:
    """Fit to target height, then centre-crop or pad width."""
    h, w = frame.shape[:2]
    scale = th / h
    nw    = int(round(w * scale))
    img   = _pil(frame).resize((nw, th), _LANCZOS)

    if nw >= tw:
        x = (nw - tw) // 2
        img = img.crop((x, 0, x + tw, th))
    else:
        canvas = _make_canvas(tw, th, pad_color)
        canvas.paste(img, ((tw - nw) // 2, 0))
        img = canvas

    return _arr(img)


def _resize_crop_v(
    frame: np.ndarray,
    tw: int, th: int,
    pad_color: tuple[int, int, int],
) -> np.ndarray:
    """Fit to target width, then centre-crop or pad height."""
    h, w = frame.shape[:2]
    scale = tw / w
    nh    = int(round(h * scale))
    img   = _pil(frame).resize((tw, nh), _LANCZOS)

    if nh >= th:
        y = (nh - th) // 2
        img = img.crop((0, y, tw, y + th))
    else:
        canvas = _make_canvas(tw, th, pad_color)
        canvas.paste(img, (0, (th - nh) // 2))
        img = canvas

    return _arr(img)


def _resize_crop_uniform(
    frame: np.ndarray,
    tw: int, th: int,
    _pad_color: tuple[int, int, int],
) -> np.ndarray:
    """Scale to cover (both sides ≥ target), then centre-crop all sides."""
    h, w  = frame.shape[:2]
    scale = max(tw / w, th / h)
    nw    = max(tw, int(round(w * scale)))
    nh    = max(th, int(round(h * scale)))
    img   = _pil(frame).resize((nw, nh), _LANCZOS)
    x     = (nw - tw) // 2
    y     = (nh - th) // 2
    img   = img.crop((x, y, x + tw, y + th))
    return _arr(img)


_RESIZE_FN = {
    "scale":        _resize_scale,
    "pad":          _resize_pad,
    "crop_h":       _resize_crop_h,
    "crop_v":       _resize_crop_v,
    "crop_uniform": _resize_crop_uniform,
}


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
    Compute (target_width, target_height) according to the resolution mode.

    auto   — round each dimension to the nearest *multiple*, clamp so
             the short side >= min_side.
    manual — use exactly the user-supplied values; no rounding or clamping.
    """
    if mode == "manual" and manual_w is not None and manual_h is not None:
        return manual_w, manual_h

    tw = _round_to_multiple(orig_w, multiple)
    th = _round_to_multiple(orig_h, multiple)

    if min(tw, th) < min_side:
        scale = min_side / min(tw, th)
        tw    = _ceil_to_multiple(int(round(tw * scale)), multiple)
        th    = _ceil_to_multiple(int(round(th * scale)), multiple)

    return tw, th


def normalize_resolution(
    frames: list[np.ndarray],
    target_w: int,
    target_h: int,
    pad_color: tuple[int, int, int] | None = None,
    resize_mode: str = "scale",
) -> list[np.ndarray]:
    """
    Resize every frame to exactly (target_w × target_h).

    Parameters
    ----------
    frames      : list of H×W×3 uint8 numpy arrays.
    target_w    : output width in pixels.
    target_h    : output height in pixels.
    pad_color   : RGB fill used by pad/crop_h/crop_v modes when padding is
                  needed. Defaults to the border-sampled colour of the first
                  frame (same heuristic as the original GIF pipeline).
    resize_mode : one of "scale", "pad", "crop_h", "crop_v", "crop_uniform".
    """
    if not frames:
        raise ValueError("normalize_resolution: received empty frame list")

    h, w = frames[0].shape[:2]
    if w == target_w and h == target_h:
        return frames

    fn = _RESIZE_FN.get(resize_mode, _resize_scale)

    if pad_color is None and resize_mode in ("pad", "crop_h", "crop_v"):
        pad_color = _detect_bg_from_borders(frames[0])
    pad_color = pad_color or (0, 0, 0)

    return [fn(f, target_w, target_h, pad_color) for f in frames]
