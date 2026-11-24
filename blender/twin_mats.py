"""Materials for the digital-twin renders + the heat-map overlay node group.

Every material is procedural (object/world-space textures), so nothing needs UVs and the .blend
has no external texture dependencies except the RSS field images written next to it.
Nodes are always looked up by type / by our own labels, never by (localised) default names.
"""
import math

import bpy

# --------------------------------------------------------------------------- colour helpers


def srgb_to_lin(c):
    c = float(c)
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexc(h, a=1.0):
    h = h.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))
    return (srgb_to_lin(r), srgb_to_lin(g), srgb_to_lin(b), a)


def scale_c(c, k):
    return (c[0] * k, c[1] * k, c[2] * k, c[3] if len(c) > 3 else 1.0)


# --------------------------------------------------------------------------- tiny node DSL
class NB:
    """Minimal node-tree builder.  Values may be numbers/tuples or output sockets."""

    def __init__(self, nt):
        self.nt = nt
        self.N = nt.nodes
        self.L = nt.links
        self._x = -1400

    def node(self, bl, label=None, **props):
        n = self.N.new(bl)
        n.location = (self._x, 0)
        self._x += 40
        if label:
            n.label = label
        for k, v in props.items():
            setattr(n, k, v)
        return n

    def link(self, src, dst):
        self.L.new(src, dst)

    def feed(self, sock, val):
        if hasattr(val, "is_output") or hasattr(val, "links"):
            self.L.new(val, sock)
        else:
            sock.default_value = val

    def math(self, op, a, b=None, c=None, clamp=False):
        n = self.node("ShaderNodeMath", operation=op, use_clamp=clamp)
        self.feed(n.inputs[0], a)
        if b is not None:
            self.feed(n.inputs[1], b)
        if c is not None:
            self.feed(n.inputs[2], c)
        return n.outputs[0]

    def value(self, v, label):
        n = self.node("ShaderNodeValue", label=label)
        n.outputs[0].default_value = v
        return n.outputs[0]

    def maprange(self, x, a, b, c, d, clamp=True, interp="LINEAR"):
        n = self.node("ShaderNodeMapRange", clamp=clamp, interpolation_type=interp)
        self.feed(n.inputs["Value"], x)
        self.feed(n.inputs["From Min"], a)
        self.feed(n.inputs["From Max"], b)
        self.feed(n.inputs["To Min"], c)
        self.feed(n.inputs["To Max"], d)
        return n.outputs["Result"]

    def sep(self, vec):
        n = self.node("ShaderNodeSeparateXYZ")
        self.feed(n.inputs[0], vec)
        return n.outputs[0], n.outputs[1], n.outputs[2]

    def comb(self, x, y, z):
        n = self.node("ShaderNodeCombineXYZ")
        self.feed(n.inputs[0], x)
        self.feed(n.inputs[1], y)
        self.feed(n.inputs[2], z)
        return n.outputs[0]

    def mixc(self, fac, a, b, blend="MIX"):
        n = self.node("ShaderNodeMix", data_type="RGBA", blend_type=blend)
        self.feed(n.inputs[0], fac)
        self.feed(n.inputs[6], a)
        self.feed(n.inputs[7], b)
        return n.outputs[2]

    def mixs(self, fac, a, b):
        n = self.node("ShaderNodeMixShader")
        self.feed(n.inputs[0], fac)
        self.link(a, n.inputs[1])
        self.link(b, n.inputs[2])
        return n.outputs[0]

    def adds(self, a, b):
        n = self.node("ShaderNodeAddShader")
        self.link(a, n.inputs[0])
        self.link(b, n.inputs[1])
        return n.outputs[0]

    def emission(self, color, strength):
        n = self.node("ShaderNodeEmission")
        self.feed(n.inputs["Color"], color)
        self.feed(n.inputs["Strength"], strength)
        return n.outputs[0]

    def noise(self, vec, scale, detail=4.0, rough=0.55, dims="3D"):
        n = self.node("ShaderNodeTexNoise", noise_dimensions=dims)
        if vec is not None:
            self.feed(n.inputs["Vector"], vec)
        n.inputs["Scale"].default_value = scale
        n.inputs["Detail"].default_value = detail
        n.inputs["Roughness"].default_value = rough
        return n.outputs["Fac"], n.outputs["Color"]

    def coord(self, kind="Object"):
        n = self.node("ShaderNodeTexCoord")
        return n.outputs[kind]

    def geometry(self):
        return self.node("ShaderNodeNewGeometry")

    def bump(self, height, strength, distance=0.02, normal=None):
        n = self.node("ShaderNodeBump")
        n.inputs["Strength"].default_value = strength
        n.inputs["Distance"].default_value = distance
        self.feed(n.inputs["Height"], height)
        if normal is not None:
            self.feed(n.inputs["Normal"], normal)
        return n.outputs["Normal"]


def _new_material(name):
    m = bpy.data.materials.get(name)
    if m:
        bpy.data.materials.remove(m)
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    return m, nt


def _out(nb):
    return nb.node("ShaderNodeOutputMaterial", label="OUT")


def principled(nb, color=(0.8, 0.8, 0.8, 1), rough=0.5, metal=0.0, spec=0.5, coat=0.0):
    p = nb.node("ShaderNodeBsdfPrincipled", label="BSDF")
    nb.feed(p.inputs["Base Color"], color)
    nb.feed(p.inputs["Roughness"], rough)
    p.inputs["Metallic"].default_value = metal
    if "Specular IOR Level" in p.inputs:
        p.inputs["Specular IOR Level"].default_value = spec
    if coat and "Coat Weight" in p.inputs:
        p.inputs["Coat Weight"].default_value = coat
        p.inputs["Coat Roughness"].default_value = 0.05
    return p


# --------------------------------------------------------------------------- material library
def mat_pbr(name, hexcol, rough=0.6, metal=0.0, var=0.06, var_scale=1.6, bump=0.0, bump_scale=40.0,
            spec=0.5, coat=0.0, world=False):
    """Principled with subtle low-frequency colour variation + optional micro bump."""
    m, nt = _new_material(name)
    nb = NB(nt)
    base = hexc(hexcol)
    vec = nb.coord("Object") if not world else nb.geometry().outputs["Position"]
    col = base
    if var > 0:
        f, _ = nb.noise(vec, var_scale, 3.0, 0.5)
        k = nb.maprange(f, 0.3, 0.7, 1.0 - var, 1.0 + var)
        col = nb.mixc(1.0, base, nb.comb(k, k, k), "MULTIPLY")
    p = principled(nb, col, rough, metal, spec, coat)
    if bump > 0:
        f2, _ = nb.noise(vec, bump_scale, 6.0, 0.6)
        nb.link(nb.bump(f2, bump, 0.01), p.inputs["Normal"])
    nb.link(p.outputs[0], _out(nb).inputs["Surface"])
    return m


def mat_tiles(name, hexcol, hex2, size=(0.6, 0.3), mortar=0.006, rough=0.75, var=0.08, bump=0.15, offset=0.5):
    """Paving / tiles from the Brick texture in world XY (works on any horizontal surface)."""
    m, nt = _new_material(name)
    nb = NB(nt)
    pos = nb.geometry().outputs["Position"]
    br = nb.node("ShaderNodeTexBrick", offset=offset, squash=1.0)
    nb.feed(br.inputs["Vector"], pos)
    br.inputs["Color1"].default_value = hexc(hexcol)
    br.inputs["Color2"].default_value = hexc(hex2)
    br.inputs["Mortar"].default_value = scale_c(hexc(hexcol), 0.62)
    br.inputs["Scale"].default_value = 1.0
    br.inputs["Mortar Size"].default_value = mortar
    br.inputs["Mortar Smooth"].default_value = 0.3
    br.inputs["Bias"].default_value = 0.0
    br.inputs["Brick Width"].default_value = size[0]
    br.inputs["Row Height"].default_value = size[1]
    f, _ = nb.noise(pos, 0.35, 3.0, 0.5)
    k = nb.maprange(f, 0.3, 0.7, 1.0 - var, 1.0 + var)
    col = nb.mixc(1.0, br.outputs["Color"], nb.comb(k, k, k), "MULTIPLY")
    p = principled(nb, col, rough)
    if bump > 0:
        nb.link(nb.bump(br.outputs["Fac"], bump, 0.004), p.inputs["Normal"])
    nb.link(p.outputs[0], _out(nb).inputs["Surface"])
    return m


def mat_asphalt(name, hexcol="#2c2e31", rough=0.88):
    m, nt = _new_material(name)
    nb = NB(nt)
    pos = nb.geometry().outputs["Position"]
    f1, _ = nb.noise(pos, 0.08, 3.0, 0.5)
    f2, _ = nb.noise(pos, 9.0, 4.0, 0.7)
    k1 = nb.maprange(f1, 0.3, 0.7, 0.82, 1.15)
    k2 = nb.maprange(f2, 0.2, 0.8, 0.9, 1.1)
    k = nb.math("MULTIPLY", k1, k2)
    col = nb.mixc(1.0, hexc(hexcol), nb.comb(k, k, k), "MULTIPLY")
    p = principled(nb, col, rough, spec=0.35)
    f3, _ = nb.noise(pos, 140.0, 2.0, 0.5)
    nb.link(nb.bump(f3, 0.25, 0.004), p.inputs["Normal"])
    nb.link(p.outputs[0], _out(nb).inputs["Surface"])
    return m


def mat_grass(name, hex1="#56733a", hex2="#7b8f45", rough=0.95):
    m, nt = _new_material(name)
    nb = NB(nt)
    pos = nb.geometry().outputs["Position"]
    f1, _ = nb.noise(pos, 0.12, 4.0, 0.55)
    f2, _ = nb.noise(pos, 3.0, 3.0, 0.6)
    t = nb.math("ADD", nb.math("MULTIPLY", f1, 0.75), nb.math("MULTIPLY", f2, 0.25))
    t = nb.maprange(t, 0.35, 0.65, 0.0, 1.0)
    col = nb.mixc(t, hexc(hex1), hexc(hex2))
    p = principled(nb, col, rough, spec=0.25)
    f3, _ = nb.noise(pos, 60.0, 2.0, 0.5)
    nb.link(nb.bump(f3, 0.35, 0.01), p.inputs["Normal"])
    nb.link(p.outputs[0], _out(nb).inputs["Surface"])
    return m


def mat_wood(name, hexcol="#9a6b43", scale=6.0, rough=0.55, axis="X"):
    m, nt = _new_material(name)
    nb = NB(nt)
    vec = nb.coord("Object")
    w = nb.node("ShaderNodeTexWave", wave_type="BANDS", bands_direction=axis)
    nb.feed(w.inputs["Vector"], vec)
    w.inputs["Scale"].default_value = scale
    w.inputs["Distortion"].default_value = 6.0
    w.inputs["Detail"].default_value = 3.0
    base = hexc(hexcol)
    col = nb.mixc(nb.maprange(w.outputs["Fac"], 0, 1, 0.0, 0.35), base, scale_c(base, 0.62))
    p = principled(nb, col, rough)
    nb.link(p.outputs[0], _out(nb).inputs["Surface"])
    return m


def mat_glass(name, tint="#dbe9ee", rough=0.0, ior=1.5, reflect_boost=1.0):
    """Clear glazing.  Shadow rays pass straight through (no black interiors / caustics)."""
    m, nt = _new_material(name)
    nb = NB(nt)
    p = principled(nb, hexc(tint), rough)
    p.inputs["Transmission Weight"].default_value = 1.0
    p.inputs["IOR"].default_value = ior
    if "Specular IOR Level" in p.inputs:
        p.inputs["Specular IOR Level"].default_value = 0.5 * reflect_boost
    tr = nb.node("ShaderNodeBsdfTransparent")
    tr.inputs["Color"].default_value = hexc(tint)
    lp = nb.node("ShaderNodeLightPath")
    s = nb.mixs(lp.outputs["Is Shadow Ray"], p.outputs[0], tr.outputs[0])
    nb.link(s, _out(nb).inputs["Surface"])
    m.use_backface_culling = False
    try:
        m.surface_render_method = "BLENDED"
    except Exception:
        pass
    return m


def mat_emit(name, hexcol, strength, base_hex=None, sampling="AUTO"):
    m, nt = _new_material(name)
    nb = NB(nt)
    e = nb.emission(hexc(hexcol), nb.value(strength, "strength"))
    if base_hex:
        p = principled(nb, hexc(base_hex), 0.4)
        e = nb.adds(p.outputs[0], e)
    nb.link(e, _out(nb).inputs["Surface"])
    try:
        m.cycles.emission_sampling = sampling
    except Exception:
        pass
    return m


def mat_halo(name, hexcol, strength):
    """Soft glowing bubble: emission seen face-on fades towards the silhouette (no light emission)."""
    m, nt = _new_material(name)
    nb = NB(nt)
    lw = nb.node("ShaderNodeLayerWeight")
    lw.inputs["Blend"].default_value = 0.5
    fac = nb.math("POWER", nb.math("SUBTRACT", 1.0, lw.outputs["Facing"]), 2.2)
    e = nb.emission(hexc(hexcol), nb.math("MULTIPLY", fac, nb.value(strength, "strength")))
    tr = nb.node("ShaderNodeBsdfTransparent")
    s = nb.adds(tr.outputs[0], e)
    nb.link(s, _out(nb).inputs["Surface"])
    try:
        m.cycles.emission_sampling = "NONE"
        m.surface_render_method = "BLENDED"
    except Exception:
        pass
    return m


def mat_ghost(name, hexcol, alpha):
    """X-ray ghost for removed parts in the cutaway: faint body, brighter silhouette edges."""
    m, nt = _new_material(name)
    nb = NB(nt)
    lw = nb.node("ShaderNodeLayerWeight")
    lw.inputs["Blend"].default_value = 0.35
    p = principled(nb, hexc(hexcol), 0.5)
    tr = nb.node("ShaderNodeBsdfTransparent")
    fac = nb.math("ADD", alpha, nb.math("MULTIPLY", lw.outputs["Facing"], 0.35))
    s = nb.mixs(nb.math("MINIMUM", fac, 0.7), tr.outputs[0], p.outputs[0])
    e = nb.emission(hexc(hexcol), nb.math("MULTIPLY", lw.outputs["Facing"], 0.25))
    s = nb.adds(s, e)
    nb.link(s, _out(nb).inputs["Surface"])
    try:
        m.cycles.emission_sampling = "NONE"
    except Exception:
        pass
    return m


def mat_car_paint(name):
    """Car paint coloured by Object Color (ob.color) so 29 cars share one material."""
    m, nt = _new_material(name)
    nb = NB(nt)
    oi = nb.node("ShaderNodeObjectInfo")
    p = principled(nb, oi.outputs["Color"], 0.32, 0.35, 0.5, coat=1.0)
    nb.link(p.outputs[0], _out(nb).inputs["Surface"])
    return m


def mat_foliage(name, hex1="#3f6b2f", hex2="#7a9a3c"):
    """Low-poly canopy; per-object random hue so the trees don't look cloned."""
    m, nt = _new_material(name)
    nb = NB(nt)
    oi = nb.node("ShaderNodeObjectInfo")
    pos = nb.coord("Object")
    f, _ = nb.noise(pos, 2.2, 2.0, 0.5)
    t = nb.math("ADD", nb.math("MULTIPLY", oi.outputs["Random"], 0.7), nb.math("MULTIPLY", f, 0.3))
    col = nb.mixc(t, hexc(hex1), hexc(hex2))
    p = principled(nb, col, 0.8, spec=0.3)
    if "Subsurface Weight" in p.inputs:
        p.inputs["Subsurface Weight"].default_value = 0.05
    nb.link(p.outputs[0], _out(nb).inputs["Surface"])
    return m


def mat_screen(name, strength=2.2):
    """Laptop screen: dark terminal with glowing green 'code' lines."""
    m, nt = _new_material(name)
    nb = NB(nt)
    uv = nb.coord("Object")
    br = nb.node("ShaderNodeTexBrick", offset=0.5, squash=1.0)
    nb.feed(br.inputs["Vector"], uv)
    br.inputs["Color1"].default_value = hexc("#59ff9c")
    br.inputs["Color2"].default_value = hexc("#2fd3ff")
    br.inputs["Mortar"].default_value = (0.004, 0.006, 0.008, 1)
    br.inputs["Scale"].default_value = 1.0
    br.inputs["Mortar Size"].default_value = 0.004
    br.inputs["Brick Width"].default_value = 0.05
    br.inputs["Row Height"].default_value = 0.012
    br.inputs["Bias"].default_value = -0.6
    e = nb.emission(br.outputs["Color"], strength)
    nb.link(e, _out(nb).inputs["Surface"])
    return m


def mat_context_facade(name, wall_hex, glass_hex="#1d242b", pitch=3.0, win_w=0.55, floor_h=3.4,
                       win_h=0.55, z_min=0.0, z_max=100.0, lit_frac=0.45, lit_strength=3.0,
                       storefront_h=0.0, ribbon=False, warm="#ffc98a", storefront_dir=None):
    """Massing facade with a procedural window grid (world space) and randomly lit windows.

    Window cells are found from the world position along the facade (x or y, picked from the face
    normal) and z.  'lit' (label) and 'lit_strength' (label) Value nodes are switched per preset.
    """
    m, nt = _new_material(name)
    nb = NB(nt)
    geo = nb.geometry()
    px, py, pz = nb.sep(geo.outputs["Position"])
    nx, ny, nz = nb.sep(geo.outputs["Normal"])
    along_y = nb.math("GREATER_THAN", nb.math("ABSOLUTE", nx), 0.5)
    u = nb.math("ADD", px, nb.math("MULTIPLY", along_y, nb.math("SUBTRACT", py, px)))
    vertical = nb.math("LESS_THAN", nb.math("ABSOLUTE", nz), 0.3)
    # cell coordinates
    cu = nb.math("DIVIDE", u, pitch)
    cz = nb.math("DIVIDE", pz, floor_h)
    fu = nb.math("FRACT", cu)
    fz = nb.math("FRACT", cz)
    hu = (1.0 - win_w) * 0.5
    in_u = nb.math("MULTIPLY", nb.math("GREATER_THAN", fu, hu), nb.math("LESS_THAN", fu, 1.0 - hu))
    if ribbon:
        in_u = nb.math("GREATER_THAN", nb.math("FRACT", nb.math("DIVIDE", u, 1.5)), 0.04)
    lo = 0.28
    in_z = nb.math("MULTIPLY", nb.math("GREATER_THAN", fz, lo), nb.math("LESS_THAN", fz, lo + win_h))
    win = nb.math("MULTIPLY", in_u, in_z)
    win = nb.math("MULTIPLY", win, vertical)
    zok = nb.math("MULTIPLY", nb.math("GREATER_THAN", pz, z_min + storefront_h), nb.math("LESS_THAN", pz, z_max - 0.9))
    win = nb.math("MULTIPLY", win, zok)
    # storefront band
    store = None
    if storefront_h > 0:
        sb = nb.math("MULTIPLY", nb.math("GREATER_THAN", pz, 0.35), nb.math("LESS_THAN", pz, storefront_h - 0.45))
        mull = nb.math("GREATER_THAN", nb.math("FRACT", nb.math("DIVIDE", u, 3.0)), 0.035)
        store = nb.math("MULTIPLY", nb.math("MULTIPLY", sb, mull), vertical)
        if storefront_dir is not None:      # only the street-facing side has shop fronts
            facing = nb.math("ADD", nb.math("MULTIPLY", nx, storefront_dir[0]), nb.math("MULTIPLY", ny, storefront_dir[1]))
            store = nb.math("MULTIPLY", store, nb.math("GREATER_THAN", facing, 0.5))
        win = nb.math("MAXIMUM", win, store)
    # random lit cells
    oi = nb.node("ShaderNodeObjectInfo")
    cell = nb.node("ShaderNodeVectorMath", operation="ADD")
    nb.feed(cell.inputs[0], nb.comb(nb.math("FLOOR", cu), nb.math("FLOOR", cz), nb.math("FLOOR", nb.math("MULTIPLY", along_y, 7.0))))
    nb.feed(cell.inputs[1], nb.comb(nb.math("MULTIPLY", oi.outputs["Random"], 113.0), 0.0, 0.0))
    wn = nb.node("ShaderNodeTexWhiteNoise", noise_dimensions="3D")
    nb.feed(wn.inputs["Vector"], cell.outputs[0])
    lit_val = nb.value(lit_frac, "lit")
    lit = nb.math("GREATER_THAN", wn.outputs["Value"], nb.math("SUBTRACT", 1.0, lit_val))
    if store is not None:
        lit = nb.math("MAXIMUM", lit, nb.math("MULTIPLY", store, nb.math("GREATER_THAN", lit_val, 0.05)))
    warmth = nb.mixc(nb.math("FRACT", nb.math("MULTIPLY", wn.outputs["Value"], 7.13)), hexc(warm), hexc("#fff1d6"))
    # shaders
    f, _ = nb.noise(geo.outputs["Position"], 0.9, 3.0, 0.5)
    k = nb.maprange(f, 0.3, 0.7, 0.93, 1.07)
    wall_col = nb.mixc(1.0, hexc(wall_hex), nb.comb(k, k, k), "MULTIPLY")
    pw = principled(nb, wall_col, 0.82)
    pg = principled(nb, hexc(glass_hex), 0.08, 0.0, 0.9)
    lstr = nb.value(lit_strength, "lit_strength")
    em = nb.emission(warmth, nb.math("MULTIPLY", lit, lstr))
    glass = nb.adds(pg.outputs[0], em)
    s = nb.mixs(win, pw.outputs[0], glass)
    nb.link(s, _out(nb).inputs["Surface"])
    try:
        m.cycles.emission_sampling = "NONE"
    except Exception:
        pass
    return m


# --------------------------------------------------------------------------- heat-map overlay
TURBO_STOPS = 32


def turbo_ramp(ramp_node, turbo_fn):
    """Fill a ColorRamp with the turbo colormap (scene-linear colours)."""
    els = ramp_node.color_ramp.elements
    while len(els) > 1:
        els.remove(els[-1])
    import numpy as np
    xs = np.linspace(0.0, 1.0, TURBO_STOPS)
    cols = turbo_fn(xs)
    els[0].position = 0.0
    els[0].color = tuple(srgb_to_lin(c) for c in cols[0]) + (1.0,)
    for x, c in zip(xs[1:], cols[1:]):
        e = els.new(float(x))
        e.color = tuple(srgb_to_lin(v) for v in c) + (1.0,)
    ramp_node.color_ramp.interpolation = "LINEAR"


def overlay_group(name, field_img, bounds, turbo_fn, vmin=-100.0, vmax=-30.0, line=True,
                  mask_rect=None, edge_fade=6.0, line_hex="#ff2d55"):
    """Shader node group:  Shader in -> Shader out, adds the RSS heat map draped in world XY.

    field_img: float image, R = RSS (dBm), G = signed distance (m) to the eavesdrop contour.
    bounds   : (x0, y0, x1, y1) of the image in world metres.
    Labelled Value nodes (set per view): 'opacity', 'heat_strength', 'line_strength', 'line_width'.
    """
    ng = bpy.data.node_groups.get(name)
    if ng:
        bpy.data.node_groups.remove(ng)
    ng = bpy.data.node_groups.new(name, "ShaderNodeTree")
    ng.interface.new_socket("Shader", in_out="INPUT", socket_type="NodeSocketShader")
    alb = ng.interface.new_socket("Albedo", in_out="INPUT", socket_type="NodeSocketColor")
    alb.default_value = (0.3, 0.3, 0.3, 1.0)
    ng.interface.new_socket("Shader", in_out="OUTPUT", socket_type="NodeSocketShader")
    nb = NB(ng)
    gi = nb.node("NodeGroupInput")
    go = nb.node("NodeGroupOutput")
    x0, y0, x1, y1 = bounds
    px, py, _ = nb.sep(nb.geometry().outputs["Position"])
    u = nb.math("DIVIDE", nb.math("SUBTRACT", px, x0), x1 - x0)
    v = nb.math("DIVIDE", nb.math("SUBTRACT", py, y0), y1 - y0)
    tex = nb.node("ShaderNodeTexImage", interpolation="Linear", extension="EXTEND")
    tex.image = field_img
    nb.feed(tex.inputs["Vector"], nb.comb(u, v, 0.0))
    sc = nb.node("ShaderNodeSeparateColor")
    nb.link(tex.outputs["Color"], sc.inputs[0])
    rss, sd = sc.outputs[0], sc.outputs[1]
    # colour
    t = nb.maprange(rss, vmin, vmax, 0.0, 1.0)
    ramp = nb.node("ShaderNodeValToRGB", label="turbo")
    turbo_ramp(ramp, turbo_fn)
    nb.link(t, ramp.inputs[0])
    # alpha: fade below the colour range, fade at the edges of the study area
    alpha = nb.maprange(rss, vmin - 12.0, vmin, 0.0, 1.0)
    inside_u = nb.math("MINIMUM", nb.math("MULTIPLY", u, x1 - x0), nb.math("MULTIPLY", nb.math("SUBTRACT", 1.0, u), x1 - x0))
    inside_v = nb.math("MINIMUM", nb.math("MULTIPLY", v, y1 - y0), nb.math("MULTIPLY", nb.math("SUBTRACT", 1.0, v), y1 - y0))
    if edge_fade > 0:
        edge = nb.maprange(nb.math("MINIMUM", inside_u, inside_v), 0.0, edge_fade, 0.0, 1.0, interp="SMOOTHSTEP")
        alpha = nb.math("MULTIPLY", alpha, edge)
    else:
        edge = 1.0
    if mask_rect is not None:
        mx0, my0, mx1, my1 = mask_rect
        mk = nb.math("MULTIPLY",
                     nb.math("MULTIPLY", nb.math("GREATER_THAN", px, mx0), nb.math("LESS_THAN", px, mx1)),
                     nb.math("MULTIPLY", nb.math("GREATER_THAN", py, my0), nb.math("LESS_THAN", py, my1)))
        alpha = nb.math("MULTIPLY", alpha, mk)
    opac = nb.value(0.78, "opacity")
    alpha = nb.math("MULTIPLY", alpha, opac)
    hs = nb.value(1.0, "heat_strength")
    # projected-light look: the colour is modulated by the surface albedo, so lane markings,
    # paving joints and curbs stay readable under the map
    bw = nb.node("ShaderNodeRGBToBW")
    nb.link(gi.outputs[1], bw.inputs[0])
    amod = nb.maprange(bw.outputs[0], 0.02, 0.55, 0.62, 1.35)
    am = nb.value(1.0, "albedo_mix")
    amod = nb.math("ADD", 1.0, nb.math("MULTIPLY", am, nb.math("SUBTRACT", amod, 1.0)))
    em = nb.emission(ramp.outputs["Color"], nb.math("MULTIPLY", hs, amod))
    # keep some of the ground's own shading under the colour (reads as 'draped', not painted)
    shaded = nb.mixs(alpha, gi.outputs[0], em)
    # faint iso-lines every few dB (B channel = distance in metres to the nearest iso level)
    iw = nb.value(0.10, "iso_width")
    istr = nb.value(0.8, "iso_strength")
    ih = nb.math("MULTIPLY", iw, 0.5)
    iso = nb.math("SUBTRACT", 1.0, nb.maprange(sc.outputs[2], ih, nb.math("ADD", ih, 0.05), 0.0, 1.0, interp="SMOOTHSTEP"))
    iso = nb.math("MULTIPLY", iso, alpha)
    iso_em = nb.emission(ramp.outputs["Color"], nb.math("MULTIPLY", iso, istr))
    shaded = nb.adds(shaded, iso_em)
    out = shaded
    if line:
        lw = nb.value(0.32, "line_width")
        ls = nb.value(8.0, "line_strength")
        ad = nb.math("ABSOLUTE", sd)
        half = nb.math("MULTIPLY", lw, 0.5)
        core = nb.math("SUBTRACT", 1.0, nb.maprange(ad, half, nb.math("ADD", half, 0.06), 0.0, 1.0, interp="SMOOTHSTEP"))
        core = nb.math("MULTIPLY", core, edge)
        # soft glow on the dangerous (high-RSS) side of the contour
        glow = nb.math("MULTIPLY", nb.maprange(sd, 0.0, 2.2, 0.32, 0.0, interp="SMOOTHERSTEP"),
                       nb.math("GREATER_THAN", sd, 0.0))
        glow = nb.math("MULTIPLY", glow, edge)
        red = hexc(line_hex)
        line_em = nb.emission(red, ls)
        glow_em = nb.emission(red, nb.math("MULTIPLY", nb.math("MULTIPLY", glow, ls), 0.35))
        out = nb.mixs(nb.math("MULTIPLY", core, nb.math("GREATER_THAN", ls, 0.0)), shaded, line_em)
        out = nb.adds(out, glow_em)
    nb.link(out, go.inputs[0])
    return ng


def wrap_with_group(mat, group):
    """Insert a Shader->Shader group between the surface shader and the Material Output."""
    nt = mat.node_tree
    out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
    if not out.inputs["Surface"].links:
        return None
    src = out.inputs["Surface"].links[0].from_socket
    g = nt.nodes.new("ShaderNodeGroup")
    g.node_tree = group
    g.label = "OVERLAY:" + group.name
    g.location = (out.location.x - 200, out.location.y - 200)
    nt.links.new(src, g.inputs[0])
    nt.links.new(g.outputs[0], out.inputs["Surface"])
    bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is not None and len(g.inputs) > 1:
        bc = bsdf.inputs["Base Color"]
        if bc.links:
            nt.links.new(bc.links[0].from_socket, g.inputs[1])
        else:
            g.inputs[1].default_value = bc.default_value
    return g


def set_overlay_bypass(bypass):
    """True: link the base shader straight to the output (for glTF export); False: through the overlay."""
    for m in bpy.data.materials:
        if not m.node_tree:
            continue
        nt = m.node_tree
        gs = [n for n in nt.nodes if n.type == "GROUP" and n.label.startswith("OVERLAY:")]
        if not gs:
            continue
        out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
        g = gs[0]
        if bypass:
            if g.inputs[0].links:
                nt.links.new(g.inputs[0].links[0].from_socket, out.inputs["Surface"])
        else:
            nt.links.new(g.outputs[0], out.inputs["Surface"])


def set_group_value(group, label, value):
    for n in group.nodes:
        if n.type == "VALUE" and n.label == label:
            n.outputs[0].default_value = value
            return True
    return False


def set_material_value(mat, label, value):
    ok = False
    for n in mat.node_tree.nodes:
        if n.type == "VALUE" and n.label == label:
            n.outputs[0].default_value = value
            ok = True
    return ok
