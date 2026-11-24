"""Vectorised NumPy reference implementation of the multi-wall model (docs/MODEL.md §2-7).

The central primitive is :func:`crossing_counts`: for one transmitter ``T`` and many receivers
``R`` it returns, per receiver, how many times each *effective* material is crossed
(wall material or opening material per §2.1, and the ``slab`` material per §2.2).  The
multi-wall loss is then simply ``counts @ loss_table``, which is also what makes the
least-squares calibration in ``compare.py`` linear.

``link_budget`` is an independent, scalar (pure-Python) implementation of the same equations
that additionally reports every wall/slab crossing; it is used for the JS/GLSL test vectors
(``sim/out/mwm_testpoints.json``) and to cross-check the vectorised path (``sim/tests``).
"""

from __future__ import annotations

import math

import numpy as np

from .building import Building, ScenarioParams, boresight, cell_centers, grid_points

CHUNK = 4096
EPS_T = 1e-5          # MODEL.md §2.1: wall counts for EPS < t < 1 - EPS (end point on a wall plane never counts)
EPS_U = 1e-5          #   and -EPS <= u <= 1 + EPS (a ray through a wall junction counts every wall meeting there)
DELTA = 1e-4          #   length/height tolerance [m] for z-range, opening edges, sill/head, slab footprint


# ============================================================================ path loss
def pl0_db(freq_ghz: float) -> float:
    """Free-space loss at 1 m (MODEL.md §2)."""
    return 20.0 * math.log10(freq_ghz) + 32.44


def crossing_counts(T, R, B: Building) -> np.ndarray:
    """Number of crossings of each material between T (3,) and every row of R (N,3).

    Returns an (N, n_materials) float array.  Walls follow MODEL.md §2.1 (3-D crossing,
    periodic openings), slabs follow §2.2 and are counted in the ``slab`` column.
    """
    T = np.asarray(T, float)
    R = np.atleast_2d(np.asarray(R, float))
    W = B.walls
    nmat = len(B.materials)
    N = R.shape[0]
    counts = np.zeros((N, nmat))

    ex, ey = W.bx - W.ax, W.by - W.ay
    wx, wy = W.ax - T[0], W.ay - T[1]
    t_num = wx * ey - wy * ex
    per_safe = np.where(W.period > 0, W.period, 1.0)
    for s in range(0, N, CHUNK):
        r = R[s:s + CHUNK]
        n = r.shape[0]
        dx = (r[:, 0] - T[0])[:, None]
        dy = (r[:, 1] - T[1])[:, None]
        dz = (r[:, 2] - T[2])[:, None]
        denom = dx * ey - dy * ex
        with np.errstate(divide="ignore", invalid="ignore"):
            t = t_num / denom
            u = (wx * dy - wy * dx) / denom
            zc = T[2] + t * dz
        ok = (denom != 0) & (t > EPS_T) & (t < 1 - EPS_T) & (u >= -EPS_U) & (u <= 1 + EPS_U)
        ok &= (zc >= W.z0 - DELTA) & (zc <= W.z1 + DELTA)
        with np.errstate(invalid="ignore"):
            m = u * W.length - W.offset
            mp = np.mod(m, per_safe)                                     # positive modulo
            mp = np.where(mp > per_safe - DELTA, mp - per_safe, mp)      # wrap at the period boundary
            m = np.where(W.period > 0, mp, m)
        h = zc - W.z0
        inside = (W.has_open & (m >= -DELTA) & (m <= W.width + DELTA)
                  & (h >= W.sill - DELTA) & (h <= W.head + DELTA))
        mat = np.where(inside, W.open_mat, W.mat)
        rows = np.broadcast_to(np.arange(n)[:, None], mat.shape)
        idx = rows[ok] * nmat + mat[ok]
        counts[s:s + n] += np.bincount(idx, minlength=n * nmat).reshape(n, nmat)

    # floor slabs (§2.2)
    x0, y0, x1, y1 = B.slab_extent
    k_slab = B.mat_index["slab"]
    dzs = R[:, 2] - T[2]
    lo, hi = np.minimum(T[2], R[:, 2]), np.maximum(T[2], R[:, 2])
    for zs in B.slab_planes:
        cross = (zs > lo) & (zs < hi)
        with np.errstate(divide="ignore", invalid="ignore"):
            t = (zs - T[2]) / dzs
            px = T[0] + t * (R[:, 0] - T[0])
            py = T[1] + t * (R[:, 1] - T[1])
        cross &= (px >= x0 - DELTA) & (px <= x1 + DELTA) & (py >= y0 - DELTA) & (py <= y1 + DELTA)
        counts[:, k_slab] += cross
    return counts


def distance(T, R, d_min: float) -> np.ndarray:
    R = np.atleast_2d(np.asarray(R, float))
    return np.maximum(np.linalg.norm(R - np.asarray(T, float), axis=1), d_min)


def path_loss(T, R, B: Building, loss: np.ndarray, freq_ghz: float, n: float | None = None,
              counts: np.ndarray | None = None) -> np.ndarray:
    """PL(T, R) [dB] for every row of R (MODEL.md §2)."""
    n = float(B.rf["pathloss_exponent"]) if n is None else n
    d = distance(T, R, float(B.rf["min_distance_m"]))
    if counts is None:
        counts = crossing_counts(T, R, B)
    return pl0_db(freq_ghz) + 10.0 * n * np.log10(d) + counts @ loss


# ============================================================================ antennas (§3)
def _unit(T, R):
    v = np.atleast_2d(np.asarray(R, float)) - np.asarray(T, float)
    nrm = np.linalg.norm(v, axis=1, keepdims=True)
    return np.divide(v, nrm, out=np.zeros_like(v), where=nrm > 0)


def gain_dipole(v: np.ndarray) -> np.ndarray:
    """Vertical half-wave dipole, 2.15 dBi peak, floor at -27.85 dBi."""
    sin_el = np.clip(v[:, 2], -1.0, 1.0)
    cos_el = np.sqrt(np.maximum(1.0 - sin_el ** 2, 0.0))
    with np.errstate(divide="ignore", invalid="ignore"):
        F = np.where(cos_el < 1e-3, 0.0, np.cos(0.5 * np.pi * sin_el) / np.where(cos_el < 1e-3, 1.0, cos_el))
    return 2.15 + 10.0 * np.log10(np.maximum(F * F, 1e-3))


def gain_patch(v: np.ndarray, az_deg: float, tilt_deg: float, gmax_dbi=8.0, hpbw_deg=65.0, sla_db=30.0) -> np.ndarray:
    """3GPP TR 38.901 element pattern with boresight (az, tilt)."""
    a = math.radians(az_deg)
    b = boresight(az_deg, tilt_deg)
    yp = np.array([-math.sin(a), math.cos(a), 0.0])
    zp = np.cross(b, yp)
    phi = np.degrees(np.arctan2(v @ yp, v @ b))
    theta = np.degrees(np.arcsin(np.clip(v @ zp, -1.0, 1.0)))
    AH = -np.minimum(12.0 * (phi / hpbw_deg) ** 2, sla_db)
    AV = -np.minimum(12.0 * (theta / hpbw_deg) ** 2, sla_db)
    return gmax_dbi - np.minimum(-(AH + AV), sla_db)


def tx_gain(sp: ScenarioParams, T, R) -> np.ndarray:
    v = _unit(T, R)
    if sp.antenna == "dipole":
        return gain_dipole(v)
    if sp.antenna == "patch":
        return gain_patch(v, sp.az_deg, sp.tilt_deg, **sp.patch)
    raise ValueError(sp.antenna)


def rss_from_router(B: Building, sp: ScenarioParams, R, g_rx: float = 0.0, n: float | None = None,
                    loss: np.ndarray | None = None) -> np.ndarray:
    """RSS(AP -> R) [dBm] (MODEL.md §4); with several APs the maximum over the APs."""
    L = sp.loss if loss is None else loss
    vals = [sp.tx_dbm + tx_gain(sp, T, R) + g_rx - path_loss(T, R, B, L, sp.freq_ghz, n=n) for T in sp.tx_positions]
    return np.max(vals, axis=0)


# ============================================================================ maps
def router_maps(B: Building, sp: ScenarioParams, cell="sionna", n=None, loss=None) -> dict:
    """RSS maps [dBm] (ny, nx) on the outdoor plane and the three floor planes."""
    out = {}
    for name in B.plane_names():
        g = B.grid(name, cell)
        P = grid_points(g)
        out[name] = rss_from_router(B, sp, P, n=n, loss=loss).reshape(g["ny"], g["nx"])
    return out


def client_pl_maps(B: Building, sp: ScenarioParams, grid: dict, n=None, loss=None) -> np.ndarray:
    """PL(c -> X) [dB] for every client c (no antenna gain), shape (n_clients, ny, nx)."""
    P = grid_points(grid)
    L = sp.loss if loss is None else loss
    pls = [path_loss(c, P, B, L, sp.freq_ghz, n=n) for c in B.client_positions()]
    return np.stack(pls).reshape(len(pls), grid["ny"], grid["nx"])


def rss_router_to_clients(B: Building, sp: ScenarioParams, n=None, loss=None) -> np.ndarray:
    g_c = float(B.attack["client"]["gain_dbi"])
    return rss_from_router(B, sp, B.client_positions(), g_rx=g_c, n=n, loss=loss)


# ============================================================================ attacks (§6)
def equipment(B: Building, key: str | None = None) -> dict:
    key = key or B.attack["default_equipment"]
    e = B.attack["equipment"][key]
    return {"key": key, "G": float(e["gain_dbi"]), "S": float(e["sens_dbm"]), "P": float(e["tx_dbm"])}


def attack_maps(B: Building, sp: ScenarioParams, rss_ap_outdoor: np.ndarray, pl_clients: np.ndarray,
                rss_ap_clients: np.ndarray, eq: dict | None = None) -> dict:
    """Feasibility of each attack on every outdoor cell (MODEL.md §6).

    Deauthentication and Evil Twin additionally require the eavesdropping condition (the attacker must
    hear the AP to learn BSSID / channel / client MACs), so the tiers are nested ET ⊂ Deauth ⊂ Eavesdrop:
    ``deauth_margin_eff = min(deauth_margin, eav_margin)``, ``et_margin_eff = min(et_margin, eav_margin)``.

    ``pl_clients`` (n_clients, ny, nx) = PL(c -> X); cells without any signal may be +inf.
    Returns bool maps ``eavesdrop``, ``deauth``, ``eviltwin``, the highest ``tier`` (0-3) and the
    margins [dB] (feasible where margin >= 0).
    """
    eq = eq or equipment(B)
    S_c = float(B.attack["client"]["sens_dbm"])
    margin = float(B.attack["evil_twin"]["margin_db"])
    min_rss = float(B.attack["evil_twin"]["min_rss_dbm"])
    eav_m = (rss_ap_outdoor + eq["G"]) - eq["S"]
    p_at_client = eq["P"] + eq["G"] - pl_clients                     # (nc, ny, nx)
    deauth_m = p_at_client.max(axis=0) - S_c
    et_m = np.minimum(p_at_client - (rss_ap_clients[:, None, None] + margin), p_at_client - min_rss).max(axis=0)
    deauth_m = np.minimum(deauth_m, eav_m)
    et_m = np.minimum(et_m, eav_m)
    eav = eav_m >= 0
    deauth = (deauth_m >= 0) & (not sp.pmf)
    evil = (et_m >= 0) & (not sp.wpa3)
    tier = np.zeros(eav.shape, np.uint8)
    tier[eav] = 1
    tier[deauth] = 2
    tier[evil] = 3
    return {"eavesdrop": eav, "deauth": deauth, "eviltwin": evil, "tier": tier,
            "margin_eavesdrop": eav_m, "margin_deauth": deauth_m, "margin_eviltwin": et_m}


def router_floor(B: Building, sp: ScenarioParams) -> int:
    z = sp.tx_pos[2]
    for f in B.floors:
        if f["z"] <= z < f["z"] + f["height"]:
            return int(f["id"])
    return int(B.router["floor"])


def attack_stats(B: Building, sp: ScenarioParams, grid: dict, att: dict, rss_router_floor: np.ndarray,
                 floor_grid: dict) -> dict:
    """Key statistics of MODEL.md §7."""
    X, Y = cell_centers(grid)
    outside = ~B.inside_footprint(X, Y)
    a = grid["dx"] ** 2
    eav = att["eavesdrop"] & outside
    dist = B.dist_to_footprint(X, Y)
    edge = np.zeros_like(eav)
    edge[0, :] = edge[-1, :] = edge[:, 0] = edge[:, -1] = True
    street = B.street_mask(X, Y)
    FX, FY = cell_centers(floor_grid)
    inside = B.inside_footprint(FX, FY)
    # service area excludes the stair/elevator core of the router floor (cells strictly inside, MODEL.md §6)
    for r in B.raw["rooms"]:
        if r["type"] == "core" and r["floor"] == router_floor(B, sp):
            cx0, cy0, cx1, cy1 = r["rect"]
            inside &= ~((FX > cx0) & (FX < cx1) & (FY > cy0) & (FY < cy1))
    cov_thr = float(B.attack["coverage_dbm"])
    return {
        "area_eavesdrop": float(eav.sum() * a),
        "area_deauth": float((att["deauth"] & outside).sum() * a),
        "area_eviltwin": float((att["eviltwin"] & outside).sum() * a),
        "area_danger": float(((att["tier"] > 0) & outside).sum() * a),
        "max_leak_m": float(dist[eav].max()) if eav.any() else 0.0,
        "leak_reaches_edge": bool((eav & edge).any()),
        "street_exposure": float(100.0 * (eav & street).sum() / street.sum()),
        "coverage": float(100.0 * ((rss_router_floor >= cov_thr) & inside).sum() / inside.sum()),
    }


def scenario_analysis(B: Building, sp: ScenarioParams, cell="sionna", eq=None, n=None, loss=None,
                      client_cache: dict | None = None) -> dict:
    """Router maps + attack maps + stats for one scenario (MWM only)."""
    maps = router_maps(B, sp, cell, n=n, loss=loss)
    g = B.grid("outdoor", cell)
    key = (sp.material_config, cell, n, None if loss is None else tuple(np.round(loss, 6)))
    if client_cache is not None and key in client_cache:
        plc = client_cache[key]
    else:
        plc = client_pl_maps(B, sp, g, n=n, loss=loss)
        if client_cache is not None:
            client_cache[key] = plc
    rc = rss_router_to_clients(B, sp, n=n, loss=loss)
    att = attack_maps(B, sp, maps["outdoor"], plc, rc, eq)
    fl = f"floor{router_floor(B, sp)}"
    st = attack_stats(B, sp, g, att, maps[fl], B.grid(fl, cell))
    return {"maps": maps, "attack": att, "stats": st, "rss_ap_clients": rc, "pl_clients": plc}


# ============================================================================ scalar link budget
def link_budget(B: Building, T, R, freq_ghz: float, loss: np.ndarray, gain_fn=None, tx_dbm=None,
                g_rx: float = 0.0, n: float | None = None) -> dict:
    """Scalar, fully itemised implementation of MODEL.md §2-4 for one link.

    ``gain_fn(v) -> dBi`` gives the TX antenna gain for unit vector v (None = 0 dBi, no antenna).
    Also returns ``margin_m``: the smallest distance [m] of the link to any decision boundary
    of the model (wall ends, wall top/bottom, opening edges, slab edges); links with a tiny
    margin are numerically fragile and are avoided as test vectors.
    """
    T = np.asarray(T, float)
    R = np.asarray(R, float)
    n = float(B.rf["pathloss_exponent"]) if n is None else n
    d_true = float(np.linalg.norm(R - T))
    d = max(d_true, float(B.rf["min_distance_m"]))
    W = B.walls
    walls, margins = [], [d_true]
    for k in range(len(W)):
        ax, ay, bx, by = W.ax[k], W.ay[k], W.bx[k], W.by[k]
        ex, ey = bx - ax, by - ay
        dx, dy = R[0] - T[0], R[1] - T[1]
        denom = dx * ey - dy * ex
        if denom == 0:
            continue
        wx, wy = ax - T[0], ay - T[1]
        t = (wx * ey - wy * ex) / denom
        u = (wx * dy - wy * dx) / denom
        L = W.length[k]
        zc = T[2] + t * (R[2] - T[2])
        D = math.hypot(dx, dy)
        near = (-0.05 < t * D and (t - 1) * D < 0.05 and -0.05 < u * L and (u - 1) * L < 0.05
                and W.z0[k] - 0.05 < zc < W.z1[k] + 0.05)
        crossed = ((EPS_T < t < 1 - EPS_T) and (-EPS_U <= u <= 1 + EPS_U)
                   and (W.z0[k] - DELTA <= zc <= W.z1[k] + DELTA))
        if near:
            margins += [abs(t * D), abs((1 - t) * D), abs(u * L), abs((1 - u) * L),
                        abs(zc - W.z0[k]), abs(W.z1[k] - zc)]
        if not crossed:
            continue
        mat = int(W.mat[k])
        inside = False
        if W.has_open[k]:
            m = u * L - W.offset[k]
            if W.period[k] > 0:
                m = m - W.period[k] * math.floor(m / W.period[k])
                if m > W.period[k] - DELTA:
                    m -= W.period[k]
            h = zc - W.z0[k]
            inside = ((-DELTA <= m <= W.width[k] + DELTA)
                      and (W.sill[k] - DELTA <= h <= W.head[k] + DELTA))
            margins += [abs(m), abs(m - W.width[k]), abs(h - W.sill[k]), abs(h - W.head[k])]
            if W.period[k] > 0:
                margins.append(abs(m - W.period[k]))
            if inside:
                mat = int(W.open_mat[k])
        walls.append({"id": W.ids[k], "material": B.materials[mat], "loss_db": float(loss[mat]),
                      "opening": bool(inside), "t": round(float(t), 9), "u": round(float(u), 9),
                      "s_m": round(float(u * L), 6), "zc": round(float(zc), 6)})
    slabs = []
    x0, y0, x1, y1 = B.slab_extent
    ks = B.mat_index["slab"]
    for zs in B.slab_planes:
        lo, hi = min(T[2], R[2]), max(T[2], R[2])
        if lo < zs < hi:
            t = (zs - T[2]) / (R[2] - T[2])
            px, py = T[0] + t * (R[0] - T[0]), T[1] + t * (R[1] - T[1])
            margins += [abs(zs - T[2]), abs(zs - R[2]), abs(px - x0), abs(px - x1), abs(py - y0), abs(py - y1)]
            if x0 - DELTA <= px <= x1 + DELTA and y0 - DELTA <= py <= y1 + DELTA:
                slabs.append({"z": float(zs), "loss_db": float(loss[ks]), "x": round(float(px), 6), "y": round(float(py), 6)})
    pl0 = pl0_db(freq_ghz)
    pl_dist = 10.0 * n * math.log10(d)
    pl = pl0 + pl_dist + sum(w["loss_db"] for w in walls) + sum(s["loss_db"] for s in slabs)
    v = (R - T) / d_true if d_true > 0 else np.zeros(3)
    g_tx = float(gain_fn(v[None, :])[0]) if gain_fn is not None else 0.0
    out = {"d_m": d, "pl0_db": pl0, "pl_distance_db": pl_dist, "pl_db": pl, "gain_tx_dbi": g_tx,
           "gain_rx_dbi": g_rx, "walls": walls, "slabs": slabs, "margin_m": float(min(margins))}
    out["rss_dbm"] = None if tx_dbm is None else float(tx_dbm + g_tx + g_rx - pl)
    return out


def router_gain_fn(sp: ScenarioParams):
    if sp.antenna == "dipole":
        return gain_dipole
    return lambda v: gain_patch(v, sp.az_deg, sp.tilt_deg, **sp.patch)
