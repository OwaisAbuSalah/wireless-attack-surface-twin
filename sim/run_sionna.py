#!/usr/bin/env python
"""NVIDIA Sionna RT radio maps for every scenario of building.json.

For each scenario: RadioMapSolver maps of the access point on the outdoor plane (z = 1.5 m, 1.0 m cells,
200 x 140) and on the three floor planes (z = floor + 1.2 m, 0.25 m cells, 148 x 68);
RSS_dBm = P_tx + 10 log10(path_gain).  For the attack analysis (MODEL.md §6, reciprocity) the eight
clients are additionally traced as isotropic sources onto the outdoor plane (PL(X, c) = -10 log10 g),
once per propagation environment (frequency x shielding), and RSS(AP -> c) is obtained with the
PathSolver (dual-polarised isotropic receivers, incoherent sum of path powers).

Outputs
  web/src/data/sionna.json                 MODEL.md §8 (+ top-level "stats" and "tiers")
  docs/figures/sionna_<scenario>.png (+ _dark.png)
  sim/out/sionna_stats.csv
  sim/out/cache/sionna_<scenario>.npz      full-precision maps for compare.py
  sim/out/cache/scene_<env>/               generated Mitsuba XML + PLY meshes

  python sim/run_sionna.py [--samples 1e9] [--max-depth 5] [--seeds-outdoor auto] [--scenarios a,b]
                           [--assemble-only] [--no-figures] [--noise-check]

The per-scenario results are cached (sim/out/cache/sionna_<scenario>.npz with a fingerprint of all radio inputs);
the CSV / JSON / figures are always assembled for all scenarios from the cache, so a change of the attack or
statistics rules only needs --assemble-only, and a stale cache entry is detected and reported.

Requires sionna-rt (tested with 2.2.0, Mitsuba 3.9.1, Dr.Jit 1.5.0).  The Mitsuba variant
cuda_ad_mono_polarized is used when available, else llvm_ad_mono_polarized.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import subprocess
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
try:                                    # UTF-8 console/log output on Windows (m², ε, ...)
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except AttributeError:
    pass

from twin import CACHE, FIGURES, OUT, WEB_SIONNA_JSON           # noqa: E402
from twin import mwm                                            # noqa: E402
from twin import sionna_scene as ss                             # noqa: E402
from twin.building import cell_centers, load_building, scenario_params   # noqa: E402
from twin.export import grids_block, tiers_to_b64, write_maps_json   # noqa: E402

STAT_KEYS = ["area_eavesdrop", "area_deauth", "area_eviltwin", "area_danger", "max_leak_m", "leak_reaches_edge",
             "street_exposure", "coverage"]
MAX_RAYS_PER_CALL = 4_000_000_000      # Sionna indexes rays with uint32 (samples_per_tx * num_tx)


def set_variant():
    import mitsuba as mi
    for v in ("cuda_ad_mono_polarized", "llvm_ad_mono_polarized"):
        try:
            mi.set_variant(v)
            return v
        except Exception as e:        # noqa: BLE001
            print(f"  variant {v} unavailable: {e}")
    raise RuntimeError("no polarized Mitsuba variant available")


def gpu_name():
    try:
        return subprocess.run(["nvidia-smi", "--query-gpu=name,driver_version", "--format=csv,noheader"],
                              capture_output=True, text=True, timeout=20).stdout.strip()
    except Exception:                 # noqa: BLE001
        return "unknown"


def check_itu_table():
    """Assert that twin.sionna_scene.ITU_ABCD equals the installed Sionna ITU table (1-10 GHz rows)."""
    from sionna.rt.radio_materials.itu import ITU_MATERIALS_PROPERTIES as T
    for name, abcd in ss.ITU_ABCD.items():
        rows = [p for (lo, hi), p in T[name].items() if lo <= 2.4 <= hi and lo <= 5.0 <= hi]
        assert rows and tuple(rows[0]) == tuple(abcd), (name, rows, abcd)


class Runner:
    def __init__(self, B, args):
        import mitsuba as mi
        import sionna.rt as rt
        self.mi, self.rt, self.B, self.a = mi, rt, B, args
        self.solver = rt.RadioMapSolver()
        self.path_solver = rt.PathSolver()
        self.settings = dict(max_depth=args.max_depth, samples_per_tx=int(args.samples), los=True,
                             specular_reflection=True, diffuse_reflection=False, refraction=True, diffraction=False,
                             seed=args.seed)

    def P3(self, v):
        return self.mi.Point3f(*[float(x) for x in v])

    def radio_map(self, scene, grid: dict, seeds: int = 1) -> np.ndarray:
        """Path gain [num_tx, ny, nx] on a horizontal plane described by a MODEL.md grid spec.

        With ``seeds > 1`` the map is the mean of independent runs (seeds seed + 1000 k).  Ray directions
        are a deterministic Fibonacci lattice, the interaction type (reflection / transmission) is sampled
        randomly with probability proportional to its gain, so averaging seeds reduces the Monte-Carlo
        noise behind strongly attenuating walls (unbiased estimator, variance / seeds)."""
        mi = self.mi
        w, h = grid["nx"] * grid["dx"], grid["ny"] * grid["dx"]
        center = (grid["x0"] + w / 2, grid["y0"] + h / 2, grid["z"])
        s = self.settings
        pg = 0.0
        for k in range(seeds):
            rm = self.solver(scene, center=self.P3(center), orientation=self.P3((0, 0, 0)), size=mi.Point2f(w, h),
                             cell_size=mi.Point2f(grid["dx"], grid["dx"]), samples_per_tx=s["samples_per_tx"],
                             max_depth=s["max_depth"], los=s["los"], specular_reflection=s["specular_reflection"],
                             diffuse_reflection=s["diffuse_reflection"], refraction=s["refraction"],
                             diffraction=s["diffraction"], seed=s["seed"] + 1000 * k)
            pg = pg + rm.path_gain.numpy().astype(np.float64) / seeds
        cc = rm.cell_centers.numpy()
        assert pg.shape[1:] == (grid["ny"], grid["nx"]), pg.shape
        # sanity: cell centres follow MODEL.md §4 (x0 + (i + 0.5) dx, row-major in y)
        assert abs(cc[0, 0, 0] - (grid["x0"] + 0.5 * grid["dx"])) < 1e-3 and abs(cc[0, 0, 1] - (grid["y0"] + 0.5 * grid["dx"])) < 1e-3
        assert abs(cc[-1, -1, 1] - (grid["y0"] + (grid["ny"] - 0.5) * grid["dx"])) < 1e-3
        return pg

    def client_maps(self, scene, grid, seeds: int = 1) -> np.ndarray:
        rt, B = self.rt, self.B
        scene.tx_array = rt.PlanarArray(num_rows=1, num_cols=1, pattern="iso", polarization="V")
        per_call = max(1, MAX_RAYS_PER_CALL // self.settings["samples_per_tx"])
        out = []
        cl = B.clients
        for k in range(0, len(cl), per_call):
            txs = [rt.Transmitter(f"cl-{c['id']}", position=self.P3(c["pos"]), orientation=self.P3((0, 0, 0)),
                                  power_dbm=0.0) for c in cl[k:k + per_call]]
            scene.add(txs)
            out.append(self.radio_map(scene, grid, seeds=seeds))
            scene.remove([t.name for t in txs])
        return np.concatenate(out, axis=0)

    def router(self, scene, sp, seeds_outdoor: int = 1):
        """AP maps on all planes + RSS(AP -> clients) via the PathSolver."""
        rt, B = self.rt, self.B
        pattern = ss.router_pattern(sp)
        scene.tx_array = rt.PlanarArray(num_rows=1, num_cols=1, pattern=pattern, polarization="V")
        scene.rx_array = rt.PlanarArray(num_rows=1, num_cols=1, pattern="iso", polarization="VH")
        aps = [rt.Transmitter(f"ap{k}", position=self.P3(T), orientation=self.P3(ss.router_orientation(sp)),
                              power_dbm=float(sp.tx_dbm)) for k, T in enumerate(sp.tx_positions)]
        scene.add(aps)
        maps = {}
        for name in B.plane_names():
            g = B.grid(name, "sionna")
            # several APs (micro-cells, MODEL.md §4): RSS = max over the APs (same power) = max path gain
            pg = self.radio_map(scene, g, seeds=seeds_outdoor if name == "outdoor" else 1).max(axis=0)
            with np.errstate(divide="ignore"):
                maps[name] = sp.tx_dbm + 10 * np.log10(pg)
        rxs = [rt.Receiver(f"rx-{c['id']}", position=self.P3(c["pos"])) for c in B.clients]
        scene.add(rxs)
        s = self.settings
        paths = self.path_solver(scene, max_depth=s["max_depth"], max_num_paths_per_src=1_000_000,
                                 samples_per_src=10_000_000, synthetic_array=True, los=True,
                                 specular_reflection=True, diffuse_reflection=False, refraction=True, seed=s["seed"])
        a_re, a_im = (np.asarray(x.numpy(), np.float64) for x in paths.a)
        p = (a_re ** 2 + a_im ** 2)            # [num_rx, num_rx_ant, num_tx, num_tx_ant, num_paths]
        p_rx = p.sum(axis=(1, 3, 4)).max(axis=1)          # [num_rx, num_tx] -> strongest AP per client
        with np.errstate(divide="ignore"):
            rss_c = sp.tx_dbm + 10 * np.log10(p_rx)
        n_paths = int(np.asarray(paths.valid.numpy()).sum())
        scene.remove([a.name for a in aps] + [r.name for r in rxs])
        return maps, rss_c, n_paths


def noise_check(B, R, args):
    """Seed-to-seed repeatability of the baseline AP maps (event sampling is random; ray directions are a
    deterministic Fibonacci lattice).  Compares a run with seed+1 against sim/out/cache/sionna_baseline.npz."""
    ref = np.load(CACHE / "sionna_baseline.npz")
    sp = scenario_params(B, "baseline")
    xml, _, _ = ss.write_scene(B, sp, CACHE / "scene_noise")
    scene = ss.load(xml, sp.freq_ghz)
    R.settings["seed"] = args.seed + 1
    maps, _, _ = R.router(scene, sp)
    from twin.building import cell_centers
    out = {"samples_per_tx": float(args.samples), "seeds": [args.seed, args.seed + 1], "planes": {}}
    for plane, m in maps.items():
        g = B.grid(plane, "sionna")
        X, Y = cell_centers(g)
        reg = ~B.inside_footprint(X, Y) if plane == "outdoor" else B.inside_footprint(X, Y)
        a, b = ref[plane].astype(np.float64), m
        ok = reg & np.isfinite(a) & np.isfinite(b) & (a > -120) & (b > -120)
        d = b[ok] - a[ok]
        out["planes"][plane] = {"cells": int(ok.sum()), "rms_diff_db": float(np.sqrt(np.mean(d ** 2))),
                                "p95_abs_diff_db": float(np.percentile(np.abs(d), 95)),
                                "rms_single_run_noise_db": float(np.sqrt(np.mean(d ** 2) / 2))}
        for lo, hi in ((-120, -90), (-90, -60), (-60, 0)):
            sel = ok & (a >= lo) & (a < hi)
            if sel.any():
                dd = b[sel] - a[sel]
                out["planes"][plane][f"rms_diff_db_{lo}_{hi}"] = float(np.sqrt(np.mean(dd ** 2)))
    (OUT / "sionna_noise.json").write_text(json.dumps(out, indent=1))
    print(json.dumps(out, indent=1))


def env_tag(sp) -> str:
    return f"f{sp.fkey}" + "".join(f"_{k}+{v:g}dB" for k, v in sorted(sp.extra_db.items()))


def outdoor_seeds(specs: dict, mode: str) -> int:
    """Seeds averaged on the outdoor plane.  'auto': 4 when an exterior material (ext_concrete, ext_glass) has a
    normal-incidence slab loss > 30 dB -- there only ~1e-3 or fewer of the incident rays are continued as
    transmissions (event sampling proportional to |T|^2), so single-seed maps leave many outdoor cells empty;
    otherwise 1."""
    if mode != "auto":
        return int(mode)
    worst = max(specs[m]["slab_T_loss_db"] for m in ("ext_concrete", "ext_glass") if m in specs)
    return 4 if worst > 30.0 else 1


def fingerprint(B, sp) -> str:
    """Hash of every input that influences the traced maps of a scenario (geometry, radio materials, router,
    clients, frequency); used to detect stale cache entries."""
    import hashlib
    h = hashlib.sha256()
    quads = ss.scene_quads(B)
    for k in sorted(quads):
        h.update(k.encode())
        h.update(np.concatenate(quads[k]).astype("<f8").tobytes())
    specs = ss.material_specs(B, sp)
    h.update(json.dumps({k: {kk: (round(vv, 9) if isinstance(vv, float) else vv) for kk, vv in v.items()
                             if kk != "mwm_loss_db"} for k, v in specs.items()}, sort_keys=True).encode())
    h.update(json.dumps({"tx": [float(x) for x in sp.tx_pos], "antenna": sp.antenna, "patch": sp.patch,
                         "az": sp.az_deg, "tilt": sp.tilt_deg, "p": sp.tx_dbm, "f": sp.freq_ghz,
                         "clients": B.client_positions().tolist()}, sort_keys=True).encode())
    if len(sp.tx_positions) > 1:                 # extra key only for multi-AP (keeps single-AP hashes stable)
        h.update(json.dumps({"tx_all": sp.tx_positions.tolist()}).encode())
    return h.hexdigest()[:16]


def reusable_client_maps(B, tag, k_out):
    """Client-source maps depend only on the propagation environment: reuse them from any cached scenario of the
    same environment (same seeds) whose radio fingerprint is still valid."""
    for f in sorted(CACHE.glob("sionna_*.npz")):
        try:
            z = np.load(f)
            meta = json.loads(str(z["meta"]))
        except Exception:      # noqa: BLE001
            continue
        if meta.get("env") != tag or meta.get("seeds_outdoor") != k_out or meta["scenario"] not in B.scenarios:
            continue
        if meta["fingerprint"] != fingerprint(B, scenario_params(B, meta["scenario"])):
            continue
        return z["pl_clients"].astype(np.float64), meta["scenario"]
    return None


def trace(B, R, names, args):
    """Ray-trace the selected scenarios and store everything in sim/out/cache (one npz per scenario,
    one env_<tag>.json per propagation environment)."""
    groups = {}
    for n in names:
        groups.setdefault(scenario_params(B, n).material_config, []).append(n)
    g_out = B.grid("outdoor", "sionna")
    for cfg, members in groups.items():
        sp0 = scenario_params(B, members[0])
        tag = env_tag(sp0)
        t0 = time.perf_counter()
        xml, specs, counts = ss.write_scene(B, sp0, CACHE / f"scene_{tag}")
        k_out = outdoor_seeds(specs, args.seeds_outdoor)
        scene = ss.load(xml, sp0.freq_ghz)
        reuse = reusable_client_maps(B, tag, k_out)
        if reuse is not None:                       # same environment already traced: client maps are identical
            pl_c, src = reuse
            pg_c = np.where(np.isfinite(pl_c), 10 ** (-pl_c / 10), 0.0)
            print(f"[{tag}] reusing the client-source maps of '{src}' (same environment, {k_out} seed(s))", flush=True)
        else:
            pg_c = R.client_maps(scene, g_out, seeds=k_out)                  # (8, ny, nx)
            with np.errstate(divide="ignore"):
                pl_c = -10 * np.log10(pg_c)                                  # +inf where no ray reached the cell
        t_env = time.perf_counter() - t0
        old_env = CACHE / f"env_{tag}.json"
        if reuse is not None and old_env.exists():   # keep the original client-map runtime / scenario list
            prev = json.loads(old_env.read_text())
            members_all = sorted(set(prev.get("scenarios", [])) | set(members))
            t_env_rec = prev.get("client_maps_runtime_s", round(t_env, 1))
        else:
            members_all, t_env_rec = members, round(t_env, 1)
        env = {"freq_ghz": sp0.freq_ghz, "scenarios": members_all, "client_maps_runtime_s": t_env_rec,
               "seeds_outdoor": k_out, "client_zero_ray_cells": [int((p == 0).sum()) for p in pg_c], "quads": counts,
               "materials": {k: {kk: (round(vv, 6) if isinstance(vv, float) else vv) for kk, vv in s_.items()}
                             for k, s_ in specs.items()}}
        (CACHE / f"env_{tag}.json").write_text(json.dumps(env, indent=1))
        print(f"[{tag}] scene + 8 client maps ({k_out} seed(s) outdoor): {t_env:.1f} s   (zero-ray cells per client: "
              f"{env['client_zero_ray_cells']})", flush=True)
        for name in members:
            sp = scenario_params(B, name)
            t1 = time.perf_counter()
            maps, rss_c, n_paths = R.router(scene, sp, seeds_outdoor=k_out)
            dt = time.perf_counter() - t1
            meta = {"scenario": name, "env": tag, "fingerprint": fingerprint(B, sp), "seeds_outdoor": k_out,
                    "seed": R.settings["seed"], "samples_per_tx": R.settings["samples_per_tx"],
                    "max_depth": R.settings["max_depth"], "pathsolver_valid_paths": n_paths,
                    "runtime_s": round(dt + t_env / len(members), 1),
                    "traced_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
            np.savez_compressed(CACHE / f"sionna_{name}.npz", **{k: v.astype(np.float32) for k, v in maps.items()},
                                pl_clients=pl_c.astype(np.float32), rss_ap_clients=rss_c,
                                meta=np.array(json.dumps(meta)))
            print(f"  {name:14s} traced in {dt:.1f} s   RSS(AP->c) {np.round(rss_c, 1).tolist()}  paths {n_paths}",
                  flush=True)
        del scene


def assemble(B, args, versions) -> None:
    """Attack maps, statistics, figures, sionna_stats.csv and web/src/data/sionna.json from the cache."""
    eq = mwm.equipment(B)
    g_out = B.grid("outdoor", "sionna")
    Xo, Yo = cell_centers(g_out)
    outside = ~B.inside_footprint(Xo, Yo)
    results, rows, runtimes, seeds, metas, env_info = {}, [], {}, {}, {}, {}
    for name in B.scenarios:
        f = CACHE / f"sionna_{name}.npz"
        if not f.exists():
            sys.exit(f"missing {f} - run: python sim/run_sionna.py --scenarios {name}")
        z = np.load(f)
        meta = json.loads(str(z["meta"]))
        sp = scenario_params(B, name)
        if meta["fingerprint"] != fingerprint(B, sp):
            sys.exit(f"stale cache for '{name}' (radio inputs in building.json changed) - "
                     f"run: python sim/run_sionna.py --scenarios {name}")
        maps = {p: z[p].astype(np.float64) for p in B.plane_names()}
        pl_c = z["pl_clients"].astype(np.float64)
        rss_c = z["rss_ap_clients"].astype(np.float64)
        att = mwm.attack_maps(B, sp, maps["outdoor"], pl_c, rss_c, eq)
        fl = f"floor{mwm.router_floor(B, sp)}"
        st = mwm.attack_stats(B, sp, g_out, att, maps[fl], B.grid(fl, "sionna"))
        st["zero_ray_pct"] = float(100 * (~np.isfinite(maps["outdoor"]) & outside).sum() / outside.sum())
        runtimes[name], seeds[name], metas[name] = meta["runtime_s"], meta["seeds_outdoor"], meta
        env_info[meta["env"]] = json.loads((CACHE / f"env_{meta['env']}.json").read_text())
        results[name] = {"sp": sp, "maps": maps, "att": att, "stats": st, "rss_c": rss_c}
        rows.append({"scenario": name, "model": "sionna", "grid": "sionna", "cell_outdoor_m": g_out["dx"],
                     "cell_floor_m": B.grid("floor0", "sionna")["dx"], "freq_ghz": sp.freq_ghz, "tx_dbm": sp.tx_dbm,
                     "antenna": sp.antenna, "mount": sp.mount, "equipment": eq["key"],
                     **{k: st[k] for k in STAT_KEYS}, "zero_ray_pct": round(st["zero_ray_pct"], 2),
                     "seeds_outdoor": meta["seeds_outdoor"], "runtime_s": meta["runtime_s"]})
        print(f"  {name:14s} eav {st['area_eavesdrop']:8.0f} m²  deauth {st['area_deauth']:8.0f} m²  "
              f"ET {st['area_eviltwin']:7.0f} m²  leak {st['max_leak_m']:6.1f} m  street {st['street_exposure']:5.1f} %  "
              f"cov {st['coverage']:5.1f} %  no-ray {st['zero_ray_pct']:4.1f} %  (seeds {meta['seeds_outdoor']})",
              flush=True)
        if not args.no_figures:
            from twin.plotting import save_both
            save_both(B, sp, maps, att, st, "Sionna RT ray tracing", FIGURES / f"sionna_{name}", cell="sionna",
                      note=f"rays/tx {meta['samples_per_tx']:.0e} x {meta['seeds_outdoor']} seed(s), "
                           f"depth {meta['max_depth']}")
    with open(OUT / "sionna_stats.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    m0 = next(iter(metas.values()))
    settings = {"max_depth": m0["max_depth"], "samples_per_tx": float(m0["samples_per_tx"]), "los": True,
                "specular_reflection": True, "diffuse_reflection": False, "refraction": True, "diffraction": False,
                "seed": m0["seed"], "seeds_outdoor": seeds,
                "seeds_outdoor_rule": "outdoor maps (AP and clients) averaged over 4 seeds when an exterior material "
                                      "has a normal-incidence slab loss > 30 dB, else 1 seed; floor planes 1 seed",
                **versions,
                "solver": "RadioMapSolver (planar maps) + PathSolver (RSS at clients)",
                "tx_antenna": {"dipole": "hw_dipole, polarization V, orientation (0,0,0)",
                               "patch": "tr38901 (8 dBi/65°/30 dB; other mount-specific patch parameters -> custom "
                                        "pattern with the same formula), polarization V, orientation (az, -tilt, 0) "
                                        "rad -> boresight = local +x"},
                "rx": "radio-map cells: polarisation-agnostic isotropic (|E|^2); PathSolver receivers: iso 'VH' summed",
                "client_maps": "8 clients traced as isotropic V sources onto the outdoor plane (reciprocity) for PL(X,c)",
                "geometry": "walls = zero-thickness quads with ITU-R P.2040 single-slab materials (thickness = t); "
                            "openings split out; slabs at rf.slab_planes; ground medium_dry_ground; "
                            "context = 4 walls + roof",
                "environments": env_info, "runtime_s": runtimes,
                "runtime_total_s": round(sum(runtimes.values()), 1),
                "traced_utc": {n: m["traced_utc"] for n, m in metas.items()},
                "stats_equipment": eq["key"], "building_json_sha256": B.extra["sha256"]}
    scen = {n: {"freq_ghz": r["sp"].freq_ghz, "tx_dbm": r["sp"].tx_dbm, **r["maps"]} for n, r in results.items()}
    extra = {"stats": {n: {**{k: (round(v, 2) if isinstance(v, float) else v) for k, v in r["stats"].items()},
                           "rss_ap_clients_dbm": {c["id"]: round(float(x), 2) for c, x in zip(B.clients, r["rss_c"])}}
                       for n, r in results.items()},
             "tiers_encoding": "uint8 per outdoor-grid cell (row-major like the maps): 0 = no attack, 1 = eavesdropping, "
                               "2 = deauthentication, 3 = evil twin (highest feasible tier, MODEL.md §6 with nested tiers "
                               "evil twin ⊂ deauth ⊂ eavesdropping, equipment "
                               f"'{eq['key']}', Sionna PL for AP and clients; cells inside the footprint included)",
             "tiers": {n: tiers_to_b64(r["att"]["tier"]) for n, r in results.items()}}
    size = write_maps_json(Path(args.out), f"sionna-rt {versions['sionna_rt']}", settings, grids_block(B, "sionna"),
                           scen, extra)
    print(f"wrote {args.out} ({size / 1024:.0f} kB), {OUT / 'sionna_stats.csv'}")
    if size > 1.5 * 1024 * 1024:
        print("WARNING: sionna.json exceeds 1.5 MB")


def main():
    global CACHE
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--samples", type=float, default=1e9, help="samples (rays) per transmitter and seed")
    ap.add_argument("--max-depth", type=int, default=5)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--seeds-outdoor", default="auto",
                    help="seeds averaged on the outdoor plane: 'auto' (4 behind > 30 dB exterior walls, else 1) or N")
    ap.add_argument("--scenarios", default="all", help="comma-separated scenarios to (re-)trace; the outputs are "
                                                       "always assembled for all scenarios from the cache")
    ap.add_argument("--assemble-only", action="store_true", help="no ray tracing: rebuild stats/figures/JSON from cache")
    ap.add_argument("--no-figures", action="store_true")
    ap.add_argument("--out", default=str(WEB_SIONNA_JSON))
    ap.add_argument("--cache-dir", default=str(CACHE), help="cache directory (use a separate one for quick tests)")
    ap.add_argument("--noise-check", action="store_true",
                    help="only re-trace the baseline AP maps with seed+1 and compare with the cached run "
                         "(Monte-Carlo repeatability) -> sim/out/sionna_noise.json")
    args = ap.parse_args()
    CACHE = Path(args.cache_dir)

    variant = set_variant()
    import drjit as dr
    import mitsuba as mi
    import sionna.rt as rt
    check_itu_table()
    B = load_building()
    versions = {"sionna_rt": rt.__version__, "mitsuba": mi.__version__, "drjit": dr.__version__, "variant": variant,
                "gpu": gpu_name()}
    print("Sionna RT", versions, flush=True)
    CACHE.mkdir(parents=True, exist_ok=True)
    FIGURES.mkdir(parents=True, exist_ok=True)
    if args.noise_check:
        noise_check(B, Runner(B, args), args)
        return
    if not args.assemble_only:
        names = list(B.scenarios) if args.scenarios == "all" else args.scenarios.split(",")
        t0 = time.perf_counter()
        trace(B, Runner(B, args), names, args)
        print(f"traced {len(names)} scenario(s) in {time.perf_counter() - t0:.0f} s", flush=True)
    assemble(B, args, versions)


if __name__ == "__main__":
    main()
