"""Wireless Attack Surface Digital Twin -- Python simulation package.

Modules
-------
building      load ``data/building.json``, geometry helpers, scenario -> effective parameters (MODEL.md §5)
mwm           vectorised NumPy reference implementation of MODEL.md §2-7 (multi-wall model, attacks, stats)
export        uint8/base64 map encoding of MODEL.md §8
plotting      report / slide figures
sionna_scene  build an NVIDIA Sionna RT scene from building.json (imports mitsuba lazily)
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]          # project root
SIM = ROOT / "sim"
DATA = ROOT / "data" / "building.json"
OUT = SIM / "out"
CACHE = OUT / "cache"
FIGURES = ROOT / "docs" / "figures"
WEB_SIONNA_JSON = ROOT / "web" / "src" / "data" / "sionna.json"

__all__ = ["ROOT", "SIM", "DATA", "OUT", "CACHE", "FIGURES", "WEB_SIONNA_JSON"]
