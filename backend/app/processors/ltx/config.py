"""
LTX 2.3 model constraints.
All constants come from the LTX training documentation and the
existing gif_normalization pipeline.
"""

# Frame count rule: 8n + 1  (9, 17, 25, 33, …, 257)
FRAME_MULTIPLE = 8
FRAME_OFFSET = 1
FRAME_MIN = 9
FRAME_MAX = 257

# Resolution
RESOLUTION_MULTIPLE = 32   # all dims must be divisible by 32
RESOLUTION_MIN_SIDE = 64   # minimum width or height

# Common LTX resolution buckets (width × height, both dims are multiples of 32)
# Processor will target the nearest bucket in auto mode.
RESOLUTION_BUCKETS: list[tuple[int, int]] = [
    (256, 256),
    (512, 512),
    (768, 768),
    (1024, 1024),
    (1280, 720),   # 16:9 HD
    (1280, 1024),
    (1536, 1536),
]
