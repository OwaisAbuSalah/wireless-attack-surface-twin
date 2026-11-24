#!/usr/bin/env python
"""Compare field RSSI measurements with the multi-wall model (MWM) and the Sionna RT maps.

    python sim/measure/compare_measurements.py my_points.csv [--scenario baseline]
                                                [--sionna web/src/data/sionna.json] [--out report.json]

CSV columns (see rssi_measurements_template.csv): point_id, x_m, y_m, z_m, rssi_dbm, device, notes.
Coordinates are in the building frame of data/building.json (x east, y north, z up, metres, origin =
building centre at ground level).  Lines starting with '#' are ignored (the template's example rows).

Reported:
* per point: measured RSSI, MWM prediction (MODEL.md §2-4, nominal losses of the chosen scenario),
  Sionna RT value of the nearest map cell (outdoor plane outside the footprint, the floor plane of the
  point's storey inside it), and the errors (model - measured);
* RMSE / MAE / mean bias / Pearson r per model;
* a least-squares fit of the MWM to the data:  RSSI = P_tx + G_tx - PL0 - sum(L_walls) - 10 n log10 d + offset
  (unknowns n and offset; with n fixed at the model value, only the offset);
* a constant offset for Sionna RT (mean of measured - Sionna);
* optionally (--per-device) the mean residual per receiving device, i.e. device RSSI offsets.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
try:                                    # UTF-8 console/log output on Windows (m², ε, ...)
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except AttributeError:
    pass

from twin import WEB_SIONNA_JSON                               # noqa: E402
from twin import mwm                                           # noqa: E402
from twin.building import load_building, scenario_params       # noqa: E402

REQUIRED = ["point_id", "x_m", "y_m", "z_m", "rssi_dbm"]


def read_points(path: Path) -> list:
    lines = [ln for ln in Path(path).read_text(encoding="utf-8-sig").splitlines()
             if ln.strip() and not ln.lstrip().startswith("#")]
    rows = list(csv.DictReader(io.StringIO("\n".join(lines))))
    missing = [c for c in REQUIRED if rows and c not in rows[0]]
    if missing:
        sys.exit(f"missing columns: {missing}")
    pts = []
    for r in rows:
        try:
            pts.append({"point_id": r["point_id"], "pos": [float(r["x_m"]), float(r["y_m"]), float(r["z_m"])],
                        "rssi": float(r["rssi_dbm"]), "device": (r.get("device") or "").strip(), "notes": r.get("notes", "")})
        except ValueError as e:
            sys.exit(f"bad row {r}: {e}")
    return pts


def sionna_lookup(B, doc_maps, grids, scenario, pos):
    """Nearest-cell Sionna RSS for a point; returns (rss or None, plane, |dz|)."""
    x, y, z = pos
    if B.inside_footprint(x, y):
        f = B.floor_of_z(z)
        plane = f"floor{f}" if f >= 0 else "outdoor"
    else:
        plane = "outdoor"
    g = grids[plane]
    i = int(np.floor((x - g["x0"]) / g["dx"]))
    j = int(np.floor((y - g["y0"]) / g["dx"]))
    if not (0 <= i < g["nx"] and 0 <= j < g["ny"]):
        return None, plane, None
    v = doc_maps[scenario][plane][j, i]
    return (float(v) if np.isfinite(v) else None), plane, abs(z - g["z"])


def stats(err):
    err = np.asarray(err, float)
    if err.size == 0:
        return None
    return {"n": int(err.size), "rmse_db": float(np.sqrt(np.mean(err ** 2))), "mae_db": float(np.mean(np.abs(err))),
            "bias_db": float(np.mean(err))}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("csv", type=Path)
    ap.add_argument("--scenario", default="baseline", help="scenario of building.json the measurement corresponds to")
    ap.add_argument("--sionna", type=Path, default=WEB_SIONNA_JSON)
    ap.add_argument("--per-device", action="store_true")
    ap.add_argument("--out", type=Path)
    a = ap.parse_args()

    B = load_building()
    sp = scenario_params(B, a.scenario)
    pts = read_points(a.csv)
    if not pts:
        sys.exit("no measurement rows (lines starting with '#' are ignored)")
    doc_maps, grids = None, None
    if a.sionna.exists():
        from twin.export import read_maps_json
        d = read_maps_json(a.sionna)
        if a.scenario in d["maps"]:
            doc_maps, grids = d["maps"], d["grids"]

    P = np.array([p["pos"] for p in pts])
    meas = np.array([p["rssi"] for p in pts])
    counts = mwm.crossing_counts(sp.tx_pos, P, B)
    walls = counts @ sp.loss
    d = mwm.distance(sp.tx_pos, P, float(B.rf["min_distance_m"]))
    gtx = mwm.tx_gain(sp, sp.tx_pos, P)
    pl0 = mwm.pl0_db(sp.freq_ghz)
    n0 = float(B.rf["pathloss_exponent"])
    rss_mwm = sp.tx_dbm + gtx - (pl0 + 10 * n0 * np.log10(d) + walls)

    rows = []
    for k, p in enumerate(pts):
        s, plane, dz = (None, None, None)
        if doc_maps is not None:
            s, plane, dz = sionna_lookup(B, doc_maps, grids, a.scenario, p["pos"])
        rows.append({"point_id": p["point_id"], "pos": p["pos"], "device": p["device"], "measured_dbm": p["rssi"],
                     "mwm_dbm": float(rss_mwm[k]), "mwm_err_db": float(rss_mwm[k] - p["rssi"]),
                     "sionna_dbm": s, "sionna_plane": plane, "sionna_plane_dz_m": dz,
                     "sionna_err_db": (s - p["rssi"]) if s is not None else None,
                     "distance_m": float(d[k]), "wall_loss_db": float(walls[k])})

    res = {"scenario": a.scenario, "freq_ghz": sp.freq_ghz, "tx_dbm": sp.tx_dbm, "points": rows,
           "mwm": stats([r["mwm_err_db"] for r in rows])}
    if len(rows) >= 2:
        res["mwm"]["pearson_r"] = float(np.corrcoef(meas, rss_mwm)[0, 1])
    # MWM fit: y = meas - (P + G - PL0 - W) = -10 n log10 d + offset
    y = meas - (sp.tx_dbm + gtx - pl0 - walls)
    fit = {"offset_only": {"n": n0, "offset_db": float(np.mean(y + 10 * n0 * np.log10(d)))}}
    fit["offset_only"]["rmse_db"] = float(np.sqrt(np.mean((y + 10 * n0 * np.log10(d) - fit["offset_only"]["offset_db"]) ** 2)))
    if len(rows) >= 3 and np.ptp(np.log10(d)) > 0.1:
        A = np.c_[-10 * np.log10(d), np.ones_like(d)]
        (n_fit, off), *_ = np.linalg.lstsq(A, y, rcond=None)
        r = y - A @ np.array([n_fit, off])
        fit["n_and_offset"] = {"n": float(n_fit), "offset_db": float(off), "rmse_db": float(np.sqrt(np.mean(r ** 2)))}
    else:
        fit["n_and_offset"] = "needs >= 3 points spanning a range of distances"
    res["mwm_fit"] = fit
    se = [r["sionna_err_db"] for r in rows if r["sionna_err_db"] is not None]
    if se:
        res["sionna"] = stats(se)
        off = -float(np.mean(se))
        res["sionna"]["offset_db"] = off
        res["sionna"]["rmse_after_offset_db"] = float(np.sqrt(np.mean((np.array(se) + off) ** 2)))
        ms = [(r["measured_dbm"], r["sionna_dbm"]) for r in rows if r["sionna_dbm"] is not None]
        if len(ms) >= 2:
            res["sionna"]["pearson_r"] = float(np.corrcoef(*np.array(ms).T)[0, 1])
    else:
        res["sionna"] = "no Sionna map available for this scenario/points"
    if a.per_device:
        dev = {}
        for r in rows:
            dev.setdefault(r["device"] or "?", []).append(r["mwm_err_db"])
        res["device_offsets_mwm_db"] = {k: {"n": len(v), "mean_model_minus_measured_db": float(np.mean(v))}
                                        for k, v in dev.items()}

    print(f"{len(rows)} points, scenario '{a.scenario}' ({sp.freq_ghz:g} GHz, {sp.tx_dbm:g} dBm)\n")
    print(f"{'point':>10} {'meas':>7} {'MWM':>7} {'err':>6} {'Sionna':>7} {'err':>6}  plane")
    for r in rows:
        sv = f"{r['sionna_dbm']:7.1f} {r['sionna_err_db']:+6.1f}" if r["sionna_dbm"] is not None else f"{'-':>7} {'-':>6}"
        print(f"{r['point_id']:>10} {r['measured_dbm']:7.1f} {r['mwm_dbm']:7.1f} {r['mwm_err_db']:+6.1f} {sv}  {r['sionna_plane']}")
    print("\nMWM:   ", json.dumps(res["mwm"]))
    print("MWM fit:", json.dumps(res["mwm_fit"]))
    print("Sionna:", json.dumps(res["sionna"]))
    if a.per_device:
        print("Device offsets:", json.dumps(res["device_offsets_mwm_db"]))
    if a.out:
        a.out.write_text(json.dumps(res, indent=1), encoding="utf-8")
        print("wrote", a.out)


if __name__ == "__main__":
    main()
