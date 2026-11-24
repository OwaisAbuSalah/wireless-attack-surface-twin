"""Map encoding for the web app (docs/MODEL.md §8).

``v = round((RSS_dBm + 130) * 2)`` clipped to [1, 255]; ``0`` = no signal (< -129.5 dBm, -inf or NaN).
Rounding is half-up (``floor(x + 0.5)``) to match JavaScript ``Math.round``.
Bytes are row-major, ``index = j * nx + i`` (j = y index from y0 upward), then base64.
"""

from __future__ import annotations

import base64
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

ENCODING = "uint8: v = round((RSS_dBm + 130)·2) clipped to [1,255]; 0 = no signal (< −129.5 dBm)"


def encode_rss(rss_dbm: np.ndarray) -> np.ndarray:
    r = np.asarray(rss_dbm, float)
    good = np.isfinite(r) & (r >= -129.5)
    v = np.floor((np.where(good, r, -130.0) + 130.0) * 2.0 + 0.5)
    v = np.clip(v, 1, 255)
    return np.where(good, v, 0).astype(np.uint8)


def decode_rss(v: np.ndarray) -> np.ndarray:
    """Inverse of :func:`encode_rss`; 0 -> -inf."""
    v = np.asarray(v, np.uint8).astype(float)
    return np.where(v > 0, v / 2.0 - 130.0, -np.inf)


def to_b64(rss_dbm: np.ndarray) -> str:
    return base64.b64encode(encode_rss(rss_dbm).ravel(order="C").tobytes()).decode("ascii")


def from_b64(s: str, nx: int, ny: int) -> np.ndarray:
    b = np.frombuffer(base64.b64decode(s), np.uint8)
    assert b.size == nx * ny, (b.size, nx, ny)
    return decode_rss(b.reshape(ny, nx))


def tiers_to_b64(tier: np.ndarray) -> str:
    return base64.b64encode(np.asarray(tier, np.uint8).ravel(order="C").tobytes()).decode("ascii")


def grids_block(B, cell="sionna") -> dict:
    return {name: B.grid(name, cell) for name in B.plane_names()}


def write_maps_json(path: Path, generator: str, settings: dict, grids: dict, scenarios: dict,
                    extra: dict | None = None) -> int:
    """Write the §8 document. ``scenarios[name] = {freq_ghz, tx_dbm, outdoor: rss, floor0: rss, ...}``
    with RSS arrays (they are encoded here). Returns the file size in bytes."""
    doc = {
        "generator": generator,
        "created": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "settings": settings,
        "grids": grids,
        "encoding": ENCODING,
        "scenarios": {},
    }
    for name, sc in scenarios.items():
        d = {"freq_ghz": sc["freq_ghz"], "tx_dbm": sc["tx_dbm"]}
        for plane in grids:
            d[plane] = to_b64(sc[plane])
        doc["scenarios"][name] = d
    if extra:
        doc.update(extra)
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return path.stat().st_size


def read_maps_json(path: Path) -> dict:
    """Load a §8 document and decode every map into RSS arrays (dBm, -inf = no signal)."""
    doc = json.loads(Path(path).read_text(encoding="utf-8"))
    grids = doc["grids"]
    out = {}
    for name, sc in doc["scenarios"].items():
        out[name] = {k: (from_b64(v, grids[k]["nx"], grids[k]["ny"]) if k in grids else v) for k, v in sc.items()}
    return {"doc": doc, "grids": grids, "maps": out}
