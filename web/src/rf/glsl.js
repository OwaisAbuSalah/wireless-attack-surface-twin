// GLSL (WebGL2 / GLSL ES 3.00) — GPU implementation of docs/MODEL.md.
// Mirrors web/src/rf/model.js exactly. One fragment = one map cell.

export const MAX_WALLS = 512;

export const MODEL_GLSL = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler2D;

#define MAXW ${MAX_WALLS}
#define PI 3.141592653589793

uniform sampler2D uWalls;   // 4 texels per wall: (ax,ay,bx,by) (z0,z1,mat,len|-1) (sill,head,period,width) (offset,openMat,-,-)
uniform int   uWallCount;
uniform float uMatLoss[16];
uniform float uSlabZ[4];
uniform int   uSlabCount;
uniform float uSlabLoss;
uniform vec4  uFoot;        // x0,y0,x1,y1
uniform float uPL0;
uniform float uN;
uniform float uDmin;

// router antenna
uniform int   uAntType;     // 0 = half-wave dipole, 1 = 3GPP patch
uniform vec3  uBore;
uniform vec3  uAntY;
uniform vec3  uAntZ;
uniform float uGmax;
uniform float uHpbw;        // radians
uniform float uSla;

float log10f(float x) { return log(x) * 0.43429448190325176; }

float wallsLoss(vec3 a, vec3 b) {
  float total = 0.0;
  vec2 r = b.xy - a.xy;
  float zmin = min(a.z, b.z);
  float zmax = max(a.z, b.z);
  for (int i = 0; i < MAXW; i++) {
    if (i >= uWallCount) break;
    vec4 w1 = texelFetch(uWalls, ivec2(i * 4 + 1, 0), 0);
    if (zmax < w1.x - 1e-4 || zmin > w1.y + 1e-4) continue;
    vec4 w0 = texelFetch(uWalls, ivec2(i * 4, 0), 0);
    vec2 s = w0.zw - w0.xy;
    float rxs = r.x * s.y - r.y * s.x;
    if (abs(rxs) < 1e-9) continue;
    vec2 q = w0.xy - a.xy;
    float t = (q.x * s.y - q.y * s.x) / rxs;
    float u = (q.x * r.y - q.y * r.x) / rxs;
    // tolerances make exact coincidences (rays through wall junctions, opening edges, storey
    // boundaries) resolve identically in float32 (GPU) and float64 (CPU) — see MODEL.md §2.1
    if (t <= 1e-5 || t >= 1.0 - 1e-5 || u < -1e-5 || u > 1.0 + 1e-5) continue;
    float zc = a.z + t * (b.z - a.z);
    if (zc < w1.x - 1e-4 || zc > w1.y + 1e-4) continue;
    int mat = int(w1.z + 0.5);
    if (w1.w > 0.0) {
      vec4 w2 = texelFetch(uWalls, ivec2(i * 4 + 2, 0), 0);
      vec4 w3 = texelFetch(uWalls, ivec2(i * 4 + 3, 0), 0);
      float m = u * w1.w - w3.x;
      if (w2.z > 0.0) { m = mod(m, w2.z); if (m > w2.z - 1e-4) m -= w2.z; }
      float h = zc - w1.x;
      if (m >= -1e-4 && m <= w2.w + 1e-4 && h >= w2.x - 1e-4 && h <= w2.y + 1e-4) mat = int(w3.y + 0.5);
    }
    total += uMatLoss[mat];
  }
  for (int k = 0; k < 4; k++) {
    if (k >= uSlabCount) break;
    float zs = uSlabZ[k];
    if ((a.z - zs) * (b.z - zs) < 0.0) {
      float t = (zs - a.z) / (b.z - a.z);
      vec2 p = a.xy + t * r;
      if (p.x >= uFoot.x - 1e-4 && p.x <= uFoot.z + 1e-4 && p.y >= uFoot.y - 1e-4 && p.y <= uFoot.w + 1e-4) total += uSlabLoss;
    }
  }
  return total;
}

float pathLoss(vec3 a, vec3 b) {
  float d = max(distance(a, b), uDmin);
  return uPL0 + 10.0 * uN * log10f(d) + wallsLoss(a, b);
}

float antennaGain(vec3 v) {
  if (uAntType == 0) {
    float el = asin(clamp(v.z, -1.0, 1.0));
    float c = cos(el);
    float F = 0.0;
    if (c >= 1e-3) F = cos(0.5 * PI * sin(el)) / c;
    return 2.15 + 10.0 * log10f(max(F * F, 1e-3));
  }
  float phi = atan(dot(v, uAntY), dot(v, uBore));
  float th = asin(clamp(dot(v, uAntZ), -1.0, 1.0));
  float AH = -min(12.0 * (phi / uHpbw) * (phi / uHpbw), uSla);
  float AV = -min(12.0 * (th / uHpbw) * (th / uHpbw), uSla);
  return uGmax - min(-(AH + AV), uSla);
}
`;

export const COMPUTE_VERT = /* glsl */ `
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export const COMPUTE_FRAG = /* glsl */ `
${MODEL_GLSL}

uniform int   uMode;        // 0 = outdoor plane, 1 = stacked floor planes
uniform vec2  uOrigin;
uniform float uCell;
uniform float uZ;
uniform float uFloorZ[3];
uniform int   uFloorRows;

uniform vec3  uTxs[4];
uniform int   uTxCount;
uniform float uPtx;

uniform vec3  uClients[8];
uniform float uClientRss[8];
uniform int   uClientCount;
uniform float uAttEirp;     // attacker P_tx + G_att
uniform float uEtMargin;
uniform float uEtMin;
uniform float uClientSens;
uniform vec3  uAttacker;

layout(location = 0) out highp vec4 outField;

void main() {
  vec2 fc = gl_FragCoord.xy;
  vec3 rx;
  if (uMode == 0) {
    rx = vec3(uOrigin + fc * uCell, uZ);
  } else {
    int k = int(fc.y) / uFloorRows;
    float jy = fc.y - float(k * uFloorRows);
    rx = vec3(uOrigin.x + fc.x * uCell, uOrigin.y + jy * uCell, uFloorZ[k]);
  }
  // strongest access point (micro-cell design → several APs)
  float rss = -1e4;
  for (int k = 0; k < 4; k++) {
    if (k >= uTxCount) break;
    vec3 dv = rx - uTxs[k];
    float dl = length(dv);
    vec3 v = dl > 1e-6 ? dv / dl : vec3(1.0, 0.0, 0.0);
    rss = max(rss, uPtx + antennaGain(v) - pathLoss(uTxs[k], rx));
  }

  if (uMode == 0) {
    // reciprocity: attacker standing here → each client
    float deauth = -1e4;
    float et = -1e4;
    for (int c = 0; c < 8; c++) {
      if (c >= uClientCount) break;
      float s = uAttEirp - pathLoss(uClients[c], rx);
      deauth = max(deauth, s - uClientSens);
      et = max(et, min(s - uClientRss[c] - uEtMargin, s - uEtMin));
    }
    outField = vec4(rss, deauth, et, 1.0);
  } else {
    float att = uAttEirp - pathLoss(uAttacker, rx);   // rogue AP signal inside
    outField = vec4(rss, att, 0.0, 1.0);
  }
}
`;

// Turbo colormap (Google, polynomial approximation) — sRGB output.
export const PALETTE_GLSL = /* glsl */ `
vec3 turbo(float x) {
  const vec4 kR4 = vec4(0.13572138, 4.61539260, -42.66032258, 132.13108234);
  const vec4 kG4 = vec4(0.09140261, 2.19418839, 4.84296658, -14.18503333);
  const vec4 kB4 = vec4(0.10667330, 12.64194608, -60.58204836, 110.36276771);
  const vec2 kR2 = vec2(-152.94239396, 59.28637943);
  const vec2 kG2 = vec2(4.27729857, 2.82956604);
  const vec2 kB2 = vec2(-89.90310912, 27.34824973);
  x = clamp(x, 0.0, 1.0);
  vec4 v4 = vec4(1.0, x, x * x, x * x * x);
  vec2 v2 = v4.zw * v4.z;
  return clamp(vec3(dot(v4, kR4) + dot(v2, kR2), dot(v4, kG4) + dot(v2, kG2), dot(v4, kB4) + dot(v2, kB2)), 0.0, 1.0);
}
vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }
float isoLine(float v, float w) {           // anti-aliased line where v == 0
  float d = abs(v) / max(fwidth(v), 1e-4);
  return 1.0 - smoothstep(0.0, w, d);
}
float gridLines(float v, float step, float w) {
  float f = v / step;
  float d = abs(fract(f - 0.5) - 0.5) / max(fwidth(f), 1e-4);
  return 1.0 - smoothstep(0.0, w, d);
}
vec3 diverging(float x) {                    // blue – white – red, x in [-1,1]
  x = clamp(x, -1.0, 1.0);
  vec3 neg = vec3(0.13, 0.40, 0.95), mid = vec3(0.96, 0.96, 0.96), pos = vec3(0.95, 0.22, 0.25);
  return x < 0.0 ? mix(mid, neg, -x) : mix(mid, pos, x);
}
`;
