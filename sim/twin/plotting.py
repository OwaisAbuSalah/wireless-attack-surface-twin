"""Report (light) and slide (dark) figures for radio and attack-surface maps."""

from __future__ import annotations

from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt                       # noqa: E402
import numpy as np                                    # noqa: E402
from matplotlib.lines import Line2D                   # noqa: E402
from matplotlib.patches import Patch, Rectangle       # noqa: E402

from .building import Building, ScenarioParams, cell_centers   # noqa: E402

VMIN, VMAX = -100.0, -30.0
TIER_COLORS = {"eavesdrop": "#ffd60a", "deauth": "#ff8a00", "eviltwin": "#ff2d55"}
TIER_LABELS = {"eavesdrop": "Eavesdropping", "deauth": "Deauthentication", "eviltwin": "Evil Twin"}
DPI = 150
WIDTH_IN = 12.0           # 12 in x 150 dpi = 1800 px

THEMES = {
    "light": {"bg": "#ffffff", "fg": "#1b1f24", "grid": "#d0d4da", "wall": "#1b1f24", "ext": "#000000",
              "ctx": "#9aa1ab", "ctx_edge": "#5d646e", "under": "#eef0f3", "street": "#3a3f47", "client": "#ffffff",
              "client_edge": "#1b1f24", "router": "#ffffff", "router_edge": "#000000", "box": "#ffffffdd"},
    "dark": {"bg": "#0b1426", "fg": "#e6ebf2", "grid": "#26324a", "wall": "#cdd6e4", "ext": "#ffffff",
             "ctx": "#44506a", "ctx_edge": "#8592ab", "under": "#101c33", "street": "#a9b6cc", "client": "#0b1426",
             "client_edge": "#e6ebf2", "router": "#ffffff", "router_edge": "#0b1426", "box": "#0b1426dd"},
}


def _cmap(theme):
    cm = matplotlib.colormaps["turbo"].copy()
    cm.set_under(THEMES[theme]["under"])
    cm.set_bad(THEMES[theme]["under"])
    return cm


def _style_axes(ax, th):
    ax.set_facecolor(th["under"])
    for s in ax.spines.values():
        s.set_color(th["fg"])
    ax.tick_params(colors=th["fg"], labelsize=8)
    ax.xaxis.label.set_color(th["fg"])
    ax.yaxis.label.set_color(th["fg"])
    ax.title.set_color(th["fg"])


def _draw_walls(ax, B: Building, th, floor=None, outdoor=False):
    W = B.walls
    for k in range(len(W)):
        if W.context[k]:
            continue
        if floor is not None and W.floor[k] != floor:
            continue
        if outdoor and W.floor[k] != 0:
            continue
        ext = W.exterior[k]
        ax.plot([W.ax[k], W.bx[k]], [W.ay[k], W.by[k]], color=th["ext"] if ext else th["wall"],
                lw=(1.6 if ext else 0.5) if outdoor else (2.0 if ext else 0.9), solid_capstyle="butt", zorder=6)


def _draw_context(ax, B: Building, th):
    for c in B.raw["context"]:
        x0, y0, x1, y1 = c["rect"]
        ax.add_patch(Rectangle((x0, y0), x1 - x0, y1 - y0, facecolor=th["ctx"], edgecolor=th["ctx_edge"],
                               lw=0.8, alpha=0.85, zorder=5))
        ax.text((x0 + x1) / 2, (y0 + y1) / 2, c["name"]["en"], ha="center", va="center", fontsize=6.5,
                color=th["bg"] if th is THEMES["light"] else th["fg"], zorder=7)


def _draw_street(ax, B: Building, th):
    for r in B.raw["site"]["roads"]:
        if r["id"] != "main_street":
            continue
        x0, y0, x1, y1 = r["rect"]
        ax.add_patch(Rectangle((x0, y0), x1 - x0, y1 - y0, fill=False, edgecolor=th["street"], lw=1.0,
                               ls=(0, (6, 4)), zorder=6))
        ax.text(x0 + 3, (y0 + y1) / 2, r["name"]["en"], fontsize=7, color=th["street"], va="center", zorder=7,
                fontstyle="italic")


def _draw_devices(ax, B: Building, sp: ScenarioParams, th, floor=None, size=1.0):
    from .mwm import router_floor
    if floor is None or router_floor(B, sp) == floor:
        ax.plot(*sp.tx_pos[:2], marker="*", ms=14 * size, mfc=th["router"], mec=th["router_edge"], mew=1.2, zorder=9)
        if sp.antenna == "patch":
            b = np.array([np.cos(np.radians(sp.az_deg)), np.sin(np.radians(sp.az_deg))])
            if abs(sp.tilt_deg) < 89:
                ax.annotate("", xy=sp.tx_pos[:2] + 3 * b, xytext=sp.tx_pos[:2],
                            arrowprops=dict(arrowstyle="->", color=th["router_edge"], lw=1.2), zorder=9)
    for c in B.clients:
        cf = B.floor_of_z(c["pos"][2])
        if floor is None or cf == floor:
            ax.plot(c["pos"][0], c["pos"][1], "o", ms=4.5 * size, mfc=th["client"], mec=th["client_edge"], mew=0.9, zorder=9)
            if floor is not None:
                ax.text(c["pos"][0] + 0.35, c["pos"][1] + 0.35, c["id"], fontsize=6, color=th["fg"], zorder=9)


def _draw_tiers(ax, B: Building, grid, attack, th):
    X, Y = cell_centers(grid)
    outside = ~B.inside_footprint(X, Y)
    plt.rcParams["hatch.linewidth"] = 0.8
    for key, hatch in (("eavesdrop", None), ("deauth", None), ("eviltwin", "xxxx")):
        m = (attack[key] & outside).astype(float)
        if not m.any():
            continue
        if hatch:
            cs = ax.contourf(X, Y, m, levels=[0.5, 1.5], colors="none", hatches=[hatch], zorder=4)
            try:
                cs.set_edgecolor(TIER_COLORS[key])
                cs.set_linewidth(0.0)
            except AttributeError:  # older matplotlib
                for col in cs.collections:
                    col.set_edgecolor(TIER_COLORS[key])
        ax.contour(X, Y, m, levels=[0.5], colors=[TIER_COLORS[key]], linewidths=1.6 if key != "deauth" else 1.3,
                   linestyles=["solid"] if key != "deauth" else [(0, (4, 2))], zorder=8)


def scenario_figure(B: Building, sp: ScenarioParams, maps: dict, attack: dict, stats: dict, model_label: str,
                    path: Path, theme: str = "light", cell="sionna", label: str | None = None, note: str | None = None):
    th = THEMES[theme]
    cm = _cmap(theme)
    fig = plt.figure(figsize=(WIDTH_IN, 10.0), dpi=DPI, facecolor=th["bg"])
    gs = fig.add_gridspec(2, 3, height_ratios=[7.0, 1.75], hspace=0.13, wspace=0.07,
                          left=0.065, right=0.895, top=0.955, bottom=0.035)
    ax = fig.add_subplot(gs[0, :])
    _style_axes(ax, th)
    g = B.grid("outdoor", cell)
    ext = [g["x0"], g["x0"] + g["nx"] * g["dx"], g["y0"], g["y0"] + g["ny"] * g["dx"]]
    im = ax.imshow(np.where(np.isfinite(maps["outdoor"]), maps["outdoor"], VMIN - 50), origin="lower", extent=ext,
                   cmap=cm, vmin=VMIN, vmax=VMAX, interpolation="nearest", zorder=1)
    _draw_tiers(ax, B, g, attack, th)
    _draw_context(ax, B, th)
    _draw_street(ax, B, th)
    _draw_walls(ax, B, th, outdoor=True)
    _draw_devices(ax, B, sp, th, size=0.9)
    a = B.attack["start"]
    ax.plot(a[0], a[1], marker="X", ms=8, mfc="#ff2d55", mec=th["bg"], zorder=9)
    ax.set_xlim(ext[0], ext[1]); ax.set_ylim(ext[2], ext[3]); ax.set_aspect("equal")
    ax.set_xlabel("x [m] (east)"); ax.set_ylabel("y [m] (north)")
    lab = label or B.scenarios.get(sp.name, {}).get("label", {}).get("en", sp.name)
    ant = "3GPP patch" if sp.antenna == "patch" else "λ/2 dipole"
    ax.set_title(f"{lab} — {model_label}   |   {sp.freq_ghz:g} GHz, {sp.tx_dbm:g} dBm, {ant} @ {sp.mount}   "
                 f"|   outdoor plane z = {g['z']:g} m", fontsize=11, color=th["fg"], loc="left")
    handles = [Line2D([], [], color=TIER_COLORS[k], lw=2, ls="solid" if k != "deauth" else (0, (4, 2)),
                      label=TIER_LABELS[k]) for k in TIER_COLORS]
    handles[-1] = Patch(facecolor="none", edgecolor=TIER_COLORS["eviltwin"], hatch="xxxx", lw=1.6, label="Evil Twin")
    handles += [Line2D([], [], marker="*", ls="", mfc=th["router"], mec=th["router_edge"], ms=11, label="Access point"),
                Line2D([], [], marker="o", ls="", mfc=th["client"], mec=th["client_edge"], ms=5, label="Clients"),
                Line2D([], [], marker="X", ls="", mfc="#ff2d55", mec=th["bg"], ms=8, label="Attacker start"),
                Patch(facecolor=th["ctx"], edgecolor=th["ctx_edge"], label="Neighbouring buildings")]
    leg = ax.legend(handles=handles, loc="upper right", fontsize=7.5, framealpha=0.9, facecolor=th["bg"],
                    edgecolor=th["grid"], labelcolor=th["fg"], ncol=2)
    leg.set_zorder(20)
    txt = (f"Attacker: USB 5 dBi (default)\n"
           f"Eavesdrop {stats['area_eavesdrop']:,.0f} m²   Deauth {stats['area_deauth']:,.0f} m²\n"
           f"Evil Twin {stats['area_eviltwin']:,.0f} m²   max leak {stats['max_leak_m']:.0f} m"
           f"{'+' if stats.get('leak_reaches_edge') else ''}\n"
           f"Street exposure {stats['street_exposure']:.1f} %   Coverage {stats['coverage']:.1f} %")
    if note:
        txt += "\n" + note
    ax.text(0.01, 0.015, txt, transform=ax.transAxes, fontsize=7.5, color=th["fg"], va="bottom", ha="left", zorder=20,
            bbox=dict(boxstyle="round,pad=0.4", facecolor=th["box"], edgecolor=th["grid"]), family="monospace")

    for i, f in enumerate(B.floors):
        axf = fig.add_subplot(gs[1, i])
        _style_axes(axf, th)
        name = f"floor{f['id']}"
        gf = B.grid(name, cell)
        extf = [gf["x0"], gf["x0"] + gf["nx"] * gf["dx"], gf["y0"], gf["y0"] + gf["ny"] * gf["dx"]]
        mp = maps[name]
        axf.imshow(np.where(np.isfinite(mp), mp, VMIN - 50), origin="lower", extent=extf, cmap=cm, vmin=VMIN,
                   vmax=VMAX, interpolation="nearest")
        _draw_walls(axf, B, th, floor=f["id"])
        _draw_devices(axf, B, sp, th, floor=f["id"], size=0.8)
        axf.set_xlim(extf[0], extf[1]); axf.set_ylim(extf[2], extf[3]); axf.set_aspect("equal")
        axf.set_title(f"{f['name']['en']} (z = {gf['z']:g} m)", fontsize=9, color=th["fg"])
        axf.tick_params(labelsize=7)
        if i:
            axf.set_yticklabels([])
    cax = fig.add_axes([0.91, 0.30, 0.014, 0.62])
    cb = fig.colorbar(im, cax=cax, extend="both")
    cb.set_label("RSS from access point [dBm] (0 dBi receiver)", color=th["fg"])
    cb.ax.tick_params(colors=th["fg"], labelsize=8)
    cb.outline.set_edgecolor(th["fg"])
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path, dpi=DPI, facecolor=th["bg"])
    plt.close(fig)


def save_both(B, sp, maps, attack, stats, model_label, stem: Path, **kw):
    """Write ``<stem>.png`` (light, report) and ``<stem>_dark.png`` (slides)."""
    stem = Path(stem)
    scenario_figure(B, sp, maps, attack, stats, model_label, stem.with_suffix(".png"), "light", **kw)
    scenario_figure(B, sp, maps, attack, stats, model_label, stem.parent / (stem.name + "_dark.png"), "dark", **kw)
