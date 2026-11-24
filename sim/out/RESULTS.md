# Simulation results — Wireless Attack Surface Digital Twin

*Generated 2026-11-24T23:05:07+00:00 by `sim/compare.py` from the outputs of `sim/run_mwm.py` and `sim/run_sionna.py`. Every number below is produced by those scripts; re-running them regenerates this file.*

Models: **MWM** = multi-wall reference model of `docs/MODEL.md` (`sim/twin/mwm.py`, nominal material losses of `data/building.json`); **Sionna RT** = NVIDIA Sionna RT ray tracer (sionna-rt 2.2.0, Mitsuba 3.9.1, Dr.Jit 1.5.0, variant `cuda_ad_mono_polarized`, NVIDIA GeForce RTX 3060, 616.64); **MWM-cal** = MWM with the material losses fitted to Sionna (n = 2 kept, section 3).

Attack statistics use the default attacker equipment `usb` (USB adapter + 5 dBi antenna). Grids: outdoor 1.0 m (200 × 140) at z = 1.5 m and floors 0.25 m (148 × 68) at floor + 1.2 m unless stated otherwise. ⁺ = the eavesdropping zone reaches the edge of the 200 m × 140 m study area, so the true leak distance is larger.

## 1. Attack-surface statistics (MODEL.md §7)

### 1a. Sionna RT (ray tracing)

| Scenario | Eavesdrop [m²] | Deauth [m²] | Evil Twin [m²] | Max leak [m] | Street exp. [%] | Coverage [%] |
|---|---:|---:|---:|---:|---:|---:|
| Baseline (`baseline`) | 21,672 | 21,300 | 317 | 102.1⁺ | 98.2 | 94.8 |
| Reduced TX power (`lowPower`) | 18,822 | 18,779 | 1,911 | 102.1⁺ | 96.3 | 83.8 |
| Directional antenna (`directional`) | 19,609 | 19,378 | 965 | 102.1⁺ | 94.1 | 92.4 |
| Relocated AP (`relocate`) | 23,178 | 22,044 | 536 | 102.1⁺ | 99.0 | 98.7 |
| Shielding window film (`shieldWindows`) | 17,446 | 17,414 | 50 | 102.1⁺ | 95.3 | 95.1 |
| Shielding paint (`shieldPaint`) | 20,429 | 15,601 | 246 | 102.1⁺ | 95.7 | 94.8 |
| 5 GHz band (`band5`) | 16,428 | 12,894 | 219 | 102.1⁺ | 95.7 | 82.0 |
| Combined RF measures (`allRF`) | 3,960 | 112 | 0 | 84.5⁺ | 36.7 | 92.2 |
| Applied protection (app) (`applied`) | 2,691 | 35 | 0 | 81.1 | 17.6 | 100.0 |

Share of outdoor cells (outside the footprint) that no AP ray reached (reported as *no signal*): baseline 5.4 %, lowPower 5.4 %, directional 5.4 %, relocate 4.1 %, shieldWindows 13.5 %, shieldPaint 9.2 %, band5 21.8 %, allRF 36.3 %, applied 18.2 %.

### 1b. MWM, nominal losses (same 1 m / 0.25 m grid as Sionna)

| Scenario | Eavesdrop [m²] | Deauth [m²] | Evil Twin [m²] | Max leak [m] | Street exp. [%] | Coverage [%] |
|---|---:|---:|---:|---:|---:|---:|
| Baseline (`baseline`) | 22,521 | 22,521 | 550 | 102.1⁺ | 99.5 | 94.7 |
| Reduced TX power (`lowPower`) | 16,518 | 16,518 | 3,496 | 102.1⁺ | 99.5 | 82.4 |
| Directional antenna (`directional`) | 15,469 | 15,469 | 6,478 | 102.1⁺ | 91.4 | 88.9 |
| Relocated AP (`relocate`) | 18,170 | 18,170 | 6,369 | 101.5⁺ | 97.7 | 81.6 |
| Shielding window film (`shieldWindows`) | 16,785 | 16,785 | 453 | 102.1⁺ | 96.9 | 94.7 |
| Shielding paint (`shieldPaint`) | 13,651 | 10,738 | 30 | 102.1⁺ | 95.3 | 94.7 |
| 5 GHz band (`band5`) | 9,410 | 8,502 | 7 | 100.5⁺ | 94.8 | 70.1 |
| Combined RF measures (`allRF`) | 819 | 12 | 0 | 59.5 | 9.6 | 68.5 |
| Applied protection (app) (`applied`) | 288 | 14 | 0 | 38.5 | 0.0 | 96.1 |

### 1c. MWM, nominal losses, real-time grid (0.4 m / 0.2 m — what the web app computes)

| Scenario | Eavesdrop [m²] | Deauth [m²] | Evil Twin [m²] | Max leak [m] | Street exp. [%] | Coverage [%] |
|---|---:|---:|---:|---:|---:|---:|
| Baseline (`baseline`) | 22,520 | 22,520 | 566 | 102.5⁺ | 99.5 | 94.4 |
| Reduced TX power (`lowPower`) | 16,490 | 16,490 | 3,493 | 102.5⁺ | 99.5 | 82.1 |
| Directional antenna (`directional`) | 15,452 | 15,452 | 6,470 | 102.5⁺ | 91.8 | 88.5 |
| Relocated AP (`relocate`) | 18,202 | 18,202 | 6,379 | 102.3⁺ | 97.8 | 81.2 |
| Shielding window film (`shieldWindows`) | 16,793 | 16,793 | 463 | 102.5⁺ | 96.9 | 94.4 |
| Shielding paint (`shieldPaint`) | 13,623 | 10,719 | 25 | 102.5⁺ | 95.5 | 94.4 |
| 5 GHz band (`band5`) | 9,378 | 8,469 | 8 | 101.2⁺ | 94.9 | 70.1 |
| Combined RF measures (`allRF`) | 815 | 16 | 0 | 59.8 | 9.7 | 68.3 |
| Applied protection (app) (`applied`) | 282 | 12 | 0 | 38.6 | 0.0 | 95.9 |

### 1d. MWM calibrated to Sionna (section 3)

| Scenario | Eavesdrop [m²] | Deauth [m²] | Evil Twin [m²] | Max leak [m] | Street exp. [%] | Coverage [%] |
|---|---:|---:|---:|---:|---:|---:|
| Baseline (`baseline`) | 24,195 | 24,189 | 230 | 102.1⁺ | 99.5 | 100.0 |
| Reduced TX power (`lowPower`) | 18,853 | 18,847 | 2,379 | 102.1⁺ | 99.5 | 98.7 |
| Directional antenna (`directional`) | 17,695 | 17,695 | 4,647 | 102.1⁺ | 93.3 | 99.7 |
| Relocated AP (`relocate`) | 23,216 | 23,214 | 369 | 102.1⁺ | 97.9 | 100.0 |
| Shielding window film (`shieldWindows`) | 20,475 | 20,475 | 208 | 102.1⁺ | 96.9 | 100.0 |
| Shielding paint (`shieldPaint`) | 18,000 | 15,988 | 15 | 102.1⁺ | 99.5 | 100.0 |
| 5 GHz band (`band5`) | 15,728 | 13,573 | 0 | 102.1⁺ | 96.9 | 97.5 |
| Combined RF measures (`allRF`) | 2,428 | 1,466 | 0 | 61.5⁺ | 25.1 | 100.0 |
| Applied protection (app) (`applied`) | 1,347 | 1,097 | 0 | 38.5 | 12.7 | 100.0 |

### 1e. Effect of each protection on the eavesdropping area (relative to baseline)

| Scenario | MWM | Sionna RT | MWM-cal |
|---|---:|---:|---:|
| Reduced TX power | -27 % | -13 % | -22 % |
| Directional antenna | -31 % | -10 % | -27 % |
| Relocated AP | -19 % | +7 % | -4 % |
| Shielding window film | -25 % | -19 % | -15 % |
| Shielding paint | -39 % | -6 % | -26 % |
| 5 GHz band | -58 % | -24 % | -35 % |
| Combined RF measures | -96 % | -82 % | -90 % |
| Applied protection (app) | -99 % | -88 % | -94 % |

## 2. Validation: MWM vs. Sionna RT (cell-by-cell)

Error = MWM − Sionna [dB] on cells where both models give RSS > −120 dBm; outdoor cells outside the building footprint, floor cells inside it. RSS maps of the access point.

| Scenario | Outdoor N | Outdoor RMSE | Outdoor MAE | Outdoor bias | Floors N | Floors RMSE | Floors MAE | Floors bias | All RMSE | All bias |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline | 24,729 | 12.84 | 9.45 | -2.54 | 27,243 | 6.99 | 3.98 | -0.68 | 10.20 | -1.56 |
| lowPower | 23,915 | 12.15 | 8.97 | -2.67 | 26,817 | 6.09 | 3.62 | -0.40 | 9.44 | -1.47 |
| directional | 22,988 | 16.06 | 12.56 | -9.15 | 27,279 | 7.36 | 4.59 | -0.49 | 12.14 | -4.45 |
| relocate | 23,531 | 19.81 | 16.10 | -11.83 | 27,263 | 12.08 | 7.59 | -3.51 | 16.13 | -7.36 |
| shieldWindows | 21,655 | 10.46 | 7.90 | 0.86 | 27,165 | 7.00 | 3.90 | -0.25 | 8.71 | 0.24 |
| shieldPaint | 22,178 | 19.60 | 14.69 | -10.65 | 27,235 | 7.04 | 4.04 | -0.61 | 14.13 | -5.12 |
| band5 | 16,956 | 15.19 | 11.36 | -8.11 | 22,750 | 12.18 | 8.91 | -0.07 | 13.55 | -3.51 |
| allRF | 5,061 | 12.65 | 10.68 | -9.95 | 23,048 | 14.35 | 10.64 | 2.38 | 14.06 | 0.16 |
| applied | 9,204 | 10.40 | 9.11 | -8.90 | 26,981 | 8.73 | 7.30 | 3.65 | 9.19 | 0.46 |

Per floor (nominal MWM):

| Scenario | floor0 RMSE / bias | floor1 RMSE / bias | floor2 RMSE / bias |
|---|---:|---:|---:|
| baseline | 7.06 / -1.48 | 7.25 / -2.93 | 6.64 / 2.51 |
| lowPower | 6.00 / -1.15 | 7.25 / -2.93 | 4.65 / 3.12 |
| directional | 7.56 / -1.03 | 7.30 / -3.01 | 7.21 / 2.66 |
| relocate | 11.90 / -4.42 | 13.93 / -6.92 | 10.05 / 0.90 |
| shieldWindows | 6.24 / 0.47 | 7.91 / -3.54 | 6.74 / 2.44 |
| shieldPaint | 7.15 / -1.33 | 7.26 / -2.95 | 6.68 / 2.57 |
| band5 | 14.03 / -0.43 | 10.06 / -6.05 | 12.52 / 9.62 |
| allRF | 8.89 / 6.59 | 15.91 / -9.93 | 16.93 / 13.74 |
| applied | 6.85 / 5.61 | 6.64 / -4.77 | 11.81 / 10.45 |

After calibration (MWM-cal, in-sample for the scenarios used in the fit):

| Scenario | Outdoor RMSE | Outdoor bias | Floors RMSE | Floors bias | All RMSE | All MAE | All bias |
|---|---:|---:|---:|---:|---:|---:|---:|
| baseline | 11.10 | -1.17 | 6.99 | 3.20 | 9.22 | 6.29 | 1.08 |
| lowPower | 10.80 | -1.61 | 6.71 | 3.11 | 8.91 | 6.11 | 0.84 |
| directional | 15.31 | -6.91 | 8.41 | 3.38 | 12.11 | 8.64 | -1.39 |
| relocate | 13.88 | -6.61 | 6.99 | 2.44 | 10.91 | 7.93 | -1.97 |
| shieldWindows | 10.74 | 5.30 | 7.20 | 3.62 | 9.00 | 6.62 | 4.39 |
| shieldPaint | 15.75 | -7.27 | 7.09 | 3.26 | 11.99 | 7.95 | -1.72 |
| band5 | 14.91 | -6.49 | 14.97 | 10.75 | 14.94 | 11.91 | 2.65 |
| allRF | 8.80 | -2.43 | 19.32 | 15.11 | 16.25 | 12.52 | 8.65 |
| applied | 5.95 | -2.29 | 15.08 | 12.45 | 12.42 | 9.53 | 6.83 |

Leave-one-scenario-out at 2.4 GHz (fit on the other unshielded scenarios, test on the held-out one):

| Held-out scenario | n | All RMSE | All MAE | All bias | Outdoor RMSE | Floors RMSE |
|---|---:|---:|---:|---:|---:|---:|
| baseline | 2.0 | 9.51 | 6.72 | 1.66 | 11.02 | 7.83 |
| directional | 2.0 | 12.86 | 9.48 | -0.82 | 15.81 | 9.65 |
| relocate | 2.0 | 11.30 | 8.34 | -1.82 | 14.26 | 7.45 |

### 2b. Reference model vs. the web app's GPU implementation

`sim/out/app_stats.json` (written by the web app, 2026-11-24T22:53:26.838Z, GPU: ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002504) Direct3D11 vs_5_0 ps_5_0, D3D11)) vs. the NumPy reference on the same real-time grid (table 1c); difference = app − NumPy.

| Scenario | Eavesdrop [m²] | Deauth [m²] | Evil Twin [m²] | Max leak [m] | Street exp. [%] | Coverage [%] |
|---|---:|---:|---:|---:|---:|---:|
| baseline | +0.5 | +0.5 | -0.2 | -0.0 | +0.0 | -0.0 |
| lowPower | +0.1 | +0.1 | +0.0 | -0.0 | +0.0 | -0.0 |
| directional | +0.3 | +0.3 | -0.4 | -0.0 | +0.1 | -0.0 |
| relocate | +0.2 | +0.2 | +0.3 | +0.0 | +0.0 | -0.0 |
| shieldWindows | +0.2 | +0.2 | -0.0 | -0.0 | +0.0 | -0.0 |
| shieldPaint | +0.3 | +0.1 | -0.1 | -0.0 | +0.1 | -0.0 |
| band5 | -0.1 | +0.4 | +0.2 | -0.0 | +0.1 | -0.0 |
| allRF | -0.4 | -0.2 | +0.0 | +0.0 | -0.1 | -0.0 |

Not in the app file: `applied`.

## 3. Calibration of the MWM material losses to Sionna RT

Method: bounded weighted linear least squares (scipy.optimize.lsq_linear, BVLS); each map weighted equally; target = Sionna path loss on cells > -120 dBm (outdoor outside / floors inside footprint). Data: AP maps of the unshielded scenarios of each band (`lowPower` is excluded because its path loss is identical to `baseline`) plus the eight client-source outdoor maps; shielding increments fitted afterwards on the shielded scenarios with the base losses fixed. Materials crossed by fewer than 100 cells keep their nominal value. Full result: `sim/out/calibration.json`.

### 2.4 GHz (scenarios: baseline, directional, relocate; 334,631 cells)

Weighted RMS residual over the fit data: nominal MWM 15.62 dB → calibrated losses with n = 2 (**primary**, used for MWM-cal) 10.56 dB → losses + free exponent 9.92 dB (fitted n = 2.70; sensitivity only — the exponent trades off against the wall counts, which are correlated with distance).

| Material | cells crossing | nominal MWM [dB] | ITU slab, normal incidence [dB] | calibrated, n = 2 [dB] | calibrated, n = 2.70 [dB] |
|---|---:|---:|---:|---:|---:|
| ext_concrete | 210,556 | 17 | 21.0 | 17.0 | 9.1 |
| concrete | 63,473 | 15 | 17.8 | 5.5 | 4.2 |
| brick | 164,317 | 6 | 5.7 | 3.5 | 1.9 |
| drywall | 135,948 | 3 | 2.7 | 2.1 | 0.3 |
| ext_glass | 42,000 | 3 | 0.3 | 4.8 | 0.0 |
| glass | 32,309 | 2 | 3.3 | 3.6 | 1.6 |
| wood | 26,402 | 3 | 0.7 | 2.2 | 0.8 |
| metal | 22,233 | 26 | opaque (>100) | 5.0 | 4.5 |
| slab | 92,988 | 18 | 21.0 | 19.9 | 16.9 |
| ctx_wall | 93,763 | 10 | 17.8 | 11.0 | 9.5 |

### 5 GHz (scenarios: band5; 154,923 cells)

Weighted RMS residual over the fit data: nominal MWM 26.04 dB → calibrated losses with n = 2 (**primary**, used for MWM-cal) 14.42 dB → losses + free exponent 12.00 dB (fitted n = 3.57; sensitivity only — the exponent trades off against the wall counts, which are correlated with distance).

| Material | cells crossing | nominal MWM [dB] | ITU slab, normal incidence [dB] | calibrated, n = 2 [dB] | calibrated, n = 3.57 [dB] |
|---|---:|---:|---:|---:|---:|
| ext_concrete | 116,204 | 26 | 36.3 | 29.8 | 8.5 |
| concrete | 21,403 | 23 | 30.5 | 3.0 | 2.0 |
| brick | 78,434 | 10 | 6.0 | 2.1 | 0.0 |
| drywall | 65,409 | 4 | 5.2 | 4.5 | 0.4 |
| ext_glass | 15,566 | 5 | 0.7 | 13.3 | 0.0 |
| glass | 11,462 | 3 | 0.4 | 0.0 | 0.0 |
| wood | 14,590 | 5 | 1.5 | 2.0 | 0.0 |
| metal | 7,344 | 32 | opaque (>100) | 0.1 | 0.0 |
| slab | 40,748 | 26 | 36.3 | 24.1 | 19.3 |
| ctx_wall | 21,063 | 15 | 30.5 | 6.1 | 4.0 |

Shielding increments (added to the calibrated base loss):

| Scenario | material | nominal extra [dB] | fitted extra [dB] |
|---|---|---:|---:|
| shieldWindows (2.4 GHz) | ext_glass | 25 | 15.7 |
| shieldPaint (2.4 GHz) | ext_concrete | 20 | 12.9 |
| allRF (5 GHz) | ext_glass | 28 | 19.8 |
| allRF (5 GHz) | ext_concrete | 24 | 13.0 |

## 4. Sanity checks of the Sionna RT set-up (`sim/tests/test_sionna_canonical.py`)

| Case | Result |
|---|---|
| free space, vertical half-wave dipole vs. MODEL.md §2-3 free space | RMSE 0.032 dB, mean error -0.000 dB over 6,188 cells |
| free space, 3GPP patch az=90 tilt=-10 vs. MODEL.md §2-3 free space | RMSE 0.060 dB, mean error +0.002 dB over 3,514 cells |
| free space, ceiling patch 5.5 dBi/110°, tilt=-90 vs. MODEL.md §2-3 free space | RMSE 0.008 dB, mean error -0.006 dB over 6,188 cells |
| single concrete surface t=0.30 m, normal incidence | Sionna excess loss 21.07 dB vs. ITU-R P.2040 slab 21.05 dB (crossed once) |

Monte-Carlo repeatability of the Sionna maps (`run_sionna.py --noise-check`: baseline re-traced with seed 43 vs. 42, 1e+09 rays): single-run noise = RMS difference / √2.

| Plane | cells | RMS diff [dB] | single-run noise [dB] | 95 % abs diff [dB] | RMS diff, cells < −90 dBm | −90…−60 | > −60 |
|---|---:|---:|---:|---:|---:|---:|---:|
| outdoor | 25,056 | 2.05 | 1.45 | 4.21 | 4.04 | 0.70 | 0.09 |
| floor0 | 9,155 | 1.97 | 1.39 | 2.73 | 6.97 | 1.25 | 0.14 |
| floor1 | 9,212 | 0.30 | 0.21 | 0.56 | 4.33 | 0.69 | 0.12 |
| floor2 | 8,730 | 2.74 | 1.94 | 4.57 | 9.42 | 2.11 | 0.16 |

## 5. Sionna RT settings and runtime

* Solver: RadioMapSolver (planar maps) + PathSolver (RSS at clients); max_depth = 5, samples_per_tx = 1e+09, LoS = True, specular = True, refraction = True, diffuse = False, diffraction = False, seed = 42.
* Geometry: walls = zero-thickness quads with ITU-R P.2040 single-slab materials (thickness = t); openings split out; slabs at rf.slab_planes; ground medium_dry_ground; context = 4 walls + roof.
* Antennas: {'dipole': 'hw_dipole, polarization V, orientation (0,0,0)', 'patch': 'tr38901 (8 dBi/65°/30 dB; other mount-specific patch parameters -> custom pattern with the same formula), polarization V, orientation (az, -tilt, 0) rad -> boresight = local +x'}; radio-map cells: polarisation-agnostic isotropic (|E|^2); PathSolver receivers: iso 'VH' summed.
* 8 clients traced as isotropic V sources onto the outdoor plane (reciprocity) for PL(X,c).
* Runtime per scenario [s]: baseline 89.5, lowPower 83.4, directional 88.8, relocate 102.7, shieldWindows 199.1, shieldPaint 693.8, band5 463.5, allRF 442.7, applied 198.0; total 2361.5 s.

Radio materials used by Sionna (normal-incidence single-slab losses computed with the ITU-R P.2040 equations that Sionna implements):

| Environment | material | ITU type | t [m] | ε_r | σ [S/m] | T loss [dB] | R loss [dB] | MWM [dB] |
|---|---|---|---:|---:|---:|---:|---:|---:|
| f2.4 | ext_concrete | concrete | 0.3 | 5.24 | 0.09163 | 21.0 | 8.1 | 17 |
| f2.4 | concrete | concrete | 0.25 | 5.24 | 0.09163 | 17.8 | 8.1 | 15 |
| f2.4 | brick | brick | 0.2 | 3.91 | 0.02738 | 5.7 | 8.1 | 6 |
| f2.4 | drywall | plasterboard | 0.12 | 2.73 | 0.01935 | 2.7 | 12.9 | 3 |
| f2.4 | ext_glass | glass | 0.024 | 6.31 | 0.01163 | 0.3 | 18.9 | 3 |
| f2.4 | glass | glass | 0.012 | 6.31 | 0.01163 | 3.3 | 2.8 | 2 |
| f2.4 | wood | wood | 0.045 | 1.99 | 0.01201 | 0.7 | 30.7 | 3 |
| f2.4 | metal | metal | 0.003 | 1.00 | 1e+07 | >100 | 0.0 | 26 |
| f2.4 | slab | concrete | 0.3 | 5.24 | 0.09163 | 21.0 | 8.1 | 18 |
| f2.4 | ctx_wall | concrete | 0.25 | 5.24 | 0.09163 | 17.8 | 8.1 | 10 |
| f2.4_ext_glass+25dB | ext_concrete | concrete | 0.3 | 5.24 | 0.09163 | 21.0 | 8.1 | 17 |
| f2.4_ext_glass+25dB | concrete | concrete | 0.25 | 5.24 | 0.09163 | 17.8 | 8.1 | 15 |
| f2.4_ext_glass+25dB | brick | brick | 0.2 | 3.91 | 0.02738 | 5.7 | 8.1 | 6 |
| f2.4_ext_glass+25dB | drywall | plasterboard | 0.12 | 2.73 | 0.01935 | 2.7 | 12.9 | 3 |
| f2.4_ext_glass+25dB | ext_glass | glass + shield | 0.024 | 6.31 | 1.836 | 25.3 | 3.8 | 28 |
| f2.4_ext_glass+25dB | glass | glass | 0.012 | 6.31 | 0.01163 | 3.3 | 2.8 | 2 |
| f2.4_ext_glass+25dB | wood | wood | 0.045 | 1.99 | 0.01201 | 0.7 | 30.7 | 3 |
| f2.4_ext_glass+25dB | metal | metal | 0.003 | 1.00 | 1e+07 | >100 | 0.0 | 26 |
| f2.4_ext_glass+25dB | slab | concrete | 0.3 | 5.24 | 0.09163 | 21.0 | 8.1 | 18 |
| f2.4_ext_glass+25dB | ctx_wall | concrete | 0.25 | 5.24 | 0.09163 | 17.8 | 8.1 | 10 |
| f2.4_ext_concrete+20dB | ext_concrete | concrete + shield | 0.3 | 5.24 | 0.1861 | 41.0 | 7.9 | 37 |
| f2.4_ext_concrete+20dB | concrete | concrete | 0.25 | 5.24 | 0.09163 | 17.8 | 8.1 | 15 |
| f2.4_ext_concrete+20dB | brick | brick | 0.2 | 3.91 | 0.02738 | 5.7 | 8.1 | 6 |
| f2.4_ext_concrete+20dB | drywall | plasterboard | 0.12 | 2.73 | 0.01935 | 2.7 | 12.9 | 3 |
| f2.4_ext_concrete+20dB | ext_glass | glass | 0.024 | 6.31 | 0.01163 | 0.3 | 18.9 | 3 |
| f2.4_ext_concrete+20dB | glass | glass | 0.012 | 6.31 | 0.01163 | 3.3 | 2.8 | 2 |
| f2.4_ext_concrete+20dB | wood | wood | 0.045 | 1.99 | 0.01201 | 0.7 | 30.7 | 3 |
| f2.4_ext_concrete+20dB | metal | metal | 0.003 | 1.00 | 1e+07 | >100 | 0.0 | 26 |
| f2.4_ext_concrete+20dB | slab | concrete | 0.3 | 5.24 | 0.09163 | 21.0 | 8.1 | 18 |
| f2.4_ext_concrete+20dB | ctx_wall | concrete | 0.25 | 5.24 | 0.09163 | 17.8 | 8.1 | 10 |
| f5 | ext_concrete | concrete | 0.3 | 5.24 | 0.1627 | 36.3 | 8.1 | 26 |
| f5 | concrete | concrete | 0.25 | 5.24 | 0.1627 | 30.5 | 8.1 | 23 |
| f5 | brick | brick | 0.2 | 3.91 | 0.03079 | 6.0 | 10.1 | 10 |
| f5 | drywall | plasterboard | 0.12 | 2.73 | 0.03856 | 5.2 | 10.1 | 4 |
| f5 | ext_glass | glass | 0.024 | 6.31 | 0.03108 | 0.7 | 23.8 | 5 |
| f5 | glass | glass | 0.012 | 6.31 | 0.03108 | 0.4 | 29.5 | 3 |
| f5 | wood | wood | 0.045 | 1.99 | 0.02638 | 1.5 | 18.6 | 5 |
| f5 | metal | metal | 0.003 | 1.00 | 1e+07 | >100 | 0.0 | 32 |
| f5 | slab | concrete | 0.3 | 5.24 | 0.1627 | 36.3 | 8.1 | 26 |
| f5 | ctx_wall | concrete | 0.25 | 5.24 | 0.1627 | 30.5 | 8.1 | 15 |
| f5_ext_concrete+24dB_ext_glass+28dB | ext_concrete | concrete + shield | 0.3 | 5.24 | 0.2755 | 60.3 | 8.0 | 50 |
| f5_ext_concrete+24dB_ext_glass+28dB | concrete | concrete | 0.25 | 5.24 | 0.1627 | 30.5 | 8.1 | 23 |
| f5_ext_concrete+24dB_ext_glass+28dB | brick | brick | 0.2 | 3.91 | 0.03079 | 6.0 | 10.1 | 10 |
| f5_ext_concrete+24dB_ext_glass+28dB | drywall | plasterboard | 0.12 | 2.73 | 0.03856 | 5.2 | 10.1 | 4 |
| f5_ext_concrete+24dB_ext_glass+28dB | ext_glass | glass + shield | 0.024 | 6.31 | 1.875 | 28.7 | 5.3 | 33 |
| f5_ext_concrete+24dB_ext_glass+28dB | glass | glass | 0.012 | 6.31 | 0.03108 | 0.4 | 29.5 | 3 |
| f5_ext_concrete+24dB_ext_glass+28dB | wood | wood | 0.045 | 1.99 | 0.02638 | 1.5 | 18.6 | 5 |
| f5_ext_concrete+24dB_ext_glass+28dB | metal | metal | 0.003 | 1.00 | 1e+07 | >100 | 0.0 | 32 |
| f5_ext_concrete+24dB_ext_glass+28dB | slab | concrete | 0.3 | 5.24 | 0.1627 | 36.3 | 8.1 | 26 |
| f5_ext_concrete+24dB_ext_glass+28dB | ctx_wall | concrete | 0.25 | 5.24 | 0.1627 | 30.5 | 8.1 | 15 |

## 6. Interpretation

* **Ranking of single protections** by remaining eavesdropping area (best first) — MWM: band5 < shieldPaint < directional < lowPower < shieldWindows < relocate; Sionna RT: band5 < shieldWindows < lowPower < directional < shieldPaint < relocate. The two models agree on the best single measure (band5).
* **Baseline leakage**: eavesdropping is possible on 22,521 m² (MWM) vs. 21,672 m² (Sionna) of the 27,424 m² outdoor study area; street exposure 99 % vs. 98 %.
* **Qualitative disagreement**: for `relocate` (MWM -19 %, Sionna +7 %) the two models predict opposite changes of the eavesdropping area relative to the baseline. The ray tracer adds multipath (reflections off the slabs, the ground and neighbouring façades) that the straight-line multi-wall model cannot represent, so conclusions about these measures should cite the ray-tracing result.
* **Headline configuration `applied`** (microcells + shieldWindows + shieldPaint + band5, 14 dBm per AP, two ceiling micro-cells): both models confirm the large reduction of the attack surface — eavesdropping area 288 m² (MWM) / 2,691 m² (Sionna) vs. 22,521 / 21,672 m² in the baseline (-99 % / -88 %), deauth 14 / 35 m², evil twin 0 / 0 m², with service coverage 96 % / 100 %. Quantitatively the ray tracer leaves a 9× larger residual eavesdropping zone (max. leak 38 m vs. 81 m, street exposure 0 % vs. 18 %): the multi-wall model under-predicts outdoor power behind the shielded façade (outdoor bias -8.9 dB), so the report should quote the Sionna value as the residual risk.
* **Combined RF measures** (`allRF` = relocate + shieldWindows + shieldPaint + band5) reduce the eavesdropping area to 819 m² (MWM) / 3,960 m² (Sionna), at the cost of service coverage on the AP floor (69 % / 92 % vs. 95 % / 95 % in the baseline).
* **Deauthentication** only needs P_att + G_att − PL(X, c) ≥ −88 dBm at one client, i.e. PL ≤ 120 dB with the USB adapter. With the nested rule of MODEL.md §6 (the attacker must also hear the AP) the deauth zone is the part of the eavesdropping zone from which a client can be reached; deauth/eavesdrop area ratio (MWM / Sionna): baseline 1.00 / 0.98, lowPower 1.00 / 1.00, directional 1.00 / 0.99, relocate 1.00 / 0.95, shieldWindows 1.00 / 1.00, shieldPaint 0.79 / 0.76, band5 0.90 / 0.78, allRF 0.01 / 0.03, applied 0.05 / 0.01. Without shielding the client link is almost never limiting (ratio ≈ 1); shielding and 5 GHz also attenuate the attacker → client path, so the active-attack zone shrinks faster than the eavesdropping zone. Only 802.11w (PMF), a protocol measure, removes deauthentication entirely. The **Evil Twin** zone is much smaller because the rogue AP must beat the real AP by 3 dB at the client.
* **Agreement of the nominal MWM with Sionna**: mean RMSE 12.0 dB over the scenarios; mean bias -7.0 dB outdoors and +0.0 dB on the floors (negative = MWM predicts less power). Indoors the MWM ignores multipath (reflections off slabs, walls and the ground add power in the ray tracer); outdoors the difference is dominated by how much leaks through windows vs. concrete.
* **Calibration** reduces the mean RMSE from 12.0 dB to 11.8 dB (in-sample), and the leave-one-scenario-out RMSE at 2.4 GHz is baseline 9.5 dB, directional 12.9 dB, relocate 11.3 dB.
* **Calibrated losses are effective parameters, not material properties** (2.4 GHz, n = 2): metal 5.0 dB although it is opaque in Sionna, concrete core walls 5.5 dB vs. 17.8 dB slab loss — power reaches the cells behind these obstacles by reflection around them, which a straight-line model can only mimic with a lower loss; where the direct path dominates the fit stays close to the slab physics (exterior concrete 17.0 vs. 21.0 dB, floor slab 19.9 vs. 21.0 dB). The remaining RMSE after calibration (9–16 dB) is therefore structural: multipath, not material values.
* **Glass**: a single 24 mm ITU glass slab is almost transparent at 2.4 GHz (0.3 dB — close to a half-wave resonance, λ/(2√ε_r) ≈ 25 mm) whereas the MWM assumes 3 dB; the 12 mm interior glass is near a quarter-wave thickness (3.3 dB). Real double glazing (two panes + gap, possibly low-E coated) is not a single homogeneous slab — this is a modelling sensitivity worth stating in the report.
* **Metal** (elevator shaft, server-room door) is opaque in Sionna (σ = 10⁷ S/m) while the MWM uses 26 dB to represent gaps around real doors.

## 7. Limitations

* Sionna runs use specular reflection + transmission (refraction) up to depth 5; diffraction and diffuse scattering are disabled, so deep shadow regions (behind neighbouring buildings, behind several concrete walls) receive no rays and appear as *no signal*. Attack areas there are lower bounds.
* Sionna samples the interaction type with probability proportional to its power (unbiased Monte Carlo). Behind strongly attenuating walls (shielded façade, 5 GHz concrete) only a small fraction of rays continues, so outdoor cells can stay empty; these environments are traced with 4 averaged seeds on the outdoor plane (baseline: 1, lowPower: 1, directional: 1, relocate: 1, shieldWindows: 1, shieldPaint: 4, band5: 4, allRF: 4, applied: 4 seed(s)) and the share of ray-less outdoor cells is listed in section 1a. Client-source maps behind the shielded façade remain the least converged quantity (deauth / evil-twin areas of `shieldPaint`, `band5`, `allRF`, `applied`).
* Runtimes in section 5 were measured on an RTX 3060 shared with another GPU job; per-scenario values include the scenario's share of the client-source maps of its propagation environment.
* Radio-map cells are averages of the incoherent ray power over each cell (local-area mean, no small-scale fading); the MWM is evaluated at cell centres. Both use isotropic receivers (MODEL.md §3).
* Shielding is modelled in Sionna as an equivalent lossy slab whose normal-incidence transmission loss matches building.json (`sim/README.md`); at oblique incidence the extra loss differs from the constant MWM increment.
* Material parameters are ITU-R P.2040 generic values; no measurements of the real building were available, so the calibration aligns the engineering model with the physics model, not with reality (`sim/measure/` provides the workflow for field data).
