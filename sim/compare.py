#!/usr/bin/env python
"""MWM (reference model) vs. Sionna RT: validation metrics, figures and least-squares calibration.

Inputs   sim/out/cache/sionna_<scenario>.npz (written by run_sionna.py; falls back to web/src/data/sionna.json)
Outputs  docs/figures/compare_<scenario>.png (+ _dark), docs/figures/compare_calibration.png (+ _dark)
         sim/out/compare_metrics.csv, sim/out/calibration.json, sim/out/RESULTS.md

Metrics are computed on cells where both models give RSS > -120 dBm; outdoor cells outside the
footprint, floor cells inside it (MODEL.md §7).  Error = MWM - Sionna [dB].

Calibration.  Because PL_MWM = PL0 + 10 n log10(d) + sum_m N_m L_m is linear in (n, L_m), the material
losses (and optionally n) are fitted by bounded weighted linear least squares to the Sionna path loss
PL_S = P_tx + G_tx - RSS_S (AP maps; G_tx from the MODEL.md §3 patterns, identical to Sionna's) and
PL_S = -10 log10 g (client-source outdoor maps), each map weighted equally.  Base losses are fitted per
frequency on the unshielded scenarios; the shielding increments (extra_db) are then fitted on the
shielded scenarios with the base losses fixed.  Leave-one-scenario-out errors are reported for 2.4 GHz.

  python sim/compare.py
"""

from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

import numpy as np
from scipy.optimize import lsq_linear

sys.path.insert(0, str(Path(__file__).resolve().parent))
try:                                    # UTF-8 console/log output on Windows (m², ε, ...)
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except AttributeError:
    pass

from twin import CACHE, FIGURES, OUT, WEB_SIONNA_JSON              # noqa: E402
from twin import mwm                                               # noqa: E402
from twin.building import cell_centers, grid_points, load_building, scenario_params   # noqa: E402

FLOOR_DB = -120.0
CAL_MATS = ["ext_concrete", "concrete", "brick", "drywall", "ext_glass", "glass", "wood", "metal", "slab", "ctx_wall"]
STAT_KEYS = ["area_eavesdrop", "area_deauth", "area_eviltwin", "max_leak_m", "street_exposure", "coverage"]


# ============================================================================ data
def load_sionna(B):
    out = {}
    for name in B.scenarios:
        f = CACHE / f"sionna_{name}.npz"
        if f.exists():
            z = np.load(f)
            out[name] = {k: z[k].astype(np.float64) for k in z.files if k != "meta"}
    if out:
        return out, "cache (float32)"
    from twin.export import read_maps_json
    doc = read_maps_json(WEB_SIONNA_JSON)
    return {n: {k: v for k, v in m.items() if isinstance(v, np.ndarray)} for n, m in doc["maps"].items()}, \
        "sionna.json (uint8, 0.5 dB steps)"


class Geo:
    """Cached crossing counts / distances / grid masks (geometry only, independent of losses)."""

    def __init__(self, B):
        self.B, self._c = B, {}

    def get(self, T, plane):
        key = (tuple(np.round(T, 4)), plane)
        if key not in self._c:
            g = self.B.grid(plane, "sionna")
            P = grid_points(g)
            X, Y = cell_centers(g)
            region = ~self.B.inside_footprint(X, Y) if plane == "outdoor" else self.B.inside_footprint(X, Y)
            self._c[key] = {"counts": mwm.crossing_counts(T, P, self.B),
                            "logd": np.log10(mwm.distance(T, P, float(self.B.rf["min_distance_m"]))),
                            "P": P, "region": region.ravel(), "grid": g}
        return self._c[key]


def metrics(err: np.ndarray) -> dict:
    if err.size == 0:
        return {"n": 0, "rmse": np.nan, "mae": np.nan, "bias": np.nan, "std": np.nan}
    return {"n": int(err.size), "rmse": float(np.sqrt(np.mean(err ** 2))), "mae": float(np.mean(np.abs(err))),
            "bias": float(np.mean(err)), "std": float(np.std(err))}


# ============================================================================ calibration
def design_rows(B, geo, sp, sion, include_clients=True):
    """Rows (A, b, w, tag) for the linear model  PL - PL0 = 10 n log10 d + counts @ L."""
    rows = []
    pl0 = mwm.pl0_db(sp.freq_ghz)
    for plane in B.plane_names():
        G = geo.get(sp.tx_pos, plane)
        rss_s = sion[plane].ravel()
        gtx = mwm.tx_gain(sp, sp.tx_pos, G["P"])
        ok = G["region"] & np.isfinite(rss_s) & (rss_s > FLOOR_DB)
        pl_s = sp.tx_dbm + gtx - rss_s
        rows.append((G["counts"][ok], G["logd"][ok], pl_s[ok] - pl0, np.full(ok.sum(), 1.0 / max(ok.sum(), 1)), ("ap", plane)))
    if include_clients and "pl_clients" in sion:
        for c, plc in zip(B.client_positions(), sion["pl_clients"]):
            G = geo.get(c, "outdoor")
            pl_s = plc.ravel()
            ok = G["region"] & np.isfinite(pl_s) & (pl_s < 140.0)   # ~ RSS > -120 dBm for a 20 dBm source
            rows.append((G["counts"][ok], G["logd"][ok], pl_s[ok] - pl0, np.full(ok.sum(), 1.0 / max(ok.sum(), 1)), ("client", "outdoor")))
    return rows


def fit(B, rows, fit_n: bool, freq_ghz: float, n_fixed=2.0, min_cells=100):
    """Bounded weighted LSQ for (n,) L_m.  Materials crossed by fewer than ``min_cells`` rows are not
    identifiable from the data and stay at their nominal value.  Returns dict(n, loss[nmat], ...)."""
    nominal = B.loss_table(freq_ghz)
    C = np.concatenate([r[0] for r in rows])
    logd = np.concatenate([r[1] for r in rows])
    y = np.concatenate([r[2] for r in rows])
    w = np.sqrt(np.concatenate([r[3] for r in rows]))
    used_all = {m: int((C[:, B.mat_index[m]] > 0).sum()) for m in CAL_MATS}
    free = [m for m in CAL_MATS if used_all[m] >= min_cells]
    idx = [B.mat_index[m] for m in free]
    fixed_idx = [k for k in range(len(B.materials)) if k not in idx]
    y_adj = y - C[:, fixed_idx] @ nominal[fixed_idx]
    cols = [C[:, idx]]
    lb, ub = [0.0] * len(idx), [80.0] * len(idx)
    if fit_n:
        cols.insert(0, 10 * logd[:, None]); lb.insert(0, 1.0); ub.insert(0, 5.0)
    else:
        y_adj = y_adj - 10 * n_fixed * logd
    A = np.hstack(cols)
    res = lsq_linear(A * w[:, None], y_adj * w, bounds=(lb, ub), method="bvls")
    x = res.x
    n = float(x[0]) if fit_n else n_fixed
    loss = nominal.copy()
    loss[idx] = x[1:] if fit_n else x
    pred = 10 * n * logd + C @ loss
    pred_nom = 10 * float(B.rf["pathloss_exponent"]) * logd + C @ nominal
    wrms = lambda p: float(np.sqrt(np.sum(w ** 2 * (p - y) ** 2) / np.sum(w ** 2)))
    return {"n": n, "loss": loss, "cells_crossing": used_all, "fitted": free, "rows": int(len(y)),
            "weighted_rmse_db": wrms(pred), "weighted_rmse_nominal_db": wrms(pred_nom)}


def fit_extras(B, rows, base_loss, n, mats):
    """Fit additive increments for `mats` with everything else fixed."""
    idx = [B.mat_index[m] for m in mats]
    C = np.concatenate([r[0] for r in rows]); logd = np.concatenate([r[1] for r in rows])
    y = np.concatenate([r[2] for r in rows]); w = np.sqrt(np.concatenate([r[3] for r in rows]))
    resid = y - 10 * n * logd - C @ base_loss
    A = C[:, idx]
    res = lsq_linear(A * w[:, None], resid * w, bounds=([-40.0] * len(idx), [80.0] * len(idx)), method="bvls")
    return dict(zip(mats, res.x.tolist()))


# ============================================================================ figures
def compare_figure(B, name, sp, mw, si, met, path, theme="light"):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from twin.plotting import THEMES, _draw_context, _draw_walls, _style_axes, DPI, WIDTH_IN
    th = THEMES[theme]
    fig = plt.figure(figsize=(WIDTH_IN, 9.6), dpi=DPI, facecolor=th["bg"])
    gs = fig.add_gridspec(2, 3, height_ratios=[2.35, 1.0], width_ratios=[1, 1, 1], hspace=0.18, wspace=0.12,
                          left=0.06, right=0.9, top=0.93, bottom=0.04)
    cm = matplotlib.colormaps["RdBu_r"].copy()
    cm.set_bad(th["under"])
    # scatter
    ax = fig.add_subplot(gs[0, 0]); _style_axes(ax, th)
    xs, ys = [], []
    for plane in B.plane_names():
        g = B.grid(plane, "sionna")
        X, Y = cell_centers(g)
        reg = ~B.inside_footprint(X, Y) if plane == "outdoor" else B.inside_footprint(X, Y)
        ok = reg & np.isfinite(si[plane]) & (si[plane] > FLOOR_DB) & (mw[plane] > FLOOR_DB)
        xs.append(si[plane][ok]); ys.append(mw[plane][ok])
    xs, ys = np.concatenate(xs), np.concatenate(ys)
    hb = ax.hexbin(xs, ys, gridsize=70, extent=(-125, -15, -125, -15), bins="log", cmap="viridis", mincnt=1)
    ax.plot([-125, -15], [-125, -15], color=th["fg"], lw=1)
    for o in (-10, 10):
        ax.plot([-125, -15], [-125 + o, -15 + o], color=th["fg"], lw=0.6, ls="--")
    ax.set_xlim(-125, -15); ax.set_ylim(-125, -15); ax.set_aspect("equal")
    ax.set_xlabel("Sionna RT RSS [dBm]"); ax.set_ylabel("MWM RSS [dBm]")
    ax.set_title("All planes (cells > −120 dBm)", fontsize=9, color=th["fg"])
    m_all = met["all"]
    ax.text(0.03, 0.97, f"N = {m_all['n']:,}\nRMSE {m_all['rmse']:.1f} dB\nMAE {m_all['mae']:.1f} dB\n"
                        f"bias {m_all['bias']:+.1f} dB", transform=ax.transAxes, va="top", fontsize=8, color=th["fg"],
            family="monospace", bbox=dict(boxstyle="round", facecolor=th["box"], edgecolor=th["grid"]))
    # outdoor difference
    ax = fig.add_subplot(gs[0, 1:]); _style_axes(ax, th)
    g = B.grid("outdoor", "sionna")
    X, Y = cell_centers(g)
    ok = (~B.inside_footprint(X, Y)) & np.isfinite(si["outdoor"]) & (si["outdoor"] > FLOOR_DB) & (mw["outdoor"] > FLOOR_DB)
    diff = np.where(ok, mw["outdoor"] - si["outdoor"], np.nan)
    ext = [g["x0"], g["x0"] + g["nx"] * g["dx"], g["y0"], g["y0"] + g["ny"] * g["dx"]]
    im = ax.imshow(diff, origin="lower", extent=ext, cmap=cm, vmin=-20, vmax=20, interpolation="nearest")
    _draw_context(ax, B, th); _draw_walls(ax, B, th, outdoor=True)
    for T in sp.tx_positions:
        ax.plot(*T[:2], marker="*", ms=12, mfc=th["router"], mec=th["router_edge"], zorder=9)
    ax.set_xlim(ext[0], ext[1]); ax.set_ylim(ext[2], ext[3]); ax.set_aspect("equal")
    mo = met["outdoor"]
    ax.set_title(f"Outdoor z = {g['z']:g} m: MWM − Sionna   (RMSE {mo['rmse']:.1f}, bias {mo['bias']:+.1f} dB)",
                 fontsize=9, color=th["fg"])
    for i, f in enumerate(B.floors):
        ax = fig.add_subplot(gs[1, i]); _style_axes(ax, th)
        pn = f"floor{f['id']}"
        g = B.grid(pn, "sionna")
        X, Y = cell_centers(g)
        ok = B.inside_footprint(X, Y) & np.isfinite(si[pn]) & (si[pn] > FLOOR_DB) & (mw[pn] > FLOOR_DB)
        diff = np.where(ok, mw[pn] - si[pn], np.nan)
        ext = [g["x0"], g["x0"] + g["nx"] * g["dx"], g["y0"], g["y0"] + g["ny"] * g["dx"]]
        ax.imshow(diff, origin="lower", extent=ext, cmap=cm, vmin=-20, vmax=20, interpolation="nearest")
        _draw_walls(ax, B, th, floor=f["id"])
        if B.floor_of_z(sp.tx_pos[2]) == f["id"]:
            for T in sp.tx_positions:
                ax.plot(*T[:2], marker="*", ms=10, mfc=th["router"], mec=th["router_edge"], zorder=9)
        ax.set_xlim(ext[0], ext[1]); ax.set_ylim(ext[2], ext[3]); ax.set_aspect("equal")
        mf = met[pn]
        ax.set_title(f"{f['name']['en']}: RMSE {mf['rmse']:.1f}, bias {mf['bias']:+.1f} dB", fontsize=8.5, color=th["fg"])
        ax.tick_params(labelsize=7)
    cax = fig.add_axes([0.915, 0.3, 0.014, 0.6])
    cb = fig.colorbar(im, cax=cax, extend="both")
    cb.set_label("MWM − Sionna RT [dB]", color=th["fg"]); cb.ax.tick_params(colors=th["fg"]); cb.outline.set_edgecolor(th["fg"])
    lab = B.scenarios[name]["label"]["en"]
    fig.suptitle(f"{lab} — multi-wall model (nominal losses) vs. Sionna RT   |   {sp.freq_ghz:g} GHz, "
                 f"{sp.antenna} @ {sp.mount}", color=th["fg"], fontsize=11, x=0.06, ha="left")
    fig.savefig(path, dpi=DPI, facecolor=th["bg"])
    plt.close(fig)


def calibration_figure(B, cal, specs_by_f, path, theme="light"):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from twin.plotting import THEMES, _style_axes, DPI, WIDTH_IN
    th = THEMES[theme]
    fig, axs = plt.subplots(1, 2, figsize=(WIDTH_IN, 5.2), dpi=DPI, facecolor=th["bg"])
    for ax, fk in zip(axs, ["2.4", "5"]):
        _style_axes(ax, th)
        if fk not in cal["base"]:
            ax.set_visible(False); continue
        c = cal["base"][fk]
        mats = [m for m in CAL_MATS if c["cells_crossing"].get(m, 0) > 0]
        x = np.arange(len(mats))
        nom = [B.raw["materials"][m]["loss"][fk] for m in mats]
        itu = [min(specs_by_f.get(fk, {}).get(m, {}).get("slab_T_loss_db", np.nan), 60) for m in mats]
        fa = [c["n_fixed"]["loss_db"][m] for m in mats]
        fb = [c["n_free"]["loss_db"][m] for m in mats]
        wdt = 0.2
        ax.bar(x - 1.5 * wdt, nom, wdt, label="MWM nominal", color="#8d939b")
        ax.bar(x - 0.5 * wdt, itu, wdt, label="ITU slab, normal inc. (Sionna material)", color="#4c9be8")
        ax.bar(x + 0.5 * wdt, fa, wdt, label="calibrated, n = 2", color="#ff8a00")
        ax.bar(x + 1.5 * wdt, fb, wdt, label=f"calibrated, n = {c['n_free']['n']:.2f}", color="#ff2d55")
        ax.set_xticks(x); ax.set_xticklabels(mats, rotation=35, ha="right", fontsize=8)
        ax.set_ylabel("loss per crossing [dB]")
        ax.set_title(f"{fk} GHz  (metal ITU capped at 60 dB)", color=th["fg"], fontsize=10)
        ax.grid(axis="y", color=th["grid"], lw=0.6); ax.set_axisbelow(True)
        ax.legend(fontsize=7.5, facecolor=th["bg"], edgecolor=th["grid"], labelcolor=th["fg"])
    fig.suptitle("Least-squares calibration of the multi-wall material losses to Sionna RT", color=th["fg"])
    fig.tight_layout()
    fig.savefig(path, dpi=DPI, facecolor=th["bg"])
    plt.close(fig)


# ============================================================================ main
def scenario_metrics(B, mw, si):
    met, errs = {}, []
    for plane in B.plane_names():
        g = B.grid(plane, "sionna")
        X, Y = cell_centers(g)
        reg = ~B.inside_footprint(X, Y) if plane == "outdoor" else B.inside_footprint(X, Y)
        ok = reg & np.isfinite(si[plane]) & (si[plane] > FLOOR_DB) & (mw[plane] > FLOOR_DB)
        e = (mw[plane] - si[plane])[ok]
        met[plane] = metrics(e)
        errs.append(e)
    met["floors"] = metrics(np.concatenate(errs[1:]))
    met["all"] = metrics(np.concatenate(errs))
    return met


def main():
    B = load_building()
    sion, source = load_sionna(B)
    if not sion:
        sys.exit("no Sionna results found - run sim/run_sionna.py first")
    names = [n for n in B.scenarios if n in sion]
    geo = Geo(B)
    sp = {n: scenario_params(B, n) for n in names}
    sjson = json.loads(WEB_SIONNA_JSON.read_text(encoding="utf-8")) if WEB_SIONNA_JSON.exists() else {}
    envs = sjson.get("settings", {}).get("environments", {})
    specs_by_f = {}
    for tag, e in envs.items():
        if "+" not in tag:
            specs_by_f[tag[1:]] = e["materials"]

    # ---- nominal MWM vs Sionna
    nominal, rows_csv = {}, []
    mw_nom = {}
    for n in names:
        mw_nom[n] = mwm.router_maps(B, sp[n], "sionna")
        nominal[n] = scenario_metrics(B, mw_nom[n], sion[n])

    # ---- calibration (base losses per frequency on unshielded scenarios; lowPower duplicates baseline)
    groups = {}
    for n in names:
        if sp[n].extra_db or n == "lowPower":
            continue
        groups.setdefault(sp[n].fkey, []).append(n)
    cal = {"primary": "n_fixed (n = 2 kept as in MODEL.md; only material losses fitted) -- used for MWM-cal maps/stats",
           "method": "bounded weighted linear least squares (scipy.optimize.lsq_linear, BVLS); each map weighted "
                     "equally; target = Sionna path loss on cells > -120 dBm (outdoor outside / floors inside footprint)",
           "data_source": source, "base": {}, "extras": {}, "loso_2.4": {}}
    base_fit = {}
    for fk, members in groups.items():
        rows = sum((design_rows(B, geo, sp[m], sion[m], include_clients=(m == members[0])) for m in members), [])
        f_ghz = sp[members[0]].freq_ghz
        fa = fit(B, rows, fit_n=False, freq_ghz=f_ghz)
        fb = fit(B, rows, fit_n=True, freq_ghz=f_ghz)
        base_fit[fk] = {"n_fixed": fa, "n_free": fb}
        cal["base"][fk] = {
            "scenarios": members, "client_maps_included": True,
            "cells_crossing": fa["cells_crossing"], "fitted_materials": fa["fitted"], "rows": fa["rows"],
            "weighted_rmse_db": {"nominal": round(fa["weighted_rmse_nominal_db"], 3),
                                 "n_fixed": round(fa["weighted_rmse_db"], 3), "n_free": round(fb["weighted_rmse_db"], 3)},
            "n_fixed": {"n": 2.0, "loss_db": {m: round(float(fa["loss"][B.mat_index[m]]), 2) for m in CAL_MATS}},
            "n_free": {"n": round(fb["n"], 3), "loss_db": {m: round(float(fb["loss"][B.mat_index[m]]), 2) for m in CAL_MATS}},
            "nominal_loss_db": {m: B.raw["materials"][m]["loss"][fk] for m in CAL_MATS},
        }
        print(f"[{fk} GHz] n = {fb['n']:.2f}; losses (n=2): "
              + ", ".join(f"{m} {fa['loss'][B.mat_index[m]]:.1f}" for m in CAL_MATS), flush=True)
    # leave-one-scenario-out (2.4 GHz)
    if "2.4" in groups and len(groups["2.4"]) > 1:
        for held in groups["2.4"]:
            train = [m for m in groups["2.4"] if m != held]
            rows = sum((design_rows(B, geo, sp[m], sion[m], include_clients=(m == train[0])) for m in train), [])
            f = fit(B, rows, fit_n=False, freq_ghz=2.4)
            mw = mwm.router_maps(B, sp[held], "sionna", n=f["n"], loss=f["loss"])
            cal["loso_2.4"][held] = {"train": train, "n": round(f["n"], 3), "metrics": scenario_metrics(B, mw, sion[held])}
    # shielding increments
    for n in names:
        if not sp[n].extra_db or len(sp[n].tx_positions) > 1:     # multi-AP max() is not linear -> not fitted
            continue
        fk = sp[n].fkey
        if fk not in base_fit:
            continue
        b = base_fit[fk]["n_fixed"]
        rows = design_rows(B, geo, sp[n], sion[n], include_clients=True)
        ex = fit_extras(B, rows, b["loss"], b["n"], list(sp[n].extra_db))
        cal["extras"][n] = {"freq_ghz": sp[n].freq_ghz, "nominal_extra_db": sp[n].extra_db,
                            "fitted_extra_db": {k: round(v, 2) for k, v in ex.items()}}

    # ---- calibrated MWM maps, metrics and attack statistics
    calibrated, cal_stats, nom_stats = {}, {}, {}
    eq = mwm.equipment(B)
    cache = {}
    for n in names:
        fk = sp[n].fkey
        if fk not in base_fit:
            continue
        b = base_fit[fk]["n_fixed"]          # primary calibration: n = 2 as in MODEL.md, losses fitted
        loss = b["loss"].copy()
        # shielding increments: own fit, else the fit of a scenario with the same propagation environment
        donor = n if n in cal["extras"] else next((m for m in cal["extras"]
                                                     if sp[m].material_config == sp[n].material_config), None)
        for mat in sp[n].extra_db:
            ex = cal["extras"].get(donor, {}).get("fitted_extra_db", {}).get(mat, sp[n].extra_db[mat])
            loss[B.mat_index[mat]] += ex
        r = mwm.scenario_analysis(B, sp[n], "sionna", eq=eq, n=b["n"], loss=loss, client_cache=cache)
        calibrated[n] = scenario_metrics(B, r["maps"], sion[n])
        cal_stats[n] = r["stats"]
        nom_stats[n] = mwm.scenario_analysis(B, sp[n], "sionna", eq=eq, client_cache=cache)["stats"]
    for n in names:
        for kind, M in (("nominal", nominal), ("calibrated", calibrated)):
            if n not in M:
                continue
            for plane, m in M[n].items():
                rows_csv.append({"scenario": n, "mwm": kind, "plane": plane, **{k: (round(v, 3) if isinstance(v, float) else v)
                                                                                for k, v in m.items()}})
    with open(OUT / "compare_metrics.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows_csv[0].keys()))
        w.writeheader(); w.writerows(rows_csv)
    cal["metrics_nominal"] = nominal
    cal["metrics_calibrated"] = calibrated
    cal["stats_calibrated_mwm"] = cal_stats
    (OUT / "calibration.json").write_text(json.dumps(cal, indent=1, default=float), encoding="utf-8")

    # ---- figures
    FIGURES.mkdir(parents=True, exist_ok=True)
    for n in names:
        for theme, suf in (("light", ""), ("dark", "_dark")):
            compare_figure(B, n, sp[n], mw_nom[n], sion[n], nominal[n], FIGURES / f"compare_{n}{suf}.png", theme)
    for theme, suf in (("light", ""), ("dark", "_dark")):
        calibration_figure(B, cal, specs_by_f, FIGURES / f"compare_calibration{suf}.png", theme)

    # ---- RESULTS.md
    from twin.report import write_results
    write_results(B, names, sp, nominal, calibrated, cal, nom_stats, cal_stats, sjson, specs_by_f, OUT / "RESULTS.md")
    print("wrote", OUT / "RESULTS.md", OUT / "calibration.json", OUT / "compare_metrics.csv")


if __name__ == "__main__":
    main()
