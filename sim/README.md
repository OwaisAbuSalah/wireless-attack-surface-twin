# `sim/` — propagation simulation of the Wireless Attack Surface Digital Twin

Python half of the project: a vectorised NumPy **reference implementation of the multi-wall model**
(`docs/MODEL.md`, the same model the web app runs in GLSL/JS) and **NVIDIA Sionna RT** ray-traced radio maps
used as the physics reference to validate and calibrate it. Everything reads the single source of truth
`data/building.json`; nothing here edits it.

```
sim/
├── twin/                     package
│   ├── building.py           load building.json, grids, geometry helpers, scenario → effective parameters (MODEL.md §5)
│   ├── mwm.py                multi-wall model §2–7: path loss, 3-D wall/slab crossings with openings, dipole + 3GPP patch,
│   │                         maps, attack zones (§6, nested tiers), statistics (§7), itemised scalar link budget
│   ├── sionna_scene.py       building.json → Mitsuba XML + PLY scene for Sionna RT, ITU-R P.2040 slab maths, shielding materials
│   ├── export.py             uint8 / base64 map encoding of MODEL.md §8
│   ├── plotting.py           report (light) and slide (dark) figures
│   └── report.py             generates out/RESULTS.md
├── run_mwm.py                MWM maps + stats for all scenarios, test vectors for the JS/GLSL implementation
├── run_sionna.py             Sionna RT maps for all scenarios → web/src/data/sionna.json
├── compare.py                MWM vs. Sionna metrics, difference maps, least-squares calibration, RESULTS.md
├── measure/                  field-measurement template + comparison script
├── tests/                    test_mwm.py (NumPy only), test_sionna_canonical.py (Sionna conventions)
└── out/                      results (CSV / JSON / RESULTS.md); out/cache/ is git-ignored
```

## 1. Setup

```powershell
uv venv --python 3.12 sim\.venv
uv pip install --python sim\.venv\Scripts\python.exe -r sim\requirements.txt
sim\.venv\Scripts\python.exe -c "import mitsuba as mi; mi.set_variant('cuda_ad_mono_polarized'); print(mi.variant())"
```

* `sionna-rt` 2.x is the standalone ray tracer (no TensorFlow). It needs a *polarized* Mitsuba variant:
  `cuda_ad_mono_polarized` (NVIDIA GPU, used here) or `llvm_ad_mono_polarized` (CPU; needs an LLVM shared
  library). `run_sionna.py` picks CUDA first and falls back to LLVM automatically. The message
  `jitc_llvm_init(): LLVM API initialization failed` is harmless when CUDA is used.
* **Windows path-length pitfall (encountered on the development machine).** Python's DLL loader fails with
  *"DLL load failed while importing cuda_ad_mono_polarized: The filename or extension is too long"* when the
  file `…\site-packages\mitsuba\cuda_ad_mono_polarized.cp312-win_amd64.pyd` has a path of ≳ 250 characters
  (Mitsuba resolves the real path, so 8.3 short names do not help; `LongPathsEnabled` does not help either).
  With the project at a long path, create the environment at a short location instead and use that
  interpreter for `run_sionna.py`, e.g.
  ```powershell
  uv venv --python 3.12 C:\venvs\twin
  uv pip install --python C:\venvs\twin\Scripts\python.exe -r sim\requirements.txt
  C:\venvs\twin\Scripts\python.exe sim\run_sionna.py
  ```
  (`sim/.venv` works for everything that does not import Mitsuba: `run_mwm.py`, `compare.py`, tests, `measure/`.)
  If `uv venv --python 3.12` reports *"Missing expected target directory for Python minor version link"*, pass
  the interpreter path it downloaded (`--python %APPDATA%\uv\python\cpython-3.12.*\python.exe`).

## 2. Running (all commands from the project root)

| Step | Command | Runtime (RTX 3060 / laptop CPU) | Outputs |
|---|---|---|---|
| unit tests (15) | `python sim/tests/test_mwm.py` | ≈ 10 s | — |
| reference model | `python sim/run_mwm.py` | ≈ 2–4 min | `docs/figures/mwm_<scenario>[_dark].png`, `sim/out/mwm_stats.csv`, `sim/out/mwm_maps.json`, `sim/out/mwm_testpoints.json` |
| Sionna sanity checks | `python sim/tests/test_sionna_canonical.py` | ≈ 10 s | `sim/out/sionna_canonical.json` |
| ray tracing | `python sim/run_sionna.py` (`--samples 1e9 --max-depth 5 --seeds-outdoor auto`) | ≈ 40 min for all nine scenarios (sum of recorded per-scenario runtimes 2,362 s on an RTX 3060 shared with another GPU job; the 4-seed outdoor maps of the four heavily attenuating scenarios dominate) | `web/src/data/sionna.json`, `docs/figures/sionna_<scenario>[_dark].png`, `sim/out/sionna_stats.csv`, `sim/out/cache/` |
| Sionna Monte-Carlo noise | `python sim/run_sionna.py --noise-check` | ≈ 1 min | `sim/out/sionna_noise.json` |
| comparison | `python sim/compare.py` | ≈ 1–2 min | `docs/figures/compare_<scenario>[_dark].png`, `docs/figures/compare_calibration[_dark].png`, `sim/out/compare_metrics.csv`, `sim/out/calibration.json`, `sim/out/RESULTS.md` |
| field data | `python sim/measure/compare_measurements.py points.csv` | < 5 s | console / `--out report.json` |

`python` = the interpreter of the venv (`sim\.venv\Scripts\python.exe`, or the short-path venv for Sionna).
Quick Sionna test (separate cache, does not touch the production results):
`python sim/run_sionna.py --samples 1e7 --cache-dir sim/out/cache/quick --out sim/out/cache/quick/sionna.json --no-figures`.
`run_sionna.py` caches each traced scenario (`sim/out/cache/sionna_<scenario>.npz` + a fingerprint of every radio
input) and always assembles CSV / JSON / figures for all scenarios from that cache: `--scenarios a,b` re-traces only
those, `--assemble-only` re-derives statistics after a change of the attack/statistics rules without ray tracing,
and a cache entry whose radio inputs no longer match building.json is refused.

## 3. Reference model (`twin/mwm.py`)

Implements `docs/MODEL.md` §2–7 literally: `PL = PL0(f) + 10 n log10(max(d, 0.5)) + Σ L_wall + Σ L_slab`,
3-D wall crossings (plan intersection `ε < t < 1 − ε`, `−ε ≤ u ≤ 1 + ε` with ε = 10⁻⁵ — an end point on a wall plane
never counts that wall, a ray through a junction counts every wall meeting there —, height test `z0 − δ ≤ zc ≤ z1 + δ`
with δ = 10⁻⁴ m), periodic openings (`m = (s − offset) mod period`, wrapped to `m − period` when `m > period − δ`;
`−δ ≤ m ≤ width + δ`, `sill − δ ≤ h ≤ head + δ`), slab planes strictly between the end points and inside the
footprint ± δ — the lattice tolerances of MODEL.md §2.1 that make float32 GPU and float64 CPU agree on every cell —, vertical λ/2 dipole (2.15 dBi, floor −27.85 dBi) and the 3GPP TR 38.901 patch
with the local frame of §3; the patch parameters are those of the active mount (`router.mounts.<mount>.patch`:
wall 8 dBi / 65° / 30 dB, ceiling 5.5 dBi / 110° / 25 dB). Transmit power = the scenario's `tx_dbm` if given, else
12 dBm with `lowPower`, else `router.tx_dbm`. With several access points (`microcells` → mount `micro`, two ceiling
APs) `RSS(AP→R) = max_k RSS(AP_k→R)` for maps and for RSS(AP → client) (MODEL.md §4).

* `crossing_counts(T, R)` returns how often each material is crossed, so that the wall loss is `counts @ loss`;
  this makes the calibration a *linear* least-squares problem.
* `link_budget(...)` is an independent scalar implementation that itemises every crossing (`tests/test_mwm.py`
  checks that both agree to 1e-9 dB on random links).
* Attack feasibility (§6) uses **nested tiers** — deauthentication and Evil Twin also require the eavesdropping
  condition (the attacker must hear the AP): `deauth_margin_eff = min(deauth_margin, eav_margin)`,
  `et_margin_eff = min(et_margin, eav_margin)`. `PL(X, c)` uses the client as source (reciprocity, no antenna gain).
* Statistics (§7) use the default attacker equipment `usb`. Definitions used where MODEL.md leaves a choice:
  *outside the footprint* = cell centre not inside the closed footprint rectangle (cells inside neighbouring
  buildings count as outdoor); *main street + its sidewalks* = `site.roads.main_street` plus the four sidewalk
  rectangles that share an edge with it (closed rectangles, union); `max_leak_m` = largest plan distance from an
  eavesdropping cell centre to the footprint rectangle, with `leak_reaches_edge = true` when the zone touches the
  border of the study area (the true value is then larger); *router floor* = storey containing the AP height;
  *coverage* = share of router-floor cells inside the footprint with RSS ≥ −67 dBm, excluding cells strictly inside
  the stair/elevator core (`rooms` of type `core`, [−3, 1.2, 3, 8]), which is not a service area.
* `run_mwm.py` evaluates every scenario on the real-time grid (0.4 m outdoor / 0.2 m floors — what the web app
  computes) and on the Sionna grid (1.0 m / 0.25 m, used for the comparison).

### Test vectors for the JavaScript / GLSL implementation — `out/mwm_testpoints.json`

43 baseline links (AP → each client, AP → attacker start, AP → 30 seeded random outdoor/near/indoor points,
client c1 → 4 outdoor points as source of `PL(X, c)`) plus 4 links for every other scenario (patch antenna,
5 GHz, ceiling mount, shielding; for the two-AP scenario `applied` one link per AP plus `rss_max_over_aps_dbm`) and
for the non-scenario combination `directional+relocate` (wide-beam ceiling patch of MODEL.md §3), each with `tx_pos, rx_pos, freq_ghz, d_m, pl0_db, pl_distance_db, pl_db,
gain_tx_dbi, rss_dbm` and the list of crossed `walls` (`id, material, loss_db, opening, t, u, s_m, zc`) and
`slabs`. Random points are rejected unless every decision boundary of the model (wall ends, wall top/bottom,
opening edges, slab edges) is ≥ 5 cm away (`margin_m`), so float32 GPU code must reproduce the same crossings.
`attack_checks_baseline` gives §6 margins and verdicts at six outdoor positions; `loss_tables_db` gives the
effective per-material losses of every scenario.

## 4. Sionna RT scene (`twin/sionna_scene.py`, `run_sionna.py`)

**Walls are single planar quads on their centre plane, with radio-material `thickness` = wall `t`.**
This was confirmed against the installed sionna-rt 2.2.0 source: `RadioMaterial` computes reflection and
transmission with `itu_coefficients_single_layer_slab` (ITU-R P.2040 Eqs. 43–44: a slab of thickness `d`
including the multiple internal reflections), and the docstring states that the class is meant for walls modelled
as single flat surfaces; transmitted rays continue undeflected (`_specular_reflection_transmission_direction`).
A closed box would therefore be crossed twice. `tests/test_sionna_canonical.py` verifies it numerically: one
0.30 m concrete surface between transmitter and a measurement plane produces 21.07 dB excess loss vs. 21.05 dB
from the slab formula.

* Each wall is split into rectangles in wall coordinates: solid parts → wall material, window/door parts →
  opening material (periodic patterns of MODEL.md §2.1 are expanded); `air` openings are left empty.
* Floor slabs: footprint quads at `rf.slab_planes` (3.45, 7.05, 10.65 m), ITU concrete, 0.30 m.
* Ground: quad 260 m × 200 m at z = 0, ITU `medium_dry_ground`, 1.0 m (≈ half-space).
* Context buildings: their four `ctx_wall` walls from building.json + a roof quad, ITU concrete, `t` = 0.25 m.
* `materials[*].itu` → ITU type (`plasterboard` for drywall, `metal` for steel). All quads of one material are one
  PLY mesh; `sim/out/cache/scene_<env>/scene.xml` is the generated Mitsuba scene (one per frequency/shielding).
* Transmitter: `hw_dipole`, polarisation V, orientation (0, 0, 0) for the omni router; `tr38901` for the wall-mount
  patch (8 dBi / 65° / 30 dB, identical to Sionna's built-in TR 38.901 element); any other mount-specific patch (the
  5.5 dBi / 110° / 25 dB ceiling panel) is registered as a custom Sionna pattern with the same formula
  (`twin.sionna_scene.register_patch_pattern`). Orientation `(α, β, γ) = (az, −tilt, 0)`. Sionna's rotation is `Rz(α)·Ry(β)·Rx(γ)` and the antenna
  boresight is the local +x axis, so the boresight becomes `(cos az cos tilt, sin az cos tilt, sin tilt)` and the
  local y axis `(−sin az, cos az, 0)` — exactly MODEL.md §3. Verified in `test_sionna_canonical.py`: free-space
  maps match the MODEL.md dipole, wall patch and ceiling patch link budgets with 0.03 / 0.06 / 0.01 dB RMSE.
* Receivers: radio-map cells are polarisation-agnostic isotropic receivers (Sionna sums |E|² over both
  polarisations). RSS(AP → client) uses the `PathSolver` with dual-polarised (`VH`) isotropic receivers and the
  incoherent sum of all path powers (local-area mean, consistent with the radio maps).
* `RSS_dBm = P_tx + 10 log10(path_gain)`; cells reached by no ray → `−inf` → encoded `0` (no signal).
* Clients for §6 (`PL(X, c)`): the eight clients are traced as isotropic V sources onto the outdoor plane once per
  propagation environment (reciprocity), `PL = −10 log10(g)`; a scenario of an already traced environment reuses them
  (e.g. `applied` reuses the maps of `allRF`: same frequency, shielding and clients).
* Several APs (`applied`): one Sionna `Transmitter` per AP (same pattern and power); the map is the per-cell maximum of
  the path gains, RSS(AP → client) the maximum over the APs (MODEL.md §4).
* Solver settings: `max_depth = 5`, LoS + specular reflection + refraction (transmission), diffuse reflection
  off (ITU materials have zero scattering coefficient), diffraction off, `samples_per_tx = 1e9`, `seed = 42`.
  Sionna launches rays on a deterministic Fibonacci lattice and samples the interaction type (reflection vs.
  transmission) with probability proportional to its power — unbiased, but behind strongly attenuating walls
  (e.g. 41 dB painted concrete) only ~10⁻⁴ of the incident rays continue, leaving outdoor cells without rays.
  `--seeds-outdoor K` therefore averages K independent seeds on the outdoor plane (AP and client maps); the
  share of outdoor cells without any ray is reported per scenario (`zero_ray_pct`).
  Sionna indexes rays with uint32, so client sources are batched (≤ 4·10⁹ rays per call). 10⁹ rays per source take
  ≈ 12 s per plane on the RTX 3060.

### Shielding materials (`shieldWindows`, `shieldPaint`)

The MWM adds `extra_db` (building.json → `protections.*.extra_db`) to the loss of `ext_glass` / `ext_concrete`.
For Sionna the affected material is replaced by an equivalent lossy slab — same thickness `d` and real permittivity
`ε_r` as the ITU material, but a conductivity σ′ chosen such that the **normal-incidence slab transmission loss rises
by exactly `extra_db`**:

```
η(σ)      = ε_r − j σ / (ω ε0)                                      complex relative permittivity
r         = (cos θ − √(η − sin²θ)) / (cos θ + √(η − sin²θ))          (TE; TM analogous)  ITU-R P.2040 Eq. 37
q         = 2π d / λ · √(η − sin²θ)                                                  Eq. 44
T(σ)      = (1 − r²) e^{−jq} / (1 − r² e^{−j2q})                                     Eq. 43b
L_T(σ)    = −10 log10 ½(|T_TE|² + |T_TM|²)       solve   L_T(σ′) = L_T(σ_ITU) + extra_db   (θ = 0, Brent's method)
```

The same equations are what Sionna evaluates at every interaction (`twin.sionna_scene.slab_coefficients` is a NumPy
replica; the canonical test confirms the agreement). Resulting materials:

| Scenario | material | d [m] | ε_r | σ_ITU [S/m] | σ′ [S/m] | L_T ITU → shielded [dB] | thin-film equivalent R_s |
|---|---|---:|---:|---:|---:|---|---:|
| shieldWindows, 2.4 GHz | ext_glass (glass) | 0.024 | 6.31 | 0.0116 | 1.84 | 0.3 → 25.3 | 11.2 Ω/sq |
| shieldPaint, 2.4 GHz | ext_concrete (concrete) | 0.30 | 5.24 | 0.0916 | 0.186 | 21.0 → 41.0 | 20.9 Ω/sq |
| allRF (5 GHz) | ext_glass (glass) | 0.024 | 6.31 | 0.0311 | 1.88 | 0.7 → 28.7 | 7.8 Ω/sq |
| allRF (5 GHz) | ext_concrete (concrete) | 0.30 | 5.24 | 0.163 | 0.276 | 36.3 → 60.3 | 12.7 Ω/sq |

For orientation, the last column gives the sheet resistance of an infinitely thin conductive film in free space with
the same insertion loss, `|T| = 1 / (1 + η0 / (2 R_s))` → `R_s = η0 / (2 (10^{extra/20} − 1))`. The equivalent-slab
approach keeps each wall a single surface (two coplanar surfaces would create spurious internal bounces); its
limitation is that the extra loss at oblique incidence follows the slab physics rather than a constant increment.
The full material table of every run (ε_r, σ, normal-incidence transmission/reflection loss) is stored in
`web/src/data/sionna.json → settings.environments` and printed in `out/RESULTS.md`.

### Output format

`web/src/data/sionna.json` follows MODEL.md §8 exactly (`generator`, `created`, `settings`, `grids`, `encoding`,
`scenarios.<name>.{freq_ghz, tx_dbm, outdoor, floor0, floor1, floor2}`) and adds two optional top-level keys that a
§8 reader can ignore: `stats` (Sionna §7 statistics + RSS(AP → client) per scenario) and `tiers` (uint8 outdoor map:
0 none, 1 eavesdrop, 2 deauth, 3 evil twin; encoding described in `tiers_encoding`). `sim/out/mwm_maps.json` is the
same §8 format for the reference model (`generator: "mwm-numpy"`) — useful to diff against the GPU implementation.

## 5. Comparison and calibration (`compare.py`)

Cell-by-cell error MWM − Sionna on cells where both are > −120 dBm (outdoor cells outside the footprint, floor cells
inside it): RMSE, MAE, mean bias, per plane and scenario (`out/compare_metrics.csv`), hexbin scatter + difference
maps (`docs/figures/compare_<scenario>.png`). Calibration: since `PL_MWM = PL0 + 10 n log10 d + Σ_m N_m L_m` is linear
in `(n, L_m)`, the material losses (with n = 2 fixed, and with n free) are fitted by bounded weighted least squares
(BVLS) to the Sionna path loss of the unshielded scenarios of each band (AP maps on all four planes + the eight
client-source outdoor maps, every map weighted equally); the shielding increments are then fitted on the shielded
scenarios with the base losses fixed. Leave-one-scenario-out errors are reported for 2.4 GHz. Result:
`out/calibration.json`; the calibrated model is re-run for every scenario (statistics in `out/RESULTS.md`).

## 6. Field measurements (`measure/`)

1. Copy `measure/rssi_measurements_template.csv` and fill one row per point: `point_id, x_m, y_m, z_m, rssi_dbm,
   device, notes` in the building frame (x east, y north, z up, origin = building centre at ground level; take
   positions from the floor plan / web app). Average several beacon RSSI readings per point; note the device —
   RSSI calibration differs between adapters. The two `# EXAMPLE` rows are placeholders, not data, and are ignored.
2. `python sim/measure/compare_measurements.py my_points.csv --scenario baseline --per-device --out report.json`
3. The script reports per-point MWM and Sionna predictions (nearest map cell of the matching plane), RMSE / MAE /
   bias / r per model, a least-squares fit of the MWM `RSSI = P_tx + G_tx − PL0 − ΣL − 10 n log10 d + offset`
   (n and a constant offset), the constant offset of Sionna, and per-device offsets.
