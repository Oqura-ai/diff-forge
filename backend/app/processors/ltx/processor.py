from __future__ import annotations

import json
import logging
import subprocess
import tempfile
from pathlib import Path

import numpy as np

from ..base import VideoProcessor, ProcessorInput, ProcessorOutput, SegmentOutput
from ..registry import register
from .config import FRAME_MIN, FRAME_MAX, RESOLUTION_MULTIPLE, RESOLUTION_MIN_SIDE
from .steps.frame_norm import next_8n1, resample_bresenham
from .steps.resolution_norm import compute_target_resolution, normalize_resolution

logger = logging.getLogger(__name__)

_FFPROBE_TIMEOUT = 30
_FFMPEG_TIMEOUT  = 600

_SEP = "─" * 60


def _log(msg: str) -> None:
    print(f"[LTX] {msg}", flush=True)


@register("LTX")
class LTXProcessor(VideoProcessor):
    model_id = "LTX"
    supported_extensions = {".mp4", ".mov", ".avi", ".webm", ".gif"}

    def process(self, inp: ProcessorInput) -> ProcessorOutput:
        cfg  = inp.config
        prog = inp.on_progress or (lambda p, m: None)

        _log(_SEP)
        _log(f"START  file={inp.file_path.name}")
        _log(f"CONFIG resolution.mode={cfg.resolution.mode.value}  "
             f"width={cfg.resolution.width}  height={cfg.resolution.height}")
        _log(f"CONFIG frames.mode={cfg.frames.mode.value}  target={cfg.frames.target}")
        _log(f"CONFIG splits={cfg.splits}  frame_deletions={cfg.frame_deletions}")

        # ── 1. Probe ──────────────────────────────────────────────────────────
        _log("STEP 1  Probing video (dimensions + fps)…")
        prog(3, "Probing video…")
        orig_w, orig_h, fps = _probe(inp.file_path)
        _log(f"PROBE   orig={orig_w}×{orig_h}  fps={fps:.4f}")
        prog(8, f"Probed: {orig_w}×{orig_h} @ {fps:.3f} fps")

        # ── 2. Decode all frames ──────────────────────────────────────────────
        _log("STEP 2  Decoding all frames via ffmpeg…")
        prog(10, "Decoding frames…")
        frames = _decode(inp.file_path, orig_w, orig_h)
        _log(f"DECODE  got {len(frames)} frames  shape={frames[0].shape if frames else 'N/A'}")
        prog(30, f"Decoded {len(frames)} frames")

        # ── 3. Target resolution ──────────────────────────────────────────────
        _log("STEP 3  Computing target resolution…")
        target_w, target_h = compute_target_resolution(
            orig_w, orig_h,
            multiple=RESOLUTION_MULTIPLE,
            min_side=RESOLUTION_MIN_SIDE,
            mode=cfg.resolution.mode.value,   # .value avoids "ResolutionMode.manual" in Python 3.11
            manual_w=cfg.resolution.width,
            manual_h=cfg.resolution.height,
        )
        _log(f"RESOLUTION  mode={cfg.resolution.mode.value}  "
             f"{orig_w}×{orig_h} → {target_w}×{target_h}  "
             f"(changed={orig_w != target_w or orig_h != target_h})")
        prog(32, f"Target resolution: {target_w}×{target_h}")
        _log(f"FLAGS  apply_resolution={cfg.apply_resolution}  apply_frames={cfg.apply_frames}")

        # ── 4. Build segment boundaries ───────────────────────────────────────
        _log("STEP 4  Building segment boundaries…")
        total = len(frames)
        split_indices = sorted({
            max(1, min(total - 1, round(t * fps)))
            for t in (cfg.splits or [])
        })
        boundaries   = [0] + split_indices + [total]
        segments_raw = [
            (frames[boundaries[i]: boundaries[i + 1]], boundaries[i], boundaries[i + 1])
            for i in range(len(boundaries) - 1)
            if boundaries[i] < boundaries[i + 1]
        ]
        n_segs = len(segments_raw)
        _log(f"SEGMENTS  count={n_segs}  split_frame_indices={split_indices}")
        prog(35, f"{n_segs} segment(s) to process")

        outputs: list[SegmentOutput] = []

        for seg_idx, (seg_frames, start_fi, end_fi) in enumerate(segments_raw):
            seg_label = f"[seg {seg_idx + 1}/{n_segs}]"
            seg_base  = 35 + int(seg_idx / n_segs * 60)

            _log(f"{seg_label}  frames [{start_fi}:{end_fi}]  count={len(seg_frames)}")

            # ── 5. Frame normalisation ────────────────────────────────────────
            _log(f"{seg_label} STEP 5  Frame normalisation…")
            prog(seg_base, f"{seg_label} Frame normalisation…")

            src_fc = len(seg_frames)

            if cfg.apply_frames:
                frames_mode = cfg.frames.mode.value
                if frames_mode == "strict" and cfg.frames.target is not None:
                    target_fc = cfg.frames.target
                    _log(f"{seg_label} FRAMES  mode=strict  target={target_fc}  source={src_fc}")
                    if target_fc < src_fc:
                        raise ValueError(
                            f"Manual frame target {target_fc} < source {src_fc}. "
                            f"Normalisation only adds frames — use a value >= {src_fc}."
                        )
                else:
                    target_fc = next_8n1(src_fc, FRAME_MIN, FRAME_MAX)
                    _log(f"{seg_label} FRAMES  mode=auto ({frames_mode})  next_8n1({src_fc})={target_fc}")

                if target_fc != src_fc:
                    _log(f"{seg_label} RESAMPLE  {src_fc} → {target_fc} frames (adding {target_fc - src_fc})")
                    seg_frames = resample_bresenham(seg_frames, target_fc)
                    _log(f"{seg_label} RESAMPLE  done  len={len(seg_frames)}")
                else:
                    _log(f"{seg_label} RESAMPLE  skipped (already {src_fc} frames, target={target_fc})")
            else:
                target_fc = src_fc
                _log(f"{seg_label} FRAMES  skipped (apply_frames=False)  keeping {target_fc} frames")

            prog(seg_base + 10, f"{seg_label} {len(seg_frames)} frames (target {target_fc})")

            # ── Optional frame deletions ──────────────────────────────────────
            if cfg.frame_deletions:
                before = len(seg_frames)
                delete_set = set(cfg.frame_deletions)
                seg_frames = [f for i, f in enumerate(seg_frames) if i not in delete_set]
                target_fc  = len(seg_frames)
                _log(f"{seg_label} DELETIONS  removed={before - target_fc}  remaining={target_fc}")
                prog(seg_base + 12, f"{seg_label} {target_fc} frames after deletions")

            # ── 6. Resolution normalisation ───────────────────────────────────
            if cfg.apply_resolution:
                resize_mode = cfg.resolution.resize_mode.value
                _log(f"{seg_label} STEP 6  Resolution normalisation  {orig_w}×{orig_h} → {target_w}×{target_h}  mode={resize_mode}…")
                prog(seg_base + 15, f"{seg_label} Resolution normalisation…")
                seg_frames = normalize_resolution(seg_frames, target_w, target_h, resize_mode=resize_mode)
                _log(f"{seg_label} RES NORM  done  frame_shape={seg_frames[0].shape}")
            else:
                _log(f"{seg_label} STEP 6  Resolution normalisation skipped (apply_resolution=False)")

            out_w = target_w if cfg.apply_resolution else orig_w
            out_h = target_h if cfg.apply_resolution else orig_h

            # ── 7. Encode ─────────────────────────────────────────────────────
            suffix   = f"_seg{seg_idx}" if n_segs > 1 else ""
            out_path = inp.file_path.parent / f"{inp.file_path.stem}_ltx{suffix}.mp4"
            _log(f"{seg_label} STEP 7  Encoding {len(seg_frames)} frames → {out_path.name}  "
                 f"fps={fps:.3f}  {out_w}×{out_h}…")
            prog(seg_base + 25, f"{seg_label} Encoding MP4…")
            _encode(seg_frames, out_path, fps, out_w, out_h)
            _log(f"{seg_label} ENCODE  done  size={out_path.stat().st_size / 1024:.1f} KB")

            outputs.append(SegmentOutput(
                path=out_path,
                width=out_w,   height=out_h,
                frame_count=target_fc,
                fps=fps,
                duration_secs=target_fc / fps,
                segment_index=seg_idx,
                start_secs=start_fi / fps,
                end_secs=end_fi   / fps,
            ))

        _log(f"DONE  {n_segs} seg(s)  {target_w}×{target_h}  {target_fc}f")
        _log(_SEP)
        prog(100, f"Done — {n_segs} seg(s), {target_w}×{target_h}, {target_fc}f")
        return ProcessorOutput(segments=outputs)


# ─── I/O helpers ─────────────────────────────────────────────────────────────

def _probe(path: Path) -> tuple[int, int, float]:
    _log(f"PROBE   running ffprobe on {path.name}…")

    r_stream = subprocess.run(
        [
            "ffprobe", "-v", "quiet",
            "-select_streams", "v:0",
            "-show_entries", "stream=r_frame_rate,avg_frame_rate,nb_frames,duration",
            "-of", "json",
            str(path),
        ],
        capture_output=True, text=True, timeout=_FFPROBE_TIMEOUT,
    )
    if r_stream.returncode != 0:
        raise RuntimeError(f"ffprobe (stream) failed:\n{r_stream.stderr}")

    streams = json.loads(r_stream.stdout).get("streams", [])
    if not streams:
        raise RuntimeError(f"No video stream in {path.name}")

    s = streams[0]
    _log(f"PROBE   stream info: r_frame_rate={s.get('r_frame_rate')}  "
         f"avg_frame_rate={s.get('avg_frame_rate')}  "
         f"nb_frames={s.get('nb_frames')}  duration={s.get('duration')}")

    fps = _parse_fps(s)
    _log(f"PROBE   resolved fps={fps:.4f}")

    # Actual decoded dimensions from the first frame
    r_frame = subprocess.run(
        [
            "ffprobe", "-v", "quiet",
            "-select_streams", "v:0",
            "-read_intervals", "%+#1",
            "-show_frames",
            "-show_entries", "frame=width,height",
            "-of", "json",
            str(path),
        ],
        capture_output=True, text=True, timeout=_FFPROBE_TIMEOUT,
    )

    frame_list = (
        json.loads(r_frame.stdout).get("frames", [])
        if r_frame.returncode == 0 else []
    )

    if frame_list:
        w = int(frame_list[0]["width"])
        h = int(frame_list[0]["height"])
        _log(f"PROBE   first-frame dimensions: {w}×{h}")
    else:
        _log("PROBE   first-frame probe failed, falling back to stream width/height")
        r_wh = subprocess.run(
            [
                "ffprobe", "-v", "quiet",
                "-select_streams", "v:0",
                "-show_entries", "stream=width,height",
                "-of", "json",
                str(path),
            ],
            capture_output=True, text=True, timeout=_FFPROBE_TIMEOUT,
        )
        sv = json.loads(r_wh.stdout).get("streams", [{}])[0]
        w  = int(sv.get("width", 0))
        h  = int(sv.get("height", 0))
        _log(f"PROBE   stream fallback dimensions: {w}×{h}")

    if w == 0 or h == 0:
        raise RuntimeError(f"Could not determine video dimensions for {path.name}")

    return w, h, fps


def _parse_fps(stream_info: dict) -> float:
    for key in ("avg_frame_rate", "r_frame_rate"):
        val = stream_info.get(key, "")
        if "/" in val:
            try:
                num, den = val.split("/")
                num_f, den_f = float(num), float(den)
                if den_f > 0 and num_f > 0:
                    _log(f"PARSE_FPS  used {key}={val} → {num_f/den_f:.4f}")
                    return num_f / den_f
            except (ValueError, ZeroDivisionError):
                pass

    nb  = stream_info.get("nb_frames")
    dur = stream_info.get("duration")
    if nb not in (None, "N/A", "") and dur not in (None, "N/A", ""):
        try:
            dur_f = float(dur)
            if dur_f > 0:
                result = int(nb) / dur_f
                _log(f"PARSE_FPS  computed from nb_frames/duration={result:.4f}")
                return result
        except (ValueError, TypeError):
            pass

    _log("PARSE_FPS  all methods failed, defaulting to 10.0")
    return 10.0


def _decode(path: Path, w: int, h: int) -> list[np.ndarray]:
    frame_bytes = w * h * 3
    _log(f"DECODE  expected frame_bytes={frame_bytes} ({w}×{h}×3)")

    with tempfile.TemporaryDirectory() as tmp_dir:
        raw_path = Path(tmp_dir) / "frames.raw"

        cmd = [
            "ffmpeg", "-i", str(path),
            "-an",
            "-vsync", "0",        # output EVERY frame, no deduplication
            "-f", "rawvideo",
            "-pix_fmt", "rgb24",
            str(raw_path),
        ]
        _log(f"DECODE  ffmpeg cmd: {' '.join(cmd)}")
        r = subprocess.run(cmd, capture_output=True, timeout=_FFMPEG_TIMEOUT)
        _log(f"DECODE  ffmpeg exit={r.returncode}")

        if not raw_path.exists() or raw_path.stat().st_size == 0:
            raise RuntimeError(
                f"ffmpeg produced no output (exit {r.returncode}) for {path.name}.\n"
                f"{r.stderr.decode(errors='replace')[-2000:]}"
            )

        total_bytes = raw_path.stat().st_size
        _log(f"DECODE  raw file size={total_bytes} bytes  "
             f"÷ frame_bytes={frame_bytes} = {total_bytes / frame_bytes:.3f} frames")

        if total_bytes % frame_bytes != 0:
            raise RuntimeError(
                f"Frame size mismatch for {path.name}: "
                f"decoded {total_bytes} bytes, not a multiple of {w}×{h}×3={frame_bytes}.\n"
                f"stderr: {r.stderr.decode(errors='replace')[-800:]}"
            )

        n_frames = total_bytes // frame_bytes
        if n_frames == 0:
            raise RuntimeError(f"No complete frames decoded from {path.name}")

        _log(f"DECODE  reading {n_frames} frames from temp file…")
        frames: list[np.ndarray] = []
        with open(raw_path, "rb") as fh:
            for i in range(n_frames):
                chunk = fh.read(frame_bytes)
                if len(chunk) < frame_bytes:
                    _log(f"DECODE  WARNING: short read at frame {i}, stopping")
                    break
                frames.append(
                    np.frombuffer(chunk, dtype=np.uint8)
                    .reshape(h, w, 3)
                    .copy()
                )

        _log(f"DECODE  done  frames_read={len(frames)}")

    return frames


def _encode(
    frames: list[np.ndarray],
    out_path: Path,
    fps: float,
    width: int,
    height: int,
) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory() as tmp_dir:
        raw_path = Path(tmp_dir) / "input.raw"

        _log(f"ENCODE  writing {len(frames)} frames to temp raw file…")
        with open(raw_path, "wb") as fh:
            for frame in frames:
                fh.write(frame.astype(np.uint8).tobytes())

        raw_size = raw_path.stat().st_size
        _log(f"ENCODE  raw file size={raw_size} bytes  "
             f"({len(frames)} × {width}×{height}×3 = {len(frames)*width*height*3})")

        cmd = [
            "ffmpeg", "-y",
            "-f", "rawvideo", "-vcodec", "rawvideo",
            "-s", f"{width}x{height}",
            "-pix_fmt", "rgb24",
            "-r", str(fps),
            "-i", str(raw_path),
            "-vcodec", "libx264",
            "-preset", "fast",
            "-crf", "18",
            "-pix_fmt", "yuv420p",
            str(out_path),
        ]
        _log(f"ENCODE  ffmpeg cmd: {' '.join(cmd)}")
        r = subprocess.run(cmd, capture_output=True, timeout=_FFMPEG_TIMEOUT)
        _log(f"ENCODE  ffmpeg exit={r.returncode}")

        if r.returncode != 0:
            raise RuntimeError(
                f"ffmpeg encode failed (exit {r.returncode}):\n"
                f"{r.stderr.decode(errors='replace')[-2000:]}"
            )
