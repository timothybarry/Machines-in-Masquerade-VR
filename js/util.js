import * as THREE from 'three';

export const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const DEG = Math.PI / 180;
export const UP = V(0, 1, 0);
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const ease = t => t * t * (3 - 2 * t);
// Works either way round: smoothstep(0.9, 0.7, x) rises as x falls.
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const yq = y => new THREE.Quaternion().setFromAxisAngle(UP, y);
// Compass heading of a rotation: 0 when its nose points down -z, positive turning left.
export const headingOf = q => { const f = V(0, 0, -1).applyQuaternion(q); return Math.atan2(-f.x, -f.z); };
// The yaw that faces from a to b.
export const yawTo = (a, b) => Math.atan2(-(b.x - a.x), -(b.z - a.z));
// Signed smallest turn from angle a to angle b.
export const angleDiff = (a, b) => { let d = (b - a) % (2 * Math.PI); if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; return d; };

// Seeded random (mulberry32), so the world is laid out the same on every load.
export function makeRand(seed) {
  let s = seed;
  return () => {
    s = s + 0x6D2B79F5 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Smooth value noise and fractal noise in 0..1, for the terrain.
const hash2 = (x, z) => { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); };
export function noise2(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  let fx = x - ix, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx); fz = fz * fz * (3 - 2 * fz);
  return lerp(lerp(hash2(ix, iz), hash2(ix + 1, iz), fx), lerp(hash2(ix, iz + 1), hash2(ix + 1, iz + 1), fx), fz);
}
export function fbm2(x, z, octaves = 4) {
  let sum = 0, amp = 0.5, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) { sum += amp * noise2(x * freq + i * 17.3, z * freq - i * 9.1); norm += amp; amp *= 0.5; freq *= 2.03; }
  return sum / norm;
}

// Does segment a-b pass within r of c? Returns the fraction along the segment of the closest approach, or -1.
const segTmp = V(), segTmp2 = V();
export function segmentSphere(a, b, c, r) {
  segTmp.subVectors(b, a);
  const len2 = Math.max(segTmp.lengthSq(), 1e-9);
  const t = clamp(segTmp2.subVectors(c, a).dot(segTmp) / len2, 0, 1);
  segTmp2.copy(a).addScaledVector(segTmp, t);
  return segTmp2.distanceToSquared(c) < r * r ? t : -1;
}
