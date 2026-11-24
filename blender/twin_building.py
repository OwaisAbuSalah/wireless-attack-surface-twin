"""The faculty building, procedurally from data/building.json.

Walls are manifold solids with their openings cut by construction (cell grid along the wall), so
there are no booleans and the Bevel modifier rounds exactly the real edges.  Window glass, frames,
sills, doors and the lobby curtain wall are generated from each wall's `opening` definition with the
same interval maths as the propagation model (MODEL.md section 2.1).
"""
import math
import random

from mathutils import Vector

from twin_mesh import MeshBuilder

# ----------------------------------------------------------------------------- parameters
SLAB = 0.30            # slab thickness (data: slab k occupies [z_k - 0.3, z_k])
SLAB_LIP = 0.04        # slab edge band projects beyond the facade
PARAPET_H = 1.05
COPING = 0.06
CUT_H = 1.6            # cutaway: section height above the floor-1 finish
KEEP_ROUTER_PIER = False  # cutaway: True keeps the AP pier solid; False draws it as a translucent ghost
GHOST_ROUTER_PIER = True
FRAME_W = 0.05         # window frame profile
FRAME_D = 0.07         # window frame depth
GLASS_SET = 0.11       # glass plane set back from the exterior face
CURTAIN_T = 0.16       # visual depth of the lobby curtain wall (mullions)
METAL_VIS_T = 0.05     # steel shaft cladding drawn at least this thick
STAIR_HOLE = (-0.70, 3.20, 2.85, 7.82)   # x0, y0, x1, y1 of the stair void in slabs above the core

INTERIOR_MAT = {"brick": "int_brick", "drywall": "int_drywall", "concrete": "int_concrete",
                "metal": "steel", "ext_concrete": "ext_concrete", "glass": "glass_int"}


# ----------------------------------------------------------------------------- wall helpers
class Wall:
    def __init__(self, d):
        self.d = d
        self.id = d["id"]
        self.floor = d.get("floor", 0)
        self.a = Vector((d["a"][0], d["a"][1], 0.0))
        self.b = Vector((d["b"][0], d["b"][1], 0.0))
        self.L = (self.b - self.a).length
        self.U = (self.b - self.a).normalized()
        self.V = Vector((0, 0, 1))
        self.W = self.U.cross(self.V)               # right-hand normal (U x V = W)
        self.z0, self.z1 = d["z0"], d["z1"]
        self.mat = d["mat"]
        self.t = d["t"]
        self.op = d.get("opening")
        self.ext = bool(d.get("exterior"))
        self.facade = d.get("facade")
        self.curtain = bool(self.op and self.op["period"] > 0 and self.op["period"] <= 1.6
                            and self.op["width"] / self.op["period"] > 0.8)
        if self.curtain:
            self.vt = CURTAIN_T
        elif self.mat == "metal":
            self.vt = max(self.t, METAL_VIS_T)
        elif self.mat == "glass":
            self.vt = 0.07
        else:
            self.vt = self.t
        # how far the wall's inner face lies from its centre line (a curtain wall hangs flush
        # with the outer face, so its inner face is just beyond the centre line)
        self.reach = (self.t / 2 - self.vt) if self.curtain else self.vt / 2
        self.out = 0.0      # +1: exterior on the +W side, -1: on the -W side (exterior walls only)

    def P(self, s, z, w):
        return self.a + self.U * s + Vector((0, 0, z)) + self.W * w

    def intervals(self):
        """Opening intervals along the wall (s0, s1), same maths as the propagation model."""
        o = self.op
        if not o:
            return []
        out = []
        if o["period"] > 0:
            p = o["period"]
            k0 = math.floor((0.0 - o["offset"] - o["width"]) / p) - 1
            k1 = math.ceil((self.L - o["offset"]) / p) + 1
            for k in range(k0, k1 + 1):
                s0 = o["offset"] + k * p
                s1 = s0 + o["width"]
                s0, s1 = max(s0, 0.0), min(s1, self.L)
                if s1 - s0 > 1e-6:
                    out.append((s0, s1))
        else:
            s0, s1 = max(o["offset"], 0.0), min(o["offset"] + o["width"], self.L)
            if s1 - s0 > 1e-6:
                out.append((s0, s1))
        return out


def _on_segment(p, w, tol=1e-6):
    """u in (0,1) strictly inside the segment, and distance to the line ~0."""
    ap = p - w.a
    u = ap.dot(w.U)
    if u <= tol or u >= w.L - tol:
        return False
    return abs(ap.dot(w.W)) < tol


def junctions(walls):
    """Extension (+) / trim (-) at both ends of every wall so corners close and tees tuck in.

    L-corner (perpendicular wall ending at the same point, no straight continuation): extend by
    half the other wall's thickness (minus 2 mm).  Tee (the point lies inside another wall, or two
    opposite perpendicular walls meet there): trim back to 3 mm inside the host.
    """
    adj = {}
    for w in walls:
        res = []
        for end, P in ((0, w.a), (1, w.b)):
            away = w.U if end == 0 else -w.U        # direction from P into the wall
            collinear, perp_dirs, hosts = False, [], []
            for o in walls:
                if o is w or abs(o.z0 - w.z0) > 1e-6:
                    continue
                par = abs(o.U.dot(w.U)) > 0.999
                at_a = (o.a - P).length < 1e-6
                at_b = (o.b - P).length < 1e-6
                if par and (at_a or at_b):
                    collinear = True
                elif not par and (at_a or at_b):
                    perp_dirs.append((o.U if at_a else -o.U, o))
                elif not par and _on_segment(P, o):
                    hosts.append(o)
            if collinear:
                res.append(0.0)
                continue
            through = any(d1.dot(d2) < -0.999 for i, (d1, _) in enumerate(perp_dirs) for (d2, _) in perp_dirs[i + 1:])
            if hosts or through:
                cand = [h.reach for h in hosts] + ([o.reach for _, o in perp_dirs] if through else [])
                res.append(-(min(cand) - 0.003))
            elif perp_dirs:
                res.append(max(o.vt for _, o in perp_dirs) / 2.0 - 0.002)
            else:
                res.append(0.0)
        adj[w.id] = tuple(res)
    return adj


# ----------------------------------------------------------------------------- building
class BuildingBuilder:
    """Builds the building into MeshBuilders grouped by (floor, part).  cut=True builds the
    cutaway variant of floor 1 (section at CUT_H)."""

    def __init__(self, bld, rng_seed=7):
        self.bld = bld
        self.rng = random.Random(rng_seed)
        fp = bld["footprint"]
        self.X0, self.Y0, self.X1, self.Y1 = fp
        self.cx, self.cy = (self.X0 + self.X1) / 2, (self.Y0 + self.Y1) / 2
        self.walls = [Wall(d) for d in bld["walls"] if not d["id"].startswith("CTX")]
        for w in self.walls:
            if w.ext:
                mid = (w.a + w.b) * 0.5
                self.out_of = mid - Vector((self.cx, self.cy, 0))
                w.out = 1.0 if w.W.dot(self.out_of) > 0 else -1.0
        self.adj = junctions(self.walls)
        self.ext_t = max(w.t for w in self.walls if w.ext)
        rt = bld["router"]["mounts"][bld["router"].get("mount", "wall")]
        self.router = Vector(rt["pos"])

    # ------------------------------------------------------------------ walls
    def wall_mats(self, w, cut_top):
        if w.curtain:
            face = side = "frame"
            inner = "frame"
        elif w.ext:
            face, inner, side = "ext_concrete", "int_plaster", "ext_concrete"
        else:
            face = inner = side = INTERIOR_MAT.get(w.mat, "int_brick")

        def fn(key, i, j, _top=[None]):
            if key in ("+w", "-w"):
                if w.ext and not w.curtain:
                    outside = (key == "+w") == (w.out > 0)
                    return face if outside else inner
                return face
            if key == "+v":
                return fn.top(i, j)
            return side
        return fn

    def build_wall(self, w, mb, fill, zcut=None, keep=()):
        """Wall body into `mb`, glass/frames/doors into the `fill` dict of MeshBuilders."""
        ea, eb = self.adj[w.id]
        s_from, s_to = -ea, w.L + eb
        zb = w.z0
        zt = w.z1 - SLAB
        op = w.op
        ivs = w.intervals()
        holes = []
        if op and w.mat != "glass":
            h0 = zb + op["sill"]
            h1 = min(zb + op["head"], zt)
            for s0, s1 in ivs:
                holes.append((s0, s1, h0, h1))
        if w.mat == "glass":          # full-height glass partition: no wall body at all
            self.glass_partition(w, fill, zb, zt, zcut, keep)
            return
        us = {s_from, s_to}
        zs = {zb, zt}
        for s0, s1, h0, h1 in holes:
            us.update((min(max(s0, s_from), s_to), min(max(s1, s_from), s_to)))
            zs.update((h0, h1))
        if zcut is not None and zcut < zt:
            zs.add(zcut)
            for k0, k1 in keep:
                us.update((min(max(k0, s_from), s_to), min(max(k1, s_from), s_to)))
        us = sorted(us)
        zs = sorted(z for z in zs if zb - 1e-9 <= z <= zt + 1e-9)

        def kept(sc):
            return any(k0 <= sc <= k1 for k0, k1 in keep)

        def solid(i, j):
            sc = 0.5 * (us[i] + us[i + 1])
            zc = 0.5 * (zs[j] + zs[j + 1])
            if zcut is not None and zc > zcut and not kept(sc):
                return False
            for s0, s1, h0, h1 in holes:
                if s0 < sc < s1 and h0 < zc < h1:
                    return False
            return True

        mf = self.wall_mats(w, zcut is not None)

        def top(i, j):
            if zcut is not None and abs(zs[j + 1] - zcut) < 1e-6:
                return "cut"
            if j + 1 == len(zs) - 1:
                return "cut" if zcut is not None and zt <= zcut + 1e-6 else ("frame" if w.curtain else "slab_edge")
            return mf("-u", i, j)
        mf.top = top
        w_off = 0.0
        if w.curtain:      # curtain wall sits flush with the outer face line
            w_off = w.out * (self.ext_t / 2 - w.vt / 2)
        origin = w.a + w.W * w_off
        mb.grid_solid(origin, w.U, w.V, w.W, us, zs, solid, -w.vt / 2, w.vt / 2, mf)

        # fill the openings
        for s0, s1, h0, h1 in holes:
            if op["mat"] == "air":
                continue
            if op["mat"] in ("ext_glass",) and w.curtain:
                self.curtain_pane(w, fill, s0, s1, h0, h1, w_off, zcut)
            elif op["mat"] == "ext_glass":
                self.window(w, fill, s0, s1, h0, h1, zcut, keep)
            elif op["mat"] in ("wood", "metal"):
                self.door(w, fill, s0, s1, h0, h1, op["mat"], zcut)

    # small oriented box in wall coordinates, clipped at the section height
    def _wb(self, mb, w, s0, s1, z0, z1, w0, w1, mat, zcut=None, keep=()):
        if zcut is not None and not any(k0 <= 0.5 * (s0 + s1) <= k1 for k0, k1 in keep):
            if z0 >= zcut:
                return
            z1 = min(z1, zcut)
        mb.obox(w.a, w.U, w.V, w.W, s0, s1, z0, z1, w0, w1, mat)

    def window(self, w, fill, s0, s1, h0, h1, zcut, keep):
        o = w.out if w.ext else 1.0
        wg = o * (w.vt / 2 - GLASS_SET)
        fw, fd = FRAME_W, FRAME_D
        fr, gl = fill["frame"], fill["glass"]
        a, b = sorted((wg - fd / 2, wg + fd / 2))
        self._wb(fr, w, s0, s0 + fw, h0, h1, a, b, "frame", zcut, keep)
        self._wb(fr, w, s1 - fw, s1, h0, h1, a, b, "frame", zcut, keep)
        self._wb(fr, w, s0 + fw, s1 - fw, h0, h0 + fw, a, b, "frame", zcut, keep)
        self._wb(fr, w, s0 + fw, s1 - fw, h1 - fw, h1, a, b, "frame", zcut, keep)
        width = s1 - s0
        n_m = 0 if width < 1.2 else (1 if width < 2.2 else 2)
        for k in range(1, n_m + 1):
            sm = s0 + width * k / (n_m + 1)
            self._wb(fr, w, sm - 0.022, sm + 0.022, h0 + fw, h1 - fw, a, b, "frame", zcut, keep)
        if h1 - h0 > 2.2:     # tall corridor window: transom
            zt = h0 + 2.0
            self._wb(fr, w, s0 + fw, s1 - fw, zt - 0.022, zt + 0.022, a, b, "frame", zcut, keep)
        g0, g1 = sorted((wg - 0.012, wg + 0.012))
        self._wb(gl, w, s0 + fw * 0.5, s1 - fw * 0.5, h0 + fw * 0.5, h1 - fw * 0.5, g0, g1,
                 "glass_ext" if w.ext else "glass_int", zcut, keep)
        if w.ext and (h0 - w.z0) > 0.25:
            ow = o * (w.vt / 2 + 0.05)
            iw = wg
            c, d = sorted((ow, iw))
            self._wb(fr, w, s0 - 0.04, s1 + 0.04, h0 - 0.03, h0 + 0.012, c, d, "sill_stone", zcut, keep)

    def curtain_pane(self, w, fill, s0, s1, h0, h1, w_off, zcut):
        fr, gl = fill["frame"], fill["glass"]
        o = w.out
        base = w_off
        g0, g1 = base - 0.012, base + 0.012
        smid = 0.5 * (s0 + s1)
        x_mid = (w.a + w.U * smid).x
        door = abs(x_mid) < 1.6 and w.facade == "S"
        if door:
            zt = w.z0 + 2.4
            self._wb(fr, w, s0, s1, zt - 0.05, zt + 0.05, base - w.vt / 2, base + w.vt / 2, "frame", zcut)
            # door leaf frame + glass + push bars
            self._wb(fr, w, s0, s0 + 0.06, h0, zt, base - 0.03, base + 0.03, "frame", zcut)
            self._wb(fr, w, s1 - 0.06, s1, h0, zt, base - 0.03, base + 0.03, "frame", zcut)
            self._wb(fr, w, s0, s1, h0, h0 + 0.12, base - 0.03, base + 0.03, "frame", zcut)
            for sg in (-1, 1):
                ww = base + sg * 0.07
                self._wb(fr, w, s0 + 0.15, s1 - 0.15, w.z0 + 1.0, w.z0 + 1.04, ww - 0.015, ww + 0.015, "steel", zcut)
            self._wb(gl, w, s0 + 0.03, s1 - 0.03, h0 + 0.06, zt - 0.03, g0, g1, "glass_ext", zcut)
            self._wb(gl, w, s0 + 0.01, s1 - 0.01, zt + 0.03, h1 - 0.01, g0, g1, "glass_ext", zcut)
        else:
            self._wb(gl, w, s0 + 0.01, s1 - 0.01, h0 + 0.01, h1 - 0.01, g0, g1, "glass_ext", zcut)
            # slim horizontal glazing bar at door-transom height for rhythm
            zt = w.z0 + 2.4
            self._wb(fr, w, s0, s1, zt - 0.025, zt + 0.025, base - 0.04, base + 0.04, "frame", zcut)

    def door(self, w, fill, s0, s1, h0, h1, mat, zcut):
        fr, dr = fill["frame"], fill["door"]
        t = w.vt
        cas = 0.06
        self._wb(fr, w, s0 - cas, s0 + 0.02, h0, h1 + cas, -t / 2 - 0.012, t / 2 + 0.012, "door_frame", zcut)
        self._wb(fr, w, s1 - 0.02, s1 + cas, h0, h1 + cas, -t / 2 - 0.012, t / 2 + 0.012, "door_frame", zcut)
        self._wb(fr, w, s0 - cas, s1 + cas, h1 - 0.02, h1 + cas, -t / 2 - 0.012, t / 2 + 0.012, "door_frame", zcut)
        dm = "wood_door" if mat == "wood" else "steel_door"
        width = s1 - s0
        leaves = [(s0 + 0.02, s1 - 0.02)] if width < 1.4 else [(s0 + 0.02, 0.5 * (s0 + s1) - 0.002), (0.5 * (s0 + s1) + 0.002, s1 - 0.02)]
        for l0, l1 in leaves:
            self._wb(dr, w, l0, l1, h0 + 0.01, h1 - 0.02, -0.022, 0.022, dm, zcut)
            hs = l1 - 0.10 if l1 < s1 - 0.1 else l1 - 0.10
            for sg in (-1, 1):
                self._wb(fr, w, hs - 0.12, hs, w.z0 + 1.0, w.z0 + 1.03, sg * 0.022, sg * 0.055, "steel", zcut)

    def glass_partition(self, w, fill, zb, zt, zcut, keep):
        fr, gl = fill["frame"], fill["glass"]
        ea, eb = self.adj[w.id]
        s0, s1 = -ea, w.L + eb
        self._wb(fr, w, s0, s1, zb, zb + 0.06, -0.035, 0.035, "frame", zcut)
        self._wb(fr, w, s0, s1, zt - 0.06, zt, -0.035, 0.035, "frame", zcut)
        n = max(1, int(round((s1 - s0) / 1.5)))
        for k in range(n + 1):
            s = s0 + (s1 - s0) * k / n
            self._wb(fr, w, max(s0, s - 0.025), min(s1, s + 0.025), zb, zt, -0.035, 0.035, "frame", zcut)
        self._wb(gl, w, s0, s1, zb + 0.06, zt - 0.06, -0.008, 0.008, "glass_int", zcut)

    # ------------------------------------------------------------------ slabs, roof, core
    def slab(self, mb, z_top, floor_mat, hole=None, lip=SLAB_LIP, bottom=None):
        e = self.ext_t / 2 + lip
        x0, y0, x1, y1 = self.X0 - e, self.Y0 - e, self.X1 + e, self.Y1 + e
        us = [x0, x1]
        vs = [y0, y1]
        if hole:
            us += [hole[0], hole[2]]
            vs += [hole[1], hole[3]]
        us, vs = sorted(us), sorted(vs)

        def solid(i, j):
            if not hole:
                return True
            xc, yc = 0.5 * (us[i] + us[i + 1]), 0.5 * (vs[j] + vs[j + 1])
            return not (hole[0] < xc < hole[2] and hole[1] < yc < hole[3])

        def mf(key, i, j):
            return {"+w": floor_mat, "-w": "ceiling"}.get(key, "slab_edge")
        zb = z_top - SLAB if bottom is None else bottom
        mb.grid_solid((0, 0, zb), (1, 0, 0), (0, 1, 0), (0, 0, 1), us, vs, solid, 0.0, z_top - zb, mf)

    def stairs(self, mb, z0, fh=3.6):
        x0, y0, x1, y1 = STAIR_HOLE
        n = 10
        rise = fh / 2 / n
        run = (6.80 - y0) / n
        xm = 0.5 * (x0 + x1)
        ya = y0
        # flight A (east half) rising north
        for i in range(n):
            mb.box(xm + 0.05, ya + i * run, z0, x1, ya + (i + 1) * run, z0 + (i + 1) * rise, "stair")
        # landing
        yl = ya + n * run
        mb.box(x0, yl, z0 + fh / 2 - 0.22, x1, y1, z0 + fh / 2, "stair")
        # flight B (west half) rising south
        for i in range(n):
            zt = z0 + fh / 2 + (i + 1) * rise
            mb.box(x0, yl - (i + 1) * run, zt - 0.28, xm - 0.05, yl - i * run, zt, "stair")
        # glass-free steel balustrade on the void side of flight B and the landing
        mb.box(xm - 0.07, ya, z0 + fh / 2 + 0.9, xm - 0.03, yl, z0 + fh / 2 + 0.94, "steel")
        mb.box(xm + 0.03, ya, z0 + 0.9 + fh / 4, xm + 0.07, yl, z0 + 0.94 + fh / 4, "steel")

    def roof_extras(self, mb, z_roof):
        e = self.ext_t / 2
        X0, Y0, X1, Y1 = self.X0 - e, self.Y0 - e, self.X1 + e, self.Y1 + e
        pt = 0.25
        zt = z_roof + PARAPET_H
        # parapet (outer face flush with the facade) + coping
        mb.box(X0, Y0, z_roof, X1, Y0 + pt, zt, "ext_concrete", {"+y": "roof_inner"})
        mb.box(X0, Y1 - pt, z_roof, X1, Y1, zt, "ext_concrete", {"-y": "roof_inner"})
        mb.box(X0, Y0 + pt, z_roof, X0 + pt, Y1 - pt, zt, "ext_concrete", {"+x": "roof_inner"})
        mb.box(X1 - pt, Y0 + pt, z_roof, X1, Y1 - pt, zt, "ext_concrete", {"-x": "roof_inner"})
        c = 0.035
        mb.box(X0 - c, Y0 - c, zt, X1 + c, Y0 + pt + c, zt + COPING, "coping")
        mb.box(X0 - c, Y1 - pt - c, zt, X1 + c, Y1 + c, zt + COPING, "coping")
        mb.box(X0 - c, Y0 + pt + c, zt, X0 + pt + c, Y1 - pt - c, zt + COPING, "coping")
        mb.box(X1 - pt - c, Y0 + pt + c, zt, X1 + c, Y1 - pt - c, zt + COPING, "coping")
        # stair / lift bulkhead over the core
        bx0, bx1, by0, by1 = -3.15, 3.15, 1.05, Y1
        zh = z_roof + 3.0
        mb.box(bx0, by0, z_roof, bx1, by1, zh, "ext_concrete")
        mb.box(bx0 - 0.05, by0 - 0.05, zh, bx1 + 0.05, by1 + 0.0, zh + 0.12, "coping")
        mb.box(0.4, by0 - 0.03, z_roof + 0.02, 1.4, by0 + 0.02, z_roof + 2.15, "steel_door")

    def roof_plant(self, mb, z_roof):
        """HVAC units and a small PV array -- reads as a real roof from the aerial views."""
        for (x, y, lx, ly) in ((-11.0, 4.2, 2.6, 1.7), (9.5, 4.6, 3.2, 1.8), (12.8, -4.4, 2.0, 1.5)):
            mb.box(x - lx / 2, y - ly / 2, z_roof, x + lx / 2, y + ly / 2, z_roof + 0.15, "steel")
            mb.box(x - lx / 2 + 0.05, y - ly / 2 + 0.05, z_roof + 0.15, x + lx / 2 - 0.05, y + ly / 2 - 0.05, z_roof + 1.35, "hvac")
            for k in (-1, 1):
                if lx > 2.2:
                    mb.cylinder((x + k * lx / 4.5, y, z_roof + 1.35), (x + k * lx / 4.5, y, z_roof + 1.42), 0.42, "hvac_dark", segs=20)
                else:
                    if k > 0:
                        mb.cylinder((x, y, z_roof + 1.35), (x, y, z_roof + 1.42), 0.5, "hvac_dark", segs=20)
        # PV rows tilted to the south
        tilt = math.radians(15)
        for r in range(3):
            y0 = -6.6 + r * 1.9
            for c in range(6):
                x0 = -16.4 + c * 1.7
                d = 1.0
                h = d * math.sin(tilt)
                p0 = Vector((x0, y0, z_roof + 0.35))
                U = Vector((1, 0, 0))
                V = Vector((0, math.cos(tilt), math.sin(tilt)))
                W = U.cross(V)
                mb.obox(p0, U, V, W, 0, 1.62, 0, d, 0, 0.04, "pv", {"+z": "pv_cell"})
                mb.box(x0 + 0.1, y0 + 0.05, z_roof, x0 + 0.16, y0 + 0.11, z_roof + 0.36, "steel")
                mb.box(x0 + 1.46, y0 + 0.05, z_roof, x0 + 1.52, y0 + 0.11, z_roof + 0.36, "steel")
                mb.box(x0 + 0.1, y0 + d * math.cos(tilt) - 0.11, z_roof, x0 + 0.16, y0 + d * math.cos(tilt) - 0.05, z_roof + 0.35 + h, "steel")
                mb.box(x0 + 1.46, y0 + d * math.cos(tilt) - 0.11, z_roof, x0 + 1.52, y0 + d * math.cos(tilt) - 0.05, z_roof + 0.35 + h, "steel")

    def canopy(self, mb):
        e = self.ext_t / 2
        mb.box(-3.4, self.Y0 - e - 2.1, 2.92, 3.4, self.Y0 - e + 0.02, 3.12, "coping", {"-z": "ceiling"})


# ----------------------------------------------------------------------------- furniture
class Furnisher:
    """Light furnishing hints per room type (boxes only)."""

    def __init__(self, bld, rng_seed=11):
        self.bld = bld
        self.rng = random.Random(rng_seed)
        self.clients = [(c["pos"][0], c["pos"][1], c["pos"][2]) for c in bld["clients"]]

    def near_client(self, x, y, z0, r=1.0):
        for cx, cy, cz in self.clients:
            if 0 <= cz - z0 < 3.0 and abs(cx - x) < r and abs(cy - y) < r:
                return True
        return False

    def desk(self, mb, x, y, z0, yaw=0.0, w=1.4, d=0.7, monitor=True, chair=True):
        if self.near_client(x, y, z0, 0.9):
            return
        c, s = math.cos(yaw), math.sin(yaw)
        mb.ybox(x, y, yaw, w, d, z0 + 0.72, z0 + 0.75, "desk")
        for sx in (-1, 1):
            px, py = x + c * sx * (w / 2 - 0.05), y + s * sx * (w / 2 - 0.05)
            mb.ybox(px, py, yaw, 0.04, d - 0.06, z0, z0 + 0.72, "desk_leg")
        if monitor:
            mx, my = x - (-s) * (d / 2 - 0.15), y - c * (d / 2 - 0.15)
            mb.ybox(mx, my, yaw, 0.55, 0.03, z0 + 0.88, z0 + 1.2, "monitor")
            mb.ybox(mx, my, yaw, 0.06, 0.06, z0 + 0.75, z0 + 0.88, "desk_leg")
        if chair:
            cx, cy = x + (-s) * (d / 2 + 0.35), y + c * (d / 2 + 0.35)
            self.chair(mb, cx, cy, z0, yaw)

    def chair(self, mb, x, y, z0, yaw):
        c, s = math.cos(yaw), math.sin(yaw)
        mb.ybox(x, y, yaw, 0.46, 0.46, z0 + 0.42, z0 + 0.48, "chair")
        bx, by = x + (-s) * 0.21, y + c * 0.21
        mb.ybox(bx, by, yaw, 0.44, 0.05, z0 + 0.48, z0 + 0.9, "chair")
        mb.ybox(x, y, yaw, 0.06, 0.06, z0, z0 + 0.42, "desk_leg")

    def room(self, mb, r, z0):
        t = r["type"]
        x0, y0, x1, y1 = r["rect"]
        m = 0.35
        X0, Y0, X1, Y1 = x0 + m, y0 + m, x1 - m, y1 - m
        W, D = X1 - X0, Y1 - Y0
        cx, cy = (X0 + X1) / 2, (Y0 + Y1) / 2
        south = y1 <= 0           # rooms on the street side have their window on y0
        win_y = Y0 if south else Y1
        face = math.pi if south else 0.0      # desks face the window
        rng = self.rng
        if t in ("office",):
            n = max(1, int(W / 2.2))
            for k in range(n):
                x = X0 + W * (k + 0.5) / n
                y = win_y + (0.9 if south else -0.9)
                self.desk(mb, x, y, z0, face)
            mb.box(X1 - 0.45, cy - 0.8, z0, X1, cy + 0.8, z0 + 1.9, "shelf")
        elif t in ("lab",):
            rows = 3 if D > 5 else 2
            for k in range(rows):
                y = Y0 + 0.8 + (D - 1.6) * k / max(rows - 1, 1)
                for xx in [X0 + 0.9 + i * 1.5 for i in range(max(1, int((W - 1.0) / 1.5)))]:
                    self.desk(mb, xx, y, z0, face, w=1.4, d=0.75)
        elif t == "lecture":
            for k in range(7):
                x = X0 + 2.6 + k * 1.15
                if x > X1 - 0.5:
                    break
                mb.box(x, Y0 + 0.6, z0 + 0.72, x + 0.45, Y1 - 0.6, z0 + 0.75, "desk")
                mb.box(x + 0.2, Y0 + 0.6, z0, x + 0.25, Y1 - 0.6, z0 + 0.72, "desk_leg")
                for yy in [Y0 + 0.9 + i * 0.75 for i in range(int((D - 1.2) / 0.75))]:
                    self.chair(mb, x + 0.75, yy, z0, -math.pi / 2)
            mb.box(X0 + 0.3, cy - 0.4, z0, X0 + 0.9, cy + 0.4, z0 + 1.1, "desk")
            mb.box(X0 - 0.3, cy - 2.0, z0 + 1.0, X0 - 0.26, cy + 2.0, z0 + 2.6, "screen_board")
        elif t in ("meeting", "seminar"):
            L = min(W - 2.2, 5.0)
            mb.box(cx - L / 2, cy - 0.6, z0 + 0.72, cx + L / 2, cy + 0.6, z0 + 0.76, "desk_dark")
            mb.box(cx - L / 2 + 0.3, cy - 0.1, z0, cx + L / 2 - 0.3, cy + 0.1, z0 + 0.72, "desk_leg")
            for xx in [cx - L / 2 + 0.5 + i * 0.85 for i in range(int(L / 0.85))]:
                self.chair(mb, xx, cy - 1.0, z0, math.pi)
                self.chair(mb, xx, cy + 1.0, z0, 0.0)
        elif t == "classroom":
            for i in range(4):
                for j in range(3):
                    x = X0 + 0.9 + i * (W - 1.8) / 3
                    y = Y0 + 1.6 + j * (D - 2.6) / 2
                    self.desk(mb, x, y, z0, 0.0 if not south else math.pi, w=0.9, d=0.55, monitor=False)
            mb.box(X0 + 0.3, Y1 - 0.25, z0 + 0.9, X1 - 0.3, Y1 - 0.2, z0 + 2.1, "screen_board")
        elif t == "lobby":
            mb.box(cx - 1.4, Y1 - 1.6, z0, cx + 1.4, Y1 - 0.9, z0 + 1.08, "reception")
            mb.box(cx - 1.5, Y1 - 1.65, z0 + 1.08, cx + 1.5, Y1 - 0.85, z0 + 1.12, "desk_dark")
            for sx in (-1, 1):
                x = cx + sx * 3.6
                mb.box(x - 1.0, Y0 + 1.6, z0, x + 1.0, Y0 + 2.45, z0 + 0.42, "sofa")
                mb.box(x - 1.0, Y0 + 2.3, z0, x + 1.0, Y0 + 2.45, z0 + 0.8, "sofa")
                mb.box(x - 0.45, Y0 + 0.75, z0, x + 0.45, Y0 + 1.25, z0 + 0.38, "desk_dark")
                self.planter(mb, cx + sx * 5.2, Y1 - 0.6, z0)
        elif t == "cafeteria":
            for i in range(2):
                for j in range(2):
                    x = X0 + 1.4 + i * (W - 2.8)
                    y = Y0 + 1.4 + j * (D - 2.8)
                    mb.cylinder((x, y, z0 + 0.72), (x, y, z0 + 0.75), 0.45, "desk", segs=16)
                    mb.cylinder((x, y, z0), (x, y, z0 + 0.72), 0.04, "desk_leg", segs=8)
                    for a in range(4):
                        ang = a * math.pi / 2 + 0.4
                        self.chair(mb, x + 0.75 * math.cos(ang), y + 0.75 * math.sin(ang), z0, ang + math.pi / 2)
            mb.box(X1 - 0.7, Y0 + 0.5, z0, X1, Y1 - 0.5, z0 + 1.0, "reception")
        elif t == "workshop":
            for k in range(3):
                x = X0 + 1.4 + k * (W - 2.8) / 2
                mb.box(x - 1.0, cy - 0.45, z0 + 0.86, x + 1.0, cy + 0.45, z0 + 0.92, "wood_bench")
                mb.box(x - 0.95, cy - 0.4, z0, x + 0.95, cy + 0.4, z0 + 0.86, "steel_dark")
            mb.box(X1 - 1.4, Y1 - 1.2, z0, X1 - 0.2, Y1 - 0.2, z0 + 1.6, "machine")
        elif t == "storage":
            for k in range(3):
                y = Y0 + 0.6 + k * (D - 1.2) / 2
                mb.box(X0 + 0.4, y - 0.25, z0, X1 - 0.4, y + 0.25, z0 + 2.1, "shelf")
        elif t == "server":
            for row in range(2):
                y = cy - 1.2 + row * 2.4
                for k in range(6):
                    x = X0 + 0.6 + k * 0.62
                    mb.box(x, y - 0.5, z0, x + 0.6, y + 0.5, z0 + 2.05, "rack", {"-y" if row == 0 else "+y": "rack_front"})
            mb.box(X1 - 0.8, Y0 + 0.4, z0, X1 - 0.1, Y0 + 1.2, z0 + 1.9, "machine")
        elif t == "wc":
            for k in range(3):
                y = Y0 + 1.2 + k * 1.3
                mb.box(X0, y, z0 + 0.15, X0 + 1.4, y + 0.04, z0 + 2.0, "partition")
        elif t == "print":
            mb.box(X0 + 0.2, cy - 0.4, z0, X0 + 1.0, cy + 0.4, z0 + 1.1, "machine")
            mb.box(X1 - 0.9, Y0 + 0.4, z0, X1 - 0.1, Y1 - 0.4, z0 + 0.9, "desk")
        elif t == "kitchen":
            mb.box(X0, Y1 - 0.65, z0, X1, Y1, z0 + 0.9, "reception")
            mb.cylinder((cx, cy - 0.6, z0 + 0.72), (cx, cy - 0.6, z0 + 0.75), 0.4, "desk", segs=16)
            mb.cylinder((cx, cy - 0.6, z0), (cx, cy - 0.6, z0 + 0.72), 0.04, "desk_leg", segs=8)
        elif t == "corridor":
            for x in (-14.0, 8.5, 15.0):
                mb.box(x - 0.8, Y1 - 0.15, z0, x + 0.8, Y1 + 0.2, z0 + 0.45, "desk_dark")

    def planter(self, mb, x, y, z0):
        mb.cylinder((x, y, z0), (x, y, z0 + 0.45), 0.28, "planter", segs=14)
        mb.icosphere((x, y, z0 + 0.95), 0.45, "plant", subdiv=1, scale=(1, 1, 1.25), jitter=0.12, rng=self.rng)
