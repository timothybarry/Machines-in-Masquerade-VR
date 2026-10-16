// Real rigid-body physics (Rapier) for everything that breaks loose: debris, knocked-over props,
// wrecked cars and blown-apart transformers. Buildings and the ground are fixed colliders; the player
// and enemies are kinematic bodies, so they shove the loose stuff around as they move.
import * as THREE from 'three';
import RAPIER from 'rapier';
import { V, clamp } from './util.js';

let world = null;
const pools = [];

export async function initPhysics() {
  await RAPIER.init();
  world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  // a floor under everything, so nothing falls forever where the terrain mesh ends
  world.createCollider(RAPIER.ColliderDesc.cuboid(30000, 1, 30000).setTranslation(0, -1, 0).setFriction(0.9));
}

export function addTrimesh(vertices, indices) {
  world.createCollider(RAPIER.ColliderDesc.trimesh(vertices, indices).setFriction(0.9));
}
export function addBox(cx, cy, cz, hx, hy, hz) {
  return world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(cx, cy, cz).setFriction(0.8));
}
export function addCylinder(cx, cy, cz, halfHeight, radius) {
  return world.createCollider(RAPIER.ColliderDesc.cylinder(halfHeight, radius).setTranslation(cx, cy, cz).setFriction(0.8));
}
export function removeCollider(c) { if (c) world.removeCollider(c, true); }

// A body driven by gameplay code (the player, an enemy) that pushes dynamic bodies out of its way.
export function kinematic() {
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
  let collider = null, shape = '';
  const up = V(), q = new THREE.Quaternion();
  return {
    setShape(hx, hy, hz) { // a box standing on the body's origin
      const key = `${hx.toFixed(2)},${hy.toFixed(2)},${hz.toFixed(2)}`;
      if (key === shape) return;
      if (collider) world.removeCollider(collider, false);
      collider = world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(0, hy, 0), body);
      shape = key;
    },
    move(pos, quat) { body.setNextKinematicTranslation(up.copy(pos)); body.setNextKinematicRotation(q.copy(quat)); },
    teleport(pos) { body.setTranslation(pos, true); },
    remove() { world.removeRigidBody(body); },
  };
}

// Dynamic bodies drawn with instancing: one InstancedMesh per visual part, all sharing each body's pose.
export class PhysPool {
  // parts: [{ geo, mat, tint }], tint parts take the item's colour
  constructor(scene, parts, cap, { shadow = true } = {}) {
    this.cap = cap;
    this.items = [];
    this.meshes = parts.map(p => {
      const m = new THREE.InstancedMesh(p.geo, p.mat, cap);
      m.count = 0; m.castShadow = shadow; m.receiveShadow = true; m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      if (p.tint) { m.setColorAt(0, new THREE.Color()); m.userData.tint = true; }
      scene.add(m);
      return m;
    });
    pools.push(this);
  }
  // o: { pos, quat, half (collider half-extents), offset (collider centre from the origin), scale (render),
  //      vel, angvel, density, color, life, restitution, data }
  spawn(o) {
    if (!world) return null;
    if (this.items.length >= this.cap) this.remove(this.items[0]);
    const q = o.quat ?? new THREE.Quaternion();
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(o.pos.x, o.pos.y, o.pos.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setLinearDamping(0.05).setAngularDamping(0.4);
    if (o.vel) desc.setLinvel(o.vel.x, o.vel.y, o.vel.z);
    if (o.angvel) desc.setAngvel({ x: o.angvel.x, y: o.angvel.y, z: o.angvel.z });
    if (o.ccd) desc.setCcdEnabled(true);
    const body = world.createRigidBody(desc);
    const h = o.half;
    const cd = RAPIER.ColliderDesc.cuboid(Math.max(0.05, h.x), Math.max(0.05, h.y), Math.max(0.05, h.z))
      .setDensity(o.density ?? 500).setFriction(0.8).setRestitution(o.restitution ?? 0.15);
    if (o.offset) cd.setTranslation(o.offset.x, o.offset.y, o.offset.z);
    world.createCollider(cd, body);
    const it = { body, scale: (o.scale ?? V(1, 1, 1)).clone(), color: o.color ? new THREE.Color(o.color) : null, life: o.life ?? 30, age: 0, data: o.data ?? null };
    this.items.push(it);
    return it;
  }
  remove(it) {
    const i = this.items.indexOf(it);
    if (i < 0) return;
    this.items.splice(i, 1);
    world.removeRigidBody(it.body);
  }
  update(dt) {
    const m4 = this.m4 ??= new THREE.Matrix4(), p = this.p ??= V(), q = this.q ??= new THREE.Quaternion(), s = this.s ??= V();
    let n = 0;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      it.age += dt;
      const t = it.body.translation();
      if (it.age > it.life || t.y < -80) { this.remove(it); i--; continue; }
      const r = it.body.rotation();
      const fade = Math.min(1, (it.life - it.age) / 1.5); // shrink away at the end of its life
      m4.compose(p.set(t.x, t.y, t.z), q.set(r.x, r.y, r.z, r.w), s.copy(it.scale).multiplyScalar(Math.max(0.001, fade)));
      for (const m of this.meshes) {
        m.setMatrixAt(n, m4);
        if (m.userData.tint && it.color) m.setColorAt(n, it.color);
      }
      n++;
    }
    for (const m of this.meshes) {
      m.count = n; m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }
  // Pushes every body within radius away from the centre; power is roughly the speed it adds up close.
  blast(center, radius, power) {
    for (const it of this.items) {
      const t = it.body.translation();
      const dx = t.x - center.x, dy = t.y - center.y + 0.5, dz = t.z - center.z, d = Math.hypot(dx, dy, dz);
      if (d > radius) continue;
      const k = power * (1 - d / radius) * it.body.mass() / Math.max(d, 0.5);
      it.body.applyImpulse({ x: dx * k, y: Math.abs(dy) * k + k * 0.5, z: dz * k }, true);
      it.body.applyTorqueImpulse({ x: (Math.random() - 0.5) * k * 0.5, y: (Math.random() - 0.5) * k * 0.5, z: (Math.random() - 0.5) * k * 0.5 }, true);
    }
  }
  // Items moving fast enough to knock things over, for chain reactions.
  *movers(minSpeed) {
    for (const it of this.items) {
      const v = it.body.linvel();
      if (v.x * v.x + v.y * v.y + v.z * v.z > minSpeed * minSpeed) yield it;
    }
  }
}

export function blastAll(center, radius, power) { for (const p of pools) p.blast(center, radius, power); }

// Plain debris chunks: boxes in any colour.
let debrisPool = null;
export function initDebris(scene) {
  debrisPool = new PhysPool(scene, [{ geo: new THREE.BoxGeometry(1, 1, 1), mat: new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.1 }), tint: true }], 500);
}
// size: full box size; returns the item
export function spawnDebris(pos, size, color, vel, life = 25, quat = null) {
  return debrisPool?.spawn({
    pos, quat: quat ?? new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6)),
    half: V(size.x / 2, size.y / 2, size.z / 2), scale: size, color, vel,
    angvel: V((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6),
    density: 900, life: life * (0.8 + Math.random() * 0.4),
  });
}

export function stepPhysics(dt) {
  if (!world) return;
  world.timestep = clamp(dt, 1 / 120, 1 / 40);
  world.step();
  for (const p of pools) p.update(dt);
}
