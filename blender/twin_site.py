"""Site: ground, roads + markings, sidewalks + curbs, plaza, walkway, lawns, parking, café terrace,
context buildings (massing with window grids) and a hazy backdrop city beyond the study area.

Surface heights are staggered by a few millimetres so no two ground layers are ever coplanar.
"""
import math
import random

from twin_mesh import MeshBuilder

Z_GROUND = -0.04
Z_LAWN = -0.02
Z_ROAD = -0.14
Z_PARK = -0.12
Z_SIDEWALK = 0.0
Z_PLAZA = 0.002
Z_WALK = 0.004
Z_TERRACE = 0.06
BOTTOM = -0.45
EXTEND = 1600.0          # roads/sidewalks touching the site edge run on to the horizon
BACKDROP_SEED = 3


def _rect_touch(a, b, tol=1e-6):
    """Which edge of rect a touches rect b: returns list of '-x','+x','-y','+y'."""
    ax0, ay0, ax1, ay1 = a
    bx0, by0, bx1, by1 = b
    out = []
    ov_y = min(ay1, by1) - max(ay0, by0) > tol
    ov_x = min(ax1, bx1) - max(ax0, bx0) > tol
    if ov_y and abs(ax0 - bx1) < tol: out.append("-x")
    if ov_y and abs(ax1 - bx0) < tol: out.append("+x")
    if ov_x and abs(ay0 - by1) < tol: out.append("-y")
    if ov_x and abs(ay1 - by0) < tol: out.append("+y")
    return out


def _extend(rect, site):
    x0, y0, x1, y1 = rect
    sx0, sy0, sx1, sy1 = site
    if abs(x0 - sx0) < 1e-6: x0 = -EXTEND
    if abs(x1 - sx1) < 1e-6: x1 = EXTEND
    if abs(y0 - sy0) < 1e-6: y0 = -EXTEND
    if abs(y1 - sy1) < 1e-6: y1 = EXTEND
    return (x0, y0, x1, y1)


class SiteBuilder:
    def __init__(self, bld):
        self.bld = bld
        self.site = bld["site"]
        self.ground = tuple(self.site["ground"]["rect"])
        self.roads = [(r["id"], tuple(r["rect"]), r.get("dir", "x"), r.get("lanes", 2)) for r in self.site["roads"]]

    # ------------------------------------------------------------------ ground surfaces
    def build_ground(self, mb):
        """Terrain slab with holes where the (lower) asphalt surfaces are."""
        G = EXTEND
        holes = [_extend(r, self.ground) for _, r, _, _ in self.roads]
        holes.append(tuple(self.site["parking"]["rect"]))
        us = sorted({-G, G} | {h[0] for h in holes} | {h[2] for h in holes})
        vs = sorted({-G, G} | {h[1] for h in holes} | {h[3] for h in holes})

        def solid(i, j):
            xc, yc = 0.5 * (us[i] + us[i + 1]), 0.5 * (vs[j] + vs[j + 1])
            return not any(h[0] < xc < h[2] and h[1] < yc < h[3] for h in holes)
        mb.grid_solid((0, 0, BOTTOM - 0.2), (1, 0, 0), (0, 1, 0), (0, 0, 1), us, vs, solid,
                      0.0, Z_GROUND - (BOTTOM - 0.2), lambda k, i, j: "ground")

    def build_surfaces(self, mb):
        s = self.site
        site = self.ground
        for rid, r, d, lanes in self.roads:
            x0, y0, x1, y1 = _extend(r, site)
            z = Z_ROAD if rid != "parking_access" else Z_ROAD + 0.01
            mb.box(x0, y0, BOTTOM, x1, y1, z, "asphalt")
        for r in s["sidewalks"]:
            x0, y0, x1, y1 = _extend(tuple(r), site)
            mb.box(x0, y0, BOTTOM, x1, y1, Z_SIDEWALK, "sidewalk", {"-x": "curb", "+x": "curb", "-y": "curb", "+y": "curb"})
        # curbs where a sidewalk meets a road (protrude 1 cm so faces never coincide)
        for r in s["sidewalks"]:
            rr = _extend(tuple(r), site)
            for rid, road, d, lanes in self.roads:
                for e in _rect_touch(rr, _extend(road, site)):
                    self._curb(mb, rr, e)
        px0, py0, px1, py1 = s["plaza"]
        mb.box(px0, py0, BOTTOM, px1, py1, Z_PLAZA, "plaza", {"-x": "curb", "+x": "curb", "-y": "curb", "+y": "curb"})
        wx0, wy0, wx1, wy1 = s["walkway"]
        mb.box(wx0, wy0, BOTTOM, wx1, wy1, Z_WALK, "walkway", {"-x": "curb", "+x": "curb", "-y": "curb", "+y": "curb"})
        for r in s["lawns"]:
            x0, y0, x1, y1 = r
            mb.box(x0, y0, BOTTOM, x1, y1, Z_LAWN, "lawn")
        p = s["parking"]["rect"]
        mb.box(p[0], p[1], BOTTOM, p[2], p[3], Z_PARK, "asphalt_park", {"-x": "curb", "+x": "curb", "-y": "curb", "+y": "curb"})
        t = s["cafe_terrace"]["rect"]
        mb.box(t[0], t[1], BOTTOM, t[2], t[3], Z_TERRACE, "deck", {"-x": "deck_edge", "+x": "deck_edge", "-y": "deck_edge", "+y": "deck_edge"})

    def _curb(self, mb, r, edge, w=0.16):
        x0, y0, x1, y1 = r
        zt, zb = Z_SIDEWALK + 0.004, Z_ROAD - 0.03
        o = 0.012
        if edge == "-x": mb.box(x0 - o, y0, zb, x0 + w, y1, zt, "curb")
        if edge == "+x": mb.box(x1 - w, y0, zb, x1 + o, y1, zt, "curb")
        if edge == "-y": mb.box(x0, y0 - o, zb, x1, y0 + w, zt, "curb")
        if edge == "+y": mb.box(x0, y1 - w, zb, x1, y1 + o, zt, "curb")

    # ------------------------------------------------------------------ markings
    def build_markings(self, mb):
        zt = Z_ROAD + 0.003
        zb = Z_ROAD - 0.01
        site = self.ground
        cross_x = (-1.7, 1.7)          # zebra crossing in front of the entrance / café
        for rid, r, d, lanes in self.roads:
            if rid == "parking_access":
                continue
            x0, y0, x1, y1 = _extend(r, site)
            if d == "x":
                yc = 0.5 * (y0 + y1) - 0.1
                for xa, xb in ((x0, cross_x[0] - 0.6), (cross_x[1] + 0.6, x1)):
                    mb.box(xa, yc - 0.17, zb, xb, yc - 0.07, zt, "paint_yellow")
                    mb.box(xa, yc + 0.07, zb, xb, yc + 0.17, zt, "paint_yellow")
                mb.box(x0, y0 + 0.30, zb, x1, y0 + 0.42, zt, "paint_white")
                # parking lane on the north side: dashed line
                yp = y1 - 2.25
                x = x0
                while x < x1:
                    if not (cross_x[0] - 1.0 < x < cross_x[1] + 1.0):
                        mb.box(x, yp - 0.06, zb, min(x + 2.0, x1), yp + 0.06, zt, "paint_white")
                    x += 6.0
                # zebra
                yy = y0 + 0.6
                while yy + 0.5 < y1 - 0.3:
                    mb.box(cross_x[0], yy, zb, cross_x[1], yy + 0.5, zt, "paint_white")
                    yy += 1.0
            else:
                xc = 0.5 * (x0 + x1)
                y = max(y0, -16.0) + 2.0
                while y < y1:
                    mb.box(xc - 0.06, y, zb, xc + 0.06, min(y + 3.0, y1), zt, "paint_white")
                    y += 9.0
                mb.box(xc, y0 + 1.0, zb, x1 - 0.3, y0 + 1.4, zt, "paint_white")    # stop line
        # parking stalls
        p = self.site["parking"]
        st = p["stall"]
        zt2, zb2 = Z_PARK + 0.003, Z_PARK - 0.01
        for row in p["rows"]:
            n = int(round((row["x1"] - row["x0"]) / st))
            for k in range(n + 1):
                x = row["x0"] + k * st
                if x > row["x1"] + 0.5:
                    break
                mb.box(x - 0.05, row["y0"] + 0.1, zb2, x + 0.05, row["y1"] - 0.1, zt2, "paint_white")
            yb = row["y1"] if row["facing"] == "N" else row["y0"]
            mb.box(row["x0"] - 0.05, yb - 0.05, zb2, row["x0"] + n * st + 0.05, yb + 0.05, zt2, "paint_white")

    # ------------------------------------------------------------------ context buildings
    def build_context(self, mb_by_style, rng=None):
        rng = rng or random.Random(5)
        for c in self.bld["context"]:
            x0, y0, x1, y1 = c["rect"]
            h = c["height"]
            style = c.get("style", "campus")
            key = c["id"]
            mb = mb_by_style(key)
            facade = "ctx_" + key
            mb.box(x0, y0, 0.0, x1, y1, h, facade, {"+z": "ctx_roof", "-z": "ctx_roof"})
            # parapet + coping
            pt, ph = 0.3, 0.7
            for (a, b, c2, d) in ((x0, y0, x1, y0 + pt), (x0, y1 - pt, x1, y1), (x0, y0 + pt, x0 + pt, y1 - pt), (x1 - pt, y0 + pt, x1, y1 - pt)):
                mb.box(a, b, h, c2, d, h + ph, facade, {"+z": "coping"})
            if style == "campus" and key == "library":
                # vertical fins + a deep glazed ground floor
                for x in [x0 + 1.0 + i * 2.0 for i in range(int((x1 - x0 - 1.0) / 2.0) + 1)]:
                    mb.box(x - 0.08, y0 - 0.55, 4.2, x + 0.08, y0, h, "ctx_fin")
                mb.box(x0, y0 - 0.6, 4.0, x1, y0, 4.25, "ctx_fin")
            if style == "retail":
                # awning band over the shop fronts on the street side
                yy = y1 if y1 < 0 else y0
                sgn = 1 if y1 < 0 else -1
                mb.box(x0, min(yy, yy + sgn * 1.4), 3.35, x1, max(yy, yy + sgn * 1.4), 3.5, "awning")
            if style == "residential":
                for z in (3.2, 6.2, 9.2):
                    for y in [y0 + 2.0 + i * 5.0 for i in range(int((y1 - y0 - 2.0) / 5.0) + 1)]:
                        mb.box(x1, y, z - 0.12, x1 + 1.3, y + 3.0, z, "coping")
                        mb.box(x1 + 1.25, y, z, x1 + 1.3, y + 3.0, z + 1.0, "railing_glass")
            # rooftop units
            for _ in range(2):
                ux = rng.uniform(x0 + 3, x1 - 5)
                uy = rng.uniform(y0 + 3, y1 - 4)
                mb.box(ux, uy, h, ux + rng.uniform(1.5, 3.0), uy + rng.uniform(1.2, 2.2), h + rng.uniform(0.9, 1.6), "hvac")

    def build_backdrop(self, mb, tree_spots, n=120):
        """Generic city blocks beyond the study area for the horizon (kept out of the roads)."""
        rng = random.Random(BACKDROP_SEED)
        keep_out = [(-115, -85, 115, 85),                 # study area + margin
                    (-EXTEND, -31, EXTEND, -12),          # main street corridor
                    (-45, -31, -23, EXTEND)]              # side street corridor
        placed = []
        tries = 0
        while len(placed) < n and tries < 6000:
            tries += 1
            ang = rng.uniform(0, 2 * math.pi)
            dist = 150 + (rng.random() ** 0.8) * 520
            cx, cy = dist * math.cos(ang) * 1.15, dist * math.sin(ang)
            w, d = rng.uniform(14, 46), rng.uniform(12, 38)
            r = (cx - w / 2, cy - d / 2, cx + w / 2, cy + d / 2)
            if any(not (r[2] < k[0] or r[0] > k[2] or r[3] < k[1] or r[1] > k[3]) for k in keep_out):
                continue
            if any(not (r[2] + 6 < p[0] or r[0] - 6 > p[2] or r[3] + 6 < p[1] or r[1] - 6 > p[3]) for p in placed):
                continue
            h = rng.uniform(6, 15) + (dist - 130) / 520 * rng.uniform(0, 26)
            placed.append(r)
            style = rng.choice(("bd_a", "bd_b", "bd_c"))
            mb.box(r[0], r[1], 0.0, r[2], r[3], h, style, {"+z": "ctx_roof", "-z": "ctx_roof"})
        # tree clumps between the blocks
        for _ in range(260):
            ang = rng.uniform(0, 2 * math.pi)
            dist = 110 + rng.random() * 380
            x, y = dist * math.cos(ang) * 1.15, dist * math.sin(ang)
            if any(k[0] < x < k[2] and k[1] < y < k[3] for k in keep_out):
                continue
            if any(p[0] - 3 < x < p[2] + 3 and p[1] - 3 < y < p[3] + 3 for p in placed):
                continue
            tree_spots.append((x, y, rng.uniform(0.9, 1.6)))
        return placed
