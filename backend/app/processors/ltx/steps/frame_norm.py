from __future__ import annotations

import math
import numpy as np


# ─── Target computation ───────────────────────────────────────────────────────

def next_8n1(n: int, min_val: int = 9, max_val: int = 257) -> int:
    print(f"[next_8n1] Input n={n}, min_val={min_val}, max_val={max_val}")

    if n <= min_val:
        print(f"[next_8n1] n <= min_val, returning {min_val}")
        return min_val

    k = math.ceil((n - 1) / 8)
    result = min(8 * k + 1, max_val)

    print(f"[next_8n1] Computed k={k}, result={result}")
    return result


def nearest_8n1(n: int, min_val: int = 9, max_val: int = 257) -> int:
    print(f"[nearest_8n1] Input n={n}, min_val={min_val}, max_val={max_val}")

    if n <= min_val:
        print(f"[nearest_8n1] n <= min_val, returning {min_val}")
        return min_val
    if n >= max_val:
        print(f"[nearest_8n1] n >= max_val, returning {max_val}")
        return max_val

    k = max(1, (n - 1) // 8)
    candidates = [
        8 * (k + dk) + 1
        for dk in range(-1, 3)
        if 8 * (k + dk) + 1 >= min_val
    ]

    result = min(candidates, key=lambda v: abs(v - n))

    print(f"[nearest_8n1] k={k}, candidates={candidates}, selected={result}")
    return result


def next_any(n: int, min_val: int = 1, max_val: int = 600) -> int:
    result = max(min_val, min(max_val, n))
    print(f"[next_any] Input n={n}, returning {result}")
    return result


# ─── Resampling ───────────────────────────────────────────────────────────────

def resample_bresenham(
    frames: list[np.ndarray],
    target: int,
) -> list[np.ndarray]:
    print(f"[resample] Starting resample")
    print(f"[resample] Source frame count={len(frames)}, target={target}")

    n = len(frames)

    if n == 0:
        raise ValueError("resample_bresenham: received empty frame list")

    if target < n:
        raise ValueError(
            f"[resample] Downsampling blocked (source={n}, target={target})"
        )

    if n == target:
        print(f"[resample] No resampling needed, returning original frames")
        return frames

    # Upsampling only
    q, r = divmod(target, n)
    print(f"[resample] Upsampling: q={q}, r={r}")
    print(f"[resample] First {r} frames will repeat {q+1} times, rest {q} times")

    result: list[np.ndarray] = []

    for i, frame in enumerate(frames):
        reps = (q + 1) if i < r else q
        print(f"[resample] Frame {i}: repeating {reps} times")

        for j in range(reps):
            result.append(frame)

    print(f"[resample] Length after duplication={len(result)}")

    # Safety trim
    if len(result) > target:
        print(f"[resample] Trimming result from {len(result)} to {target}")
    result = result[:target]

    # Safety pad
    while len(result) < target:
        print(f"[resample] Padding with last frame to reach {target}")
        result.append(result[-1].copy())

    print(f"[resample] Final output length={len(result)}")
    return result


def bresenham_source_map(source_count: int, target_count: int) -> list[int]:
    print(f"[source_map] source_count={source_count}, target_count={target_count}")

    if target_count < source_count:
        raise ValueError(
            f"[source_map] Downsampling blocked (source={source_count}, target={target_count})"
        )

    if source_count == target_count:
        print(f"[source_map] No mapping needed (identity)")
        return list(range(source_count))

    n = source_count
    q, r = divmod(target_count, n)

    print(f"[source_map] q={q}, r={r}")
    print(f"[source_map] First {r} indices repeat {q+1} times, rest {q} times")

    result: list[int] = []

    for i in range(n):
        reps = (q + 1) if i < r else q
        print(f"[source_map] Source index {i} -> {reps} copies")

        result.extend([i] * reps)

    result = result[:target_count]

    print(f"[source_map] Final mapping length={len(result)}")
    print(f"[source_map] Mapping={result}")

    return result