#!/usr/bin/env python
"""Reference multi-wall model (docs/MODEL.md §2-7) for every scenario of building.json.

Outputs
  docs/figures/mwm_<scenario>.png (+ _dark.png)   maps on the real-time grid (0.4 m / 0.2 m)
  sim/out/mwm_stats.csv                           §7 statistics on both grids (realtime, sionna)
  sim/out/mwm_maps.json                           §8-format maps on the Sionna grid (generator "mwm-numpy")
  sim/out/mwm_testpoints.json                     itemised link budgets for unit-testing the JS/GLSL model

  python sim/run_mwm.py [--no-figures] [--grids realtime,sionna]
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
try:                                    # UTF-8 console/log output on Windows (m², ε, ...)
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except AttributeError:
    pass

from twin import FIGURES, OUT                                   # noqa: E402
from twin import mwm                                            # noqa: E402
from twin.building import load_building, scenario_params        # noqa: E402
from twin.export import grids_block, write_maps_json            # noqa: E402

STAT_KEYS = ["area_eavesdrop", "area_deauth", "area_eviltwin", "area_danger", "max_leak_m", "leak_reaches_edge",
             "street_exposure", "coverage"]


def run_maps(B, grids, figures: bool):
    rows, sionna_maps = [], {}
    caches = {g: {} for g in grids}
    eq = mwm.equipment(B)
    for name in B.scenarios:
        sp = scenario_params(B, name)
        for cell in grids:
            t0 = time.perf_counter()
            r = mwm.scenario_analysis(B, sp, cell, eq=eq, client_cache=caches[cell])
            dt = time.perf_counter() - t0
            st = r["stats"]
            rows.append({"scenario": name, "model": "mwm", "grid": cell,
                         "cell_outdoor_m": B.grid("outdoor", cell)["dx"], "cell_floor_m": B.grid("floor0", cell)["dx"],
                         "freq_ghz": sp.freq_ghz, "tx_dbm": sp.tx_dbm, "antenna": sp.antenna, "mount": sp.mount,
                         "equipment": eq["key"], **{k: st[k] for k in STAT_KEYS}, "runtime_s": round(dt, 2)})
            print(f"  {name:14s} {cell:8s} eav {st['area_eavesdrop']:9.1f} m²  deauth {st['area_deauth']:9.1f} m²  "
                  f"ET {st['area_eviltwin']:8.1f} m²  leak {st['max_leak_m']:6.1f} m  street {st['street_exposure']:5.1f} %  "
                  f"cov {st['coverage']:5.1f} %   ({dt:.1f} s)", flush=True)
            if cell == "sionna":
                sionna_maps[name] = {"freq_ghz": sp.freq_ghz, "tx_dbm": sp.tx_dbm, **r["maps"]}
            if figures and cell == grids[0]:
                from twin.plotting import save_both
                save_both(B, sp, r["maps"], r["attack"], st, "Multi-wall model (NumPy reference)",
                          FIGURES / f"mwm_{name}", cell=cell)
    return rows, sionna_maps


def _rec(B, sp, lid, tx_label, T, rx_label, R, kind="router", note=None):
    """One itemised test link."""
    T = np.round(np.asarray(T, float), 3)
    R = np.round(np.asarray(R, float), 3)
    if kind == "router":
        lb = mwm.link_budget(B, T, R, sp.freq_ghz, sp.loss, mwm.router_gain_fn(sp), sp.tx_dbm)
        tx_dbm, antenna = sp.tx_dbm, sp.antenna
    else:  # reciprocal client link: client is the source, no antenna gain (MODEL.md §6)
        lb = mwm.link_budget(B, T, R, sp.freq_ghz, sp.loss, None, None)
        tx_dbm, antenna = None, "none"
    rec = {"id": lid, "scenario": sp.name, "tx": tx_label, "tx_pos": T.tolist(), "rx": rx_label, "rx_pos": R.tolist(),
           "freq_ghz": sp.freq_ghz, "tx_dbm": tx_dbm, "antenna": antenna}
    if sp.antenna == "patch" and kind == "router":
        rec["antenna_az_deg"], rec["antenna_tilt_deg"] = sp.az_deg, sp.tilt_deg
        rec["antenna_patch"] = dict(sp.patch)
    rec.update({k: lb[k] for k in ("d_m", "pl0_db", "pl_distance_db", "pl_db", "gain_tx_dbi", "gain_rx_dbi", "rss_dbm",
                                   "walls", "slabs", "margin_m")})
    if note:
        rec["note"] = note
    return rec


def _random_points(B, rng, n, kind, sp, min_margin=0.05):
    pts = []
    while len(pts) < n:
        if kind == "outdoor":
            p = [rng.uniform(-100, 100), rng.uniform(-70, 70), B.rf["grids"]["outdoor"]["z"]]
            if B.inside_footprint(p[0], p[1]):
                continue
        elif kind == "near":
            p = [rng.uniform(-45, 45), rng.uniform(-35, 30), B.rf["grids"]["outdoor"]["z"]]
            if B.inside_footprint(p[0], p[1]):
                continue
        else:
            f = B.floors[int(rng.integers(len(B.floors)))]
            p = [rng.uniform(-17.8, 17.8), rng.uniform(-7.8, 7.8), f["z"] + B.rf["grids"]["floor"]["dz"]]
        p = np.round(p, 3)
        margin = min(mwm.link_budget(B, np.round(T, 3), p, sp.freq_ghz, sp.loss, mwm.router_gain_fn(sp),
                                     sp.tx_dbm)["margin_m"] for T in sp.tx_positions)
        if margin >= min_margin:
            pts.append(p)
    return pts


def run_testpoints(B, path: Path, seed=20261124):
    rng = np.random.default_rng(seed)
    sp = scenario_params(B, "baseline")
    links = []
    att = np.array([*B.attack["start"], B.rf["grids"]["outdoor"]["z"]])
    for c in B.clients:
        links.append(_rec(B, sp, f"ap-{c['id']}", "AP", sp.tx_pos, c["id"], c["pos"]))
    links.append(_rec(B, sp, "ap-attacker_start", "AP", sp.tx_pos, "attacker_start", att))
    k = 0
    for kind, n in (("outdoor", 10), ("near", 8), ("indoor", 12)):
        for p in _random_points(B, rng, n, kind, sp):
            k += 1
            links.append(_rec(B, sp, f"ap-rand{k:02d}", "AP", sp.tx_pos, f"random_{kind}", p))
    c1 = np.array(B.clients[0]["pos"])
    outs = [att] + _random_points(B, rng, 3, "near", sp)
    for i, p in enumerate(outs):
        links.append(_rec(B, sp, f"c1-out{i}", "c1", c1, "attacker_start" if i == 0 else "random_near", p,
                          kind="client", note="PL(X,c): client is the source, no antenna gain; rss undefined"))
    # a few links for every other scenario (patch antenna, 5 GHz, ceiling mount, shielding)
    extra = []
    # every other scenario + one non-scenario combination exercising the ceiling-mount patch (MODEL.md §3)
    others = [(n, None) for n in B.scenarios if n != "baseline"] + [(None, ["directional", "relocate"])]
    for name, prot in others:
        s2 = scenario_params(B, name, protections=prot)
        name = s2.name
        pts = [att] + _random_points(B, rng, 1, "near", s2) + _random_points(B, rng, 1, "indoor", s2)
        labels = ["attacker_start", "random_near", "random_indoor", "c3"]
        pts = pts + [np.array(B.clients[2]["pos"], float)]
        multi = len(s2.tx_positions) > 1
        for i, p in enumerate(pts):
            # several APs (micro-cells): one itemised link per AP + the combined RSS = max over APs (MODEL.md §4)
            for k, T in enumerate(s2.tx_positions):
                lid = f"{name}-ap-c3" if i == 3 else f"{name}-{i}"
                rec = _rec(B, s2, lid + (f"-ap{k + 1}" if multi else ""), f"AP{k + 1}" if multi else "AP", T,
                           labels[i], p)
                if multi:
                    rec["rss_max_over_aps_dbm"] = float(mwm.rss_from_router(B, s2, np.round(p, 3)[None])[0])
                extra.append(rec)

    # attack feasibility at a few outdoor positions (baseline, default equipment) -- MODEL.md §6
    eq = mwm.equipment(B)
    checks = []
    for p in [att] + _random_points(B, rng, 5, "near", sp):
        p = np.round(p, 3)
        rss_ap = float(mwm.rss_from_router(B, sp, p[None])[0])
        pl_c = np.array([mwm.path_loss(c, p[None], B, sp.loss, sp.freq_ghz)[0] for c in B.client_positions()])
        rss_ap_c = mwm.rss_router_to_clients(B, sp)
        p_at_c = eq["P"] + eq["G"] - pl_c
        eav_m = rss_ap + eq["G"] - eq["S"]
        deauth_m = float(p_at_c.max() - B.attack["client"]["sens_dbm"])
        et_c = np.minimum(p_at_c - (rss_ap_c + B.attack["evil_twin"]["margin_db"]),
                          p_at_c - B.attack["evil_twin"]["min_rss_dbm"])
        checks.append({"pos": p.tolist(), "equipment": eq["key"], "rss_ap_dbm": rss_ap,
                       "pl_client_db": dict(zip([c["id"] for c in B.clients], pl_c.tolist())),
                       "rss_ap_client_dbm": dict(zip([c["id"] for c in B.clients], rss_ap_c.tolist())),
                       "attacker_at_client_dbm": dict(zip([c["id"] for c in B.clients], p_at_c.tolist())),
                       "margin_eavesdrop_db": eav_m,
                       "margin_deauth_raw_db": deauth_m, "margin_eviltwin_raw_db": float(et_c.max()),
                       "margin_deauth_db": min(deauth_m, eav_m), "margin_eviltwin_db": min(float(et_c.max()), eav_m),
                       "eviltwin_clients_raw": [c["id"] for c, e in zip(B.clients, et_c) if e >= 0],
                       "eavesdrop": bool(eav_m >= 0), "deauth": bool(min(deauth_m, eav_m) >= 0),
                       "eviltwin": bool(min(float(et_c.max()), eav_m) >= 0)})
    doc = {
        "description": "Itemised multi-wall link budgets computed with sim/twin/mwm.py (docs/MODEL.md §2-6) for unit-"
                       "testing other implementations. Positions are in metres (x east, y north, z up). "
                       "rss_dbm = tx_dbm + gain_tx_dbi + gain_rx_dbi - pl_db; pl_db = pl0_db + pl_distance_db + "
                       "sum(walls.loss_db) + sum(slabs.loss_db); d_m is the clamped distance max(|R-T|, 0.5). "
                       "Client-source links (tx = c1) give PL(X, c) with no antenna gain and rss_dbm = null. "
                       "margin_m = smallest distance of the link to any model decision boundary (all >= 0.05 m "
                       "for the random links). t/u/s_m/zc are the crossing parameters of §2.1 (a wall counts only for "
                       "1e-5 < t < 1 - 1e-5). attack_checks_baseline: "
                       "§6 with nested tiers (deauth and evil twin also require eavesdropping): margin_*_db = "
                       "min(raw margin, margin_eavesdrop_db); feasible when margin >= 0.",
        "model": "docs/MODEL.md", "generator": "sim/twin/mwm.py", "seed": seed,
        "building_json_sha256": B.extra["sha256"],
        "pathloss_exponent": B.rf["pathloss_exponent"], "min_distance_m": B.rf["min_distance_m"],
        "loss_tables_db": {s: dict(zip(B.materials, scenario_params(B, s).loss.tolist())) for s in B.scenarios},
        "scenario_protections": {s: B.scenarios[s]["protections"] for s in B.scenarios},
        "links": links, "links_other_scenarios": extra, "attack_checks_baseline": checks,
    }
    path.write_text(json.dumps(doc, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"  wrote {path} ({len(links)} baseline links, {len(extra)} other-scenario links, {len(checks)} attack checks)")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--no-figures", action="store_true")
    ap.add_argument("--grids", default="realtime,sionna")
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    FIGURES.mkdir(parents=True, exist_ok=True)
    B = load_building()
    t0 = time.perf_counter()
    print("MWM reference maps:")
    grids = args.grids.split(",")
    rows, smaps = run_maps(B, grids, not args.no_figures)
    with open(OUT / "mwm_stats.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    print(f"  wrote {OUT / 'mwm_stats.csv'}")
    if smaps:
        size = write_maps_json(OUT / "mwm_maps.json", "mwm-numpy",
                               {"model": B.rf["model"], "pathloss_exponent": B.rf["pathloss_exponent"],
                                "equipment_for_stats": B.attack["default_equipment"],
                                "building_json_sha256": B.extra["sha256"]},
                               grids_block(B, "sionna"), smaps)
        print(f"  wrote {OUT / 'mwm_maps.json'} ({size / 1024:.0f} kB)")
    run_testpoints(B, OUT / "mwm_testpoints.json")
    print(f"done in {time.perf_counter() - t0:.1f} s")


if __name__ == "__main__":
    main()
