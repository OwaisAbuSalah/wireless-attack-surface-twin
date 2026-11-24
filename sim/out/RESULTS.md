# Simulation results — Wireless Attack Surface Digital Twin

*Generated 2026-11-24T22:25:41+00:00 by `sim/compare.py` from the outputs of `sim/run_mwm.py` and `sim/run_sionna.py`. Every number below is produced by those scripts; re-running them regenerates this file.*

Models: **MWM** = multi-wall reference model of `docs/MODEL.md` (`sim/twin/mwm.py`, nominal material losses of `data/building.json`); **Sionna RT** = NVIDIA Sionna RT ray tracer (sionna-rt 2.2.0, Mitsuba 3.9.1, Dr.Jit 1.5.0, variant `cuda_ad_mono_polarized`, NVIDIA GeForce RTX 3060, 616.64); **MWM-cal** = MWM with the material losses fitted to Sionna (n = 2 kept, section 3).

Attack statistics use the default attacker equipment `usb` (USB adapter + 5 dBi antenna). Grids: outdoor 1.0 m (200 × 140) at z = 1.5 m and floors 0.25 m (148 × 68) at floor + 1.2 m unless stated otherwise. ⁺ = the eavesdropping zone reaches the edge of the 200 m × 140 m study area, so the true leak distance is larger.

## 1. Attack-surface statistics (MODEL.md §7)

### 1a. Sionna RT (ray tracing)

| Scenario | Eavesdrop [m²] | Deauth [m²] | Evil Twin [m²] | Max leak [m] | Street exp. [%] | Coverage [%] |
|---|---:|---:|---:|---:|---:|---:|
| Baseline (`baseline`) | 21,672 | 21,300 | 317 | 102.1⁺ | 98.2 | 94.2 |
| Reduced TX power (`lowPower`) | 18,822 | 18,779 | 1,911 | 102.1⁺ | 96.3 | 82.4 |
| Directional antenna (`directional`) | 19,609 | 19,378 | 965 | 102.1⁺ | 94.1 | 92.1 |
| Relocated AP (`relocate`) | 23,178 | 22,044 | 536 | 102.1⁺ | 99.0 | 97.9 |
| Shielding window film (`shieldWindows`) | 17,446 | 17,414 | 50 | 102.1⁺ | 95.3 | 94.5 |
| Shielding paint (`shieldPaint`) | 20,392 | 15,681 | 246 | 102.1⁺ | 95.8 | 94.1 |
| 5 GHz band (`band5`) | 16,384 | 12,793 | 220 | 102.1⁺ | 95.6 | 81.6 |
| Combined RF measures (`allRF`) | 3,940 | 129 | 0 | 84.5⁺ | 35.2 | 91.4 |

### 1b. MWM, nominal losses (same 1 m / 0.25 m grid as Sionna)

| Scenario | Eavesdrop [m²] | Deauth [m²] | Evil Twin [m²] | Max leak [m] | Street exp. [%] | Coverage [%] |
|---|---:|---:|---:|---:|---:|---:|
| Baseline (`baseline`) | 22,522 | 22,522 | 550 | 102.1⁺ | 99.5 | 91.6 |
| Reduced TX power (`lowPower`) | 16,521 | 16,521 | 3,501 | 102.1⁺ | 99.5 | 79.9 |
| Directional antenna (`directional`) | 15,470 | 15,470 | 6,482 | 102.1⁺ | 91.4 | 87.0 |
| Relocated AP (`relocate`) | 18,163 | 18,163 | 6,365 | 101.5⁺ | 97.7 | 81.3 |
| Shielding window film (`shieldWindows`) | 16,787 | 16,787 | 453 | 102.1⁺ | 96.9 | 91.6 |
| Shielding paint (`shieldPaint`) | 13,650 | 10,741 | 30 | 102.1⁺ | 95.3 | 91.6 |
| 5 GHz band (`band5`) | 9,409 | 8,504 | 7 | 100.5⁺ | 94.8 | 68.2 |
| Combined RF measures (`allRF`) | 819 | 12 | 0 | 59.5 | 9.6 | 68.5 |

### 1c. MWM, nominal losses, real-time grid (0.4 m / 0.2 m — what the web app computes)

| Scenario | Eavesdrop [m²] | Deauth [m²] | Evil Twin [m²] | Max leak [m] | Street exp. [%] | Coverage [%] |
|---|---:|---:|---:|---:|---:|---:|
| Baseline (`baseline`) | 22,520 | 22,520 | 567 | 102.5⁺ | 99.5 | 91.5 |
| Reduced TX power (`lowPower`) | 16,491 | 16,491 | 3,497 | 102.5⁺ | 99.5 | 79.7 |
| Directional antenna (`directional`) | 15,452 | 15,452 | 6,475 | 102.5⁺ | 91.8 | 86.7 |
| Relocated AP (`relocate`) | 18,210 | 18,210 | 6,378 | 102.3⁺ | 97.9 | 80.9 |
| Shielding window film (`shieldWindows`) | 16,794 | 16,794 | 464 | 102.5⁺ | 96.9 | 91.5 |
| Shielding paint (`shieldPaint`) | 13,622 | 10,720 | 25 | 102.5⁺ | 95.5 | 91.5 |
| 5 GHz band (`band5`) | 9,378 | 8,471 | 8 | 101.2⁺ | 94.9 | 68.1 |
| Combined RF measures (`allRF`) | 815 | 16 | 0 | 59.8 | 9.7 | 68.3 |

### 1d. MWM calibrated to Sionna (section 3)

| Scenario | Eavesdrop [m²] | Deauth [m²] | Evil Twin [m²] | Max leak [m] | Street exp. [%] | Coverage [%] |
|---|---:|---:|---:|---:|---:|---:|
| Baseline (`baseline`) | 24,181 | 24,175 | 224 | 102.1⁺ | 99.5 | 100.0 |
| Reduced TX power (`lowPower`) | 18,844 | 18,838 | 2,347 | 102.1⁺ | 99.5 | 98.8 |
| Directional antenna (`directional`) | 17,685 | 17,685 | 4,610 | 102.1⁺ | 93.1 | 99.8 |
| Relocated AP (`relocate`) | 23,212 | 23,210 | 359 | 102.1⁺ | 97.9 | 100.0 |
| Shielding window film (`shieldWindows`) | 20,464 | 20,464 | 202 | 102.1⁺ | 96.9 | 100.0 |
| Shielding paint (`shieldPaint`) | 19,021 | 17,047 | 15 | 102.1⁺ | 99.5 | 100.0 |
| 5 GHz band (`band5`) | 16,357 | 14,333 | 0 | 102.1⁺ | 97.7 | 97.3 |
| Combined RF measures (`allRF`) | 2,894 | 1,701 | 0 | 61.5⁺ | 25.8 | 100.0 |

### 1e. Effect of each protection on the eavesdropping area (relative to baseline)

| Scenario | MWM | Sionna RT | MWM-cal |
|---|---:|---:|---:|
| Reduced TX power | -27 % | -13 % | -22 % |
| Directional antenna | -31 % | -10 % | -27 % |
| Relocated AP | -19 % | +7 % | -4 % |
| Shielding window film | -25 % | -19 % | -15 % |
| Shielding paint | -39 % | -6 % | -21 % |
| 5 GHz band | -58 % | -24 % | -32 % |
| Combined RF measures | -96 % | -82 % | -88 % |

## 2. Validation: MWM vs. Sionna RT (cell-by-cell)

Error = MWM − Sionna [dB] on cells where both models give RSS > −120 dBm; outdoor cells outside the building footprint, floor cells inside it. RSS maps of the access point.

| Scenario | Outdoor N | Outdoor RMSE | Outdoor MAE | Outdoor bias | Floors N | Floors RMSE | Floors MAE | Floors bias | All RMSE | All bias |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline | 24,729 | 12.84 | 9.45 | -2.54 | 27,243 | 6.99 | 3.98 | -0.68 | 10.20 | -1.56 |
| lowPower | 23,916 | 12.15 | 8.97 | -2.68 | 26,817 | 6.09 | 3.62 | -0.40 | 9.44 | -1.47 |
| directional | 22,988 | 16.06 | 12.56 | -9.15 | 27,279 | 7.36 | 4.59 | -0.49 | 12.14 | -4.45 |
| relocate | 23,525 | 19.81 | 16.10 | -11.83 | 27,263 | 12.08 | 7.59 | -3.51 | 16.13 | -7.36 |
| shieldWindows | 21,656 | 10.46 | 7.90 | 0.87 | 27,165 | 7.00 | 3.90 | -0.25 | 8.71 | 0.24 |
| shieldPaint | 21,512 | 19.85 | 14.94 | -11.02 | 27,235 | 7.04 | 4.04 | -0.61 | 14.20 | -5.21 |
| band5 | 16,634 | 15.29 | 11.44 | -8.36 | 22,750 | 12.18 | 8.91 | -0.07 | 13.58 | -3.57 |
| allRF | 4,861 | 12.76 | 10.71 | -10.17 | 23,048 | 14.35 | 10.64 | 2.38 | 14.09 | 0.20 |

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

After calibration (MWM-cal, in-sample for the scenarios used in the fit):

| Scenario | Outdoor RMSE | Outdoor bias | Floors RMSE | Floors bias | All RMSE | All MAE | All bias |
|---|---:|---:|---:|---:|---:|---:|---:|
| baseline | 11.11 | -1.19 | 6.99 | 3.20 | 9.22 | 6.30 | 1.07 |
| lowPower | 10.81 | -1.63 | 6.72 | 3.12 | 8.92 | 6.12 | 0.84 |
| directional | 15.33 | -6.94 | 8.42 | 3.39 | 12.12 | 8.64 | -1.40 |
| relocate | 13.90 | -6.63 | 6.99 | 2.44 | 10.92 | 7.95 | -1.98 |
| shieldWindows | 10.72 | 5.27 | 7.20 | 3.62 | 8.99 | 6.61 | 4.38 |
| shieldPaint | 15.12 | -6.89 | 7.09 | 3.26 | 11.54 | 7.66 | -1.46 |
| band5 | 14.52 | -6.41 | 15.19 | 10.92 | 14.88 | 11.86 | 2.89 |
| allRF | 9.02 | -2.30 | 19.75 | 15.50 | 16.85 | 13.05 | 9.38 |

Leave-one-scenario-out at 2.4 GHz (fit on the other unshielded scenarios, test on the held-out one):

| Held-out scenario | n | All RMSE | All MAE | All bias | Outdoor RMSE | Floors RMSE |
|---|---:|---:|---:|---:|---:|---:|
| baseline | 2.0 | 9.52 | 6.73 | 1.65 | 11.02 | 7.84 |
| directional | 2.0 | 12.88 | 9.49 | -0.82 | 15.83 | 9.66 |
| relocate | 2.0 | 11.32 | 8.36 | -1.82 | 14.29 | 7.46 |

## 3. Calibration of the MWM material losses to Sionna RT

Method: bounded weighted linear least squares (scipy.optimize.lsq_linear, BVLS); each map weighted equally; target = Sionna path loss on cells > -120 dBm (outdoor outside / floors inside footprint). Data: AP maps of the unshielded scenarios of each band (`lowPower` is excluded because its path loss is identical to `baseline`) plus the eight client-source outdoor maps; shielding increments fitted afterwards on the shielded scenarios with the base losses fixed. Materials crossed by fewer than 100 cells keep their nominal value. Full result: `sim/out/calibration.json`.

### 2.4 GHz (scenarios: baseline, directional, relocate; 334,631 cells)

Weighted RMS residual over the fit data: nominal MWM 15.62 dB → calibrated losses with n = 2 (**primary**, used for MWM-cal) 10.56 dB → losses + free exponent 9.92 dB (fitted n = 2.70; sensitivity only — the exponent trades off against the wall counts, which are correlated with distance).

| Material | cells crossing | nominal MWM [dB] | ITU slab, normal incidence [dB] | calibrated, n = 2 [dB] | calibrated, n = 2.70 [dB] |
|---|---:|---:|---:|---:|---:|
| ext_concrete | 210,584 | 17 | 21.0 | 17.1 | 9.1 |
| concrete | 63,463 | 15 | 17.8 | 5.5 | 4.2 |
| brick | 164,316 | 6 | 5.7 | 3.5 | 1.9 |
| drywall | 135,944 | 3 | 2.7 | 2.1 | 0.3 |
| ext_glass | 41,971 | 3 | 0.3 | 4.9 | 0.0 |
| glass | 32,309 | 2 | 3.3 | 3.6 | 1.6 |
| wood | 26,400 | 3 | 0.7 | 2.2 | 0.8 |
| metal | 22,231 | 26 | opaque (>100) | 5.0 | 4.5 |
| slab | 92,988 | 18 | 21.0 | 19.9 | 16.9 |
| ctx_wall | 93,758 | 10 | 17.8 | 10.9 | 9.5 |

### 5 GHz (scenarios: band5; 137,590 cells)

Weighted RMS residual over the fit data: nominal MWM 25.81 dB → calibrated losses with n = 2 (**primary**, used for MWM-cal) 14.50 dB → losses + free exponent 12.20 dB (fitted n = 3.55; sensitivity only — the exponent trades off against the wall counts, which are correlated with distance).

| Material | cells crossing | nominal MWM [dB] | ITU slab, normal incidence [dB] | calibrated, n = 2 [dB] | calibrated, n = 3.55 [dB] |
|---|---:|---:|---:|---:|---:|
| ext_concrete | 99,589 | 26 | 36.3 | 28.9 | 8.3 |
| concrete | 16,601 | 23 | 30.5 | 2.3 | 1.5 |
| brick | 69,185 | 10 | 6.0 | 2.1 | 0.0 |
| drywall | 56,194 | 4 | 5.2 | 4.7 | 0.4 |
| ext_glass | 14,847 | 5 | 0.7 | 13.1 | 0.0 |
| glass | 9,918 | 3 | 0.4 | 0.0 | 0.0 |
| wood | 12,808 | 5 | 1.5 | 2.1 | 0.0 |
| metal | 5,940 | 32 | opaque (>100) | 0.2 | 0.0 |
| slab | 38,628 | 26 | 36.3 | 23.6 | 19.3 |
| ctx_wall | 15,579 | 15 | 30.5 | 5.7 | 3.3 |

Shielding increments (added to the calibrated base loss):

| Scenario | material | nominal extra [dB] | fitted extra [dB] |
|---|---|---:|---:|
| shieldWindows (2.4 GHz) | ext_glass | 25 | 15.7 |
| shieldPaint (2.4 GHz) | ext_concrete | 20 | 11.0 |
| allRF (5 GHz) | ext_glass | 28 | 19.6 |
| allRF (5 GHz) | ext_concrete | 24 | 13.5 |

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
* Runtime per scenario [s]: baseline 89.5, lowPower 83.4, directional 88.8, relocate 102.7, shieldWindows 199.1, shieldPaint 293.0, band5 219.6, allRF 292.3; total 1389.1 s.

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
* **Baseline leakage**: eavesdropping is possible on 22,522 m² (MWM) vs. 21,672 m² (Sionna) of the 27,424 m² outdoor study area; street exposure 99 % vs. 98 %.
* **Qualitative disagreement**: for `relocate` (MWM -19 %, Sionna +7 %) the two models predict opposite changes of the eavesdropping area relative to the baseline. The ray tracer adds multipath (reflections off the slabs, the ground and neighbouring façades) that the straight-line multi-wall model cannot represent, so conclusions about these measures should cite the ray-tracing result.
* **Combined RF measures** (`allRF` = relocate + shieldWindows + shieldPaint + band5) reduce the eavesdropping area to 819 m² (MWM) / 3,940 m² (Sionna), at the cost of service coverage on the AP floor (68 % / 91 % vs. 92 % / 94 % in the baseline).
* **Deauthentication** only needs P_att + G_att − PL(X, c) ≥ −88 dBm at one client, i.e. PL ≤ 120 dB with the USB adapter, which is almost never the limiting condition; with the nested rule of MODEL.md §6 (the attacker must also hear the AP) the deauth zone therefore nearly coincides with the eavesdropping zone (Sionna: deauth/eavesdrop area ratio 0.03–1.00). Only 802.11w (PMF), a protocol measure, removes it. The **Evil Twin** zone is much smaller because the rogue AP must beat the real AP by 3 dB at the client.
* **Agreement of the nominal MWM with Sionna**: mean RMSE 12.3 dB over the scenarios; mean bias -6.9 dB outdoors and -0.5 dB on the floors (negative = MWM predicts less power). Indoors the MWM ignores multipath (reflections off slabs, walls and the ground add power in the ray tracer); outdoors the difference is dominated by how much leaks through windows vs. concrete.
* **Calibration** reduces the mean RMSE from 12.3 dB to 11.7 dB (in-sample), and the leave-one-scenario-out RMSE at 2.4 GHz is baseline 9.5 dB, directional 12.9 dB, relocate 11.3 dB.
* **Glass**: a single 24 mm ITU glass slab is almost transparent at 2.4 GHz (0.3 dB — close to a half-wave resonance, λ/(2√ε_r) ≈ 25 mm) whereas the MWM assumes 3 dB; the 12 mm interior glass is near a quarter-wave thickness (3.3 dB). Real double glazing (two panes + gap, possibly low-E coated) is not a single homogeneous slab — this is a modelling sensitivity worth stating in the report.
* **Metal** (elevator shaft, server-room door) is opaque in Sionna (σ = 10⁷ S/m) while the MWM uses 26 dB to represent gaps around real doors.

## 7. Limitations

* Sionna runs use specular reflection + transmission (refraction) up to depth 5; diffraction and diffuse scattering are disabled, so deep shadow regions (behind neighbouring buildings, behind several concrete walls) receive no rays and appear as *no signal*. Attack areas there are lower bounds.
* Radio-map cells are averages of the incoherent ray power over each cell (local-area mean, no small-scale fading); the MWM is evaluated at cell centres. Both use isotropic receivers (MODEL.md §3).
* Shielding is modelled in Sionna as an equivalent lossy slab whose normal-incidence transmission loss matches building.json (`sim/README.md`); at oblique incidence the extra loss differs from the constant MWM increment.
* Material parameters are ITU-R P.2040 generic values; no measurements of the real building were available, so the calibration aligns the engineering model with the physics model, not with reality (`sim/measure/` provides the workflow for field data).
