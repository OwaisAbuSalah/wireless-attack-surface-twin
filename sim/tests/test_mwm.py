#!/usr/bin/env python
"""Hand-checkable unit tests of sim/twin/mwm.py against docs/MODEL.md (NumPy only).

    python sim/tests/test_mwm.py        (or: python -m pytest sim/tests)
"""

import math
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from twin import mwm                                          # noqa: E402
from twin.building import load_building, scenario_params      # noqa: E402
from twin.export import decode_rss, encode_rss                # noqa: E402
from twin.sionna_scene import opening_intervals, wall_rectangles   # noqa: E402

B = load_building()
SP = scenario_params(B, "baseline")
L24 = B.loss_table(2.4)


def pl(T, R, loss=L24, f=2.4):
    return float(mwm.path_loss(np.array(T, float), np.array([R], float), B, loss, f)[0])


def lb(T, R, loss=L24, f=2.4):
    return mwm.link_budget(B, T, R, f, loss)


def test_pl0():
    assert abs(mwm.pl0_db(2.4) - (20 * math.log10(2.4) + 32.44)) < 1e-12
    assert abs(mwm.pl0_db(5.0) - (20 * math.log10(5.0) + 32.44)) < 1e-12


def test_free_space_and_dmin():
    T, R = (-90.0, -60.0, 1.5), (-80.0, -60.0, 1.5)          # open lawn, no walls
    assert abs(pl(T, R) - (mwm.pl0_db(2.4) + 20.0)) < 1e-9
    assert abs(pl(T, (-89.9, -60.0, 1.5)) - (mwm.pl0_db(2.4) + 20 * math.log10(0.5))) < 1e-9


def test_facade_solid_vs_window():
    # floor-1 south facade, WIN pattern (offset 0.6, period 3, width 1.8, sill 0.9, head 2.7)
    solid = lb((-15.0, -7.0, 5.4), (-15.0, -9.0, 5.4))        # s = 3.0 -> m = 2.4 > 1.8 -> concrete
    assert [w["material"] for w in solid["walls"]] == ["ext_concrete"], solid["walls"]
    win = lb((-16.5, -7.0, 5.4), (-16.5, -9.0, 5.4))          # s = 1.5 -> m = 0.9, h = 1.8 -> glass
    assert [w["material"] for w in win["walls"]] == ["ext_glass"], win["walls"]
    below = lb((-16.5, -7.0, 4.0), (-16.5, -9.0, 4.0))        # h = 0.4 < sill -> concrete
    assert [w["material"] for w in below["walls"]] == ["ext_concrete"]
    d = 2.0
    assert abs(win["pl_db"] - (mwm.pl0_db(2.4) + 20 * math.log10(d) + 3.0)) < 1e-9


def test_slab_and_vertical_ray():
    r = lb((0.0, -5.0, 1.2), (0.0, -5.0, 4.8))                # vertical: no wall crossing, one slab (3.45)
    assert r["walls"] == [] and [s["z"] for s in r["slabs"]] == [3.45]
    assert abs(r["pl_db"] - (mwm.pl0_db(2.4) + 20 * math.log10(3.6) + 18.0)) < 1e-9
    out = lb((25.0, -5.0, 1.2), (25.0, -5.0, 4.8))            # outside the slab extent -> no slab
    assert out["slabs"] == []


def test_wall_height_test():
    # ray entirely above the ground-floor wall top (z1 = 3.6) but below floor-1 walls? -> crosses floor-1 wall only
    r = lb((-15.0, -7.0, 3.7), (-15.0, -9.0, 3.7))
    assert [w["id"][:2] for w in r["walls"]] == ["F1"]


def test_endpoint_on_wall_plane_never_counts():
    # receiver exactly on the corridor wall line y = -1.2 (floor 1, brick): t = 1 -> excluded by eps rule
    on = lb((-15.0, -5.0, 4.8), (-15.0, -1.2, 4.8))
    assert on["walls"] == [], on["walls"]
    beyond = lb((-15.0, -5.0, 4.8), (-15.0, -1.0, 4.8))
    assert [w["material"] for w in beyond["walls"]] == ["brick"]
    from_wall = lb((-15.0, -1.2, 4.8), (-15.0, 3.0, 4.8))            # source on the wall plane: t = 0
    assert all(w["t"] > 1e-5 for w in from_wall["walls"]), from_wall["walls"]   # its own wall (t = 0) not counted
    v = mwm.crossing_counts(np.array([-15.0, -5.0, 4.8]), np.array([[-15.0, -1.2, 4.8]]), B)
    assert v.sum() == 0


def test_coverage_excludes_core():
    g = B.grid("floor1", "realtime")
    from twin.building import cell_centers
    X, Y = cell_centers(g)
    rss = np.full((g["ny"], g["nx"]), -50.0)
    att = {k: np.zeros((1, 1), bool) for k in ("eavesdrop", "deauth", "eviltwin")}
    att["tier"] = np.zeros((1, 1), np.uint8)
    core = (X > -3) & (X < 3) & (Y > 1.2) & (Y < 8)
    rss[core] = -100.0                                            # dead zone only inside the core
    st = mwm.attack_stats(B, SP, {"x0": 0, "y0": 0, "dx": 1, "nx": 1, "ny": 1, "z": 1.5}, att, rss, g)
    assert st["coverage"] == 100.0


def test_antennas():
    v = np.array([[1.0, 0, 0], [0, 0, 1.0], [0, 0, -1.0]])
    g = mwm.gain_dipole(v)
    assert abs(g[0] - 2.15) < 1e-12 and abs(g[1] + 27.85) < 1e-9 and abs(g[2] + 27.85) < 1e-9
    b = np.array([[0.0, 1.0, 0.0]])                           # az = 90 boresight, tilt 0
    assert abs(mwm.gain_patch(b, 90, 0)[0] - 8.0) < 1e-12
    a = math.radians(32.5)                                    # half the HPBW in azimuth -> -3 dB
    assert abs(mwm.gain_patch(np.array([[-math.sin(a), math.cos(a), 0]]), 90, 0)[0] - 5.0) < 1e-9
    assert abs(mwm.gain_patch(np.array([[0, -1.0, 0]]), 90, 0)[0] - (8 - 30)) < 1e-9     # back lobe = SLA
    t = math.radians(-10)                                     # tilted boresight
    assert abs(mwm.gain_patch(np.array([[0, math.cos(t), math.sin(t)]]), 90, -10)[0] - 8.0) < 1e-12


def test_vectorised_equals_scalar():
    rng = np.random.default_rng(1)
    P = np.c_[rng.uniform(-60, 60, 400), rng.uniform(-40, 40, 400), rng.uniform(0, 11, 400)]
    v = mwm.rss_from_router(B, SP, P)
    s = [mwm.link_budget(B, SP.tx_pos, p, 2.4, SP.loss, mwm.router_gain_fn(SP), SP.tx_dbm)["rss_dbm"] for p in P]
    assert np.max(np.abs(v - np.array(s))) < 1e-9


def test_scenarios():
    s = scenario_params(B, "allRF")             # relocate + shieldWindows + shieldPaint + band5
    assert s.freq_ghz == 5.0 and s.tx_dbm == 20 and s.antenna == "dipole" and s.mount == "ceiling"
    assert s.loss[B.mat_index["ext_glass"]] == 5 + 28 and s.loss[B.mat_index["ext_concrete"]] == 26 + 24
    d = scenario_params(B, "directional")
    assert d.mount == "wall" and d.patch == {"gmax_dbi": 8, "hpbw_deg": 65, "sla_db": 30}
    c = scenario_params(B, protections=["directional", "relocate"])   # mount-specific ceiling panel
    assert c.tilt_deg == -90 and c.patch == {"gmax_dbi": 5.5, "hpbw_deg": 110, "sla_db": 25}
    down = np.array([[0.0, 0.0, -1.0]])
    assert abs(mwm.tx_gain(c, c.tx_pos, c.tx_pos + down)[0] - 5.5) < 1e-9


def test_nested_attack_tiers():
    # usb: G 5, S -92, P 27; client S_c -88; ET margin 3 dB, min -75 dBm. Two cells x one client.
    rss_ap = np.array([[-90.0, -100.0]])          # cell 0 hears the AP (-85 >= -92), cell 1 does not (-95)
    pl_c = np.full((1, 1, 2), 90.0)               # attacker at client: 27 + 5 - 90 = -58 dBm (deauth + ET ok)
    rss_ap_c = np.array([-70.0])                  # -58 >= -70 + 3 -> ET condition met
    a = mwm.attack_maps(B, SP, rss_ap, pl_c, rss_ap_c)
    assert a["eavesdrop"].tolist() == [[True, False]]
    assert a["deauth"].tolist() == [[True, False]] and a["eviltwin"].tolist() == [[True, False]]
    assert a["tier"].tolist() == [[3, 0]]
    assert abs(a["margin_deauth"][0, 1] - (-95 + 92)) < 1e-12          # limited by eavesdropping margin


def test_encoding():
    x = np.array([-np.inf, np.nan, -200, -130, -129.5, -129.26, -67.3, -2.5, 0.0, 10.0])
    v = encode_rss(x)
    assert v.tolist() == [0, 0, 0, 0, 1, 1, 125, 255, 255, 255], v.tolist()
    assert np.allclose(decode_rss(np.array([1, 125, 255], np.uint8)), [-129.5, -67.5, -2.5])


def test_opening_split():
    w = next(w for w in B.raw["walls"] if w["id"] == "F1-001")   # 36 m south facade, WIN
    ints = opening_intervals(36.0, w["opening"])
    assert len(ints) == 12 and abs(ints[0][0] - 0.6) < 1e-12 and abs(ints[0][1] - 2.4) < 1e-12
    rects = wall_rectangles(w)
    area = sum((s1 - s0) * (h1 - h0) for s0, s1, h0, h1, _ in rects)
    glass = sum((s1 - s0) * (h1 - h0) for s0, s1, h0, h1, m in rects if m == "ext_glass")
    assert abs(area - 36 * 3.6) < 1e-9 and abs(glass - 12 * 1.8 * 1.8) < 1e-9


if __name__ == "__main__":
    n = 0
    for name, f in list(globals().items()):
        if name.startswith("test_") and callable(f):
            f()
            n += 1
            print("ok ", name)
    print(f"{n} tests passed")
