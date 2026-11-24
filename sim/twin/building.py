"""Loading of ``data/building.json`` + geometry helpers + scenario resolution.

Everything here follows ``docs/MODEL.md``:

* §1  frame: x east, y north, z up [m]; azimuth from +x towards +y; tilt positive up.
* §4  map grids: cell centres ``x = x0 + (i + 0.5) * dx``, row-major ``index = j * nx + i``.
* §5  protections -> effective radio parameters (``scenario_params``).
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from . import DATA


def freq_key(freq_ghz: float) -> str:
    """Key of the per-frequency loss columns in building.json ("2.4", "5")."""
    f = float(freq_ghz)
    return str(int(f)) if f.is_integer() else repr(f)


@dataclass
class Walls:
    """Struct-of-arrays view of ``building.json -> walls`` (all walls incl. context buildings)."""
    ids: list
    ax: np.ndarray
    ay: np.ndarray
    bx: np.ndarray
    by: np.ndarray
    z0: np.ndarray
    z1: np.ndarray
    length: np.ndarray
    mat: np.ndarray          # material index (= materials[*].id)
    has_open: np.ndarray     # bool
    sill: np.ndarray
    head: np.ndarray
    period: np.ndarray
    width: np.ndarray
    offset: np.ndarray
    open_mat: np.ndarray     # material index of the opening (-1 if none)
    floor: np.ndarray        # floor index, -1 for context walls
    context: np.ndarray      # bool
    exterior: np.ndarray     # bool

    def __len__(self):
        return len(self.ids)


@dataclass
class Building:
    raw: dict
    materials: list                     # material keys ordered by id
    mat_index: dict                     # key -> id
    walls: Walls
    footprint: tuple                    # (x0, y0, x1, y1)
    slab_planes: np.ndarray
    slab_extent: tuple
    floors: list
    clients: list
    router: dict
    rf: dict
    attack: dict
    protections: dict
    scenarios: dict
    extra: dict = field(default_factory=dict)

    # ------------------------------------------------------------------ materials
    def loss_table(self, freq_ghz: float) -> np.ndarray:
        """Nominal through-wall loss per material id [dB] at ``freq_ghz`` (no protections)."""
        k = freq_key(freq_ghz)
        return np.array([float(self.raw["materials"][m]["loss"][k]) for m in self.materials])

    # ------------------------------------------------------------------ grids
    def grid(self, name: str, cell: str | float = "sionna") -> dict:
        """Grid spec ``{x0, y0, dx, nx, ny, z}`` for ``outdoor`` / ``floor0`` / ``floor1`` / ``floor2``.

        ``cell`` = "sionna" (1.0 m / 0.25 m), "realtime" (0.4 m / 0.2 m) or a number [m].
        """
        if name == "outdoor":
            g = self.rf["grids"]["outdoor"]
            z = float(g["z"])
        elif name.startswith("floor"):
            g = self.rf["grids"]["floor"]
            fi = int(name[5:])
            z = float(self.floors[fi]["z"]) + float(g["dz"])
        else:
            raise KeyError(name)
        dx = float(g["cell_" + cell]) if isinstance(cell, str) else float(cell)
        nx = int(round((g["x1"] - g["x0"]) / dx))
        ny = int(round((g["y1"] - g["y0"]) / dx))
        return {"x0": float(g["x0"]), "y0": float(g["y0"]), "dx": dx, "nx": nx, "ny": ny, "z": round(z, 6)}

    def plane_names(self) -> list:
        return ["outdoor"] + [f"floor{f['id']}" for f in self.floors]

    # ------------------------------------------------------------------ geometry helpers
    def inside_footprint(self, x, y) -> np.ndarray:
        x0, y0, x1, y1 = self.footprint
        return (x >= x0) & (x <= x1) & (y >= y0) & (y <= y1)

    def dist_to_footprint(self, x, y) -> np.ndarray:
        """Euclidean plan distance from a point to the footprint rectangle (0 inside)."""
        x0, y0, x1, y1 = self.footprint
        dx = np.maximum.reduce([x0 - x, np.zeros_like(x, dtype=float), x - x1])
        dy = np.maximum.reduce([y0 - y, np.zeros_like(y, dtype=float), y - y1])
        return np.hypot(dx, dy)

    def street_rects(self) -> list:
        """Main street + the sidewalks that share an edge with it (MODEL.md §7 street exposure)."""
        roads = {r["id"]: r for r in self.raw["site"]["roads"]}
        sx0, sy0, sx1, sy1 = roads["main_street"]["rect"]
        rects = [(sx0, sy0, sx1, sy1)]
        for (x0, y0, x1, y1) in self.raw["site"]["sidewalks"]:
            touches = (abs(y1 - sy0) < 1e-9 or abs(y0 - sy1) < 1e-9) and (x1 > sx0 and x0 < sx1)
            if touches:
                rects.append((x0, y0, x1, y1))
        return rects

    def street_mask(self, x, y) -> np.ndarray:
        m = np.zeros(np.broadcast(x, y).shape, dtype=bool)
        for (x0, y0, x1, y1) in self.street_rects():
            m |= (x >= x0) & (x <= x1) & (y >= y0) & (y <= y1)
        return m

    def client_positions(self) -> np.ndarray:
        return np.array([c["pos"] for c in self.clients], dtype=float)

    def floor_of_z(self, z: float) -> int:
        """Index of the storey containing height z (-1 below ground / above roof)."""
        for f in self.floors:
            if f["z"] <= z < f["z"] + f["height"]:
                return int(f["id"])
        return -1


def cell_centers(grid: dict):
    """Return (X, Y) arrays of shape (ny, nx) with the cell-centre coordinates."""
    xs = grid["x0"] + (np.arange(grid["nx"]) + 0.5) * grid["dx"]
    ys = grid["y0"] + (np.arange(grid["ny"]) + 0.5) * grid["dx"]
    return np.meshgrid(xs, ys)


def grid_points(grid: dict) -> np.ndarray:
    """(ny*nx, 3) array of cell-centre points, row-major (index = j*nx + i)."""
    X, Y = cell_centers(grid)
    return np.stack([X.ravel(), Y.ravel(), np.full(X.size, grid["z"])], axis=1)


def load_building(path: str | Path | None = None) -> Building:
    import hashlib
    path = Path(path) if path else DATA
    blob = Path(path).read_bytes()
    raw = json.loads(blob.decode("utf-8"))
    mats = sorted(raw["materials"].keys(), key=lambda k: raw["materials"][k]["id"])
    assert [raw["materials"][m]["id"] for m in mats] == list(range(len(mats))), "material ids must be 0..n-1"
    mi = {m: i for i, m in enumerate(mats)}

    W = raw["walls"]
    n = len(W)
    f = lambda key: np.array([float(w[key]) for w in W])
    ax = np.array([w["a"][0] for w in W], float)
    ay = np.array([w["a"][1] for w in W], float)
    bx = np.array([w["b"][0] for w in W], float)
    by = np.array([w["b"][1] for w in W], float)
    op = [w.get("opening") for w in W]
    walls = Walls(
        ids=[w["id"] for w in W], ax=ax, ay=ay, bx=bx, by=by, z0=f("z0"), z1=f("z1"),
        length=np.hypot(bx - ax, by - ay),
        mat=np.array([mi[w["mat"]] for w in W], int),
        has_open=np.array([o is not None for o in op], bool),
        sill=np.array([o["sill"] if o else 0.0 for o in op], float),
        head=np.array([o["head"] if o else 0.0 for o in op], float),
        period=np.array([o["period"] if o else 0.0 for o in op], float),
        width=np.array([o["width"] if o else 0.0 for o in op], float),
        offset=np.array([o["offset"] if o else 0.0 for o in op], float),
        open_mat=np.array([mi[o["mat"]] if o else -1 for o in op], int),
        floor=np.array([w["floor"] if w.get("floor") is not None else -1 for w in W], int),
        context=np.array([bool(w.get("context")) for w in W], bool),
        exterior=np.array([bool(w.get("exterior")) for w in W], bool),
    )
    rf = raw["rf"]
    return Building(
        raw=raw, materials=mats, mat_index=mi, walls=walls,
        footprint=tuple(float(v) for v in raw["footprint"]),
        slab_planes=np.array(rf["slab_planes"], float),
        slab_extent=tuple(float(v) for v in rf["slab_extent"]),
        floors=raw["floors"], clients=raw["clients"], router=raw["router"], rf=rf,
        attack=raw["attack"], protections=raw["protections"], scenarios=raw["scenarios"],
        extra={"sha256": hashlib.sha256(blob).hexdigest(), "path": str(path)},
    )


# ---------------------------------------------------------------------------- scenarios
@dataclass
class ScenarioParams:
    """Effective inputs of one scenario after applying MODEL.md §5."""
    name: str
    protections: list
    freq_ghz: float
    fkey: str
    tx_dbm: float
    antenna: str               # "dipole" | "patch"
    mount: str                 # "wall" | "ceiling"
    tx_pos: np.ndarray         # (3,)
    az_deg: float
    tilt_deg: float
    patch: dict                # gmax_dbi, hpbw_deg, sla_db
    loss: np.ndarray           # per material id [dB], incl. shielding modifiers
    extra_db: dict             # material key -> extra dB applied by protections
    pmf: bool
    wpa3: bool

    @property
    def material_config(self) -> tuple:
        """Key identifying the propagation environment (independent of the router)."""
        return (self.fkey, tuple(sorted(self.extra_db.items())))


def scenario_params(B: Building, scenario: str | None = None, protections: list | None = None) -> ScenarioParams:
    if protections is None:
        protections = list(B.scenarios[scenario]["protections"]) if scenario else []
    P = B.protections
    r = B.router
    freq = float(r["freq_ghz"])
    if "band5" in protections:
        freq = float(P["band5"]["freq_ghz"])
    fk = freq_key(freq)
    tx = float(r["tx_dbm"])
    if "lowPower" in protections:
        tx = float(P["lowPower"]["tx_dbm"])
    antenna = r["antenna"]
    if "directional" in protections:
        antenna = P["directional"]["antenna"]
    mount = r["mount"]
    if "relocate" in protections:
        mount = P["relocate"]["mount"]
    m = r["mounts"][mount]
    loss = B.loss_table(freq)
    extra = {}
    for key in ("shieldWindows", "shieldPaint"):
        if key in protections:
            mat = P[key]["material"]
            e = float(P[key]["extra_db"][fk])
            loss[B.mat_index[mat]] += e
            extra[mat] = extra.get(mat, 0.0) + e
    # patch parameters are mount-specific (router.mounts.<mount>.patch, MODEL.md §3); fall back to the
    # protection's global values for older building.json files
    d = m.get("patch") or P["directional"]
    return ScenarioParams(
        name=scenario or "+".join(protections) or "baseline", protections=list(protections),
        freq_ghz=freq, fkey=fk, tx_dbm=tx, antenna=antenna, mount=mount,
        tx_pos=np.array(m["pos"], float), az_deg=float(m["az_deg"]), tilt_deg=float(m["tilt_deg"]),
        patch={"gmax_dbi": float(d["gmax_dbi"]), "hpbw_deg": float(d["hpbw_deg"]), "sla_db": float(d["sla_db"])},
        loss=loss, extra_db=extra, pmf="pmf" in protections, wpa3="wpa3" in protections,
    )


def boresight(az_deg: float, tilt_deg: float) -> np.ndarray:
    a, t = math.radians(az_deg), math.radians(tilt_deg)
    return np.array([math.cos(t) * math.cos(a), math.cos(t) * math.sin(a), math.sin(t)])
