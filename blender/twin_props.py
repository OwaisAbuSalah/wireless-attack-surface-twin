"""Props: low-poly trees and cars, street lamps, café furniture, the attacker, the access point and
the client devices.  Repeated props share one mesh (linked duplicates) to keep the file small.
"""
import math
import random

import bpy
from mathutils import Matrix, Vector

from twin_mesh import MeshBuilder

TABLE_H = 0.75


def place(name, mesh, coll, loc, yaw=0.0, scale=1.0, color=None):
    ob = bpy.data.objects.new(name, mesh)
    ob.location = loc
    ob.rotation_euler = (0.0, 0.0, yaw)
    ob.scale = (scale, scale, scale)
    if color is not None:
        ob.color = color
    coll.objects.link(ob)
    return ob


def mesh_from(mb, materials, name=None):
    """Build a mesh datablock (not an object) from a MeshBuilder."""
    tmp = bpy.data.collections.get("_tmp") or bpy.data.collections.new("_tmp")
    ob = mb.to_object(tmp, materials, name=name)
    me = ob.data
    bpy.data.objects.remove(ob)
    return me


# ----------------------------------------------------------------------------- trees
def tree_meshes(materials, n_var=5, seed=21):
    rng = random.Random(seed)
    out = []
    for k in range(n_var):
        mb = MeshBuilder("TreeMesh%d" % k)
        columnar = k == n_var - 1
        h = 2.3 + rng.uniform(-0.2, 0.3)
        mb.cylinder((0, 0, 0), (0, 0, h + 0.6), 0.17, "bark", segs=7, r1=0.09, smooth=False)
        if columnar:
            mb.icosphere((0, 0, h + 1.9), 1.15, "foliage", subdiv=1, scale=(1, 1, 1.9), jitter=0.12, rng=rng)
        else:
            mb.icosphere((0, 0, h + 1.2), 1.75, "foliage", subdiv=1, scale=(1, 1, 0.82), jitter=0.13, rng=rng)
            for _ in range(3):
                a = rng.uniform(0, 2 * math.pi)
                r = rng.uniform(0.6, 0.95)
                mb.icosphere((r * math.cos(a), r * math.sin(a), h + rng.uniform(0.7, 1.7)), rng.uniform(0.9, 1.2),
                             "foliage", subdiv=1, scale=(1, 1, 0.85), jitter=0.15, rng=rng)
        out.append(mesh_from(mb, materials))
    return out


# ----------------------------------------------------------------------------- cars
def car_mesh(materials, lights_on=False, name="CarMesh"):
    mb = MeshBuilder(name)
    paint = "car_paint"
    # lower body (side profile in x-z, extruded across y)
    body = [(-2.18, 0.30), (2.10, 0.30), (2.20, 0.50), (2.16, 0.70), (1.95, 0.82), (0.95, 0.94),
            (-1.70, 0.98), (-2.12, 0.92), (-2.22, 0.62)]
    mb.prism(body, -0.89, 0.89, paint)
    # greenhouse
    cab = [(0.98, 0.93), (0.10, 1.40), (-1.20, 1.42), (-1.86, 0.97)]
    s0 = len(mb.faces)
    mb.prism(cab, -0.78, 0.78, "car_glass")
    # roof panel in paint, a hair above the glass
    mb.prism([(0.16, 1.40), (-1.16, 1.42), (-1.18, 1.445), (0.12, 1.425)], -0.74, 0.74, paint)
    # B-pillars
    mb.box(-0.48, -0.785, 0.95, -0.36, 0.785, 1.40, paint)
    # wheels
    for x in (-1.38, 1.36):
        for sy in (-1, 1):
            y = sy * 0.80
            mb.cylinder((x, y - 0.115, 0.33), (x, y + 0.115, 0.33), 0.33, "tyre", segs=16)
            mb.cylinder((x, y + sy * 0.116, 0.33), (x, y + sy * 0.125, 0.33), 0.2, "rim", segs=16)
    # lights
    hl = "headlight_on" if lights_on else "headlight"
    tl = "taillight_on" if lights_on else "taillight"
    for sy in (-1, 1):
        mb.box(2.12, sy * 0.52, 0.58, 2.19, sy * 0.78, 0.69, hl)
        mb.box(-2.235, sy * 0.50, 0.70, -2.18, sy * 0.80, 0.80, tl)
    mb.box(2.15, -0.45, 0.36, 2.2, 0.45, 0.48, "car_trim")
    mb.box(-2.24, -0.82, 0.36, -2.19, 0.82, 0.5, "car_trim")
    return mesh_from(mb, materials)


# ----------------------------------------------------------------------------- street furniture
def lamp_mesh(materials, kind="street"):
    mb = MeshBuilder("Lamp_" + kind)
    if kind == "bollard":
        mb.cylinder((0, 0, 0), (0, 0, 0.82), 0.09, "lamp_pole", segs=12)
        mb.cylinder((0, 0, 0.82), (0, 0, 0.98), 0.085, "lamp_glow", segs=12)
        mb.cylinder((0, 0, 0.98), (0, 0, 1.03), 0.1, "lamp_pole", segs=12)
        return mesh_from(mb, materials), [(0, 0, 0.9)]
    h = 7.0 if kind == "street" else 5.6
    mb.cylinder((0, 0, 0), (0, 0, 0.6), 0.13, "lamp_pole", segs=10)
    mb.cylinder((0, 0, 0.6), (0, 0, h), 0.075, "lamp_pole", segs=10, r1=0.05)
    heads = []
    arms = (1,) if kind == "street" else (1, -1)
    for sgn in arms:
        L = 1.5 if kind == "street" else 0.9
        mb.box(0, -0.03, h - 0.12, sgn * L, 0.03, h - 0.06, "lamp_pole")
        hx = sgn * (L + 0.25)
        mb.box(hx - 0.38, -0.15, h - 0.2, hx + 0.38, 0.15, h - 0.04, "lamp_head", {"-z": "lamp_glow"})
        heads.append((hx, 0.0, h - 0.21))
    return mesh_from(mb, materials), heads


def cafe_set_meshes(materials):
    """(table+chairs, umbrella_open, umbrella_closed)."""
    mb = MeshBuilder("CafeTable")
    mb.cylinder((0, 0, TABLE_H - 0.03), (0, 0, TABLE_H), 0.42, "table_top", segs=24)
    mb.cylinder((0, 0, 0), (0, 0, TABLE_H - 0.03), 0.04, "lamp_pole", segs=8)
    mb.cylinder((0, 0, 0), (0, 0, 0.03), 0.24, "lamp_pole", segs=16)
    for k in range(4):
        a = k * math.pi / 2
        cx, cy = 0.74 * math.cos(a), 0.74 * math.sin(a)
        mb.cylinder((cx, cy, 0.43), (cx, cy, 0.46), 0.21, "chair_seat", segs=16)
        for j in range(4):
            b = j * math.pi / 2 + math.pi / 4
            lx, ly = cx + 0.15 * math.cos(b), cy + 0.15 * math.sin(b)
            mb.cylinder((lx, ly, 0), (lx, ly, 0.43), 0.012, "lamp_pole", segs=6)
        bx, by = cx + 0.2 * math.cos(a), cy + 0.2 * math.sin(a)
        u = Vector((-math.sin(a), math.cos(a), 0))
        V = Vector((0, 0, 1))
        W = u.cross(V)
        mb.obox((bx, by, 0.46), u, V, W, -0.19, 0.19, 0.12, 0.42, -0.012, 0.012, "chair_seat")
    table = mesh_from(mb, materials)
    up = MeshBuilder("UmbrellaOpen")
    up.cylinder((0, 0, 0), (0, 0, 2.55), 0.022, "lamp_pole", segs=8)
    up.cylinder((0, 0, 2.08), (0, 0, 2.52), 1.38, "umbrella", segs=8, r1=0.03, cap0=False, smooth=False)
    up.cylinder((0, 0, 1.98), (0, 0, 2.08), 1.38, "umbrella", segs=8, cap0=False, cap1=False, smooth=False)
    uo = mesh_from(up, materials)
    uc = MeshBuilder("UmbrellaClosed")
    uc.cylinder((0, 0, 0), (0, 0, 2.6), 0.022, "lamp_pole", segs=8)
    uc.cylinder((0, 0, 1.2), (0, 0, 2.25), 0.03, "umbrella_closed", segs=8, r1=0.085, smooth=True)
    uc.cylinder((0, 0, 2.25), (0, 0, 2.45), 0.085, "umbrella_closed", segs=8, r1=0.02, cap0=False, smooth=True)
    uc.cylinder((0, 0, 1.75), (0, 0, 1.79), 0.075, "lamp_pole", segs=8)
    uc.cylinder((0, 0, 1.05), (0, 0, 1.15), 0.05, "lamp_pole", segs=8)
    ucl = mesh_from(uc, materials)
    return table, uo, ucl


def string_lights(mb, p0, p1, sag, spacing, z_bulb_mat="bulb"):
    """Festoon between two pole tops; returns bulb positions."""
    p0, p1 = Vector(p0), Vector(p1)
    L = (p1 - p0).length
    n = max(2, int(L / spacing))
    pts = []
    for i in range(n + 1):
        t = i / n
        p = p0.lerp(p1, t)
        p.z -= 4 * sag * t * (1 - t)
        pts.append(p)
    for i in range(n):
        mb.cylinder(pts[i], pts[i + 1], 0.006, "wire", segs=4, cap0=False, cap1=False)
    for p in pts[1:-1]:
        mb.icosphere((p.x, p.y, p.z - 0.07), 0.04, z_bulb_mat, subdiv=1)
        mb.cylinder((p.x, p.y, p.z), (p.x, p.y, p.z - 0.04), 0.008, "wire", segs=4)
    return pts


# ----------------------------------------------------------------------------- attacker
def _squircle(cx, cy, z, w, d, n=12, p=0.55):
    pts = []
    for k in range(n):
        a = 2 * math.pi * k / n
        c, s = math.cos(a), math.sin(a)
        pts.append((cx + 0.5 * w * math.copysign(abs(c) ** p, c), cy + 0.5 * d * math.copysign(abs(s) ** p, s), z))
    return pts


def attacker(coll, materials, origin, yaw, lean_deg=13.0):
    """Seated hooded figure (stylised mannequin) facing +y, hands on a laptop.

    origin = chair centre on the deck.  Built from lofted / primitive cages that a Subdivision
    modifier smooths -- same low-poly-but-clean language as the trees and cars.
    """
    mb = MeshBuilder("Attacker")
    hip = Vector((0, 0, 0.50))
    L = Matrix.Translation(hip) @ Matrix.Rotation(math.radians(-lean_deg), 4, "X") @ Matrix.Translation(-hip)

    def lp(p):
        return L @ Vector(p)

    # torso (upright cage, then leaned forward about the hips)
    s0 = len(mb.verts)
    rings = [_squircle(0, 0.0, 0.47, 0.36, 0.27), _squircle(0, 0.0, 0.62, 0.35, 0.25),
             _squircle(0, 0.0, 0.80, 0.38, 0.25), _squircle(0, -0.01, 0.95, 0.44, 0.25),
             _squircle(0, -0.02, 1.04, 0.38, 0.20), _squircle(0, -0.01, 1.09, 0.17, 0.13)]
    mb.loft(rings, "hoodie")
    # kangaroo pocket
    mb.box(-0.12, 0.10, 0.60, 0.12, 0.135, 0.70, "hoodie")
    # hood bunched behind the neck + hood around the head
    mb.icosphere((0, -0.05, 1.10), 0.12, "hoodie", subdiv=2, scale=(1.35, 0.85, 0.7), smooth=True)
    head = Vector((0, 0.02, 1.25))
    # hood: a cowl around the head; a dark opening and the face just proud of it
    mb.icosphere(head + Vector((0, -0.028, 0.016)), 0.14, "hoodie", subdiv=2, scale=(0.95, 1.12, 1.08), smooth=True)
    mb.icosphere(head + Vector((0, 0.068, -0.018)), 0.1, "hood_inner", subdiv=2, scale=(0.80, 0.66, 1.0), smooth=True)
    mb.icosphere(head + Vector((0, 0.088, -0.03)), 0.08, "skin", subdiv=2, scale=(0.74, 0.62, 0.96), smooth=True)
    mb.cylinder((0, -0.01, 1.04), (0, 0.0, 1.16), 0.075, "hoodie", segs=10)
    # hoodie drawstrings
    for sx in (-1, 1):
        mb.cylinder(head + Vector((sx * 0.035, 0.115, -0.11)), head + Vector((sx * 0.04, 0.15, -0.26)), 0.006, "hood_string", segs=6)
    mb.transform_since(s0, L)

    # arms (shoulders follow the lean; hands rest on the keyboard)
    for sx in (-1, 1):
        sh = lp((sx * 0.195, -0.01, 0.995))
        el = Vector((sx * 0.225, 0.20, 0.80))
        wr = Vector((sx * 0.125, 0.43, 0.79))
        mb.cylinder(sh + (sh - el).normalized() * 0.03, el + (el - sh).normalized() * 0.02, 0.056, "hoodie", segs=10, r1=0.048)
        mb.cylinder(el - (wr - el).normalized() * 0.02, wr, 0.047, "hoodie", segs=10, r1=0.043)
        mb.icosphere(wr + Vector((sx * -0.008, 0.055, -0.004)), 0.042, "skin", subdiv=2, scale=(0.85, 1.3, 0.48), smooth=True)
        # legs
        hp = Vector((sx * 0.10, 0.02, 0.55))
        kn = Vector((sx * 0.115, 0.44, 0.56))
        an = Vector((sx * 0.115, 0.50, 0.12))
        mb.cylinder(hp, kn + (kn - hp).normalized() * 0.03, 0.075, "jeans", segs=10, r1=0.062)
        mb.cylinder(kn + Vector((0, 0.02, 0.02)), an, 0.058, "jeans", segs=10, r1=0.046)
        mb.box(sx * 0.115 - 0.048, an.y - 0.08, 0.0, sx * 0.115 + 0.048, an.y + 0.16, 0.09, "shoe")
    ob = mb.to_object(coll, materials)
    ob.data.polygons.foreach_set("use_smooth", [True] * len(ob.data.polygons))
    sd = ob.modifiers.new("Subdivision", "SUBSURF")
    sd.levels = 1
    sd.render_levels = 2
    ob.matrix_world = Matrix.Translation(Vector(origin)) @ Matrix.Rotation(yaw, 4, "Z")
    return [ob]


def laptop(mb, x, y, z, yaw, screen_mat="screen", w=0.34, d=0.24, tilt_deg=108, antenna=False):
    """Laptop with the hinge on the far side (+y local); screen faces -y (the user)."""
    start = len(mb.verts)
    mb.box(-w / 2, -d / 2, 0, w / 2, d / 2, 0.018, "laptop_shell", {"+z": "laptop_deck"})
    t = math.radians(tilt_deg)
    U = Vector((1, 0, 0))
    V = Vector((0, -math.cos(t), math.sin(t)))       # up the lid
    W = U.cross(V)
    mb.obox((0, d / 2 - 0.005, 0.016), U, V, W, -w / 2, w / 2, 0, d * 0.95, 0, 0.007, "laptop_shell",
            {"+z": screen_mat})          # +W faces the user (-y) -> that is the display
    if antenna:
        # USB Wi-Fi adapter on the right side + its 5 dBi whip
        mb.box(w / 2, -0.02, 0.002, w / 2 + 0.045, 0.01, 0.016, "car_trim")
        mb.cylinder((w / 2 + 0.04, -0.005, 0.016), (w / 2 + 0.06, 0.0, 0.215), 0.0065, "car_trim", segs=8)
        mb.icosphere((w / 2 + 0.06, 0.0, 0.215), 0.009, "car_trim", subdiv=1)
    M = Matrix.Translation(Vector((x, y, z))) @ Matrix.Rotation(yaw, 4, "Z")
    mb.transform_since(start, M)


# ----------------------------------------------------------------------------- access point
def router(mb, pos, wall_y_face, facing=+1):
    """White AP on a small wall shelf.  facing=+1: the room is on +y of the wall."""
    x, y, z = pos
    f = facing
    zb = z - 0.025
    # shelf bracket from the wall face
    y_wall = wall_y_face
    mb.box(x - 0.17, min(y_wall, y + f * 0.12), zb - 0.02, x + 0.17, max(y_wall, y + f * 0.12), zb, "ap_bracket")
    mb.box(x - 0.17, y_wall, zb - 0.14, x + 0.17, y_wall + f * 0.012, zb, "ap_bracket")
    # body
    mb.box(x - 0.15, y - 0.10, zb, x + 0.15, y + 0.10, zb + 0.05, "ap_body")
    mb.box(x - 0.14, y - 0.09, zb + 0.05, x + 0.14, y + 0.09, zb + 0.056, "ap_body")
    # status LED strip on the room-facing edge + small dots
    mb.box(x - 0.05, y + f * 0.1, zb + 0.022, x + 0.05, y + f * 0.1035, zb + 0.03, "led_blue")
    mb.cylinder((x, y, zb + 0.056), (x, y, zb + 0.058), 0.022, "led_blue", segs=16)
    # three dipole antennas on the wall side, gently fanned
    for k, dx in enumerate((-0.11, 0.0, 0.11)):
        base = Vector((x + dx, y - f * 0.08, zb + 0.05))
        tip = base + Vector((dx * 0.35, -f * 0.02, 0.19))
        mb.cylinder(base, base + Vector((0, 0, 0.025)), 0.012, "ap_body", segs=10)
        mb.cylinder(base + Vector((0, 0, 0.02)), tip, 0.0075, "ap_antenna", segs=10, r1=0.006)


def client_device(mb, kind, pos, yaw=0.0):
    x, y, z = pos
    zt = z - 0.05            # data z is the device position; desk top just below
    if kind == "laptop":
        laptop(mb, x, y, zt, yaw, "screen_client", 0.32, 0.22)
    elif kind == "tablet":
        start = len(mb.verts)
        U = Vector((1, 0, 0)); V = Vector((0, -math.cos(math.radians(70)), math.sin(math.radians(70))))
        mb.obox((0, 0.05, 0), U, V, U.cross(V), -0.13, 0.13, 0, 0.19, 0, 0.008, "laptop_shell", {"+z": "screen_client"})
        mb.transform_since(start, Matrix.Translation(Vector((x, y, zt))) @ Matrix.Rotation(yaw, 4, "Z"))
    elif kind == "phone":
        mb.box(x - 0.04, y - 0.08, zt, x + 0.04, y + 0.08, zt + 0.009, "laptop_shell", {"+z": "screen_client"})
    elif kind == "desktop":
        mb.box(x - 0.30, y - 0.02, zt + 0.12, x + 0.30, y + 0.01, zt + 0.48, "monitor", {"-y": "screen_client"})
        mb.box(x - 0.03, y - 0.0, zt, x + 0.03, y + 0.06, zt + 0.14, "monitor")
        mb.box(x + 0.42, y - 0.2, zt, x + 0.62, y + 0.25, zt + 0.42, "monitor")
    elif kind == "printer":
        mb.box(x - 0.28, y - 0.22, z - 0.15, x + 0.28, y + 0.22, z + 0.12, "ap_body")
        mb.box(x - 0.26, y - 0.24, z + 0.02, x + 0.26, y - 0.21, z + 0.08, "monitor")
