"""Build an NVIDIA Sionna RT scene from ``data/building.json``.

Scene-building rules (see sim/README.md, "Sionna RT scene"):

* **Walls** are single planar quads on their centre plane (zero-thickness surfaces).  Sionna RT's
  ``RadioMaterial`` evaluates reflection/transmission with the ITU-R P.2040 *single-layer slab*
  model (Eqs. 43-44, incl. multiple internal reflections) using the material ``thickness``
  (``sionna/rt/radio_materials/radio_material.py``, ``utils/electromagnetics.py::
  itu_coefficients_single_layer_slab``), and transmitted rays continue undeflected
  (``_specular_reflection_transmission_direction``).  A closed box would therefore be counted
  twice, so each wall is one surface with ``thickness = t`` from building.json.
* Each wall plane is split into rectangles: solid parts carry the wall material, window/door
  parts the opening material; ``air`` openings are left empty.
* **Floor slabs**: horizontal quads over the footprint at ``rf.slab_planes`` (concrete, 0.30 m).
* **Ground**: one large quad at z = 0, ITU ``medium_dry_ground`` (1.0 m slab ~ half-space).
* **Context buildings**: 4 walls + roof, ITU concrete with the ``ctx_wall`` thickness.
* **Shielding** (``shieldWindows`` / ``shieldPaint``): the affected material becomes a
  ``radio-material`` with the same thickness and real permittivity but a conductivity σ' chosen
  (root finding) so that its normal-incidence slab transmission loss rises by exactly the
  ``extra_db`` of building.json (an equivalent lossy slab of the wall + conductive layer).

Everything except :func:`load` is pure NumPy so that the geometry and the material derivation can be
inspected/tested without Mitsuba.
"""

from __future__ import annotations

import math
import struct
from pathlib import Path

import numpy as np
from scipy.optimize import brentq

from .building import Building, ScenarioParams

EPS0 = 8.8541878128e-12
C0 = 299792458.0

# ITU-R P.2040 Table 3 coefficients (a, b, c, d): eps_r = a f^b, sigma = c f^d (f in GHz), exactly as
# tabulated in sionna/rt/radio_materials/itu.py (v2.2.0) for the frequency range 1-10 GHz.
# run_sionna.py asserts that these equal the installed Sionna table.
ITU_ABCD = {
    "concrete": (5.24, 0.0, 0.0462, 0.7822),
    "brick": (3.91, 0.0, 0.0238, 0.16),
    "plasterboard": (2.73, 0.0, 0.0085, 0.9395),
    "wood": (1.99, 0.0, 0.0047, 1.0718),
    "glass": (6.31, 0.0, 0.0036, 1.3394),
    "metal": (1.0, 0.0, 1e7, 0.0),
    "medium_dry_ground": (15.0, -0.1, 0.035, 1.63),
}
GROUND = {"itu": "medium_dry_ground", "t": 1.0}
GROUND_RECT = (-130.0, -100.0, 130.0, 100.0)


# ============================================================================ EM helpers
def itu_eps_sigma(itu: str, f_ghz: float):
    a, b, c, d = ITU_ABCD[itu]
    return a * f_ghz ** b, c * f_ghz ** d


def slab_coefficients(eps_r: float, sigma: float, d: float, f_hz: float, cos_theta: float = 1.0):
    """ITU-R P.2040 single-layer slab (Eqs. 37, 43, 44) -- NumPy replica of Sionna's
    ``itu_coefficients_single_layer_slab``.  Returns (R_TE, R_TM, T_TE, T_TM) complex."""
    eta = complex(eps_r, -sigma / (2 * math.pi * f_hz * EPS0))
    lam = C0 / f_hz
    sin2 = 1.0 - cos_theta ** 2
    root = np.sqrt(eta - sin2 + 0j)
    q = 2 * math.pi * d / lam * root
    r_te = (cos_theta - root) / (cos_theta + root)
    r_tm = (eta * cos_theta - root) / (eta * cos_theta + root)
    e1, e2 = np.exp(-1j * q), np.exp(-2j * q)
    R_te = r_te * (1 - e2) / (1 - r_te ** 2 * e2)
    R_tm = r_tm * (1 - e2) / (1 - r_tm ** 2 * e2)
    T_te = (1 - r_te ** 2) * e1 / (1 - r_te ** 2 * e2)
    T_tm = (1 - r_tm ** 2) * e1 / (1 - r_tm ** 2 * e2)
    return R_te, R_tm, T_te, T_tm


def slab_loss_db(eps_r, sigma, d, f_hz, cos_theta=1.0):
    """Power transmission loss [dB] (polarisation-averaged) and reflection loss [dB] of a slab."""
    R_te, R_tm, T_te, T_tm = slab_coefficients(eps_r, sigma, d, f_hz, cos_theta)
    t2 = 0.5 * (abs(T_te) ** 2 + abs(T_tm) ** 2)
    r2 = 0.5 * (abs(R_te) ** 2 + abs(R_tm) ** 2)
    return -10 * math.log10(max(t2, 1e-300)), -10 * math.log10(max(r2, 1e-300))


def shield_sigma(eps_r: float, sigma0: float, d: float, f_hz: float, extra_db: float) -> float:
    """Conductivity σ' such that L_T(eps_r, σ', d) = L_T(eps_r, σ0, d) + extra_db (normal incidence)."""
    target = slab_loss_db(eps_r, sigma0, d, f_hz)[0] + extra_db
    g = lambda ls: slab_loss_db(eps_r, 10 ** ls, d, f_hz)[0] - target
    lo, hi = math.log10(max(sigma0, 1e-6)), math.log10(max(sigma0, 1e-6)) + 1
    while g(hi) < 0:
        hi += 1
    return 10 ** brentq(g, lo, hi, xtol=1e-10)


def sheet_resistance_equivalent(extra_db: float) -> float:
    """Sheet resistance R_s [Ω/sq] of an infinitely thin conductive film in free space whose
    transmission loss is ``extra_db``: |T| = 1 / (1 + η0 / (2 R_s))."""
    eta0 = 376.730313668
    return eta0 / (2 * (10 ** (extra_db / 20) - 1))


# ============================================================================ materials
def material_specs(B: Building, sp: ScenarioParams) -> dict:
    """Radio-material definition for every building.json material used as geometry, at sp.freq_ghz."""
    f = sp.freq_ghz
    specs = {}
    for key in B.materials:
        m = B.raw["materials"][key]
        if m["itu"] is None:            # air -> no geometry
            continue
        eps, sig = itu_eps_sigma(m["itu"], f)
        spec = {"kind": "itu", "itu": m["itu"], "t": float(m["t"]), "eps_r": eps, "sigma": sig,
                "mwm_loss_db": float(B.raw["materials"][key]["loss"][sp.fkey])}
        if key in sp.extra_db:
            extra = sp.extra_db[key]
            s2 = shield_sigma(eps, sig, spec["t"], f * 1e9, extra)
            spec.update({"kind": "custom", "sigma": s2, "sigma_itu": sig, "extra_db": extra,
                         "equiv_sheet_ohm_sq": sheet_resistance_equivalent(extra)})
            spec["mwm_loss_db"] += extra
        lt, lr = slab_loss_db(spec["eps_r"], spec["sigma"], spec["t"], f * 1e9)
        spec["slab_T_loss_db"], spec["slab_R_loss_db"] = lt, lr
        specs[key] = spec
    eps, sig = itu_eps_sigma(GROUND["itu"], f)
    specs["ground"] = {"kind": "itu", "itu": GROUND["itu"], "t": GROUND["t"], "eps_r": eps, "sigma": sig,
                       "mwm_loss_db": None}
    specs["ground"]["slab_T_loss_db"], specs["ground"]["slab_R_loss_db"] = slab_loss_db(eps, sig, GROUND["t"], f * 1e9)
    return specs


# ============================================================================ geometry
def opening_intervals(L: float, op: dict) -> list:
    """Intervals [s0, s1] along a wall of length L where the opening pattern applies (MODEL.md §2.1)."""
    P, wdt, off = float(op["period"]), float(op["width"]), float(op["offset"])
    out = []
    if P > 0:
        k0 = math.floor((0 - off - wdt) / P) - 1
        k1 = math.ceil((L - off) / P) + 1
        for k in range(k0, k1 + 1):
            s0, s1 = off + k * P, off + k * P + wdt
            s0, s1 = max(s0, 0.0), min(s1, L)
            if s1 - s0 > 1e-9:
                out.append((s0, s1))
    else:
        s0, s1 = max(off, 0.0), min(off + wdt, L)
        if s1 - s0 > 1e-9:
            out.append((s0, s1))
    return out


def wall_rectangles(w: dict) -> list:
    """Split one wall into (s0, s1, h0, h1, material) rectangles in wall coordinates."""
    a, b = np.array(w["a"], float), np.array(w["b"], float)
    L = float(np.linalg.norm(b - a))
    H = float(w["z1"]) - float(w["z0"])
    op = w.get("opening")
    if not op:
        return [(0.0, L, 0.0, H, w["mat"])]
    h0, h1 = min(max(float(op["sill"]), 0.0), H), min(max(float(op["head"]), 0.0), H)
    rects, cur = [], 0.0
    for s0, s1 in opening_intervals(L, op):
        if s0 > cur + 1e-9:
            rects.append((cur, s0, 0.0, H, w["mat"]))
        if h0 > 1e-9:
            rects.append((s0, s1, 0.0, h0, w["mat"]))
        if h1 - h0 > 1e-9 and op["mat"] != "air":
            rects.append((s0, s1, h0, h1, op["mat"]))
        if H - h1 > 1e-9:
            rects.append((s0, s1, h1, H, w["mat"]))
        cur = s1
    if L - cur > 1e-9:
        rects.append((cur, L, 0.0, H, w["mat"]))
    return rects


def scene_quads(B: Building) -> dict:
    """material key -> list of quads (4x3 vertex arrays)."""
    quads = {}
    add = lambda k, q: quads.setdefault(k, []).append(np.asarray(q, float))
    for w in B.raw["walls"]:
        a, b = np.array(w["a"], float), np.array(w["b"], float)
        L = float(np.linalg.norm(b - a))
        e = (b - a) / L
        z0 = float(w["z0"])
        for s0, s1, h0, h1, mat in wall_rectangles(w):
            p0, p1 = a + s0 * e, a + s1 * e
            add(mat, [[*p0, z0 + h0], [*p1, z0 + h0], [*p1, z0 + h1], [*p0, z0 + h1]])
    x0, y0, x1, y1 = B.slab_extent
    for zs in B.slab_planes:
        add("slab", [[x0, y0, zs], [x1, y0, zs], [x1, y1, zs], [x0, y1, zs]])
    for c in B.raw["context"]:                       # roofs (walls are in building.json walls)
        cx0, cy0, cx1, cy1 = c["rect"]
        h = float(c["height"])
        add("ctx_wall", [[cx0, cy0, h], [cx1, cy0, h], [cx1, cy1, h], [cx0, cy1, h]])
    gx0, gy0, gx1, gy1 = GROUND_RECT
    add("ground", [[gx0, gy0, 0.0], [gx1, gy0, 0.0], [gx1, gy1, 0.0], [gx0, gy1, 0.0]])
    return quads


def write_ply(path: Path, quads: list):
    """Binary little-endian PLY with two triangles per quad."""
    V = np.concatenate(quads).astype("<f4")
    F = []
    for i in range(len(quads)):
        o = 4 * i
        F += [(o, o + 1, o + 2), (o, o + 2, o + 3)]
    header = ("ply\nformat binary_little_endian 1.0\n"
              f"element vertex {len(V)}\nproperty float x\nproperty float y\nproperty float z\n"
              f"element face {len(F)}\nproperty list uchar int vertex_indices\nend_header\n").encode("ascii")
    body = V.tobytes() + b"".join(struct.pack("<B3i", 3, *f) for f in F)
    path.write_bytes(header + body)


def write_scene(B: Building, sp: ScenarioParams, out_dir: Path) -> tuple:
    """Write meshes/*.ply + scene.xml for the material configuration of ``sp``.
    Returns (xml_path, material specs, quad counts)."""
    out_dir = Path(out_dir)
    (out_dir / "meshes").mkdir(parents=True, exist_ok=True)
    specs = material_specs(B, sp)
    quads = scene_quads(B)
    lines = ['<scene version="2.1.0">']
    for key in quads:
        s = specs[key]
        if s["kind"] == "itu":
            lines += [f'  <bsdf type="itu-radio-material" id="rm-{key}">',
                      f'    <string name="type" value="{s["itu"]}"/>',
                      f'    <float name="thickness" value="{s["t"]:.6g}"/>', "  </bsdf>"]
        else:
            lines += [f'  <bsdf type="radio-material" id="rm-{key}">',
                      f'    <float name="relative_permittivity" value="{s["eps_r"]:.9g}"/>',
                      f'    <float name="conductivity" value="{s["sigma"]:.9g}"/>',
                      f'    <float name="thickness" value="{s["t"]:.6g}"/>', "  </bsdf>"]
    for key, qs in quads.items():
        write_ply(out_dir / "meshes" / f"{key}.ply", qs)
        lines += [f'  <shape type="ply" id="mesh-{key}">',
                  f'    <string name="filename" value="meshes/{key}.ply"/>',
                  '    <boolean name="face_normals" value="true"/>',
                  f'    <ref id="rm-{key}" name="bsdf"/>', "  </shape>"]
    lines.append("</scene>")
    xml = out_dir / "scene.xml"
    xml.write_text("\n".join(lines), encoding="utf-8")
    return xml, specs, {k: len(v) for k, v in quads.items()}


# ============================================================================ Sionna side
def load(xml_path: Path, freq_ghz: float):
    """Load the scene with Sionna RT (imports mitsuba / sionna lazily) and set the carrier."""
    import sionna.rt as rt
    scene = rt.load_scene(str(xml_path), merge_shapes=True)
    scene.frequency = freq_ghz * 1e9
    return scene


TR38901_DEFAULT = {"gmax_dbi": 8.0, "hpbw_deg": 65.0, "sla_db": 30.0}


def router_pattern(sp: ScenarioParams) -> str:
    """Name of the Sionna antenna pattern for the router of ``sp``.

    The vertical dipole is Sionna's ``hw_dipole``; a patch with the TR 38.901 default parameters
    (8 dBi, 65°, 30 dB) is Sionna's ``tr38901``.  Any other patch (e.g. the wide-beam ceiling panel of
    MODEL.md §3) is registered as a custom pattern with the same formula and the mount's parameters."""
    if sp.antenna == "dipole":
        return "hw_dipole"
    p = {k: float(v) for k, v in sp.patch.items()}
    if all(abs(p[k] - TR38901_DEFAULT[k]) < 1e-9 for k in TR38901_DEFAULT):
        return "tr38901"
    return register_patch_pattern(**p)


def register_patch_pattern(gmax_dbi: float, hpbw_deg: float, sla_db: float) -> str:
    """Register a TR 38.901-type element pattern with arbitrary (Gmax, HPBW, SLA) in Sionna RT."""
    import drjit as dr
    import mitsuba as mi
    from sionna.rt.antenna_pattern import PolarizedAntennaPattern, antenna_pattern_registry, register_antenna_pattern
    name = f"patch_g{gmax_dbi:g}_bw{hpbw_deg:g}_sla{sla_db:g}"
    try:
        antenna_pattern_registry.get(name)
        return name
    except Exception:  # noqa: BLE001 - not registered yet
        pass
    bw = hpbw_deg / 180.0 * math.pi

    def v_pattern(theta, phi):
        phi = phi + dr.pi
        phi -= dr.floor(phi / (2.0 * dr.pi)) * 2.0 * dr.pi
        phi -= dr.pi
        a_v = -dr.minimum(12.0 * ((theta - dr.pi / 2.0) / bw) ** 2, sla_db)
        a_h = -dr.minimum(12.0 * (phi / bw) ** 2, sla_db)
        a_db = -dr.minimum(-(a_v + a_h), sla_db) + gmax_dbi
        return mi.Complex2f(dr.sqrt(dr.power(10.0, a_db / 10.0)), 0)

    def factory(*, polarization, polarization_model="tr38901_2"):
        return PolarizedAntennaPattern(v_pattern=v_pattern, polarization=polarization,
                                       polarization_model=polarization_model)
    register_antenna_pattern(name, factory)
    return name


def router_orientation(sp: ScenarioParams):
    """Sionna orientation (alpha, beta, gamma) [rad] = rotations about (z, y, x).

    The antenna boresight is the local +x axis: R(alpha, beta, 0) x = (cos a cos b, sin a cos b, -sin b),
    so az -> alpha and tilt (positive up, MODEL.md §1) -> beta = -tilt.  The resulting local y axis is
    (-sin a, cos a, 0), identical to MODEL.md §3.  The vertical dipole keeps orientation (0, 0, 0)."""
    if sp.antenna == "dipole":
        return (0.0, 0.0, 0.0)
    return (math.radians(sp.az_deg), -math.radians(sp.tilt_deg), 0.0)
