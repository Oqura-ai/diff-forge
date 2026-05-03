# Import each model package here so @register decorators fire at startup.
# To add WAN: create processors/wan/__init__.py and add the import below.
from .ltx import LTXProcessor  # noqa: F401

# from .wan import WANProcessor  # ← uncomment when wan/ is ready
