#!/usr/bin/env python
"""Canonical checks of the Sionna RT conventions used by run_sionna.py (needs sionna-rt + GPU/LLVM).

1. Free space, vertical λ/2 dipole: RadioMapSolver path gain vs. P_tx + G_dipole - FSPL (MWM §2-3, n = 2).
2. Free space, 3GPP patch at (az = 90°, tilt = -10°) using run_sionna's orientation (az, -tilt, 0):
   checks that the antenna orientation reproduces MODEL.md §3 (boresight, local frame, pattern); same for the
   mount-specific ceiling panel (5.5 dBi, 110°, 25 dB, boresight down) registered as a custom Sionna pattern.
3. One zero-thickness concrete surface (t = 0.30 m) between TX and a measurement plane: the excess loss
   equals the ITU-R P.2040 single-slab transmission loss computed by twin.sionna_scene.slab_loss_db,
   i.e. a single planar surface with `thickness` is crossed exactly once (no double counting).

    python sim/tests/test_sionna_canonical.py        ->  prints a table and writes sim/out/sionna_canonical.json
"""

import json
import math
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import mitsuba as mi                     # noqa: E402
import sionna.rt as rt                   # noqa: E402

from twin import OUT                     # noqa: E402
from twin import mwm                     # noqa: E402
from twin.sionna_scene import itu_eps_sigma, slab_loss_db, write_ply   # noqa: E402

F_GHZ = 2.4
N = int(3e8)


def P3(v):
    return mi.Point3f(*[float(x) for x in v])


def solve(scene, center, orientation, size, cell, samples=N):
    rm = rt.RadioMapSolver()(scene, center=P3(center), orientation=P3(orientation), size=mi.Point2f(*size),
                             cell_size=mi.Point2f(cell, cell), samples_per_tx=samples, max_depth=5, los=True,
                             specular_reflection=True, diffuse_reflection=False, refraction=True, seed=7)
    return rm.path_gain.numpy()[0], rm.cell_centers.numpy()


def free_space(pattern, orientation, gain_fn, label):
    scene = rt.load_scene()
    scene.frequency = F_GHZ * 1e9
    scene.tx_array = rt.PlanarArray(num_rows=1, num_cols=1, pattern=pattern, polarization="V")
    T = np.array([0.0, 0.0, 5.0])
    scene.add(rt.Transmitter("tx", position=P3(T), orientation=P3(orientation), power_dbm=0.0))
    pg, cc = solve(scene, (0, 0, 1.5), (0, 0, 0), (40, 40), 0.5)
    R = cc.reshape(-1, 3)
    d = np.linalg.norm(R - T, axis=1)
    pl = mwm.pl0_db(F_GHZ) + 20 * np.log10(d)
    ref = gain_fn(mwm._unit(T, R)) - pl
    sim = 10 * np.log10(np.maximum(pg.ravel(), 1e-30))
    ok = (ref > -80) & (d < 25)
    e = sim[ok] - ref[ok]
    return {"case": label, "cells": int(ok.sum()), "mean_err_db": float(e.mean()), "rmse_db": float(np.sqrt((e ** 2).mean())),
            "p95_abs_err_db": float(np.percentile(np.abs(e), 95))}


def one_wall(tmp: Path):
    eps, sig = itu_eps_sigma("concrete", F_GHZ)
    t = 0.30
    (tmp / "meshes").mkdir(parents=True, exist_ok=True)
    write_ply(tmp / "meshes" / "wall.ply", [np.array([[5, -20, -20], [5, 20, -20], [5, 20, 20], [5, -20, 20]], float)])
    (tmp / "wall.xml").write_text(
        '<scene version="2.1.0"><bsdf type="itu-radio-material" id="rm-c"><string name="type" value="concrete"/>'
        f'<float name="thickness" value="{t}"/></bsdf><shape type="ply" id="mesh-wall"><string name="filename" '
        'value="meshes/wall.ply"/><boolean name="face_normals" value="true"/><ref id="rm-c" name="bsdf"/></shape></scene>')
    res = {}
    for name, scene in (("wall", rt.load_scene(str(tmp / "wall.xml"))), ("free", rt.load_scene())):
        scene.frequency = F_GHZ * 1e9
        scene.tx_array = rt.PlanarArray(num_rows=1, num_cols=1, pattern="iso", polarization="V")
        scene.add(rt.Transmitter("tx", position=P3((0, 0, 0)), orientation=P3((0, 0, 0)), power_dbm=0.0))
        # vertical measurement plane x = 10 (normal +x): orientation (0, pi/2, 0)
        pg, cc = solve(scene, (10, 0, 0), (0, math.pi / 2, 0), (4, 4), 0.5)
        res[name] = pg
    c = slice(3, 5)
    excess = 10 * np.log10(res["free"][c, c].mean() / res["wall"][c, c].mean())
    return {"case": "single concrete surface t=0.30 m, normal incidence", "sionna_excess_loss_db": float(excess),
            "itu_slab_T_loss_db": slab_loss_db(eps, sig, t, F_GHZ * 1e9)[0]}


def main():
    print("Mitsuba variant:", mi.variant(), "| sionna-rt", rt.__version__)
    out = []
    out.append(free_space("hw_dipole", (0, 0, 0), mwm.gain_dipole, "free space, vertical half-wave dipole"))
    az, tilt = 90.0, -10.0
    out.append(free_space("tr38901", (math.radians(az), -math.radians(tilt), 0),
                          lambda v: mwm.gain_patch(v, az, tilt), "free space, 3GPP patch az=90 tilt=-10"))
    # mount-specific wide-beam ceiling panel (MODEL.md §3): custom pattern registered by twin.sionna_scene
    from twin.sionna_scene import register_patch_pattern
    name = register_patch_pattern(5.5, 110.0, 25.0)
    out.append(free_space(name, (math.radians(90), math.radians(90), 0),
                          lambda v: mwm.gain_patch(v, 90, -90, 5.5, 110, 25), "free space, ceiling patch 5.5 dBi/110°, tilt=-90"))
    out.append(one_wall(OUT / "cache" / "canonical"))
    for r in out:
        print(json.dumps(r))
    (OUT / "sionna_canonical.json").write_text(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
