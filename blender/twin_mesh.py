"""Mesh-building helpers: accumulate many primitives into one mesh object (with material slots).

Everything is built with explicit, outward-wound faces so the meshes are manifold and the Bevel
modifier (angle-limited) only rounds real edges.  No bpy.ops, no booleans -- fast and deterministic.
"""
import math

import bmesh
import bpy
from mathutils import Matrix, Vector

# box face table in local (x,y,z) corner order, outward winding, keyed by local face direction
_BOX_FACES = {
    "-z": (0, 3, 2, 1), "+z": (4, 5, 6, 7),
    "-y": (0, 1, 5, 4), "+y": (2, 3, 7, 6),
    "-x": (3, 0, 4, 7), "+x": (1, 2, 6, 5),
}


def _newell(pts):
    n = Vector((0.0, 0.0, 0.0))
    for i, p in enumerate(pts):
        q = pts[(i + 1) % len(pts)]
        n.x += (p.y - q.y) * (p.z + q.z)
        n.y += (p.z - q.z) * (p.x + q.x)
        n.z += (p.x - q.x) * (p.y + q.y)
    return n


class MeshBuilder:
    """Collects vertices/faces/material indices; to_object() creates the Blender object."""

    def __init__(self, name):
        self.name = name
        self.verts = []
        self.faces = []
        self.fmat = []
        self.fsmooth = []
        self.mats = []
        self._mi = {}

    # ------------------------------------------------------------------ basics
    def mi(self, mat):
        if mat not in self._mi:
            self._mi[mat] = len(self.mats)
            self.mats.append(mat)
        return self._mi[mat]

    def add_verts(self, pts):
        base = len(self.verts)
        self.verts.extend(Vector(p) for p in pts)
        return base

    def add_face(self, idx, mat, smooth=False):
        self.faces.append(tuple(idx))
        self.fmat.append(self.mi(mat))
        self.fsmooth.append(smooth)

    def poly(self, pts, mat, normal=None, smooth=False):
        """Free polygon (own vertices).  If `normal` is given the winding is fixed to match it."""
        pts = [Vector(p) for p in pts]
        if normal is not None and _newell(pts).dot(Vector(normal)) < 0:
            pts.reverse()
        b = self.add_verts(pts)
        self.add_face(range(b, b + len(pts)), mat, smooth)

    @property
    def empty(self):
        return not self.faces

    # ------------------------------------------------------------------ boxes
    def box(self, x0, y0, z0, x1, y1, z1, mat, side_mats=None, skip=()):
        """Axis-aligned box.  side_mats: {'+z': 'mat', ...} overrides per face; skip: faces to omit."""
        if x0 > x1: x0, x1 = x1, x0
        if y0 > y1: y0, y1 = y1, y0
        if z0 > z1: z0, z1 = z1, z0
        c = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
             (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
        b = self.add_verts(c)
        for k, f in _BOX_FACES.items():
            if k in skip:
                continue
            m = (side_mats or {}).get(k, mat)
            self.add_face([b + i for i in f], m)

    def obox(self, origin, U, V, W, u0, u1, v0, v1, w0, w1, mat, side_mats=None):
        """Oriented box in the right-handed frame (U, V, W) at origin.  Face keys use x/y/z = U/V/W."""
        o, U, V, W = Vector(origin), Vector(U), Vector(V), Vector(W)
        P = lambda u, v, w: o + U * u + V * v + W * w
        c = [P(u0, v0, w0), P(u1, v0, w0), P(u1, v1, w0), P(u0, v1, w0),
             P(u0, v0, w1), P(u1, v0, w1), P(u1, v1, w1), P(u0, v1, w1)]
        b = self.add_verts(c)
        flip = U.cross(V).dot(W) < 0
        for k, f in _BOX_FACES.items():
            m = (side_mats or {}).get(k, mat)
            idx = [b + i for i in f]
            if flip:
                idx.reverse()
            self.add_face(idx, m)

    def ybox(self, cx, cy, yaw, lx, ly, z0, z1, mat, side_mats=None):
        """Box of size lx (along heading) x ly centred at (cx,cy), rotated by yaw (rad)."""
        U = Vector((math.cos(yaw), math.sin(yaw), 0.0))
        V = Vector((-math.sin(yaw), math.cos(yaw), 0.0))
        self.obox((cx, cy, 0.0), U, V, (0, 0, 1), -lx / 2, lx / 2, -ly / 2, ly / 2, z0, z1, mat, side_mats)

    # ------------------------------------------------------------------ revolved / extruded
    def cylinder(self, p0, p1, r0, mat, segs=12, r1=None, cap0=True, cap1=True, smooth=True, phase=0.0):
        p0, p1 = Vector(p0), Vector(p1)
        r1 = r0 if r1 is None else r1
        ax = (p1 - p0)
        if ax.length < 1e-9:
            return
        ax.normalize()
        t = Vector((1, 0, 0)) if abs(ax.x) < 0.9 else Vector((0, 1, 0))
        u = ax.cross(t).normalized()
        v = ax.cross(u).normalized()
        ring0, ring1 = [], []
        for i in range(segs):
            a = phase + 2 * math.pi * i / segs
            d = u * math.cos(a) + v * math.sin(a)
            ring0.append(p0 + d * r0)
            ring1.append(p1 + d * r1)
        b0 = self.add_verts(ring0)
        b1 = self.add_verts(ring1)
        for i in range(segs):
            j = (i + 1) % segs
            # outward winding: ring0[i] -> ring0[j] -> ring1[j] -> ring1[i]
            self.add_face((b0 + i, b0 + j, b1 + j, b1 + i), mat, smooth)
        # verify the orientation once and flip the side faces if needed
        f = self.faces[-segs]
        q = [self.verts[k] for k in f]
        cen = (p0 + p1) * 0.5
        if _newell(q).dot(((q[0] + q[2]) * 0.5) - cen) < 0:
            for k in range(len(self.faces) - segs, len(self.faces)):
                self.faces[k] = tuple(reversed(self.faces[k]))
        if cap0 and r0 > 0:
            self.add_face(tuple(reversed(range(b0, b0 + segs))), mat)
            self._fix_cap(-1, p0 - (p1 - p0))
        if cap1 and r1 > 0:
            self.add_face(tuple(range(b1, b1 + segs)), mat)
            self._fix_cap(-1, p1 + (p1 - p0))

    def _fix_cap(self, k, outward_point):
        f = self.faces[k]
        q = [self.verts[i] for i in f]
        c = sum(q, Vector()) / len(q)
        if _newell(q).dot(Vector(outward_point) - c) < 0:
            self.faces[k] = tuple(reversed(f))

    def prism(self, profile, y0, y1, mat, cap_mat=None, smooth=False):
        """Extrude a 2-D profile [(x, z), ...] (counter-clockwise seen from -y) along y."""
        n = len(profile)
        a = self.add_verts([(x, y0, z) for x, z in profile])
        b = self.add_verts([(x, y1, z) for x, z in profile])
        cap = cap_mat or mat
        pts = [Vector((x, y0, z)) for x, z in profile]
        ccw = _newell(pts).y < 0          # seen from -y the face normal must point to -y
        order = list(range(n)) if ccw else list(reversed(range(n)))
        self.add_face([a + i for i in order], cap)
        self.add_face([b + i for i in reversed(order)], cap)
        for k in range(n):
            i, j = order[k], order[(k + 1) % n]
            self.add_face((a + j, a + i, b + i, b + j), mat, smooth)

    def icosphere(self, center, radius, mat, subdiv=1, scale=(1, 1, 1), jitter=0.0, rng=None, smooth=False):
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0)
        base = len(self.verts)
        c = Vector(center)
        for v in bm.verts:
            p = v.co.copy()
            if jitter and rng is not None:
                p *= 1.0 + rng.uniform(-jitter, jitter)
            self.verts.append(c + Vector((p.x * radius * scale[0], p.y * radius * scale[1], p.z * radius * scale[2])))
        for f in bm.faces:
            self.add_face([base + v.index for v in f.verts], mat, smooth)
        bm.free()

    def loft(self, rings, mat, cap0=True, cap1=True, smooth=True):
        """Connect rings of equal length (each a closed loop of 3-D points) with quads."""
        n = len(rings[0])
        bases = [self.add_verts(r) for r in rings]
        for a, b in zip(bases[:-1], bases[1:]):
            for i in range(n):
                j = (i + 1) % n
                self.add_face((a + i, a + j, b + j, b + i), mat, smooth)
        # orient: the first quad must face away from the loft axis
        c0 = sum((Vector(p) for p in rings[0]), Vector()) / n
        c1 = sum((Vector(p) for p in rings[1]), Vector()) / n
        k0 = len(self.faces) - n * (len(rings) - 1)
        q = [self.verts[i] for i in self.faces[k0]]
        mid = (q[0] + q[2]) * 0.5
        axis_pt = (c0 + c1) * 0.5
        if _newell(q).dot(mid - axis_pt) < 0:
            for k in range(k0, len(self.faces)):
                self.faces[k] = tuple(reversed(self.faces[k]))
        if cap0:
            self.add_face(tuple(range(bases[0], bases[0] + n)), mat, smooth)
            self._fix_cap(-1, c0 - (c1 - c0))
        if cap1:
            cl = sum((Vector(p) for p in rings[-1]), Vector()) / n
            cp = sum((Vector(p) for p in rings[-2]), Vector()) / n
            self.add_face(tuple(range(bases[-1], bases[-1] + n)), mat, smooth)
            self._fix_cap(-1, cl + (cl - cp))

    def transform_since(self, start_vert, matrix):
        """Apply a 4x4 matrix to every vertex added since start_vert."""
        M = Matrix(matrix)
        for i in range(start_vert, len(self.verts)):
            self.verts[i] = M @ self.verts[i]

    # ------------------------------------------------------------------ grid solid (walls, slabs)
    def grid_solid(self, origin, U, V, W, us, vs, solid, w0, w1, matfn):
        """Manifold solid from a 2-D cell grid extruded along W.

        us, vs : sorted breakpoints along U and V;  solid(i, j) -> bool for cell [us[i],us[i+1]] x [vs[j],vs[j+1]].
        matfn(key, i, j) -> material name, key in '-w','+w','-u','+u','-v','+v'.
        (U, V, W) must be right-handed (U x V = W).
        """
        o, U, V, W = Vector(origin), Vector(U), Vector(V), Vector(W)
        nu, nv = len(us) - 1, len(vs) - 1
        S = [[bool(solid(i, j)) for j in range(nv)] for i in range(nu)]
        vid = {}

        def vi(i, j, k):
            key = (i, j, k)
            if key not in vid:
                vid[key] = len(self.verts)
                self.verts.append(o + U * us[i] + V * vs[j] + W * (w0 if k == 0 else w1))
            return vid[key]

        def sol(i, j):
            return 0 <= i < nu and 0 <= j < nv and S[i][j]

        for i in range(nu):
            for j in range(nv):
                if not S[i][j]:
                    continue
                self.add_face((vi(i, j, 0), vi(i, j + 1, 0), vi(i + 1, j + 1, 0), vi(i + 1, j, 0)), matfn("-w", i, j))
                self.add_face((vi(i, j, 1), vi(i + 1, j, 1), vi(i + 1, j + 1, 1), vi(i, j + 1, 1)), matfn("+w", i, j))
                if not sol(i - 1, j):
                    self.add_face((vi(i, j, 0), vi(i, j, 1), vi(i, j + 1, 1), vi(i, j + 1, 0)), matfn("-u", i, j))
                if not sol(i + 1, j):
                    self.add_face((vi(i + 1, j, 0), vi(i + 1, j + 1, 0), vi(i + 1, j + 1, 1), vi(i + 1, j, 1)), matfn("+u", i, j))
                if not sol(i, j - 1):
                    self.add_face((vi(i, j, 0), vi(i + 1, j, 0), vi(i + 1, j, 1), vi(i, j, 1)), matfn("-v", i, j))
                if not sol(i, j + 1):
                    self.add_face((vi(i, j + 1, 0), vi(i, j + 1, 1), vi(i + 1, j + 1, 1), vi(i + 1, j + 1, 0)), matfn("+v", i, j))

    # ------------------------------------------------------------------ output
    def to_object(self, coll, materials, bevel=None, smooth_angle=None, name=None):
        """Create the object.  materials: dict name -> bpy.types.Material."""
        if self.empty:
            return None
        name = name or self.name
        me = bpy.data.meshes.new(name)
        me.from_pydata([tuple(v) for v in self.verts], [], self.faces)
        me.validate(clean_customdata=False)
        for m in self.mats:
            me.materials.append(materials[m])
        if len(me.polygons) == len(self.fmat):
            me.polygons.foreach_set("material_index", self.fmat)
            me.polygons.foreach_set("use_smooth", self.fsmooth)
        me.update()
        ob = bpy.data.objects.new(name, me)
        coll.objects.link(ob)
        if bevel:
            md = ob.modifiers.new("Bevel", "BEVEL")
            md.width = bevel
            md.segments = 2
            md.limit_method = "ANGLE"
            md.angle_limit = math.radians(40)
            md.use_clamp_overlap = True
            md.harden_normals = False
        return ob


def mesh_object(name, coll, verts, faces, mat):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    if mat is not None:
        me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    return ob
