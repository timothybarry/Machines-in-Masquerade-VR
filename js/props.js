// Street furniture and clutter. Everything stands still (drawn with instancing) until it is hit,
// rammed or caught in a blast; then it is handed to the physics engine and flies, rolls and topples.
// Some things do more: hydrants spray, cars burn and explode, barrels and fuel tanks blow up and set
// off their neighbours, crates and containers burst open and sometimes hold a power-up.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { V, UP, clamp, makeRand } from './util.js';
import { G } from './state.js';
import { Batch } from './batch.js';
import { PhysPool, spawnDebris } from './physics.js';
import { addSolid, slab } from './collision.js';
import { terrainHeight } from './terrain.js';
import { crateTexture, containerTexture, billboardAtlas, canvasTex } from './textures.js';

const rand = makeRand(515);
const HCELL = 16;

// ---------- geometry helpers (origin at the base, the "front" faces -z) ----------
const box = (w, h, d, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const cyl = (r1, r2, h, seg, x = 0, y = 0, z = 0) => new THREE.CylinderGeometry(r1, r2, h, seg).translate(x, y, z);
const merge = (...gs) => mergeGeometries(gs.map(g => g.index ? g.toNonIndexed() : g));
function colored(geo, hex) { // bake a vertex colour so several colours can share one basic material
  const c = new THREE.Color(hex), n = geo.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
}
const std = (color, metal = 0.3, rough = 0.6, extra = {}) => new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: rough, ...extra });

// A picket fence painted on a canvas: rails and pickets, see-through between them.
function picketTexture() {
  const t = canvasTex(256, 64, g => {
    g.fillStyle = '#e8e4da';
    g.fillRect(0, 18, 256, 6); g.fillRect(0, 44, 256, 6);
    for (let x = 4; x < 256; x += 28) { g.fillRect(x, 6, 12, 58); g.beginPath(); g.moveTo(x, 6); g.lineTo(x + 6, 0); g.lineTo(x + 12, 6); g.fill(); }
  });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

function defineTypes() {
  const M = {
    metal: std(0x3a3d42, 0.7, 0.45), steel: std(0x9aa0a8, 0.8, 0.35),
    lamp: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffe2b0, emissiveIntensity: 0.6 }),
    red: std(0xb8281f, 0.3, 0.5), wood: std(0x8a6a45, 0, 0.8), green: std(0x2e4a33, 0.2, 0.6),
    glass: std(0x9fc8e8, 0.2, 0.05, { transparent: true, opacity: 0.35 }),
    trunk: new THREE.MeshLambertMaterial({ color: 0x5a4029 }), leaves: new THREE.MeshLambertMaterial({ flatShading: true }),
    frond: new THREE.MeshLambertMaterial({ color: 0x4a8a30, side: THREE.DoubleSide }),
    paint: std(0xffffff, 0.5, 0.32), carGlass: std(0x161c24, 0.7, 0.1), rubber: std(0x151515, 0, 0.9),
    lights: new THREE.MeshBasicMaterial({ vertexColors: true }),
    white: std(0xe8e4da, 0, 0.7), blue: std(0x2a4a8a, 0.3, 0.5),
    picket: new THREE.MeshStandardMaterial({ map: picketTexture(), alphaTest: 0.5, roughness: 0.7, side: THREE.DoubleSide }),
    crate: new THREE.MeshStandardMaterial({ map: crateTexture(), roughness: 0.85 }),
    container: new THREE.MeshStandardMaterial({ map: containerTexture(), roughness: 0.6, metalness: 0.4 }),
    barrel: std(0xb02020, 0.4, 0.45), tank: std(0xdedcd4, 0.5, 0.4), pump: std(0xd03030, 0.3, 0.4),
  };
  // palm: a gently curving trunk and drooping fronds
  const palmTrunk = merge(...Array.from({ length: 3 }, (_, i) => new THREE.CylinderGeometry(0.28 - i * 0.05, 0.34 - i * 0.05, 4, 6, 1, true).translate(i * i * 0.18, 2 + i * 4, 0)));
  const fronds = merge(...Array.from({ length: 8 }, (_, i) => {
    const g = new THREE.PlaneGeometry(1, 4.5, 1, 3).translate(0, 2.25, 0);
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) { const y = p.getY(k); p.setZ(k, -y * y * 0.06); } // droop
    g.rotateX(-1.2).rotateY(i * Math.PI / 4).translate(1.0, 12, 0);
    return g;
  }));
  const board = tile => { // a billboard face showing one ad from the atlas
    const g = box(10, 5, 0.3, 0, 11.5, 0), uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.5 + (tile % 2) * 0.5, uv.getY(i) * 0.5 + Math.floor(tile / 2) * 0.5);
    return g;
  };
  const adMat = new THREE.MeshStandardMaterial({ map: billboardAtlas(), roughness: 0.5, emissive: 0xffffff, emissiveIntensity: 0.15 });
  adMat.emissiveMap = adMat.map;
  const lamp = (w, x, y, z, back) => new THREE.PlaneGeometry(w, 0.14).rotateY(back ? 0 : Math.PI).translate(x, y, z);
  const carLights = merge(colored(lamp(0.42, 0.6, 0.72, -2.21), 0xfff4d0), colored(lamp(0.42, -0.6, 0.72, -2.21), 0xfff4d0),
    colored(lamp(0.4, 0.65, 0.74, 2.21, true), 0xff2020), colored(lamp(0.4, -0.65, 0.74, 2.21, true), 0xff2020));
  const wheels = merge(...[[0.85, 1.35], [-0.85, 1.35], [0.85, -1.35], [-0.85, -1.35]].map(([x, z]) => cyl(0.36, 0.36, 0.3, 8).rotateZ(Math.PI / 2).translate(x, 0.36, z)),
    box(1.96, 0.22, 0.18, 0, 0.42, -2.24), box(1.96, 0.22, 0.18, 0, 0.42, 2.24));
  const trafficLamps = merge(colored(box(0.22, 0.22, 0.06, 0, 6.25, -4.83), 0xff2a2a), colored(box(0.22, 0.22, 0.06, 0, 5.9, -4.83), 0xffb020), colored(box(0.22, 0.22, 0.06, 0, 5.55, -4.83), 0x30ff60));

  // half: collider half-extents, cy: collider centre height, h: height, knock: speed needed to knock it,
  // hp: shots to break loose, solid: blocks bodies, stat: never moves (only blows up)
  const T = {
    lamp: { parts: [[merge(cyl(0.12, 0.18, 9, 8, 0, 4.5, 0), box(0.14, 0.14, 3.2, 0, 8.9, -1.6)), M.metal], [box(0.5, 0.25, 1.1, 0, 8.75, -3.1), M.lamp]],
      half: V(0.25, 4.5, 0.25), mass: 300, knock: 3, hp: 8, cap: 40 },
    traffic: { parts: [[merge(cyl(0.12, 0.15, 6.5, 8, 0, 3.25, 0), box(0.12, 0.12, 5, 0, 6.3, -2.5), box(0.4, 1.1, 0.35, 0, 5.9, -4.6)), M.metal], [trafficLamps, M.lights]],
      half: V(0.25, 3.25, 0.25), mass: 250, knock: 3, hp: 8, cap: 20 },
    hydrant: { parts: [[merge(cyl(0.22, 0.25, 0.7, 8, 0, 0.35, 0), cyl(0.28, 0.28, 0.08, 8, 0, 0.72, 0), box(0.55, 0.12, 0.12, 0, 0.45, 0)), M.red]],
      half: V(0.25, 0.4, 0.25), mass: 120, knock: 2, hp: 5, cap: 15, water: true, shadow: false },
    bench: { parts: [[merge(box(1.8, 0.08, 0.5, 0, 0.45, 0), box(1.8, 0.45, 0.06, 0, 0.75, 0.22)), M.wood], [merge(box(0.08, 0.45, 0.5, 0.8, 0.22, 0), box(0.08, 0.45, 0.5, -0.8, 0.22, 0)), M.metal]],
      half: V(0.9, 0.45, 0.3), mass: 50, knock: 2, hp: 4, cap: 15, shadow: false },
    bin: { parts: [[cyl(0.32, 0.28, 1, 8, 0, 0.5, 0), M.green]], half: V(0.32, 0.5, 0.32), mass: 25, knock: 1.5, hp: 3, cap: 20, shadow: false },
    busStop: { parts: [[merge(...[[1.9, 0.7], [-1.9, 0.7], [1.9, -0.7], [-1.9, -0.7]].map(([x, z]) => cyl(0.05, 0.05, 2.6, 6, x, 1.3, z)), box(4.2, 0.12, 1.7, 0, 2.65, 0)), M.steel],
      [merge(box(4, 2, 0.04, 0, 1.3, 0.7), box(0.04, 2, 1.3, 1.95, 1.3, 0), box(0.04, 2, 1.3, -1.95, 1.3, 0)), M.glass], [box(3.6, 0.1, 0.4, 0, 0.5, 0.4), M.metal]],
      half: V(2.1, 1.35, 0.85), mass: 400, knock: 4, hp: 10, cap: 8 },
    tree: { parts: [[cyl(0.25, 0.4, 3.2, 6, 0, 1.6, 0), M.trunk, false, true], [new THREE.IcosahedronGeometry(1, 1).scale(3, 2.6, 3).translate(0, 4.6, 0), M.leaves, true]],
      half: V(0.45, 2.5, 0.45), mass: 900, knock: 5, hp: 14, cap: 25 },
    pine: { parts: [[cyl(0.2, 0.35, 2, 6, 0, 1, 0), M.trunk, false, true], [new THREE.ConeGeometry(2.6, 9, 7).translate(0, 5.9, 0), M.leaves, true]],
      half: V(0.4, 4, 0.4), mass: 700, knock: 5, hp: 12, cap: 20 },
    palm: { parts: [[palmTrunk, M.trunk, false, true], [fronds, M.frond]], half: V(0.35, 5.5, 0.35), mass: 500, knock: 4, hp: 10, cap: 20 },
    fence: { parts: [[box(4, 1.1, 0.06, 0, 0.55, 0), M.picket]], half: V(2, 0.6, 0.1), mass: 40, knock: 1.5, hp: 3, cap: 40, shadow: false },
    mailbox: { parts: [[merge(box(0.1, 1, 0.1, 0, 0.5, 0), box(0.25, 0.3, 0.5, 0, 1.1, 0)), M.blue]], half: V(0.15, 0.65, 0.28), mass: 15, knock: 1.5, hp: 2, cap: 15, shadow: false },
    car: { parts: [[merge(box(1.9, 0.62, 4.4, 0, 0.6, 0), box(1.6, 0.08, 1.9, 0, 1.49, 0.25)), M.paint, true], [box(1.66, 0.55, 2.15, 0, 1.18, 0.25), M.carGlass, false, true], [wheels, M.rubber, false, true], [carLights, M.lights, false, true]],
      half: V(0.95, 0.72, 2.2), mass: 1300, knock: 4, hp: 60, cap: 36, solid: true, car: true, drop: 0.12 },
    crate: { parts: [[box(1.5, 1.5, 1.5, 0, 0.75, 0), M.crate]], half: V(0.75, 0.75, 0.75), mass: 90, knock: 3, hp: 12, cap: 40, solid: true, crate: true, drop: 0.45 },
    container: { parts: [[box(12.2, 2.6, 2.44, 0, 1.3, 0), M.container, true]], half: V(6.1, 1.3, 1.22), mass: 4000, knock: 25, hp: 140, cap: 16, solid: true, burst: true, drop: 0.35 },
    barrel: { parts: [[merge(cyl(0.35, 0.35, 1, 12, 0, 0.5, 0), cyl(0.37, 0.37, 0.06, 12, 0, 0.3, 0), cyl(0.37, 0.37, 0.06, 12, 0, 0.7, 0)), M.barrel]],
      half: V(0.35, 0.5, 0.35), mass: 60, knock: 3, hp: 6, cap: 20, boom: { radius: 10, damage: 45, scale: 1.3 } },
    fuelTank: { parts: [[merge(cyl(6, 6, 10, 28, 0, 5, 0), new THREE.SphereGeometry(6, 28, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.35, 1).translate(0, 10, 0)), M.tank],
      [merge(box(0.1, 11, 0.6, 6.05, 5.5, 0), cyl(6.05, 6.05, 0.4, 28, 0, 3, 0), cyl(6.05, 6.05, 0.4, 28, 0, 7, 0)), M.metal]],
      half: V(6, 5, 6), mass: 1e9, hp: 160, cap: 1, solid: true, stat: true, boom: { radius: 34, damage: 120, scale: 3.5 } },
    pump: { parts: [[box(0.8, 1.8, 0.5, 0, 0.9, 0), M.pump], [box(0.84, 0.25, 0.54, 0, 1.75, 0), M.white]], half: V(0.4, 0.9, 0.25), mass: 1e9, hp: 20, cap: 1, solid: true, stat: true, boom: { radius: 14, damage: 70, scale: 1.7 } },
  };
  for (let i = 0; i < 4; i++) T['billboard' + i] = { parts: [[merge(cyl(0.25, 0.3, 10, 8, 4, 5, 0), cyl(0.25, 0.3, 10, 8, -4, 5, 0), box(10.4, 5.4, 0.2, 0, 11.5, 0.2)), M.metal], [board(i), adMat]],
    half: V(5, 7, 0.35), mass: 2500, knock: 12, hp: 30, cap: 6 };
  // far-off trees: same as near ones but no shadows
  T.treeFar = { ...T.tree, far: true };
  T.pineFar = { ...T.pine, far: true };
  for (const [k, t] of Object.entries(T)) {
    t.name = k;
    t.parts = t.parts.map(([geo, mat, tint, noShadow]) => ({ geo, mat, tint: !!tint, noShadow: !!noShadow }));
    t.h = t.half.y * 2;
  }
  return T;
}

export function createProps(scene) {
  const T = defineTypes();
  const all = [], hash = new Map();
  let built = false;

  const cellKey = (i, j) => i + ',' + j;
  function hashAdd(p) {
    for (let i = Math.floor(p.box.minX / HCELL); i <= Math.floor(p.box.maxX / HCELL); i++)
      for (let j = Math.floor(p.box.minZ / HCELL); j <= Math.floor(p.box.maxZ / HCELL); j++) {
        const k = cellKey(i, j);
        if (!hash.has(k)) hash.set(k, []);
        hash.get(k).push(p);
      }
  }
  function* near(x0, z0, x1, z1) {
    const seen = new Set();
    for (let i = Math.floor(x0 / HCELL); i <= Math.floor(x1 / HCELL); i++)
      for (let j = Math.floor(z0 / HCELL); j <= Math.floor(z1 / HCELL); j++)
        for (const p of hash.get(cellKey(i, j)) ?? []) if (!p.gone && !seen.has(p)) { seen.add(p); yield p; }
  }

  const props = {
    types: T,
    // Place a prop. o: { y, scale, color }
    add(type, x, z, rotY = 0, o = {}) {
      const t = T[type], s = o.scale ?? 1, y = o.y ?? terrainHeight(x, z);
      const c = Math.abs(Math.cos(rotY)), sn = Math.abs(Math.sin(rotY));
      const hx = (t.half.x * c + t.half.z * sn) * s, hz = (t.half.x * sn + t.half.z * c) * s;
      const p = { t, x, y, z, rotY, s, color: o.color ?? null, hp: t.hp * s, gone: false, idx: [],
        box: { minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz, bottom: y, top: y + t.h * s } };
      all.push(p);
      hashAdd(p);
      return p;
    },
    build() {
      for (const t of Object.values(T)) {
        const mine = all.filter(p => p.t === t);
        t.batches = t.parts.map(part => new Batch(part.geo, part.mat, { tint: part.tint, shadow: !t.far && t.shadow !== false && !part.noShadow }));
        for (const p of mine) {
          const q = new THREE.Quaternion().setFromAxisAngle(UP, p.rotY);
          p.idx = t.batches.map(b => b.add(V(p.x, p.y, p.z), q, V(p.s, p.s, p.s), p.color ?? 0xffffff));
          if (t.solid) p.solid = addSolid(p.x, p.z, p.box.maxX - p.box.minX, p.box.maxZ - p.box.minZ, p.box.top, p.box.bottom, { prop: p });
        }
        t.batches.forEach(b => b.build(scene));
        if (!t.stat) t.pool = new PhysPool(scene, t.parts, t.cap, { shadow: !t.far && t.shadow !== false });
      }
      built = true;
    },

    // Hand a standing prop to the physics engine with this velocity.
    activate(p, vel, spin = null) {
      if (p.gone || p.t.stat) return null;
      p.gone = true;
      p.t.batches.forEach((b, k) => b.hide(p.idx[k]));
      if (p.solid) p.solid.dead = true;
      const t = p.t, s = p.s;
      if (t.water) G.fx.emit('water', V(p.x, p.y, p.z), 14);
      // tall things topple: spin them about the horizontal axis across the push
      const flat = V(vel.x, 0, vel.z), sp = flat.length();
      // (spinning about UP x push tips the top toward the push)
      const ang = spin ?? (t.h * s > 3 && sp > 0.1 ? new THREE.Vector3().crossVectors(UP, flat.normalize()).multiplyScalar(Math.min(6, sp / (t.h * s) * 2.2)) : V());
      const item = t.pool.spawn({
        pos: V(p.x, p.y, p.z), quat: new THREE.Quaternion().setFromAxisAngle(UP, p.rotY), half: t.half.clone().multiplyScalar(s), offset: V(0, t.half.y * s, 0),
        scale: V(s, s, s), vel: t.h * s > 3 ? vel.clone().multiplyScalar(0.35) : vel, angvel: ang,
        density: t.mass / (8 * t.half.x * t.half.y * t.half.z), color: p.color, life: t.car ? 90 : 60,
        data: t.car ? { car: true, hp: p.hp, burnt: false } : null,
      });
      return item;
    },

    // A body moving through: knocks over what it hits. Returns the mass it knocked (to slow the body).
    knock(pos, r, vel, mass, height = 3) {
      if (!built) return 0;
      const speed = Math.hypot(vel.x, vel.z);
      if (speed < 1.5) return 0;
      let knocked = 0;
      for (const p of near(pos.x - r, pos.z - r, pos.x + r, pos.z + r)) {
        const b = p.box, t = p.t;
        if (t.stat || pos.y + height < b.bottom || pos.y > b.top - 0.2) continue;
        const dx = Math.max(b.minX - pos.x, 0, pos.x - b.maxX), dz = Math.max(b.minZ - pos.z, 0, pos.z - b.maxZ);
        if (dx * dx + dz * dz > r * r || speed < t.knock) continue;
        if (t.crate && speed > 10) { props.breakOpen(p, vel); knocked += t.mass; continue; }
        const k = clamp(mass / (mass + t.mass) * 1.6, 0.15, 1.6);
        props.activate(p, V(vel.x * k + (rand() - 0.5) * 2, speed * k * 0.25 + 1, vel.z * k + (rand() - 0.5) * 2));
        if (t.car) G.audio?.crunch(p);
        knocked += t.mass;
      }
      return knocked;
    },

    // First standing prop hit by segment a-b: { prop, t, point, normal } or null.
    hitSegment(a, b) {
      const d = V().subVectors(b, a);
      let best = null;
      for (const p of near(Math.min(a.x, b.x), Math.min(a.z, b.z), Math.max(a.x, b.x), Math.max(a.z, b.z))) {
        if (p.t.solid) continue; // solid props are found by collision.segmentHit
        const h = slab(a, d, p.box);
        if (h && (!best || h.t < best.t)) best = { prop: p, t: h.t, normal: h.n };
      }
      if (best) best.point = a.clone().addScaledVector(d, best.t);
      return best;
    },

    // Shots and blasts wear props down; then they break loose, burst or blow up.
    damage(p, amount, dir = V(), point = null) {
      if (p.gone) return;
      p.hp -= amount;
      const t = p.t;
      if (p.hp > 0) {
        if (t.boom && p.hp < t.hp * 0.5 && !p.burning) { p.burning = true; G.fx.emit('fire', V(p.x, p.box.top, p.z), 3, t.stat ? 3 : 0.8); } // fuse
        return;
      }
      if (t.boom) return props.blowUp(p);
      if (t.car) return props.carExplode(p);
      if (t.crate || t.burst) return props.breakOpen(p, dir.clone().multiplyScalar(6));
      props.activate(p, dir.clone().multiplyScalar(8).add(V(0, 3, 0)));
    },

    blowUp(p) {
      if (p.gone) return;
      p.gone = true;
      p.t.batches.forEach((b, k) => b.hide(p.idx[k]));
      if (p.solid) p.solid.dead = true;
      const t = p.t, c = V(p.x, p.y + t.h * p.s * 0.5, p.z);
      G.weapons.explode(c, { radius: t.boom.radius, damage: t.boom.damage, bld: t.boom.damage * 3, hole: t.boom.radius * 0.3, scale: t.boom.scale, owner: 'world' });
      const n = t.stat ? 16 : 5;
      for (let i = 0; i < n; i++) spawnDebris(c.clone().add(V((rand() - 0.5) * t.half.x * 2, (rand() - 0.5) * t.h, (rand() - 0.5) * t.half.z * 2)),
        V(0.4 + rand() * t.half.x * 0.6, 0.2 + rand() * t.half.y * 0.4, 0.3 + rand() * 0.8), t.stat ? 0xcfcdc5 : 0x8a1a14, V((rand() - 0.5) * 30, 10 + rand() * 20, (rand() - 0.5) * 30));
      if (t.stat) for (let i = 0; i < 3; i++) G.fx.emit('fire', V(p.x + (rand() - 0.5) * 8, p.y + 1, p.z + (rand() - 0.5) * 8), 30, 3);
    },

    carExplode(p, item = null) {
      const pos = item ? (() => { const t = item.body.translation(); return V(t.x, t.y, t.z); })() : V(p.x, p.y + 0.8, p.z);
      if (!item) item = props.activate(p, V((rand() - 0.5) * 4, 9, (rand() - 0.5) * 4), V((rand() - 0.5) * 3, (rand() - 0.5) * 2, (rand() - 0.5) * 3));
      if (!item) return;
      item.data = { car: true, hp: 0, burnt: true };
      item.color = new THREE.Color(0x1c1a18);
      item.body.applyImpulse({ x: 0, y: item.body.mass() * 7, z: 0 }, true);
      item.body.applyTorqueImpulse({ x: (rand() - 0.5) * item.body.mass() * 3, y: 0, z: (rand() - 0.5) * item.body.mass() * 3 }, true);
      G.fx.emit('fire', pos, 25, 1.3, item);
      G.weapons.explode(pos, { radius: 9, damage: 35, bld: 60, hole: 2.5, scale: 1.4, owner: 'world' });
      if (rand() < (p?.t.drop ?? 0.12)) G.powerups.drop(pos);
    },

    breakOpen(p, vel = V()) {
      if (p.gone) return;
      p.gone = true;
      p.t.batches.forEach((b, k) => b.hide(p.idx[k]));
      if (p.solid) p.solid.dead = true;
      const t = p.t, c = V(p.x, p.y + t.h * p.s * 0.5, p.z);
      const color = t.crate ? 0x9a6b3a : (p.color ?? 0x999999);
      const n = t.crate ? 7 : 10;
      for (let i = 0; i < n; i++) {
        const size = t.crate ? V(1.4, 0.12, 0.3) : V(2 + rand() * 2, 0.15, 1 + rand() * 1.2);
        spawnDebris(c.clone().add(V((rand() - 0.5) * t.half.x, (rand() - 0.5) * t.h * 0.6, (rand() - 0.5) * t.half.z)), size, color,
          V(vel.x * 0.5 + (rand() - 0.5) * 10, 4 + rand() * 6, vel.z * 0.5 + (rand() - 0.5) * 10), 20);
      }
      G.fx.dust(c, 2, 6, 0.4);
      G.audio?.crunch(p);
      if (rand() < (t.drop ?? 0)) G.powerups.drop(V(p.x, p.y + 1.2, p.z));
    },

    // An explosion: loosens, breaks or detonates everything in range (detonations chain a moment later).
    blast(center, radius, damage) {
      if (!built) return;
      for (const p of near(center.x - radius, center.z - radius, center.x + radius, center.z + radius)) {
        const b = p.box;
        const dx = Math.max(b.minX - center.x, 0, center.x - b.maxX), dy = Math.max(b.bottom - center.y, 0, center.y - b.top), dz = Math.max(b.minZ - center.z, 0, center.z - b.maxZ);
        const d = Math.hypot(dx, dy, dz);
        if (d > radius) continue;
        const k = 1 - d / radius;
        const dir = V(p.x - center.x, 0, p.z - center.z).normalize();
        if (p.t.boom || p.t.car) { chain.push({ p, t: 0.12 + rand() * 0.2, dmg: damage * k * 1.5, dir }); continue; }
        if (p.t.stat) continue;
        if (p.t.crate || p.t.burst) { if (damage * k * 2 > p.hp || k > 0.6) props.breakOpen(p, dir.clone().multiplyScalar(damage * k * 0.4)); else p.hp -= damage * k; continue; }
        props.activate(p, dir.multiplyScalar(damage * k * 0.5).add(V(0, damage * k * 0.3 + 2, 0)));
      }
      // loose cars caught in the blast burn and explode too
      for (const it of T.car.pool.items) {
        if (!it.data || it.data.burnt) continue;
        const t = it.body.translation(), d = Math.hypot(t.x - center.x, t.y - center.y, t.z - center.z);
        if (d < radius) { it.data.hp -= damage * (1 - d / radius) * 1.5; if (it.data.hp <= 0) chain.push({ item: it, t: 0.15 + rand() * 0.2 }); }
      }
    },

    // A car from traffic, already moving, handed over to physics.
    spawnCar(pos, quat, vel, angvel, color, hp = 60) {
      return T.car.pool.spawn({ pos, quat, half: T.car.half, offset: V(0, T.car.half.y, 0), scale: V(1, 1, 1), vel, angvel,
        density: T.car.mass / (8 * T.car.half.x * T.car.half.y * T.car.half.z), color, life: 90, data: { car: true, hp, burnt: false } });
    },
    damageLooseCar(item, amount) {
      if (!item.data || item.data.burnt) return;
      item.data.hp -= amount;
      if (item.data.hp <= 0) props.carExplode(null, item);
    },

    update(dt) {
      for (let i = chain.length - 1; i >= 0; i--) {
        const c = chain[i];
        if ((c.t -= dt) > 0) continue;
        chain.splice(i, 1);
        if (c.item) { if (!c.item.data.burnt) props.carExplode(null, c.item); }
        else props.damage(c.p, c.dmg, c.dir);
      }
      // fast-moving loose heavy things knock over what they fly into
      for (const t of [T.car, T.container, T.tree, T.palm]) {
        if (!t.pool) continue;
        for (const it of t.pool.movers(7)) {
          const p = it.body.translation(), v = it.body.linvel();
          props.knock(V(p.x, p.y - 0.5, p.z), 2, V(v.x, v.y, v.z), t.mass, 2);
        }
      }
    },
  };
  const chain = [];
  return props;
}
