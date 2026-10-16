// Gameplay collision: axis-aligned solid boxes filed by 80 m cell, plus the terrain.
// (Debris and knocked-over props use the physics engine instead; see physics.js.)
import { V } from './util.js';
import { terrainHeight, terrainNormal } from './terrain.js';

export const CELL = 80;
const solids = new Map();
const NONE = [];
const cellOf = v => Math.round(v / CELL);
const listAt = (x, z) => solids.get(cellOf(x) + ',' + cellOf(z)) ?? NONE;

// Filed under every cell it could touch (with a margin for the widest body), so a lookup in the
// body's own cell always finds it. `owner` says what the box belongs to (a building, a prop...).
export function addSolid(cx, cz, w, d, top, bottom = 0, owner = null) {
  const b = { minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, top, bottom, owner, dead: false };
  const m = 5;
  for (let i = cellOf(b.minX - m); i <= cellOf(b.maxX + m); i++)
    for (let j = cellOf(b.minZ - m); j <= cellOf(b.maxZ + m); j++) {
      const k = i + ',' + j;
      if (!solids.has(k)) solids.set(k, []);
      solids.get(k).push(b);
    }
  return b;
}

// The surface under (x, z) for something at height y that can step up `step` metres.
export function groundAt(x, z, y = 1e9, step = 0.8) {
  let g = terrainHeight(x, z);
  for (const b of listAt(x, z))
    if (!b.dead && x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ && y >= b.top - step && b.top > g) g = b.top;
  return g;
}

// Pushes p out of any wall it has moved into and stops the velocity going into it.
// Boxes low enough to step onto are left alone; groundAt lifts the body onto them.
export function pushOut(p, r, vel, step = 0.8) {
  let hit = null;
  for (const b of listAt(p.x, p.z)) {
    if (b.dead || p.y >= b.top - step || p.y < b.bottom - 4) continue;
    const a = p.x - (b.minX - r), c = b.maxX + r - p.x, e = p.z - (b.minZ - r), f = b.maxZ + r - p.z;
    if (a <= 0 || c <= 0 || e <= 0 || f <= 0) continue;
    const m = Math.min(a, c, e, f);
    if (m === a) { p.x -= a; vel.x = Math.min(vel.x, 0); }
    else if (m === c) { p.x += c; vel.x = Math.max(vel.x, 0); }
    else if (m === e) { p.z -= e; vel.z = Math.min(vel.z, 0); }
    else { p.z += f; vel.z = Math.max(vel.z, 0); }
    hit = b;
  }
  return hit;
}

// Is this point inside a solid? (AI uses it to look ahead.)
export function solidAt(x, y, z) {
  for (const b of listAt(x, z)) if (!b.dead && x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ && y < b.top && y > b.bottom) return b;
  return null;
}

// Solids whose box comes within r of a point.
export function solidsNear(p, r) {
  const out = new Set();
  for (let i = cellOf(p.x - r); i <= cellOf(p.x + r); i++)
    for (let j = cellOf(p.z - r); j <= cellOf(p.z + r); j++)
      for (const b of solids.get(i + ',' + j) ?? NONE) {
        if (b.dead) continue;
        const dx = Math.max(b.minX - p.x, 0, p.x - b.maxX), dy = Math.max(b.bottom - p.y, 0, p.y - b.top), dz = Math.max(b.minZ - p.z, 0, p.z - b.maxZ);
        if (dx * dx + dy * dy + dz * dz < r * r) out.add(b);
      }
  return out;
}

// First thing segment a-b hits: a solid box or the terrain. Returns { t, point, normal, solid } or null.
const dir = V();
export function segmentHit(a, b) {
  dir.subVectors(b, a);
  let best = null;
  const seen = new Set();
  for (let i = cellOf(Math.min(a.x, b.x)); i <= cellOf(Math.max(a.x, b.x)); i++)
    for (let j = cellOf(Math.min(a.z, b.z)); j <= cellOf(Math.max(a.z, b.z)); j++)
      for (const s of solids.get(i + ',' + j) ?? NONE) {
        if (s.dead || seen.has(s)) continue;
        seen.add(s);
        const h = slab(a, dir, s);
        if (h && (!best || h.t < best.t)) best = { t: h.t, normal: h.n, solid: s };
      }
  // terrain: the end is below ground, so bisect for the crossing
  if (b.y < terrainHeight(b.x, b.z) + 0.05) {
    let lo = 0, hi = 1;
    for (let k = 0; k < 10; k++) {
      const m = (lo + hi) / 2, x = a.x + dir.x * m, z = a.z + dir.z * m;
      if (a.y + dir.y * m < terrainHeight(x, z)) hi = m; else lo = m;
    }
    if (!best || hi < best.t) best = { t: hi, normal: null, solid: null, ground: true };
  }
  if (!best) return null;
  best.point = a.clone().addScaledVector(dir, best.t);
  if (!best.normal) best.normal = best.ground ? terrainNormal(best.point.x, best.point.z) : dir.clone().normalize().negate();
  return best;
}
// Segment a + d*t (t in 0..1) against a box { minX, maxX, bottom, top, minZ, maxZ }: { t, n } or null.
export function slab(a, d, s) {
  let t0 = 0, t1 = 1, n = null;
  const axes = [['x', s.minX, s.maxX], ['y', s.bottom, s.top], ['z', s.minZ, s.maxZ]];
  for (const [k, lo, hi] of axes) {
    if (Math.abs(d[k]) < 1e-9) { if (a[k] < lo || a[k] > hi) return null; continue; }
    let ta = (lo - a[k]) / d[k], tb = (hi - a[k]) / d[k], sign = -1;
    if (ta > tb) { [ta, tb] = [tb, ta]; sign = 1; }
    if (ta > t0) { t0 = ta; n = V(); n[k] = sign; }
    t1 = Math.min(t1, tb);
    if (t0 > t1) return null;
  }
  return { t: t0, n };
}
