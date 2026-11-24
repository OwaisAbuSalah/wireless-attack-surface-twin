"""Baseline RSS maps for the Blender renders -- a NumPy port of docs/MODEL.md sections 2-4.

Pure NumPy (no bpy), so it can be unit-tested with any Python that has NumPy:

    python blender/twin_rf.py            # prints map statistics

Model (normative text in docs/MODEL.md):
    PL   = PL0(f) + 10 n log10(max(d, d_min)) + sum(L_wall) + sum(L_slab)
    RSS  = P_tx + G_tx(v) + G_rx - PL
with 3-D wall crossings (openings by along-wall distance + height), slab planes inside the
footprint, and a vertical half-wave dipole at the router.
"""
from __future__ import annotations

import json
import math
import os

import numpy as np

CHUNK = 6000          # receiver cells per chunk -> CHUNK x n_walls float64 temporaries (~8 MB each)


# --------------------------------------------------------------------------- data
def load_building(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def _fkey(materials, f_ghz):
    """Loss table key for a frequency ("2.4" / "5")."""
    any_mat = next(iter(materials.values()))
    keys = list(any_mat["loss"].keys())
    return min(keys, key=lambda k: abs(float(k) - f_ghz))


def wall_arrays(bld, f_ghz):
    """Pack the walls into flat arrays for vectorised intersection."""
    mats = bld["materials"]
    fk = _fkey(mats, f_ghz)
    W = bld["walls"]
    n = len(W)
    ax = np.empty(n); ay = np.empty(n); ex = np.empty(n); ey = np.empty(n)
    z0 = np.empty(n); z1 = np.empty(n); length = np.empty(n)
    loss_wall = np.empty(n); loss_open = np.zeros(n); has_open = np.zeros(n, bool)
    o_sill = np.zeros(n); o_head = np.zeros(n); o_per = np.zeros(n); o_w = np.zeros(n); o_off = np.zeros(n)
    for i, w in enumerate(W):
        ax[i], ay[i] = w["a"]
        ex[i] = w["b"][0] - w["a"][0]
        ey[i] = w["b"][1] - w["a"][1]
        length[i] = math.hypot(ex[i], ey[i])
        z0[i], z1[i] = w["z0"], w["z1"]
        loss_wall[i] = mats[w["mat"]]["loss"][fk]
        o = w.get("opening")
        if o:
            has_open[i] = True
            o_sill[i], o_head[i] = o["sill"], o["head"]
            o_per[i], o_w[i], o_off[i] = o["period"], o["width"], o["offset"]
            loss_open[i] = mats[o["mat"]]["loss"][fk]
    return dict(ax=ax, ay=ay, ex=ex, ey=ey, z0=z0, z1=z1, L=length, lw=loss_wall, lo=loss_open,
                ho=has_open, sill=o_sill, head=o_head, per=o_per, ow=o_w, off=o_off)


# --------------------------------------------------------------------------- antenna
def dipole_gain_dbi(vz):
    """Vertical half-wave dipole, peak 2.15 dBi (MODEL.md section 3). vz = unit-vector z."""
    vz = np.clip(vz, -1.0, 1.0)
    el = np.arcsin(vz)
    cos_el = np.cos(el)
    with np.errstate(divide="ignore", invalid="ignore"):
        F = np.where(cos_el < 1e-3, 0.0, np.cos(0.5 * np.pi * np.sin(el)) / np.where(cos_el < 1e-3, 1.0, cos_el))
    return 2.15 + 10.0 * np.log10(np.maximum(F * F, 1e-3))


# --------------------------------------------------------------------------- path loss
def path_loss_db(T, R, bld, f_ghz, warr=None):
    """Path loss T -> each row of R (N x 3), dB.  T is a 3-vector."""
    rf = bld["rf"]
    n_exp = rf.get("pathloss_exponent", 2.0)
    d_min = rf.get("min_distance_m", 0.5)
    mats = bld["materials"]
    fk = _fkey(mats, f_ghz)
    slab_loss = mats["slab"]["loss"][fk]
    planes = np.asarray(rf["slab_planes"], float)
    sx0, sy0, sx1, sy1 = rf["slab_extent"]
    if warr is None:
        warr = wall_arrays(bld, f_ghz)
    T = np.asarray(T, float)
    R = np.asarray(R, float)
    N = R.shape[0]
    out = np.empty(N)
    pl0 = 20.0 * math.log10(f_ghz) + 32.44

    a_x = warr["ax"][None, :]; a_y = warr["ay"][None, :]
    e_x = warr["ex"][None, :]; e_y = warr["ey"][None, :]
    wz0 = warr["z0"][None, :]; wz1 = warr["z1"][None, :]
    wL = warr["L"][None, :]
    lw = warr["lw"][None, :]; lo = warr["lo"][None, :]; ho = warr["ho"][None, :]
    sill = warr["sill"][None, :]; head = warr["head"][None, :]
    per = warr["per"][None, :]; ow = warr["ow"][None, :]; off = warr["off"][None, :]
    # T relative to wall start (constant per wall)
    atx = a_x - T[0]
    aty = a_y - T[1]

    for s in range(0, N, CHUNK):
        Rc = R[s:s + CHUNK]
        dx = (Rc[:, 0] - T[0])[:, None]
        dy = (Rc[:, 1] - T[1])[:, None]
        dz = (Rc[:, 2] - T[2])
        # plan intersection T + t D = a + u E
        den = dx * e_y - dy * e_x                      # cross(D, E)
        par = den == 0.0
        den_s = np.where(par, 1.0, den)
        t = (atx * e_y - aty * e_x) / den_s            # cross(a-T, E) / cross(D, E)
        u = (atx * dy - aty * dx) / den_s              # cross(a-T, D) / cross(D, E)
        hit = (~par) & (t > 0.0) & (t < 1.0) & (u >= 0.0) & (u <= 1.0)
        zc = T[2] + t * dz[:, None]
        hit &= (zc >= wz0) & (zc <= wz1)
        # opening test
        sdist = u * wL
        h = zc - wz0
        m = sdist - off
        m = np.where(per > 0.0, np.mod(m, np.where(per > 0.0, per, 1.0)), m)   # np.mod is a positive modulo
        inside = ho & (m >= 0.0) & (m <= ow) & (h >= sill) & (h <= head)
        L = np.where(inside, lo, lw)
        walls_db = np.where(hit, L, 0.0).sum(axis=1)

        # slabs
        slab_db = np.zeros(Rc.shape[0])
        zr = Rc[:, 2]
        lo_z = np.minimum(T[2], zr); hi_z = np.maximum(T[2], zr)
        for zs in planes:
            between = (zs > lo_z) & (zs < hi_z)
            with np.errstate(divide="ignore", invalid="ignore"):
                tt = (zs - T[2]) / np.where(dz == 0.0, 1.0, dz)
            px = T[0] + tt * dx[:, 0]
            py = T[1] + tt * dy[:, 0]
            inside_fp = (px >= sx0) & (px <= sx1) & (py >= sy0) & (py <= sy1)
            slab_db += np.where(between & inside_fp, slab_loss, 0.0)

        d = np.sqrt(dx[:, 0] ** 2 + dy[:, 0] ** 2 + dz ** 2)
        d = np.maximum(d, d_min)
        out[s:s + CHUNK] = pl0 + 10.0 * n_exp * np.log10(d) + walls_db + slab_db
    return out


def rss_dbm(T, R, bld, f_ghz, p_tx_dbm, g_rx_dbi=0.0, warr=None):
    """RSS(T -> R) with the vertical dipole at T (MODEL.md section 4)."""
    T = np.asarray(T, float)
    R = np.asarray(R, float)
    v = R - T[None, :]
    dist = np.linalg.norm(v, axis=1)
    vz = np.where(dist > 0, v[:, 2] / np.where(dist > 0, dist, 1.0), 0.0)
    g_tx = dipole_gain_dbi(vz)
    return p_tx_dbm + g_tx + g_rx_dbi - path_loss_db(T, R, bld, f_ghz, warr)


# --------------------------------------------------------------------------- grids
def grid_centres(x0, y0, x1, y1, cell, z):
    nx = int(round((x1 - x0) / cell))
    ny = int(round((y1 - y0) / cell))
    xs = x0 + (np.arange(nx) + 0.5) * cell
    ys = y0 + (np.arange(ny) + 0.5) * cell
    X, Y = np.meshgrid(xs, ys)                 # row-major: index = j * nx + i
    R = np.stack([X.ravel(), Y.ravel(), np.full(X.size, float(z))], axis=1)
    return R, nx, ny, xs, ys


def baseline_maps(bld, outdoor_cell=0.5, floor_cell=0.1, floor_ids=(1,)):
    """Baseline scenario: router wall mount, its tx power and frequency, dipole."""
    rt = bld["router"]
    mount = rt["mounts"][rt.get("mount", "wall")]
    T = np.asarray(mount["pos"], float)
    f = float(rt.get("freq_ghz", 2.4))
    p = float(rt.get("tx_dbm", 20))
    warr = wall_arrays(bld, f)
    g = bld["rf"]["grids"]
    out = {"tx": T.tolist(), "freq_ghz": f, "tx_dbm": p}

    go = g["outdoor"]
    R, nx, ny, xs, ys = grid_centres(go["x0"], go["y0"], go["x1"], go["y1"], outdoor_cell, go["z"])
    rss = rss_dbm(T, R, bld, f, p, warr=warr).reshape(ny, nx)
    out["outdoor"] = dict(rss=rss, x0=go["x0"], y0=go["y0"], x1=go["x1"], y1=go["y1"],
                          cell=outdoor_cell, nx=nx, ny=ny, z=go["z"])

    gf = g["floor"]
    for fid in floor_ids:
        fl = bld["floors"][fid]
        z = fl["z"] + gf["dz"]
        R, nx, ny, xs, ys = grid_centres(gf["x0"], gf["y0"], gf["x1"], gf["y1"], floor_cell, z)
        rss = rss_dbm(T, R, bld, f, p, warr=warr).reshape(ny, nx)
        out["floor%d" % fid] = dict(rss=rss, x0=gf["x0"], y0=gf["y0"], x1=gf["x1"], y1=gf["y1"],
                                    cell=floor_cell, nx=nx, ny=ny, z=z)
    return out


def eavesdrop_threshold(bld, equipment="usb"):
    """RSS(AP->X) >= S_att - G_att  (MODEL.md section 6)."""
    e = bld["attack"]["equipment"][equipment]
    return e["sens_dbm"] - e["gain_dbi"]


def outside_footprint_mask(bld, xs, ys):
    fx0, fy0, fx1, fy1 = bld["footprint"]
    X, Y = np.meshgrid(xs, ys)
    return ~((X >= fx0) & (X <= fx1) & (Y >= fy0) & (Y <= fy1))


# --------------------------------------------------------------------------- colour
_TURBO_R = (0.13572138, 4.61539260, -42.66032258, 132.13108234, -152.94239396, 59.28637943)
_TURBO_G = (0.09140261, 2.19418839, 4.84296658, -14.18503333, 4.27729857, 2.82956604)
_TURBO_B = (0.10667330, 12.64194608, -60.58204836, 110.36276771, -89.90310912, 27.34824973)


def turbo(x):
    """Google 'turbo' colormap (polynomial fit), x in [0,1] -> sRGB in [0,1]."""
    x = np.clip(np.asarray(x, float), 0.0, 1.0)
    p = np.stack([np.ones_like(x), x, x ** 2, x ** 3, x ** 4, x ** 5], axis=-1)
    rgb = np.stack([p @ np.asarray(_TURBO_R), p @ np.asarray(_TURBO_G), p @ np.asarray(_TURBO_B)], axis=-1)
    return np.clip(rgb, 0.0, 1.0)


def signed_distance(field, level, cell):
    """Approximate signed distance (metres) to the iso-line field == level:
    (field - level) / |grad field|.  Positive on the high side."""
    gy, gx = np.gradient(field, cell)
    g = np.sqrt(gx * gx + gy * gy)
    return (field - level) / np.maximum(g, 1e-6)


def stats(maps, bld):
    thr = eavesdrop_threshold(bld)
    o = maps["outdoor"]
    xs = o["x0"] + (np.arange(o["nx"]) + 0.5) * o["cell"]
    ys = o["y0"] + (np.arange(o["ny"]) + 0.5) * o["cell"]
    out = outside_footprint_mask(bld, xs, ys)
    rss = o["rss"]
    eav = (rss >= thr) & out
    lines = ["outdoor grid %dx%d @ %.2f m: RSS min %.1f / median %.1f / max %.1f dBm"
             % (o["nx"], o["ny"], o["cell"], rss[out].min(), np.median(rss[out]), rss[out].max()),
             "eavesdrop (usb, RSS >= %.0f dBm): %.0f m^2 outside the footprint (%.1f %% of the study area)"
             % (thr, eav.sum() * o["cell"] ** 2, 100.0 * eav.sum() / out.sum())]
    for k in maps:
        if k.startswith("floor"):
            f = maps[k]["rss"]
            lines.append("%s (z=%.2f): RSS min %.1f / median %.1f / max %.1f dBm"
                         % (k, maps[k]["z"], f.min(), np.median(f), f.max()))
    return "\n".join(lines)


if __name__ == "__main__":
    import time
    here = os.path.dirname(os.path.abspath(__file__))
    bld = load_building(os.path.join(here, "..", "data", "building.json"))
    t0 = time.time()
    maps = baseline_maps(bld)
    print("computed in %.1f s" % (time.time() - t0))
    print(stats(maps, bld))
    o = maps["outdoor"]
    # a few probe points: street in front, café terrace, behind the library
    for name, (x, y) in {"street (0,-21.5)": (0, -21.5), "attacker (1,-30.8)": (1, -30.8),
                         "north lawn (0,20)": (0, 20), "behind library (-12,50)": (-12, 50),
                         "far east (90,-20)": (90, -20)}.items():
        i = int((x - o["x0"]) / o["cell"]); j = int((y - o["y0"]) / o["cell"])
        print("  %-26s %.1f dBm" % (name, o["rss"][j, i]))
