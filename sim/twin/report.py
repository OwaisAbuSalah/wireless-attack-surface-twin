"""Generation of sim/out/RESULTS.md (all numbers are read from the run outputs)."""

from __future__ import annotations

import csv
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from . import OUT

STATS = [("area_eavesdrop", "Eavesdrop [m²]", "{:,.0f}"), ("area_deauth", "Deauth [m²]", "{:,.0f}"),
         ("area_eviltwin", "Evil Twin [m²]", "{:,.0f}"), ("max_leak_m", "Max leak [m]", "{:.1f}"),
         ("street_exposure", "Street exp. [%]", "{:.1f}"), ("coverage", "Coverage [%]", "{:.1f}")]


def _csv(path: Path):
    if not path.exists():
        return []
    with open(path, encoding="utf-8") as f:
        return list(csv.DictReader(f))


def _fmt(v, f):
    try:
        return f.format(float(v))
    except (TypeError, ValueError):
        return str(v)


def _stats_table(rows_by_name: dict, names, B, edge=None) -> list:
    out = ["| Scenario | " + " | ".join(h for _, h, _ in STATS) + " |",
           "|---|" + "---:|" * len(STATS)]
    for n in names:
        r = rows_by_name.get(n)
        if r is None:
            continue
        cells = []
        for k, _, f in STATS:
            s = _fmt(r[k], f)
            if k == "max_leak_m" and str(r.get("leak_reaches_edge", "")).lower() == "true":
                s += "⁺"
            cells.append(s)
        out.append(f"| {B.scenarios[n]['label']['en']} (`{n}`) | " + " | ".join(cells) + " |")
    return out


def _m(m, k):
    v = m.get(k, np.nan) if m else np.nan
    return "–" if v is None or (isinstance(v, float) and np.isnan(v)) else (f"{v:,}" if k == "n" else f"{v:.2f}")


def write_results(B, names, sp, nominal, calibrated, cal, nom_stats, cal_stats, sjson, specs_by_f, path: Path):
    L = []
    st = sjson.get("settings", {})
    L += ["# Simulation results — Wireless Attack Surface Digital Twin", "",
          f"*Generated {datetime.now(timezone.utc).replace(microsecond=0).isoformat()} by `sim/compare.py` from the "
          "outputs of `sim/run_mwm.py` and `sim/run_sionna.py`. Every number below is produced by those scripts; "
          "re-running them regenerates this file.*", "",
          "Models: **MWM** = multi-wall reference model of `docs/MODEL.md` (`sim/twin/mwm.py`, nominal material losses "
          "of `data/building.json`); **Sionna RT** = NVIDIA Sionna RT ray tracer "
          f"(sionna-rt {st.get('sionna_rt', '?')}, Mitsuba {st.get('mitsuba', '?')}, Dr.Jit {st.get('drjit', '?')}, "
          f"variant `{st.get('variant', '?')}`, {st.get('gpu', '?')}); **MWM-cal** = MWM with the material losses fitted to "
          "Sionna (n = 2 kept, section 3).", "",
          f"Attack statistics use the default attacker equipment `{B.attack['default_equipment']}` "
          f"({B.attack['equipment'][B.attack['default_equipment']]['name']['en']}). Grids: outdoor 1.0 m (200 × 140) "
          "at z = 1.5 m and floors 0.25 m (148 × 68) at floor + 1.2 m unless stated otherwise. "
          "⁺ = the eavesdropping zone reaches the edge of the 200 m × 140 m study area, so the true leak distance is larger.", ""]

    # ------------------------------------------------------------------ 1. statistics
    mwm_rows = _csv(OUT / "mwm_stats.csv")
    s_rows = _csv(OUT / "sionna_stats.csv")
    mwm_rt = {r["scenario"]: r for r in mwm_rows if r["grid"] == "realtime"}
    mwm_sg = {r["scenario"]: r for r in mwm_rows if r["grid"] == "sionna"}
    sio = {r["scenario"]: r for r in s_rows}
    cal_rows = {n: {**v, "leak_reaches_edge": v["leak_reaches_edge"]} for n, v in cal_stats.items()}
    L += ["## 1. Attack-surface statistics (MODEL.md §7)", "",
          "### 1a. Sionna RT (ray tracing)", ""] + _stats_table(sio, names, B) + [""]
    if sio and all("zero_ray_pct" in sio[n] for n in names if n in sio):
        L += ["Share of outdoor cells (outside the footprint) that no AP ray reached (reported as *no signal*): " +
              ", ".join(f"{n} {float(sio[n]['zero_ray_pct']):.1f} %" for n in names if n in sio) + ".", ""]
    L += ["### 1b. MWM, nominal losses (same 1 m / 0.25 m grid as Sionna)", ""] + _stats_table(mwm_sg, names, B) + [""]
    L += ["### 1c. MWM, nominal losses, real-time grid (0.4 m / 0.2 m — what the web app computes)", ""] + \
         _stats_table(mwm_rt, names, B) + [""]
    L += ["### 1d. MWM calibrated to Sionna (section 3)", ""] + _stats_table(cal_rows, names, B) + [""]

    # relative effect of each protection on the eavesdropping area
    L += ["### 1e. Effect of each protection on the eavesdropping area (relative to baseline)", "",
          "| Scenario | MWM | Sionna RT | MWM-cal |", "|---|---:|---:|---:|"]
    def rel(tab, n):
        try:
            b = float(tab["baseline"]["area_eavesdrop"]); v = float(tab[n]["area_eavesdrop"])
            return f"{100 * (v - b) / b:+.0f} %"
        except (KeyError, ZeroDivisionError):
            return "–"
    for n in names:
        if n == "baseline":
            continue
        L.append(f"| {B.scenarios[n]['label']['en']} | {rel(mwm_sg, n)} | {rel(sio, n)} | {rel(cal_rows, n)} |")
    L.append("")

    # ------------------------------------------------------------------ 2. validation
    L += ["## 2. Validation: MWM vs. Sionna RT (cell-by-cell)", "",
          "Error = MWM − Sionna [dB] on cells where both models give RSS > −120 dBm; outdoor cells outside the "
          "building footprint, floor cells inside it. RSS maps of the access point.", "",
          "| Scenario | Outdoor N | Outdoor RMSE | Outdoor MAE | Outdoor bias | Floors N | Floors RMSE | Floors MAE | "
          "Floors bias | All RMSE | All bias |", "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|"]
    for n in names:
        m = nominal[n]
        L.append(f"| {n} | {_m(m['outdoor'], 'n')} | {_m(m['outdoor'], 'rmse')} | {_m(m['outdoor'], 'mae')} | "
                 f"{_m(m['outdoor'], 'bias')} | {_m(m['floors'], 'n')} | {_m(m['floors'], 'rmse')} | "
                 f"{_m(m['floors'], 'mae')} | {_m(m['floors'], 'bias')} | {_m(m['all'], 'rmse')} | {_m(m['all'], 'bias')} |")
    L += ["", "Per floor (nominal MWM):", "", "| Scenario | " + " | ".join(
        f"floor{f['id']} RMSE / bias" for f in B.floors) + " |", "|---|" + "---:|" * len(B.floors)]
    for n in names:
        cells = []
        for f in B.floors:
            mf = nominal[n]["floor%d" % f["id"]]
            cells.append(_m(mf, "rmse") + " / " + _m(mf, "bias"))
        L.append(f"| {n} | " + " | ".join(cells) + " |")
    L += ["", "After calibration (MWM-cal, in-sample for the scenarios used in the fit):", "",
          "| Scenario | Outdoor RMSE | Outdoor bias | Floors RMSE | Floors bias | All RMSE | All MAE | All bias |",
          "|---|---:|---:|---:|---:|---:|---:|---:|"]
    for n in names:
        m = calibrated.get(n)
        if not m:
            continue
        L.append(f"| {n} | {_m(m['outdoor'], 'rmse')} | {_m(m['outdoor'], 'bias')} | {_m(m['floors'], 'rmse')} | "
                 f"{_m(m['floors'], 'bias')} | {_m(m['all'], 'rmse')} | {_m(m['all'], 'mae')} | {_m(m['all'], 'bias')} |")
    if cal.get("loso_2.4"):
        L += ["", "Leave-one-scenario-out at 2.4 GHz (fit on the other unshielded scenarios, test on the held-out one):", "",
              "| Held-out scenario | n | All RMSE | All MAE | All bias | Outdoor RMSE | Floors RMSE |",
              "|---|---:|---:|---:|---:|---:|---:|"]
        for n, v in cal["loso_2.4"].items():
            m = v["metrics"]
            L.append(f"| {n} | {v['n']:.1f} | {_m(m['all'], 'rmse')} | {_m(m['all'], 'mae')} | {_m(m['all'], 'bias')} | "
                     f"{_m(m['outdoor'], 'rmse')} | {_m(m['floors'], 'rmse')} |")
    L.append("")

    # ------------------------------------------------------------------ 3. calibration
    L += ["## 3. Calibration of the MWM material losses to Sionna RT", "", f"Method: {cal['method']}. Data: AP maps of "
          "the unshielded scenarios of each band (`lowPower` is excluded because its path loss is identical to `baseline`) "
          "plus the eight client-source outdoor maps; shielding increments fitted afterwards on the shielded scenarios "
          "with the base losses fixed. Materials crossed by fewer than 100 cells keep their nominal value. "
          "Full result: `sim/out/calibration.json`.", ""]
    for fk, c in cal["base"].items():
        sp_ = specs_by_f.get(fk, {})
        L += [f"### {fk} GHz (scenarios: {', '.join(c['scenarios'])}; {c['rows']:,} cells)", "",
              f"Weighted RMS residual over the fit data: nominal MWM {c['weighted_rmse_db']['nominal']:.2f} dB → "
              f"calibrated losses with n = 2 (**primary**, used for MWM-cal) {c['weighted_rmse_db']['n_fixed']:.2f} dB → "
              f"losses + free exponent {c['weighted_rmse_db']['n_free']:.2f} dB (fitted n = {c['n_free']['n']:.2f}; "
              "sensitivity only — the exponent trades off against the wall counts, which are correlated with distance).", "",
              "| Material | cells crossing | nominal MWM [dB] | ITU slab, normal incidence [dB] | calibrated, n = 2 [dB] | "
              f"calibrated, n = {c['n_free']['n']:.2f} [dB] |", "|---|---:|---:|---:|---:|---:|"]
        for m in c["n_fixed"]["loss_db"]:
            itu = sp_.get(m, {}).get("slab_T_loss_db")
            itu_s = "opaque (>100)" if itu is not None and itu > 100 else (f"{itu:.1f}" if itu is not None else "–")
            fitted = m in c.get("fitted_materials", [])
            star = "" if fitted else " (not fitted)"
            L.append(f"| {m} | {c['cells_crossing'].get(m, 0):,} | {c['nominal_loss_db'][m]:g} | {itu_s} | "
                     f"{c['n_fixed']['loss_db'][m]:.1f}{star} | {c['n_free']['loss_db'][m]:.1f}{star} |")
        L.append("")
    if cal["extras"]:
        L += ["Shielding increments (added to the calibrated base loss):", "",
              "| Scenario | material | nominal extra [dB] | fitted extra [dB] |", "|---|---|---:|---:|"]
        for n, v in cal["extras"].items():
            for mat, val in v["fitted_extra_db"].items():
                L.append(f"| {n} ({v['freq_ghz']:g} GHz) | {mat} | {v['nominal_extra_db'][mat]:g} | {val:.1f} |")
        L.append("")

    # ------------------------------------------------------------------ 4. canonical checks
    can = OUT / "sionna_canonical.json"
    if can.exists():
        L += ["## 4. Sanity checks of the Sionna RT set-up (`sim/tests/test_sionna_canonical.py`)", "",
              "| Case | Result |", "|---|---|"]
        for r in json.loads(can.read_text()):
            if "rmse_db" in r:
                L.append(f"| {r['case']} vs. MODEL.md §2-3 free space | RMSE {r['rmse_db']:.3f} dB, mean error "
                         f"{r['mean_err_db']:+.3f} dB over {r['cells']:,} cells |")
            else:
                L.append(f"| {r['case']} | Sionna excess loss {r['sionna_excess_loss_db']:.2f} dB vs. ITU-R P.2040 slab "
                         f"{r['itu_slab_T_loss_db']:.2f} dB (crossed once) |")
        L.append("")

    noise = OUT / "sionna_noise.json"
    if noise.exists():
        nz = json.loads(noise.read_text())
        L += ["Monte-Carlo repeatability of the Sionna maps (`run_sionna.py --noise-check`: baseline re-traced with "
              f"seed {nz['seeds'][1]} vs. {nz['seeds'][0]}, {nz['samples_per_tx']:.0e} rays): single-run noise = RMS "
              "difference / √2.", "",
              "| Plane | cells | RMS diff [dB] | single-run noise [dB] | 95 % abs diff [dB] | RMS diff, cells < −90 dBm | −90…−60 | > −60 |",
              "|---|---:|---:|---:|---:|---:|---:|---:|"]
        for p_, v in nz["planes"].items():
            g = lambda k: f"{v[k]:.2f}" if k in v else "–"
            L.append(f"| {p_} | {v['cells']:,} | {v['rms_diff_db']:.2f} | {v['rms_single_run_noise_db']:.2f} | "
                     f"{v['p95_abs_diff_db']:.2f} | {g('rms_diff_db_-120_-90')} | {g('rms_diff_db_-90_-60')} | "
                     f"{g('rms_diff_db_-60_0')} |")
        L.append("")

    # ------------------------------------------------------------------ 5. settings
    if st:
        L += ["## 5. Sionna RT settings and runtime", "",
              f"* Solver: {st.get('solver')}; max_depth = {st.get('max_depth')}, samples_per_tx = "
              f"{float(st.get('samples_per_tx', 0)):.0e}, LoS = {st.get('los')}, specular = {st.get('specular_reflection')}, "
              f"refraction = {st.get('refraction')}, diffuse = {st.get('diffuse_reflection')}, diffraction = "
              f"{st.get('diffraction')}, seed = {st.get('seed')}.",
              f"* Geometry: {st.get('geometry')}.", f"* Antennas: {st.get('tx_antenna')}; {st.get('rx')}.",
              f"* {st.get('client_maps')}.",
              f"* Runtime per scenario [s]: " + ", ".join(f"{k} {v}" for k, v in st.get("runtime_s", {}).items())
              + f"; total {st.get('runtime_total_s')} s.", ""]
        L += ["Radio materials used by Sionna (normal-incidence single-slab losses computed with the ITU-R P.2040 "
              "equations that Sionna implements):", "",
              "| Environment | material | ITU type | t [m] | ε_r | σ [S/m] | T loss [dB] | R loss [dB] | MWM [dB] |",
              "|---|---|---|---:|---:|---:|---:|---:|---:|"]
        for tag, e in st.get("environments", {}).items():
            for m, s in e["materials"].items():
                if m == "ground":
                    continue
                tl = s["slab_T_loss_db"]
                L.append(f"| {tag} | {m} | {s['itu']}{' + shield' if s['kind'] == 'custom' else ''} | {s['t']:g} | "
                         f"{s['eps_r']:.2f} | {s['sigma']:.4g} | {'>100' if tl > 100 else f'{tl:.1f}'} | "
                         f"{s['slab_R_loss_db']:.1f} | {s['mwm_loss_db']:g} |")
        L.append("")

    # ------------------------------------------------------------------ 6. interpretation
    L += ["## 6. Interpretation", ""] + interpretation(B, names, nominal, calibrated, cal, mwm_sg, sio, cal_rows, specs_by_f)
    L += ["", "## 7. Limitations", "",
          "* Sionna runs use specular reflection + transmission (refraction) up to depth 5; diffraction and diffuse "
          "scattering are disabled, so deep shadow regions (behind neighbouring buildings, behind several concrete walls) "
          "receive no rays and appear as *no signal*. Attack areas there are lower bounds.",
          "* Sionna samples the interaction type with probability proportional to its power (unbiased Monte Carlo). Behind "
          "strongly attenuating walls (shielded façade, 5 GHz concrete) only a small fraction of rays continues, so outdoor "
          "cells can stay empty; these environments are traced with 4 averaged seeds on the outdoor plane "
          f"({', '.join(f'{k}: {v}' for k, v in st.get('seeds_outdoor', {}).items())} seed(s)) and the share of ray-less "
          "outdoor cells is listed in section 1a. Client-source maps behind the shielded façade remain the least converged "
          "quantity (deauth / evil-twin areas of `shieldPaint`, `band5`, `allRF`).",
          "* Radio-map cells are averages of the incoherent ray power over each cell (local-area mean, no small-scale "
          "fading); the MWM is evaluated at cell centres. Both use isotropic receivers (MODEL.md §3).",
          "* Shielding is modelled in Sionna as an equivalent lossy slab whose normal-incidence transmission loss matches "
          "building.json (`sim/README.md`); at oblique incidence the extra loss differs from the constant MWM increment.",
          "* Material parameters are ITU-R P.2040 generic values; no measurements of the real building were available, so "
          "the calibration aligns the engineering model with the physics model, not with reality "
          "(`sim/measure/` provides the workflow for field data).", ""]
    path.write_text("\n".join(L), encoding="utf-8")


def outdoor_area(B) -> float:
    from .building import cell_centers
    g = B.grid("outdoor", "sionna")
    X, Y = cell_centers(g)
    return float((~B.inside_footprint(X, Y)).sum() * g["dx"] ** 2)


def interpretation(B, names, nominal, calibrated, cal, mwm_sg, sio, cal_rows, specs_by_f) -> list:
    out = []
    try:
        def area(tab, n):
            return float(tab[n]["area_eavesdrop"])
        single = [n for n in names if n not in ("baseline", "allRF")]
        rk_m = sorted(single, key=lambda n: area(mwm_sg, n))
        rk_s = sorted(single, key=lambda n: area(sio, n))
        out.append(f"* **Ranking of single protections** by remaining eavesdropping area (best first) — MWM: "
                   f"{' < '.join(rk_m)}; Sionna RT: {' < '.join(rk_s)}. "
                   + ("The two models agree on the best single measure (" + rk_m[0] + ")." if rk_m[0] == rk_s[0]
                      else f"The models disagree on the best single measure ({rk_m[0]} vs. {rk_s[0]})."))
        b_m, b_s = area(mwm_sg, "baseline"), area(sio, "baseline")
        out.append(f"* **Baseline leakage**: eavesdropping is possible on {b_m:,.0f} m² (MWM) vs. {b_s:,.0f} m² (Sionna) "
                   f"of the {outdoor_area(B):,.0f} m² outdoor study area; street "
                   f"exposure {float(mwm_sg['baseline']['street_exposure']):.0f} % vs. {float(sio['baseline']['street_exposure']):.0f} %.")
        dis = [n for n in names if n != "baseline" and np.sign(area(mwm_sg, n) - b_m) != np.sign(area(sio, n) - b_s)]
        if dis:
            out.append("* **Qualitative disagreement**: for " + ", ".join(
                f"`{n}` (MWM {100 * (area(mwm_sg, n) - b_m) / b_m:+.0f} %, Sionna {100 * (area(sio, n) - b_s) / b_s:+.0f} %)"
                for n in dis) + " the two models predict opposite changes of the eavesdropping area relative to the baseline. "
                "The ray tracer adds multipath (reflections off the slabs, the ground and neighbouring façades) that the "
                "straight-line multi-wall model cannot represent, so conclusions about these measures should cite the ray-tracing result.")
        else:
            out.append("* Both models agree on the direction of the change (reduction or increase of the eavesdropping area) "
                       "for every protection.")
        if "allRF" in names:
            out.append(f"* **{B.scenarios['allRF']['label']['en']}** (`allRF` = {' + '.join(B.scenarios['allRF']['protections'])}) "
                       f"reduce the eavesdropping area to {area(mwm_sg, 'allRF'):,.0f} m² (MWM) / "
                       f"{area(sio, 'allRF'):,.0f} m² (Sionna), at the cost of service coverage on the AP floor "
                       f"({float(mwm_sg['allRF']['coverage']):.0f} % / {float(sio['allRF']['coverage']):.0f} % vs. "
                       f"{float(mwm_sg['baseline']['coverage']):.0f} % / {float(sio['baseline']['coverage']):.0f} % in the baseline).")
        eqd = B.attack["equipment"][B.attack["default_equipment"]]
        budget = eqd["tx_dbm"] + eqd["gain_dbi"] - B.attack["client"]["sens_dbm"]
        def ratio(tab, n):
            e = float(tab[n]["area_eavesdrop"])
            return float(tab[n]["area_deauth"]) / e if e > 0 else float("nan")
        out.append(f"* **Deauthentication** only needs P_att + G_att − PL(X, c) ≥ −88 dBm at one client, i.e. PL ≤ {budget:.0f} dB "
                   "with the USB adapter. With the nested rule of MODEL.md §6 (the attacker must also hear the AP) the deauth "
                   "zone is the part of the eavesdropping zone from which a client can be reached; deauth/eavesdrop area ratio "
                   "(MWM / Sionna): " + ", ".join(f"{n} {ratio(mwm_sg, n):.2f} / {ratio(sio, n):.2f}" for n in names
                                                  if float(sio[n]["area_eavesdrop"]) > 0) +
                   ". Without shielding the client link is almost never limiting (ratio ≈ 1); shielding and 5 GHz also "
                   "attenuate the attacker → client path, so the active-attack zone shrinks faster than the eavesdropping zone. "
                   "Only 802.11w (PMF), a protocol measure, removes deauthentication entirely. The **Evil Twin** zone is much "
                   "smaller because the rogue AP must beat the real AP by 3 dB at the client.")
        mo = np.mean([nominal[n]["outdoor"]["bias"] for n in names])
        mf = np.mean([nominal[n]["floors"]["bias"] for n in names])
        ro = np.mean([nominal[n]["all"]["rmse"] for n in names])
        out.append(f"* **Agreement of the nominal MWM with Sionna**: mean RMSE {ro:.1f} dB over the scenarios; mean bias "
                   f"{mo:+.1f} dB outdoors and {mf:+.1f} dB on the floors (negative = MWM predicts less power). "
                   "Indoors the MWM ignores multipath (reflections off slabs, walls and the ground add power in the ray tracer); "
                   "outdoors the difference is dominated by how much leaks through windows vs. concrete.")
        if calibrated:
            rc = np.mean([calibrated[n]["all"]["rmse"] for n in calibrated])
            out.append(f"* **Calibration** reduces the mean RMSE from {ro:.1f} dB to {rc:.1f} dB (in-sample)"
                       + (", and the leave-one-scenario-out RMSE at 2.4 GHz is "
                          + ", ".join(f"{k} {v['metrics']['all']['rmse']:.1f} dB" for k, v in cal['loso_2.4'].items())
                          if cal.get("loso_2.4") else "") + ".")
        c24 = cal.get("base", {}).get("2.4")
        s24 = specs_by_f.get("2.4", {})
        if c24 and s24:
            L_ = c24["n_fixed"]["loss_db"]
            itu = lambda m: s24[m]["slab_T_loss_db"]
            out.append("* **Calibrated losses are effective parameters, not material properties** (2.4 GHz, n = 2): "
                       f"metal {L_['metal']:.1f} dB although it is opaque in Sionna, concrete core walls {L_['concrete']:.1f} dB "
                       f"vs. {itu('concrete'):.1f} dB slab loss — power reaches the cells behind these obstacles by reflection "
                       "around them, which a straight-line model can only mimic with a lower loss; where the direct path "
                       f"dominates the fit stays close to the slab physics (exterior concrete {L_['ext_concrete']:.1f} vs. "
                       f"{itu('ext_concrete'):.1f} dB, floor slab {L_['slab']:.1f} vs. {itu('slab'):.1f} dB). The remaining "
                       f"RMSE after calibration ({min(m['all']['rmse'] for m in calibrated.values()):.0f}–"
                       f"{max(m['all']['rmse'] for m in calibrated.values()):.0f} dB) is therefore structural: multipath, "
                       "not material values.")

        if "ext_glass" in s24 and "glass" in s24:
            out.append(f"* **Glass**: a single 24 mm ITU glass slab is almost transparent at 2.4 GHz "
                       f"({s24['ext_glass']['slab_T_loss_db']:.1f} dB — close to a half-wave resonance, λ/(2√ε_r) ≈ "
                       f"{299.792458 / 2.4 / 2 / np.sqrt(s24['ext_glass']['eps_r']):.0f} mm) whereas the MWM assumes "
                       f"{B.raw['materials']['ext_glass']['loss']['2.4']} dB; the 12 mm interior glass is near a quarter-wave "
                       f"thickness ({s24['glass']['slab_T_loss_db']:.1f} dB). Real double glazing (two panes + gap, possibly "
                       "low-E coated) is not a single homogeneous slab — this is a modelling sensitivity worth stating in the report.")
        if "metal" in s24:
            out.append("* **Metal** (elevator shaft, server-room door) is opaque in Sionna (σ = 10⁷ S/m) while the MWM uses "
                       f"{B.raw['materials']['metal']['loss']['2.4']} dB to represent gaps around real doors.")
    except Exception as e:  # noqa: BLE001
        out.append(f"* (interpretation could not be generated automatically: {e})")
    return out
