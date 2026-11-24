"""Wireless Attack Surface Digital Twin -- Blender scene builder + Cycles renders.

Builds the faculty building, its site and the baseline Wi-Fi leak map from data/building.json
(single source of truth), then renders the presentation figures.

    "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe" -b --factory-startup ^
        -P blender/build_twin.py -- --out docs/figures --samples 256

Options (after the "--"):
    --out DIR            output folder for the PNGs (relative to the project root)   [docs/figures]
    --samples N          Cycles samples per pixel (adaptive, denoised)                 [256]
    --views LIST         comma list of hero,cutaway,street,clean                        [all four]
    --res WxH            resolution                                                     [1920x1080]
    --percent P          resolution percentage (quick previews: 50)                     [100]
    --cell M             outdoor RSS grid cell (m); 0.5 = the spec grid, 0.25 = smoother [0.25]
    --floor-cell M       floor-1 RSS grid cell (m)                                      [0.1]
    --suffix S           appended to the PNG names (e.g. _preview)                      []
    --no-blend / --no-glb / --no-render   skip saving the .blend / the .glb / rendering
    --device OPTIX|CUDA|CPU                                                             [OPTIX]
    --set T.S.K=V        override a preset, T = light|cam|view, e.g. --set light.dusk.exposure=0.8
                         (debug views: figure, figure_front, router)

Files:  docs/figures/blender_<view>.png, blender/out/twin.blend, blender/out/twin.glb,
        blender/out/rss_outdoor.exr, blender/out/rss_floor1.exr (R = RSS dBm, G = signed distance
        in metres to the eavesdropping contour, B = distance in metres to the nearest 5 dB
        iso-level), blender/out/render_log.json.
"""
import argparse
import json
import math
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import bpy                    # noqa: E402
import numpy as np            # noqa: E402
from mathutils import Vector  # noqa: E402

import twin_building as TB    # noqa: E402
import twin_mats as TM        # noqa: E402
import twin_mesh as TMesh     # noqa: E402
import twin_props as TP       # noqa: E402
import twin_rf as RF          # noqa: E402
import twin_site as TS        # noqa: E402

# ============================================================================ constants
EAVES_EQUIPMENT = "usb"         # danger contour: RSS + G_att >= S_att for this kit
HEAT_RANGE = (-100.0, -30.0)    # turbo colour range (dBm)
ISO_STEP = 5.0                  # faint iso-lines every ISO_STEP dB
LINE_HEX = "#ff2d55"
WARM_INTERIOR = (1.0, 0.80, 0.60)
LAMP_COLOR = (1.0, 0.74, 0.46)
INTERIOR_W_PER_M2 = 5.0         # area-light power density (dusk)

# camera rigs: location, target, focal length (mm), optional dof (focus distance, f-stop)
CAMERAS = {
    "hero":    dict(loc=(34.0, -50.0, 34.0), target=(-8.0, -8.0, 0.0), lens=24.0),
    "cutaway": dict(loc=(13.0, -31.0, 34.0), target=(-1.5, -0.5, 3.0), lens=27.0),
    "street":  dict(loc=(2.15, -32.7, 1.72), target=(-1.5, -8.0, 2.6), lens=20.0, dof=(25.0, 5.6)),
    "clean":   dict(loc=(-44.0, -29.5, 13.0), target=(0.5, -1.0, 4.5), lens=28.0),
    # debug close-ups (not rendered by default)
    "figure":  dict(loc=(2.9, -33.2, 1.5), target=(1.0, -31.0, 0.9), lens=40.0),
    "figure_front": dict(loc=(-0.6, -29.2, 1.5), target=(1.0, -31.1, 0.95), lens=40.0),
    "router":  dict(loc=(-1.2, -5.2, 6.6), target=(-3.0, -7.55, 5.8), lens=35.0),
}
VIEWS = {
    #            light    outdoor-overlay  floor-overlay  cut   umbrellas  ring
    "hero":    dict(light="dusk", out=True, floor=False, cut=False, umbrellas="closed", ring=True),
    "cutaway": dict(light="dusk_cut", out=True, floor=True, cut=True, umbrellas="closed", ring=True, halo=True,
                    hide_trees_near=11.0),
    "street":  dict(light="dusk", out=True, floor=False, cut=False, umbrellas="closed", ring=False,
                    opacity=0.5, heat=0.75, iso_w=0.16, iso=0.0, hide_attacker_umbrella=True),
    "clean":   dict(light="day", out=False, floor=False, cut=False, umbrellas="open", ring=False),
    "figure":  dict(light="dusk", out=True, floor=False, cut=False, umbrellas="closed", ring=False),
    "figure_front": dict(light="dusk", out=True, floor=False, cut=False, umbrellas="closed", ring=False),
    "router":  dict(light="dusk_cut", out=True, floor=True, cut=True, umbrellas="closed", ring=False, halo=True),
}

LIGHTING = {
    # sun azimuth (math convention, deg from +x to +y), elevation (deg)
    "dusk":     dict(sun_az=125.0, sun_el=-3.0, sky=1.0, sky_type="MULTIPLE_SCATTERING", exposure=1.0,
                     interior=1.0, lamps=1.0, look="AgX - Punchy"),
    "dusk_cut": dict(sun_az=160.0, sun_el=-2.5, sky=1.0, sky_type="MULTIPLE_SCATTERING", exposure=1.0,
                     interior=0.9, lamps=1.0, look="AgX - Punchy"),
    "day":      dict(sun_az=232.0, sun_el=33.0, sky=1.0, sky_type="MULTIPLE_SCATTERING", exposure=-3.75,
                     interior=0.0, lamps=0.0, look="AgX - Medium High Contrast"),
}


# ============================================================================ args / paths
def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser(prog="build_twin.py")
    p.add_argument("--data", default=os.path.join(ROOT, "data", "building.json"))
    p.add_argument("--out", default="docs/figures")
    p.add_argument("--samples", type=int, default=256)
    p.add_argument("--views", default="hero,cutaway,street,clean")
    p.add_argument("--res", default="1920x1080")
    p.add_argument("--percent", type=int, default=100)
    p.add_argument("--cell", type=float, default=0.25)
    p.add_argument("--floor-cell", type=float, default=0.1)
    p.add_argument("--suffix", default="")
    p.add_argument("--device", default="OPTIX")
    p.add_argument("--no-blend", action="store_true")
    p.add_argument("--no-glb", action="store_true")
    p.add_argument("--no-render", action="store_true")
    p.add_argument("--set", action="append", default=[],
                   help="override a preset value: light.dusk.exposure=0.8, cam.hero.lens=28, view.street.opacity=0.5")
    a = p.parse_args(argv)
    for s in a.set:
        key, val = s.split("=", 1)
        parts = key.split(".")
        try:
            v = json.loads(val)
        except Exception:
            v = val
        named = {"light": LIGHTING, "cam": CAMERAS, "view": VIEWS}
        if len(parts) == 3 and parts[0] in named:
            named[parts[0]].setdefault(parts[1], {})[parts[2]] = v
            continue
        sec, k = parts[0], ".".join(parts[1:])
        for table in (LIGHTING, CAMERAS, VIEWS):
            if sec in table:
                table[sec][k] = v
                break
        else:
            raise SystemExit("unknown --set section: " + sec)
    a.out = a.out if os.path.isabs(a.out) else os.path.join(ROOT, a.out)
    a.outdir_blend = os.path.join(HERE, "out")
    a.w, a.h = (int(v) for v in a.res.lower().split("x"))
    a.views = [v.strip() for v in a.views.split(",") if v.strip()]
    return a


def coll(name, parent=None):
    c = bpy.data.collections.get(name) or bpy.data.collections.new(name)
    parent = parent or bpy.context.scene.collection
    if c.name not in [x.name for x in parent.children]:
        parent.children.link(c)
    return c


def purge():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for c in list(bpy.data.collections):
        bpy.data.collections.remove(c)
    for blocks in (bpy.data.meshes, bpy.data.materials, bpy.data.lights, bpy.data.cameras,
                   bpy.data.node_groups, bpy.data.metaballs, bpy.data.images, bpy.data.worlds):
        for b in list(blocks):
            try:
                blocks.remove(b)
            except Exception:
                pass


# ============================================================================ RF maps
def compute_maps(bld, args, log):
    t0 = time.time()
    maps = RF.baseline_maps(bld, outdoor_cell=args.cell, floor_cell=args.floor_cell, floor_ids=(1,))
    thr = RF.eavesdrop_threshold(bld, EAVES_EQUIPMENT)
    o = maps["outdoor"]
    o["sd"] = np.clip(RF.signed_distance(o["rss"], thr, o["cell"]), -60, 60)
    f = maps["floor1"]
    f["sd"] = np.zeros_like(f["rss"])
    for m in (o, f):
        gy, gx = np.gradient(m["rss"], m["cell"])
        g = np.maximum(np.hypot(gx, gy), 1e-6)
        dv = np.abs(m["rss"] - ISO_STEP * np.round(m["rss"] / ISO_STEP))
        iso = dv / g
        iso[m["rss"] < HEAT_RANGE[0] - 2.0] = 50.0
        m["iso"] = np.clip(iso, 0.0, 50.0)
    log["rf_seconds"] = round(time.time() - t0, 2)
    log["rf_stats"] = RF.stats(maps, bld)
    log["eavesdrop_threshold_dbm"] = thr
    print(log["rf_stats"])
    return maps


def field_image(name, m, path):
    ny, nx = m["rss"].shape
    img = bpy.data.images.new(name, nx, ny, alpha=True, float_buffer=True)
    # NB: changing the colourspace of a generated image regenerates its buffer -> set it first
    img.colorspace_settings.name = "Non-Color"
    px = np.zeros((ny, nx, 4), np.float32)
    px[..., 0] = m["rss"]
    px[..., 1] = m["sd"]
    px[..., 2] = m["iso"]
    px[..., 3] = 1.0
    img.pixels.foreach_set(px.ravel())
    img.filepath_raw = path
    img.file_format = "OPEN_EXR"
    img.save()
    img.pack()
    return img


# ============================================================================ materials
def build_materials(maps, outdir):
    M = {}

    def add(m):
        M[m.name] = m
        return m
    P, H = TM.mat_pbr, TM.hexc
    # building
    add(P("ext_concrete", "#dcd8cf", 0.8, var=0.05, var_scale=0.8, bump=0.12, bump_scale=55))
    add(P("int_plaster", "#efebe4", 0.9, var=0.02))
    add(P("int_brick", "#e7e1d6", 0.9, var=0.03))
    add(P("int_drywall", "#f1efe9", 0.9, var=0.02))
    add(P("int_concrete", "#c9c5bc", 0.85, var=0.05))
    add(P("steel", "#8d939b", 0.35, metal=1.0, var=0.03))
    add(P("cut", "#2b2e33", 0.75, var=0.0))
    add(P("slab_edge", "#d4cfc5", 0.8, var=0.04, var_scale=0.8))
    add(TM.mat_tiles("floor0", "#d7d2c9", "#cfc9bf", size=(0.6, 0.6), mortar=0.003, rough=0.35, var=0.04, bump=0.05))
    add(TM.mat_tiles("floor1", "#d4cfc6", "#ccc6bc", size=(0.6, 0.6), mortar=0.003, rough=0.35, var=0.04, bump=0.05))
    add(TM.mat_tiles("floor2", "#d7d2c9", "#cfc9bf", size=(0.6, 0.6), mortar=0.003, rough=0.35, var=0.04, bump=0.05))
    add(P("ceiling", "#f2f0ec", 0.95, var=0.0))
    add(P("roof", "#a9a7a1", 0.95, var=0.08, var_scale=0.5, bump=0.4, bump_scale=90))
    add(P("roof_inner", "#cfcac0", 0.85, var=0.04))
    add(P("coping", "#e8e5de", 0.6, var=0.03))
    add(P("frame", "#2b2f34", 0.38, metal=0.7, var=0.0))
    add(TM.mat_glass("glass_ext", "#d3e6ec", 0.0, 1.5))
    add(TM.mat_glass("glass_int", "#eef5f6", 0.0, 1.5))
    add(P("sill_stone", "#ebe8e1", 0.55, var=0.02))
    add(P("door_frame", "#d9d6d0", 0.5, var=0.0))
    add(TM.mat_wood("wood_door", "#9a6b43", 5.0, 0.5, axis="Z"))
    add(P("steel_door", "#7f868e", 0.4, metal=0.9, var=0.02))
    add(P("stair", "#cdc8be", 0.7, var=0.04))
    add(P("hvac", "#b9bcbf", 0.5, metal=0.3, var=0.04))
    add(P("hvac_dark", "#34373b", 0.5, metal=0.4, var=0.0))
    add(P("pv", "#2d3138", 0.4, metal=0.5, var=0.0))
    add(TM.mat_tiles("pv_cell", "#18263f", "#18263f", size=(0.16, 0.16), mortar=0.004, rough=0.12, var=0.03, bump=0.0, offset=0.0))
    # furniture
    add(P("desk", "#ece9e2", 0.45, var=0.0))
    add(P("desk_leg", "#5b5f64", 0.4, metal=0.6, var=0.0))
    add(P("monitor", "#16181b", 0.3, var=0.0))
    add(P("chair", "#3c4148", 0.7, var=0.0))
    add(P("shelf", "#d8d2c5", 0.6, var=0.0))
    add(P("screen_board", "#f4f4f2", 0.3, var=0.0))
    add(P("desk_dark", "#4a4640", 0.5, var=0.0))
    add(TM.mat_wood("reception", "#b08a62", 4.0, 0.45))
    add(P("sofa", "#5d6b7a", 0.95, var=0.03))
    add(P("planter", "#d9d6d0", 0.6, var=0.0))
    add(TM.mat_foliage("plant", "#3d6a2e", "#5d8a3a"))
    add(TM.mat_wood("wood_bench", "#b78f5e", 6.0, 0.5))
    add(P("steel_dark", "#4a4e53", 0.5, metal=0.5, var=0.0))
    add(P("machine", "#9fa6ad", 0.45, metal=0.2, var=0.0))
    add(P("rack", "#1c1f23", 0.4, metal=0.4, var=0.0))
    rf = TM.mat_screen("rack_front", 1.2)
    add(rf)
    add(P("partition", "#c9d3da", 0.5, var=0.0))
    add(TM.mat_emit("ceiling_light", "#fff1dc", 4.0, sampling="NONE"))
    # site
    add(TM.mat_grass("ground", "#5a6b3a", "#7c8549"))
    add(TM.mat_grass("lawn", "#4b7433", "#6e9540"))
    add(TM.mat_asphalt("asphalt", "#2e3033"))
    add(TM.mat_asphalt("asphalt_park", "#37393c"))
    add(TM.mat_tiles("sidewalk", "#bdb8ae", "#b3ada2", size=(0.5, 0.5), mortar=0.004, rough=0.8, var=0.06))
    add(P("curb", "#cfcbc2", 0.7, var=0.04, world=True))
    add(TM.mat_tiles("plaza", "#cbc3b4", "#c3bba9", size=(1.2, 0.6), mortar=0.004, rough=0.6, var=0.06))
    add(TM.mat_tiles("walkway", "#c4bcae", "#bbb3a4", size=(0.6, 0.3), mortar=0.003, rough=0.65, var=0.06))
    add(TM.mat_tiles("deck", "#8a6446", "#7d5a3e", size=(1.8, 0.15), mortar=0.006, rough=0.6, var=0.1, bump=0.2))
    add(P("deck_edge", "#6e5038", 0.7, var=0.04))
    add(P("paint_white", "#e9e7df", 0.7, var=0.04, world=True))
    add(P("paint_yellow", "#e2b33c", 0.7, var=0.04, world=True))
    # context + backdrop
    add(TM.mat_context_facade("ctx_library", "#cbbfac", pitch=2.0, win_w=0.62, floor_h=3.4, win_h=0.62, z_max=14.0, storefront_h=4.0, lit_frac=0.55, storefront_dir=(0, -1)))
    add(TM.mat_context_facade("ctx_shops_w", "#b9aa98", pitch=3.0, win_w=0.5, floor_h=3.0, win_h=0.5, z_max=8.0, storefront_h=3.4, lit_frac=0.5, storefront_dir=(0, 1)))
    add(TM.mat_context_facade("ctx_shops_e", "#a9afb8", pitch=2.5, win_w=0.55, floor_h=3.2, win_h=0.5, z_max=10.0, storefront_h=3.4, lit_frac=0.5, storefront_dir=(0, 1)))
    add(TM.mat_context_facade("ctx_housing", "#d9cfc1", pitch=2.5, win_w=0.45, floor_h=3.0, win_h=0.48, z_max=12.0, lit_frac=0.6))
    add(TM.mat_context_facade("ctx_research", "#b8c0c6", pitch=3.0, win_w=0.9, floor_h=3.0, win_h=0.42, z_max=9.0, ribbon=True, lit_frac=0.4))
    add(TM.mat_context_facade("bd_a", "#9aa1a9", pitch=3.0, win_w=0.55, floor_h=3.2, win_h=0.5, z_max=200, lit_frac=0.3))
    add(TM.mat_context_facade("bd_b", "#b3aa9d", pitch=2.6, win_w=0.5, floor_h=3.0, win_h=0.5, z_max=200, lit_frac=0.35))
    add(TM.mat_context_facade("bd_c", "#8f979e", pitch=3.4, win_w=0.7, floor_h=3.3, win_h=0.45, z_max=200, lit_frac=0.25, ribbon=True))
    add(P("ctx_roof", "#9a9893", 0.9, var=0.1, var_scale=0.35, bump=0.3, bump_scale=70))
    add(P("ctx_fin", "#e4ddd0", 0.6, var=0.03))
    add(P("awning", "#8a3a2e", 0.9, var=0.04))
    add(TM.mat_glass("railing_glass", "#e3f0f2"))
    # props
    add(P("bark", "#5a4534", 0.9, var=0.05))
    add(TM.mat_foliage("foliage", "#3b5f2c", "#6f8f3c"))
    add(TM.mat_car_paint("car_paint"))
    add(P("car_glass", "#0d1115", 0.04, var=0.0, spec=0.9))
    add(P("tyre", "#151516", 0.8, var=0.0))
    add(P("rim", "#9aa0a6", 0.3, metal=1.0, var=0.0))
    add(P("headlight", "#dfe5ea", 0.1, var=0.0))
    add(TM.mat_emit("headlight_on", "#fff2dd", 25.0))
    add(P("taillight", "#5a0b0e", 0.2, var=0.0))
    add(TM.mat_emit("taillight_on", "#ff1a1a", 10.0))
    add(P("car_trim", "#1b1d20", 0.5, var=0.0))
    add(P("lamp_pole", "#3a3e43", 0.45, metal=0.6, var=0.0))
    add(P("lamp_head", "#2f3237", 0.45, metal=0.5, var=0.0))
    add(TM.mat_emit("lamp_glow", "#ffd7a1", 30.0, base_hex="#d9d9d6"))
    add(P("table_top", "#f0ede6", 0.3, var=0.0))
    add(P("chair_seat", "#2f3337", 0.45, metal=0.5, var=0.0))
    add(P("umbrella", "#7d3a2c", 0.92, var=0.04))
    add(P("umbrella_closed", "#33433b", 0.92, var=0.04))
    add(P("wire", "#151515", 0.6, var=0.0))
    add(TM.mat_emit("bulb", "#ffcf8f", 22.0, base_hex="#f2efe6", sampling="NONE"))
    add(P("hoodie", "#353a42", 0.95, var=0.05, var_scale=9))
    add(P("jeans", "#2d3546", 0.9, var=0.05, var_scale=9))
    add(P("skin", "#7a5a48", 0.6, var=0.0))
    add(P("hood_inner", "#0f1012", 0.95, var=0.0))
    add(P("hood_string", "#c9cbd0", 0.7, var=0.0))
    add(P("shoe", "#1b1b1c", 0.6, var=0.0))
    add(P("laptop_shell", "#b9bdc2", 0.3, metal=0.7, var=0.0))
    add(P("laptop_deck", "#2b2e33", 0.4, var=0.0))
    add(TM.mat_screen("screen", 2.4))
    add(TM.mat_emit("screen_client", "#cfe6ff", 2.5))
    add(P("ap_bracket", "#d9dadc", 0.4, metal=0.4, var=0.0))
    add(P("ap_body", "#f4f5f6", 0.22, var=0.0, coat=0.6))
    add(P("ap_antenna", "#eceef0", 0.3, var=0.0))
    add(TM.mat_emit("led_blue", "#2d7dff", 40.0))
    add(TM.mat_emit("marker", "#5ff3ff", 5.0))
    add(TM.mat_halo("marker_halo", "#7df9ff", 1.2))
    add(TM.mat_halo("ap_halo", "#3d8bff", 1.4))
    add(TM.mat_emit("ap_pin", "#2f7dff", 5.0))
    add(TM.mat_emit("marker_stem", "#7df9ff", 2.0, sampling="NONE"))
    add(TM.mat_emit("ring_red", LINE_HEX, 10.0))
    add(TM.mat_ghost("ghost", "#e8eef5", 0.09))
    for k in ("ceiling_light", "lamp_glow", "bulb", "rack_front"):
        try:
            M[k].cycles.emission_sampling = "NONE" if k != "lamp_glow" else "FRONT"
        except Exception:
            pass

    # heat-map overlays
    o, f = maps["outdoor"], maps["floor1"]
    img_o = field_image("rss_outdoor", o, os.path.join(outdir, "rss_outdoor.exr"))
    img_f = field_image("rss_floor1", f, os.path.join(outdir, "rss_floor1.exr"))
    g_out = TM.overlay_group("TW_Overlay_Outdoor", img_o, (o["x0"], o["y0"], o["x1"], o["y1"]), RF.turbo,
                             *HEAT_RANGE, line=True, edge_fade=7.0, line_hex=LINE_HEX)
    fp = maps["footprint"]
    g_fl = TM.overlay_group("TW_Overlay_Floor1", img_f, (f["x0"], f["y0"], f["x1"], f["y1"]), RF.turbo,
                            *HEAT_RANGE, line=False, mask_rect=(fp[0] + 0.14, fp[1] + 0.14, fp[2] - 0.14, fp[3] - 0.14),
                            edge_fade=0.0)
    for k in ("ground", "lawn", "asphalt", "asphalt_park", "sidewalk", "curb", "plaza", "walkway", "deck",
              "deck_edge", "paint_white", "paint_yellow"):
        TM.wrap_with_group(M[k], g_out)
        try:
            M[k].cycles.emission_sampling = "NONE"
        except Exception:
            pass
    TM.wrap_with_group(M["floor1"], g_fl)
    M["floor1"].cycles.emission_sampling = "NONE"
    return M, g_out, g_fl


# ============================================================================ building
def build_building(bld, M, C):
    BB = TB.BuildingBuilder(bld)
    fur = TB.Furnisher(bld)
    floors = bld["floors"]
    zc = floors[1]["z"] + TB.CUT_H
    stats = {}
    for fl in floors:
        k = fl["id"]
        walls = [w for w in BB.walls if w.floor == k]
        target = C["F%d" % k]
        variants = [("", target, None)]
        if k == 1:
            variants.append(("_cut", C["F1_cut"], zc))
        for suf, cl, zcut in variants:
            mb_w = TMesh.MeshBuilder("Walls_F%d%s" % (k, suf))
            fill = {"glass": TMesh.MeshBuilder("Glass_F%d%s" % (k, suf)),
                    "frame": TMesh.MeshBuilder("Frames_F%d%s" % (k, suf)),
                    "door": TMesh.MeshBuilder("Doors_F%d%s" % (k, suf))}
            for w in walls:
                keep = ()
                pier = None
                if zcut is not None and w.ext and abs((BB.router - w.a).dot(w.W)) < 0.6:
                    s_r = (BB.router - w.a).dot(w.U)
                    if 0 <= s_r <= w.L:
                        # the solid pier around the AP (between two windows)
                        ivs = w.intervals()
                        lo = max([s1 for s0, s1 in ivs if s1 <= s_r] + [0.0])
                        hi = min([s0 for s0, s1 in ivs if s0 >= s_r] + [w.L])
                        pier = (lo, hi)
                        if TB.KEEP_ROUTER_PIER:
                            keep = (pier,)
                BB.build_wall(w, mb_w, fill, zcut=zcut, keep=keep)
                if pier and not keep and TB.GHOST_ROUTER_PIER:
                    # the removed part of the AP's wall, drawn as a translucent ghost
                    gh = TMesh.MeshBuilder("GhostPier")
                    gh.obox(w.a, w.U, w.V, w.W, pier[0], pier[1], zcut + 0.002, w.z1 - TB.SLAB, -w.vt / 2, w.vt / 2, "ghost")
                    gh.to_object(cl, M)
            ob = mb_w.to_object(cl, M, bevel=0.012)
            stats[ob.name] = len(ob.data.polygons)
            for key, mb in fill.items():
                o2 = mb.to_object(cl, M, bevel=0.004 if key != "glass" else None)
                if o2:
                    stats[o2.name] = len(o2.data.polygons)
        # slab under this floor (k=0: ground-floor slab, else the floor slab with the stair void)
        mb_s = TMesh.MeshBuilder("Slab_F%d" % k)
        if k == 0:
            BB.slab(mb_s, fl["z"], "floor0", hole=None, bottom=-0.5)
        else:
            BB.slab(mb_s, fl["z"], "floor%d" % k, hole=TB.STAIR_HOLE)
        mb_s.to_object(C["F%d_slab" % k], M, bevel=0.01)
        # stairs (to the floor above), furniture, ceiling fixtures
        mb_st = TMesh.MeshBuilder("Stairs_F%d" % k)
        BB.stairs(mb_st, fl["z"], fl["height"])
        mb_st.to_object(target, M, bevel=0.006)
        mb_f = TMesh.MeshBuilder("Furniture_F%d" % k)
        for r in bld["rooms"]:
            if r["floor"] == k and r["type"] != "core":
                fur.room(mb_f, r, fl["z"])
        mb_f.to_object(C["F%d_int" % k], M, bevel=0.008)
        mb_l = TMesh.MeshBuilder("CeilingLights_F%d" % k)
        zt = fl["z"] + fl["height"] - TB.SLAB
        for r in bld["rooms"]:
            if r["floor"] != k:
                continue
            x0, y0, x1, y1 = r["rect"]
            nx = max(1, int((x1 - x0) / 2.4))
            ny = max(1, int((y1 - y0) / 2.4))
            for i in range(nx):
                for j in range(ny):
                    x = x0 + (x1 - x0) * (i + 0.5) / nx
                    y = y0 + (y1 - y0) * (j + 0.5) / ny
                    mb_l.box(x - 0.3, y - 0.3, zt - 0.025, x + 0.3, y + 0.3, zt, "ceiling_light", {"+z": "ceiling"})
        mb_l.to_object(C["F%d" % k], M)
    # roof
    z_roof = floors[-1]["z"] + floors[-1]["height"]
    mb_r = TMesh.MeshBuilder("Roof_Slab")
    BB.slab(mb_r, z_roof, "roof", hole=None)
    mb_r.to_object(C["Roof"], M, bevel=0.01)
    mb_p = TMesh.MeshBuilder("Roof_Parapet")
    BB.roof_extras(mb_p, z_roof)
    mb_p.to_object(C["Roof"], M, bevel=0.012)
    mb_pl = TMesh.MeshBuilder("Roof_Plant")
    BB.roof_plant(mb_pl, z_roof)
    mb_pl.to_object(C["Roof"], M, bevel=0.01)
    mb_c = TMesh.MeshBuilder("Entrance_Canopy")
    BB.canopy(mb_c)
    mb_c.to_object(C["F0"], M, bevel=0.01)
    return BB, stats


def facade_uplights(bld, C):
    """Warm grazing uplights on the street facade piers (dusk only) -- architectural night look."""
    fp = bld["footprint"]
    y = fp[1] - 0.15 - 0.45
    xs = [fp[0] + 3.0 * k for k in range(1, int((fp[2] - fp[0]) / 3.0))]
    for x in xs:
        if abs(x) < 6.5:          # curtain-wall lobby: lit from inside
            continue
        ld = bpy.data.lights.new("Uplight", "SPOT")
        ld.energy = 160.0
        ld.spot_size = math.radians(34)
        ld.spot_blend = 0.75
        ld.shadow_soft_size = 0.05
        ld.color = (1.0, 0.78, 0.55)
        ob = bpy.data.objects.new("Uplight_%+.0f" % x, ld)
        ob.location = (x, y, 0.08)
        ob.rotation_euler = (math.radians(-8), 0.0, 0.0)    # spot points along -Z: tip it up the wall
        ob.rotation_euler = Vector((0.0, 0.45, 1.0)).to_track_quat("-Z", "Y").to_euler()
        ob.visible_camera = False
        C["StreetLights"].objects.link(ob)
        ob["base_energy"] = ld.energy


def interior_lights(bld, C):
    lights = []
    for r in bld["rooms"]:
        fl = bld["floors"][r["floor"]]
        x0, y0, x1, y1 = r["rect"]
        W, D = x1 - x0, y1 - y0
        ld = bpy.data.lights.new("RoomLight", "AREA")
        ld.shape = "RECTANGLE"
        ld.size, ld.size_y = W * 0.7, D * 0.7
        ld.energy = INTERIOR_W_PER_M2 * W * D
        ld.color = WARM_INTERIOR
        ob = bpy.data.objects.new("RoomLight_F%d_%s" % (r["floor"], r["name"]["en"].replace(" ", "_")), ld)
        ob.location = ((x0 + x1) / 2, (y0 + y1) / 2, fl["z"] + fl["height"] - TB.SLAB - 0.08)
        ob.visible_camera = False
        C["L%d" % r["floor"]].objects.link(ob)
        ob["base_energy"] = ld.energy
        lights.append(ob)
    return lights


# ============================================================================ site + props
def build_site(bld, M, C, log):
    SB = TS.SiteBuilder(bld)
    mb = TMesh.MeshBuilder("Ground")
    SB.build_ground(mb)
    mb.to_object(C["Site"], M)
    mb = TMesh.MeshBuilder("Surfaces")
    SB.build_surfaces(mb)
    mb.to_object(C["Site"], M, bevel=0.01)
    mb = TMesh.MeshBuilder("Markings")
    SB.build_markings(mb)
    mb.to_object(C["Site"], M)
    styles = {}

    def mb_for(key):
        if key not in styles:
            styles[key] = TMesh.MeshBuilder("Context_" + key)
        return styles[key]
    SB.build_context(mb_for)
    for key, mbx in styles.items():
        mbx.to_object(C["Context"], M, bevel=0.02)
    tree_spots = []
    mb = TMesh.MeshBuilder("Backdrop_Blocks")
    SB.build_backdrop(mb, tree_spots)
    mb.to_object(C["Backdrop"], M)
    return SB, tree_spots


def surface_z(bld, x, y):
    """Top of the highest site layer at (x, y) -- props stand exactly on it."""
    s = bld["site"]

    def inside(r):
        return r[0] <= x <= r[2] and r[1] <= y <= r[3]
    fp = bld["footprint"]
    if inside((fp[0] - 0.15, fp[1] - 0.15, fp[2] + 0.15, fp[3] + 0.15)):
        return 0.0
    if inside(s["cafe_terrace"]["rect"]):
        return TS.Z_TERRACE
    if inside(s["walkway"]):
        return TS.Z_WALK
    if inside(s["plaza"]):
        return TS.Z_PLAZA
    if any(inside(TS._extend(tuple(r), tuple(s["ground"]["rect"]))) for r in s["sidewalks"]):
        return TS.Z_SIDEWALK
    if any(inside(r) for r in s["lawns"]):
        return TS.Z_LAWN
    if inside(s["parking"]["rect"]):
        return TS.Z_PARK
    if any(inside(TS._extend(tuple(r["rect"]), tuple(s["ground"]["rect"]))) for r in s["roads"]):
        return TS.Z_ROAD
    return TS.Z_GROUND


def build_props(bld, M, C, tree_spots, log):
    site = bld["site"]
    rng = np.random.default_rng(4)
    # trees
    tms = TP.tree_meshes(M)
    for i, t in enumerate(site["trees"]):
        x, y = t["p"]
        me = tms[i % (len(tms) - 1)] if (i % 7) else tms[-1]
        TP.place("Tree_%03d" % i, me, C["Trees"], (x, y, surface_z(bld, x, y)), float(rng.uniform(0, 6.28)), t["s"])
    for i, (x, y, s) in enumerate(tree_spots):
        TP.place("BgTree_%03d" % i, tms[i % len(tms)], C["Backdrop"], (x, y, TS.Z_GROUND), float(rng.uniform(0, 6.28)), s)
    # cars (parked) + a few moving cars with lights on
    car_off = TP.car_mesh(M, False, "CarMesh")
    car_on = TP.car_mesh(M, True, "CarMeshLit")
    for i, c in enumerate(site["cars"]):
        x, y = c["p"]
        col = TM.hexc(c["color"])
        TP.place("Car_%02d" % i, car_off, C["Cars"], (x, y, surface_z(bld, x, y)), math.radians(c["yaw"]), 1.0, col)
    for i, tr in enumerate(site.get("traffic", [])):
        x = (-100 + tr["offset"] * 1.0) if tr["dir"] > 0 else (100 - tr["offset"] * 1.0)
        if abs(x) > 98:
            x = math.copysign(70, x)
        y = tr["lane"]
        yaw = 0.0 if tr["dir"] > 0 else math.pi
        ob = TP.place("Traffic_%d" % i, car_on, C["Traffic"], (x, y, TS.Z_ROAD), yaw, 1.0,
                      TM.hexc(("#c9ccd1", "#20252b", "#7a1d22", "#e6e6e6")[i % 4]))
        for sy in (-0.65, 0.65):
            ld = bpy.data.lights.new("Headlight", "SPOT")
            ld.energy = 600.0
            ld.spot_size = math.radians(55)
            ld.spot_blend = 0.6
            ld.color = (1.0, 0.93, 0.82)
            lo = bpy.data.objects.new("Headlight", ld)
            lo.parent = ob
            lo.location = (2.25, sy, 0.64)
            lo.rotation_euler = (0.0, math.radians(-96), 0.0)
            lo.visible_camera = False
            C["StreetLights"].objects.link(lo)
            lo["base_energy"] = ld.energy
    # lamps
    lamp_meshes = {k: TP.lamp_mesh(M, k) for k in ("street", "parking", "bollard")}
    for i, l in enumerate(site["lamps"]):
        kind = l.get("kind", "street")
        me, heads = lamp_meshes[kind]
        x, y = l["p"]
        z = surface_z(bld, x, y)
        yaw = math.radians(l["yaw"])
        TP.place("Lamp_%02d" % i, me, C["Lamps"], (x, y, z), yaw)
        for hx, hy, hz in heads:
            px = x + hx * math.cos(yaw) - hy * math.sin(yaw)
            py = y + hx * math.sin(yaw) + hy * math.cos(yaw)
            if kind == "bollard":
                ld = bpy.data.lights.new("BollardLight", "POINT")
                ld.energy = 12.0
                ld.shadow_soft_size = 0.08
            else:
                ld = bpy.data.lights.new("LampLight", "SPOT")
                ld.energy = 900.0 if kind == "street" else 650.0
                ld.spot_size = math.radians(140)
                ld.spot_blend = 0.85
                ld.shadow_soft_size = 0.2
            ld.color = LAMP_COLOR
            lo = bpy.data.objects.new("LampLight_%02d" % i, ld)
            lo.location = (px, py, z + hz - 0.03)
            lo.visible_camera = False
            C["StreetLights"].objects.link(lo)
            lo["base_energy"] = ld.energy
    # café terrace
    table, u_open, u_closed = TP.cafe_set_meshes(M)
    zt = TS.Z_TERRACE
    for i, t in enumerate(site["cafe_tables"]):
        x, y = t["p"]
        TP.place("CafeTable_%d" % i, table, C["Cafe"], (x, y, zt))
        if t.get("umbrella"):
            TP.place("UmbrellaOpen_%d" % i, u_open, C["UmbrellaOpen"], (x, y, zt))
            uo = TP.place("UmbrellaClosed_%d" % i, u_closed, C["UmbrellaClosed"], (x, y, zt), 0.3 * i)
            ax, ay = bld["attack"]["start"]
            uo["attacker_table"] = math.hypot(x - ax, y - ay) < 0.6
    tr = site["cafe_terrace"]["rect"]
    mb = TMesh.MeshBuilder("Terrace_Dressing")
    for (x, y) in ((tr[0] + 0.45, tr[1] + 0.45), (tr[2] - 0.45, tr[1] + 0.45)):
        mb.box(x - 0.35, y - 0.35, zt, x + 0.35, y + 0.35, zt + 0.55, "planter")
        mb.icosphere((x, y, zt + 0.85), 0.42, "plant", subdiv=1, scale=(1, 1, 0.9), jitter=0.12, rng=__import__("random").Random(i))
    poles = [(tr[0] - 0.25, tr[1] + 0.25), (tr[2] + 0.25, tr[1] + 0.25), (tr[0] - 0.25, tr[3] - 0.15), (tr[2] + 0.25, tr[3] - 0.15)]
    for (x, y) in poles:
        mb.cylinder((x, y, zt), (x, y, zt + 3.3), 0.035, "lamp_pole", segs=8)
    TP.string_lights(mb, (poles[2][0], poles[2][1], zt + 3.25), (poles[3][0], poles[3][1], zt + 3.25), 0.5, 0.62)
    TP.string_lights(mb, (poles[0][0], poles[0][1], zt + 3.25), (poles[1][0], poles[1][1], zt + 3.25), 0.5, 0.62)
    TP.string_lights(mb, (poles[0][0], poles[0][1], zt + 3.2), (poles[3][0], poles[3][1], zt + 3.2), 0.55, 0.62)
    mb.to_object(C["Cafe"], M)
    for k, (x0, x1) in enumerate(((tr[0], 0.5 * (tr[0] + tr[2])), (0.5 * (tr[0] + tr[2]), tr[2]))):
        ld = bpy.data.lights.new("TerraceGlow", "AREA")
        ld.shape = "RECTANGLE"
        ld.size, ld.size_y = (x1 - x0) * 0.9, (tr[3] - tr[1]) * 0.8
        ld.energy = 140.0
        ld.color = (1.0, 0.72, 0.45)
        lo = bpy.data.objects.new("TerraceGlow_%d" % k, ld)
        lo.location = (0.5 * (x0 + x1), 0.5 * (tr[1] + tr[3]), zt + 3.0)
        lo.visible_camera = False
        lo.visible_glossy = False
        C["StreetLights"].objects.link(lo)
        lo["base_energy"] = ld.energy


def build_rf_props(bld, M, C, BB):
    """Access point, client devices + markers, attacker, attack ring."""
    rt = bld["router"]["mounts"][bld["router"].get("mount", "wall")]
    pos = Vector(rt["pos"])
    # the wall the AP hangs on: nearest exterior wall plane
    fp = bld["footprint"]
    y_face = fp[1] + BB.ext_t / 2 if abs(pos.y - fp[1]) < abs(pos.y - fp[3]) else fp[3] - BB.ext_t / 2
    facing = 1 if y_face < pos.y else -1
    mb = TMesh.MeshBuilder("AccessPoint")
    TP.router(mb, tuple(pos), y_face, facing)
    ap = mb.to_object(C["RF"], M, bevel=0.003)
    mb = TMesh.MeshBuilder("AccessPoint_Halo")
    mb.icosphere((pos.x, pos.y + facing * 0.02, pos.z + 0.03), 0.30, "ap_halo", subdiv=3, smooth=True)
    # location pin above the AP (cutaway): glowing head + thin stem down to the device
    zp = pos.z + 1.55
    mb.icosphere((pos.x, pos.y, zp), 0.14, "ap_pin", subdiv=2, smooth=True)
    mb.icosphere((pos.x, pos.y, zp), 0.30, "ap_halo", subdiv=3, smooth=True)
    mb.cylinder((pos.x, pos.y, pos.z + 0.25), (pos.x, pos.y, zp - 0.1), 0.012, "ap_pin", segs=8)
    mb.to_object(C["APHalo"], M)
    ld = bpy.data.lights.new("AP_LED", "POINT")
    ld.energy = 0.6
    ld.color = (0.25, 0.5, 1.0)
    ld.shadow_soft_size = 0.02
    lo = bpy.data.objects.new("AP_LED", ld)
    lo.location = (pos.x, pos.y + facing * 0.16, pos.z + 0.04)
    lo.visible_camera = False
    C["RF"].objects.link(lo)
    # clients
    mb = TMesh.MeshBuilder("Clients")
    mk = TMesh.MeshBuilder("ClientMarkers")
    fur = TB.Furnisher(bld)
    for c in bld["clients"]:
        x, y, z = c["pos"]
        fl = max((f for f in bld["floors"] if f["z"] <= z), key=lambda f: f["z"])
        z0 = fl["z"]
        south = y < 0
        yaw = 0.0 if south else math.pi
        if c["kind"] == "printer":
            mb.box(x - 0.35, y - 0.3, z0, x + 0.35, y + 0.3, z - 0.15, "desk_dark")
        else:
            mb.box(x - 0.55, y - 0.35, z0 + 0.72, x + 0.55, y + 0.35, z - 0.05, "desk")
            for sx in (-1, 1):
                mb.box(x + sx * 0.5 - 0.02, y - 0.3, z0, x + sx * 0.5 + 0.02, y + 0.3, z0 + 0.72, "desk_leg")
            fur.chair(mb, x, y + (-0.75 if south else 0.75), z0, 0.0 if not south else math.pi)
        TP.client_device(mb, c["kind"], (x, y, z), yaw if c["kind"] != "laptop" else (0.0 if south else math.pi))
        mk.icosphere((x, y, z + 0.75), 0.075, "marker", subdiv=2, smooth=True)
        mk.icosphere((x, y, z + 0.75), 0.17, "marker_halo", subdiv=2, smooth=True)
        mk.cylinder((x, y, z + 0.12), (x, y, z + 0.68), 0.007, "marker_stem", segs=6)
        for rr in (0.38, 0.62):
            n = 40
            for i in range(n):
                a0, a1 = 2 * math.pi * i / n, 2 * math.pi * (i + 1) / n
                mk.cylinder((x + rr * math.cos(a0), y + rr * math.sin(a0), z0 + 0.012),
                            (x + rr * math.cos(a1), y + rr * math.sin(a1), z0 + 0.012), 0.012, "marker_stem", segs=4,
                            cap0=False, cap1=False)
    mb.to_object(C["RF"], M, bevel=0.003)
    mk.to_object(C["RF"], M)
    # attacker on the café terrace
    ax, ay = bld["attack"]["start"]
    tbl = min(bld["site"]["cafe_tables"], key=lambda t: (t["p"][0] - ax) ** 2 + (t["p"][1] - ay) ** 2)
    tx, ty = tbl["p"]
    zt = TS.Z_TERRACE
    chair_y = ty - 0.74
    TP.attacker(C["Attacker"], M, (tx, chair_y, zt), 0.0)
    mb = TMesh.MeshBuilder("Attacker_Laptop")
    TP.laptop(mb, ax, ay + 0.02, zt + TP.TABLE_H, 0.0, "screen", antenna=True)
    mb.to_object(C["Attacker"], M, bevel=0.002)
    ld = bpy.data.lights.new("ScreenGlow", "AREA")
    ld.shape = "RECTANGLE"
    ld.size, ld.size_y = 0.3, 0.2
    ld.energy = 2.2
    ld.color = (0.55, 0.95, 0.85)
    lo = bpy.data.objects.new("ScreenGlow", ld)
    lo.location = (ax, ay + 0.06, zt + TP.TABLE_H + 0.14)
    lo.rotation_euler = (math.radians(-80), 0, 0)
    lo.visible_camera = False
    C["Attacker"].objects.link(lo)
    # red ring marking attack.start
    mb = TMesh.MeshBuilder("AttackRing")
    n = 64
    R = 1.25
    for i in range(n):
        a0, a1 = 2 * math.pi * i / n, 2 * math.pi * (i + 1) / n
        mb.cylinder((ax + R * math.cos(a0), ay + R * math.sin(a0), zt + 0.03),
                    (ax + R * math.cos(a1), ay + R * math.sin(a1), zt + 0.03), 0.028, "ring_red", segs=6, cap0=False, cap1=False)
    mb.to_object(C["Ring"], M)


# ============================================================================ world, lights, cameras
def build_world():
    w = bpy.data.worlds.new("TW_World")
    bpy.context.scene.world = w
    nt = w.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    sky = nt.nodes.new("ShaderNodeTexSky")
    sky.label = "SKY"
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.label = "BG"
    out = nt.nodes.new("ShaderNodeOutputWorld")
    nt.links.new(sky.outputs[0], bg.inputs[0])
    nt.links.new(bg.outputs[0], out.inputs[0])
    w.mist_settings.start = 60.0
    w.mist_settings.depth = 420.0
    w.mist_settings.falloff = "QUADRATIC"
    return w


def set_lighting(preset, C, M):
    L = LIGHTING[preset]
    sc = bpy.context.scene
    w = sc.world
    sky = next(n for n in w.node_tree.nodes if n.type == "TEX_SKY")
    bg = next(n for n in w.node_tree.nodes if n.type == "BACKGROUND")
    sky.sky_type = L["sky_type"]
    sky.sun_elevation = math.radians(L["sun_el"])
    sky.sun_rotation = math.radians(90.0 - L["sun_az"])
    sky.sun_disc = L["sun_el"] > 0
    try:
        sky.sun_intensity = 1.0
        sky.altitude = 120.0
        sky.air_density = 1.0
        sky.aerosol_density = 1.6 if preset != "day" else 1.0
    except Exception:
        pass
    bg.inputs["Strength"].default_value = L["sky"]
    vs = sc.view_settings
    vs.view_transform = "AgX"
    try:
        vs.look = L["look"]
    except Exception:
        pass
    vs.exposure = L["exposure"]
    on_i, on_l = L["interior"], L["lamps"]
    for k in range(3):
        for ob in C["L%d" % k].objects:
            ob.data.energy = ob["base_energy"] * on_i
            ob.hide_render = on_i <= 0
    for ob in C["StreetLights"].objects:
        ob.data.energy = ob["base_energy"] * on_l
        ob.hide_render = on_l <= 0
    TM.set_material_value(M["lamp_glow"], "strength", 30.0 * on_l)
    TM.set_material_value(M["bulb"], "strength", 22.0 * on_l)
    TM.set_material_value(M["ceiling_light"], "strength", 2.5 * on_i)
    TM.set_material_value(M["headlight_on"], "strength", 25.0 * on_l)
    TM.set_material_value(M["taillight_on"], "strength", 10.0 * on_l)
    for m in M.values():
        if m.name.startswith(("ctx_", "bd_")):
            TM.set_material_value(m, "lit_strength", 1.7 * on_i if preset != "day" else 0.0)


def make_camera(name, spec, C):
    cd = bpy.data.cameras.new(name)
    cd.lens = spec["lens"]
    cd.sensor_width = 36.0
    cd.clip_start = 0.1
    cd.clip_end = 4000.0
    ob = bpy.data.objects.new(name, cd)
    ob.location = spec["loc"]
    d = Vector(spec["target"]) - Vector(spec["loc"])
    ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    if "dof" in spec:
        cd.dof.use_dof = True
        cd.dof.focus_distance = spec["dof"][0]
        cd.dof.aperture_fstop = spec["dof"][1]
    C["Cameras"].objects.link(ob)
    return ob


def compositor(bloom=0.35, mist=0.0, mist_color=(0.5, 0.6, 0.75), vignette=0.18):
    sc = bpy.context.scene
    try:
        sc.use_nodes = True
    except Exception:
        pass
    old = bpy.data.node_groups.get("TW_COMP")
    if old:
        bpy.data.node_groups.remove(old)
    ng = bpy.data.node_groups.new("TW_COMP", "CompositorNodeTree")
    ng.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
    sc.compositing_node_group = ng
    N, Lk = ng.nodes, ng.links
    rl = N.new("CompositorNodeRLayers")
    go = N.new("NodeGroupOutput")
    img = rl.outputs["Image"]
    if mist > 0 and "Mist" in rl.outputs:
        mr = N.new("ShaderNodeMapRange")
        mr.inputs["To Max"].default_value = mist
        Lk.new(rl.outputs["Mist"], mr.inputs["Value"])
        mx = N.new("ShaderNodeMix")
        mx.data_type = "RGBA"
        mx.inputs[7].default_value = (*mist_color, 1.0)
        Lk.new(mr.outputs[0], mx.inputs[0])
        Lk.new(img, mx.inputs[6])
        img = mx.outputs[2]
    if bloom > 0:
        g = N.new("CompositorNodeGlare")
        TM.NB(ng)  # (keeps the helper import honest)
        for k, v in (("Type", "Bloom"), ("Quality", "High"), ("Threshold", 1.0), ("Smoothness", 0.4),
                     ("Strength", bloom), ("Size", 0.55), ("Saturation", 1.0)):
            try:
                g.inputs[k].default_value = v
            except Exception:
                pass
        Lk.new(img, g.inputs["Image"])
        img = g.outputs["Image"]
    if vignette > 0:
        el = N.new("CompositorNodeEllipseMask")
        for k, v in (("Position", (0.5, 0.5)), ("Size", (0.78, 0.86))):
            try:
                el.inputs[k].default_value = v
            except Exception:
                pass
        bl = N.new("CompositorNodeBlur")
        for k, v in (("Type", "Fast Gaussian"), ("Size", (300.0, 300.0))):
            try:
                bl.inputs[k].default_value = v
            except Exception:
                pass
        Lk.new(el.outputs["Mask"], bl.inputs["Image"])
        mr = N.new("ShaderNodeMapRange")
        mr.inputs["To Min"].default_value = 1.0 - vignette
        Lk.new(bl.outputs["Image"], mr.inputs["Value"])
        vm = N.new("ShaderNodeMix")
        vm.data_type = "RGBA"
        vm.blend_type = "MULTIPLY"
        vm.inputs[0].default_value = 1.0
        Lk.new(img, vm.inputs[6])
        Lk.new(mr.outputs[0], vm.inputs[7])
        img = vm.outputs[2]
    Lk.new(img, go.inputs[0])


def setup_render(args):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    cy = sc.cycles
    prefs = bpy.context.preferences.addons["cycles"].preferences
    dev = args.device.upper()
    if dev in ("OPTIX", "CUDA"):
        try:
            prefs.compute_device_type = dev
            prefs.get_devices()
            for d in prefs.devices:
                d.use = d.type == dev
            cy.device = "GPU"
        except Exception as e:
            print("GPU setup failed, using CPU:", e)
            cy.device = "CPU"
    else:
        cy.device = "CPU"
    cy.samples = args.samples
    cy.use_adaptive_sampling = True
    cy.adaptive_threshold = 0.012
    cy.use_denoising = True
    try:
        cy.denoiser = "OPENIMAGEDENOISE"
        cy.denoising_input_passes = "RGB_ALBEDO_NORMAL"
        cy.denoising_prefilter = "ACCURATE"
        cy.denoising_use_gpu = True
    except Exception:
        pass
    cy.max_bounces = 8
    cy.diffuse_bounces = 3
    cy.glossy_bounces = 3
    cy.transmission_bounces = 8
    cy.transparent_max_bounces = 24
    cy.caustics_reflective = False
    cy.caustics_refractive = False
    cy.sample_clamp_indirect = 6.0
    cy.blur_glossy = 0.6
    try:
        cy.use_light_tree = True
    except Exception:
        pass
    sc.render.resolution_x, sc.render.resolution_y = args.w, args.h
    sc.render.resolution_percentage = args.percent
    sc.render.film_transparent = False
    try:
        sc.render.image_settings.media_type = "IMAGE"
    except Exception:
        pass
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGB"
    sc.render.image_settings.color_depth = "8"
    sc.render.image_settings.compression = 15
    sc.view_layers[0].use_pass_mist = True
    sc.unit_settings.system = "METRIC"


# ============================================================================ views
_FOOTPRINT = [None]


def maps_footprint():
    return _FOOTPRINT[0]


def apply_view(name, C, M, g_out, g_fl):
    v = VIEWS[name]
    sc = bpy.context.scene
    set_lighting(v["light"], C, M)
    # overlays
    TM.set_group_value(g_out, "opacity", v.get("opacity", 0.7) if v["out"] else 0.0)
    TM.set_group_value(g_out, "line_strength", 9.0 if v["out"] else 0.0)
    TM.set_group_value(g_out, "heat_strength", v.get("heat", 0.85))
    TM.set_group_value(g_out, "iso_width", v.get("iso_w", 0.12))
    TM.set_group_value(g_out, "iso_strength", v.get("iso", 0.8))
    TM.set_group_value(g_fl, "iso_width", 0.05)
    TM.set_group_value(g_out, "line_width", 0.42 if name == "hero" else 0.30)
    TM.set_group_value(g_fl, "opacity", 0.86 if v["floor"] else 0.0)
    TM.set_group_value(g_fl, "heat_strength", 1.6)
    # visibility
    cut = v["cut"]
    for key in ("F2", "F2_slab", "F2_int", "L2", "Roof"):
        C[key].hide_render = cut
    C["F1"].hide_render = cut
    C["F1_cut"].hide_render = not cut
    C["UmbrellaOpen"].hide_render = v["umbrellas"] != "open"
    C["UmbrellaClosed"].hide_render = v["umbrellas"] != "closed"
    C["Ring"].hide_render = not v["ring"]
    C["APHalo"].hide_render = not v.get("halo", False)
    C["Traffic"].hide_render = v["light"] == "day"
    # view-specific declutter: trees hugging the building (cutaway) / the closed umbrella that would
    # stand in front of the facade in the over-the-shoulder shot
    fp = maps_footprint()
    near = v.get("hide_trees_near", 0.0)
    for ob in C["Trees"].objects:
        x, y = ob.location.x, ob.location.y
        dx = max(fp[0] - x, 0.0, x - fp[2])
        dy = max(fp[1] - y, 0.0, y - fp[3])
        ob.hide_render = near > 0 and math.hypot(dx, dy) < near
    for ob in C["UmbrellaClosed"].objects:
        ob.hide_render = bool(v.get("hide_attacker_umbrella")) and ob.get("attacker_table", False)
    sc.camera = bpy.data.objects["CAM_" + name]
    if v["light"] == "day":
        compositor(bloom=0.0, mist=0.6, mist_color=(0.70, 0.78, 0.88), vignette=0.12)
    elif name == "street":
        compositor(bloom=0.45, mist=0.5, mist_color=(0.10, 0.13, 0.22), vignette=0.22)
    else:
        compositor(bloom=0.4, mist=0.55, mist_color=(0.09, 0.12, 0.21), vignette=0.2)


# ============================================================================ checks
def check_scene(bld, C, log):
    """Automated sanity checks: props standing on their surface, no NaN geometry, AP inside the building."""
    issues = []
    for ob in list(C["Cars"].objects) + list(C["Lamps"].objects) + list(C["Trees"].objects):
        x, y, z = ob.location
        zs = surface_z(bld, x, y)
        if abs(z - zs) > 1e-4:
            issues.append("%s floats/sinks: z=%.3f surface=%.3f" % (ob.name, z, zs))
    for ob in bpy.data.objects:
        if ob.type == "MESH" and ob.data and len(ob.data.vertices):
            co = np.empty(len(ob.data.vertices) * 3)
            ob.data.vertices.foreach_get("co", co)
            if not np.isfinite(co).all():
                issues.append("%s has non-finite vertices" % ob.name)
    fp = bld["footprint"]
    ap = bld["router"]["mounts"]["wall"]["pos"]
    if not (fp[0] < ap[0] < fp[2] and fp[1] < ap[1] < fp[3]):
        issues.append("AP outside the footprint")
    log["checks"] = issues or ["ok"]
    print("CHECKS:", log["checks"])


# ============================================================================ main
def build_all(args, log):
    purge()
    bld = RF.load_building(args.data)
    os.makedirs(args.outdir_blend, exist_ok=True)
    maps = compute_maps(bld, args, log)
    maps["footprint"] = bld["footprint"]
    _FOOTPRINT[0] = bld["footprint"]
    M, g_out, g_fl = build_materials(maps, args.outdir_blend)
    root = coll("TwinScene")
    C = {}
    for key in ("Building", "Site", "Context", "Backdrop", "Props", "RF", "Lights", "Cameras"):
        C[key] = coll("TW_" + key, root)
    for k in range(3):
        C["F%d" % k] = coll("TW_F%d" % k, C["Building"])
        C["F%d_slab" % k] = coll("TW_F%d_slab" % k, C["Building"])
        C["F%d_int" % k] = coll("TW_F%d_interior" % k, C["Building"])
        C["L%d" % k] = coll("TW_Lights_F%d" % k, C["Lights"])
    C["F1_cut"] = coll("TW_F1_cutaway", C["Building"])
    C["Roof"] = coll("TW_Roof", C["Building"])
    for k in ("Trees", "Cars", "Traffic", "Lamps", "Cafe", "UmbrellaOpen", "UmbrellaClosed"):
        C[k] = coll("TW_" + k, C["Props"])
    C["StreetLights"] = coll("TW_StreetLights", C["Lights"])
    C["Attacker"] = coll("TW_Attacker", C["RF"])
    C["Ring"] = coll("TW_AttackRing", C["RF"])
    C["APHalo"] = coll("TW_APHalo", C["RF"])
    t0 = time.time()
    BB, stats = build_building(bld, M, C)
    interior_lights(bld, C)
    facade_uplights(bld, C)
    SB, tree_spots = build_site(bld, M, C, log)
    build_props(bld, M, C, tree_spots, log)
    build_rf_props(bld, M, C, BB)
    tmp = bpy.data.collections.get("_tmp")
    if tmp:
        bpy.data.collections.remove(tmp)
    build_world()
    for name, spec in CAMERAS.items():
        make_camera("CAM_" + name, spec, C)
    setup_render(args)
    log["build_seconds"] = round(time.time() - t0, 2)
    log["objects"] = len(bpy.data.objects)
    log["polygons_building_walls"] = stats
    check_scene(bld, C, log)
    return bld, C, M, g_out, g_fl


def export_glb(path, C):
    """Building + site + context + street furniture, no heat map, no RF markers, no lights."""
    from twin_mats import set_overlay_bypass
    set_overlay_bypass(True)
    keep = ["F0", "F1", "F2", "F0_slab", "F1_slab", "F2_slab", "F0_int", "F1_int", "F2_int", "Roof",
            "Site", "Context", "Trees", "Cars", "Lamps", "Cafe", "UmbrellaOpen"]
    names = set()
    for k in keep:
        for ob in C[k].all_objects:
            if ob.type == "MESH":
                names.add(ob.name)
    for ob in bpy.data.objects:
        ob.select_set(ob.name in names)
    vl = bpy.context.view_layer
    # everything we export must be visible in the view layer
    vl.objects.active = bpy.data.objects[sorted(names)[0]]
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=False,
                              export_lights=False, export_cameras=False, export_yup=True,
                              export_extras=False, export_texcoords=False, export_normals=True)
    set_overlay_bypass(False)
    for ob in bpy.data.objects:
        ob.select_set(False)


def main():
    args = parse_args()
    log = {"args": {k: (v if isinstance(v, (int, float, str, list)) else str(v)) for k, v in vars(args).items()}}
    t_all = time.time()
    bld, C, M, g_out, g_fl = build_all(args, log)
    os.makedirs(args.out, exist_ok=True)
    log["renders"] = {}
    if not args.no_render:
        for v in args.views:
            apply_view(v, C, M, g_out, g_fl)
            path = os.path.join(args.out, "blender_%s%s.png" % (v, args.suffix))
            bpy.context.scene.render.filepath = path
            t0 = time.time()
            bpy.ops.render.render(write_still=True)
            dt = time.time() - t0
            log["renders"][v] = {"file": os.path.relpath(path, ROOT), "seconds": round(dt, 1),
                                 "samples": args.samples, "res": "%dx%d@%d%%" % (args.w, args.h, args.percent)}
            print("RENDERED %s in %.1f s -> %s" % (v, dt, path))
    # leave the file in the hero state
    apply_view("hero", C, M, g_out, g_fl)
    if not args.no_blend:
        p = os.path.join(args.outdir_blend, "twin.blend")
        bpy.ops.wm.save_as_mainfile(filepath=p, compress=True)
        log["blend"] = os.path.relpath(p, ROOT)
    if not args.no_glb:
        p = os.path.join(args.outdir_blend, "twin.glb")
        export_glb(p, C)
        log["glb"] = os.path.relpath(p, ROOT)
    log["total_seconds"] = round(time.time() - t_all, 1)
    with open(os.path.join(args.outdir_blend, "render_log%s.json" % args.suffix), "w", encoding="utf-8") as fh:
        json.dump(log, fh, indent=2)
    print("DONE in %.1f s" % log["total_seconds"])


if __name__ == "__main__":
    main()
