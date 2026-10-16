// How any transformer body moves, whoever drives it: the player from input, enemies from their AI.
// A control object c looks like the player's input: { mx, my, rx, trigR, trigL, throttle, action }.
// Each step returns what happened ({ landed, hitWall, crash }) so the caller can add sound and effects.
import * as THREE from 'three';
import { V, DEG, UP, clamp, yq, headingOf } from './util.js';
import { GRAV, ROBOT_SPEED } from './state.js';
import { groundAt, pushOut } from './collision.js';
import { terrainNormal } from './terrain.js';

const IDENT = new THREE.Quaternion(), tq = new THREE.Quaternion(), te = new THREE.Euler(), tn = V();

export function bodyQuat(s) {
  if (s.mode === 'jet') return s.quat.clone();
  return yq(s.yaw + s.lookYawS).multiply(s.tilt);
}

// Switches mode, handing speed and heading across so the body keeps its momentum.
export function transformTo(s, m) {
  if (m === s.mode) return false;
  const prev = s.mode;
  if (prev === 'jet') { // the ground modes take the heading; the leftover tilt eases level
    s.yaw = headingOf(s.quat);
    s.tilt.copy(yq(-s.yaw).multiply(s.quat));
  }
  if (m === 'jet') { s.quat.copy(yq(s.yaw).multiply(s.tilt)); s.tilt.identity(); }
  const f = V(0, 0, -1).applyQuaternion(m === 'jet' ? s.quat : yq(s.yaw));
  if (m === 'car') s.speed = Math.max(-15, s.vel.x * f.x + s.vel.z * f.z);
  if (m === 'jet') s.speed = Math.max(s.grounded ? 0 : 45, s.vel.dot(f));
  s.prevMode = prev; s.mode = m; s.T = 0;
  return true;
}

function moveAndCollide(s, dt, r, step) {
  s.pos.addScaledVector(s.vel, dt);
  const wall = pushOut(s.pos, r, s.vel, step);
  const g = groundAt(s.pos.x, s.pos.z, s.pos.y, step);
  let landed = 0;
  if (s.pos.y <= g) {
    if (!s.grounded && s.vel.y < -10) landed = -s.vel.y;
    s.pos.y = g; s.vel.y = Math.max(s.vel.y, 0);
  }
  s.grounded = s.pos.y <= g + 0.05;
  return { wall, landed };
}

// o: { snapTurn, turbo (jets never run dry), speedMul }
export function stepRobot(s, dt, c, o = {}) {
  if (o.snapTurn) { // snap turns: smooth turning in a headset makes people sick
    if (Math.abs(c.rx) > 0.7 && !s.snapped) { s.yaw -= Math.sign(c.rx) * 30 * DEG; s.snapped = true; }
    else if (Math.abs(c.rx) < 0.3) s.snapped = false;
  } else s.yaw -= c.rx * 2.2 * dt;
  const face = s.yaw + s.lookYaw, sn = Math.sin(face), cs = Math.cos(face);
  let wx = sn * c.my + cs * c.mx, wz = cs * c.my - sn * c.mx; // walk the way you look
  const len = Math.hypot(wx, wz);
  if (len > 1) { wx /= len; wz /= len; }
  const top = ROBOT_SPEED * (o.speedMul ?? 1), acc = (s.grounded ? 45 : 10) * dt;
  let dx = wx * top - s.vel.x, dz = wz * top - s.vel.z;
  const dl = Math.hypot(dx, dz);
  if (dl > acc) { dx *= acc / dl; dz *= acc / dl; }
  s.vel.x += dx; s.vel.z += dz;
  s.vel.y -= GRAV * dt;
  if (s.grounded) s.fuel = Math.min(2.5, s.fuel + dt);
  s.jets = false;
  let jumped = false;
  if (c.action && s.grounded && !s.actionHeld) { s.vel.y = 13; jumped = true; }
  else if (c.action && !s.grounded && (s.fuel > 0 || o.turbo)) { s.vel.y = Math.min(s.vel.y + 40 * dt, 8); if (!o.turbo) s.fuel -= dt; s.jets = true; }
  s.actionHeld = !!c.action;
  s.tilt.slerp(IDENT, 1 - Math.exp(-4 * dt));
  const r = moveAndCollide(s, dt, 1.6 * s.scale, 2.2 * s.scale);
  return { ...r, jumped };
}

export function stepCar(s, dt, c, o = {}) {
  s.boosting = c.action && (s.nitro > 0.02 || o.turbo);
  if (!o.turbo) s.nitro = s.boosting ? Math.max(0, s.nitro - dt * 0.2) : Math.min(1, s.nitro + dt * 0.07);
  let a = c.trigR * (s.boosting ? 30 : 14) * (o.speedMul ?? 1);
  if (c.trigL > 0.05) a -= c.trigL * (s.speed > 0.5 ? 28 : 8);   // brake, then reverse
  a -= 0.0015 * s.speed * Math.abs(s.speed) + 0.08 * s.speed;      // drag: tops out near 265 km/h, 430 on nitro
  const f = V(-Math.sin(s.yaw), 0, -Math.cos(s.yaw));
  if (s.grounded) { // hills: gravity pulls along the slope, and the body leans with the ground
    const n = terrainNormal(s.pos.x, s.pos.z, tn);
    a -= 9.81 * (n.x * f.x + n.z * f.z) / Math.max(n.y, 0.3) * -1;
    const lean = tq.setFromUnitVectors(UP, n);
    const local = yq(-s.yaw).multiply(lean).multiply(yq(s.yaw));
    s.tilt.slerp(local, 1 - Math.exp(-10 * dt));
  } else s.tilt.slerp(IDENT, 1 - Math.exp(-2 * dt));
  s.speed = clamp(s.speed + a * dt, -15, 140);
  s.steer += (-c.mx - s.steer) * (1 - Math.exp(-8 * dt));
  s.yaw += s.steer * s.speed / (5.5 + 0.03 * s.speed * s.speed) * dt; // wider turns at speed
  s.vel.x = -Math.sin(s.yaw) * s.speed; s.vel.z = -Math.cos(s.yaw) * s.speed;
  s.vel.y -= GRAV * dt;
  const r = moveAndCollide(s, dt, 1.4 * s.scale, 0.9);
  let wallSpeed = 0;
  if (r.wall) { wallSpeed = Math.abs(s.speed); s.speed *= 0.4; }
  return { ...r, wallSpeed };
}

export function stepJet(s, dt, c, o = {}) {
  const q = s.quat;
  let pitch = c.my * 1.4, roll = -c.mx * 2.8, yaw = -c.rx * 0.7;
  if (s.grounded) { roll = 0; yaw = -(c.mx + c.rx) * 0.9; if (s.speed < 50) pitch = Math.min(pitch, 0); }
  q.multiply(tq.setFromEuler(te.set(pitch * dt, yaw * dt, roll * dt, 'YXZ')));
  if (!s.grounded) q.premultiply(tq.setFromAxisAngle(UP, V(1, 0, 0).applyQuaternion(q).y * 0.9 * dt)); // banking turns the nose
  q.normalize();
  const f = V(0, 0, -1).applyQuaternion(q);
  s.throttle = c.throttle ?? c.trigR;
  s.boosting = !!c.action;
  let target = (s.grounded ? s.throttle * 170 : 55 + s.throttle * 125) + (c.action ? 120 : 0);
  target *= 1 - c.trigL * (s.grounded ? 1 : 0.6);
  const rate = c.action ? 45 : s.grounded && c.trigL > 0.1 ? 40 : 16;
  s.speed += clamp(target - s.speed, -rate * dt, rate * dt);
  if (!s.grounded) s.speed -= GRAV * f.y * dt * 0.6; // climbing costs speed, diving earns it
  s.speed = clamp(s.speed, 0, 320);
  s.vel.copy(f).multiplyScalar(s.speed);
  if (!s.grounded) s.vel.y -= Math.max(0, 45 - s.speed) * 0.8; // too slow: it sinks
  s.pos.addScaledVector(s.vel, dt);
  if (pushOut(s.pos, 4, s.vel, 0.5)) return { crash: true };
  const g = groundAt(s.pos.x, s.pos.z, s.pos.y, 0.5);
  let landed = 0;
  if (s.pos.y <= g) {
    const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
    if (!s.grounded && (s.vel.y < -15 || Math.abs(e.z) > 0.6 || e.x < -0.3)) return { crash: true };
    if (!s.grounded) landed = -s.vel.y;
    s.pos.y = g;
    e.x = s.speed < 50 ? 0 : Math.max(e.x, 0); e.z = 0;
    q.setFromEuler(e);
  }
  s.grounded = s.pos.y <= g + 0.05;
  return { landed };
}

// Where a body's middle is and how big it is, for hits.
export function hitSphere(s, out = V()) {
  const k = s.scale;
  if (s.mode === 'robot') return { c: out.set(s.pos.x, s.pos.y + 3 * k, s.pos.z), r: 2.8 * k };
  if (s.mode === 'car') return { c: out.set(s.pos.x, s.pos.y + 0.7 * k, s.pos.z), r: 2.6 * k };
  return { c: out.set(s.pos.x, s.pos.y + 1, s.pos.z), r: 5 * k };
}
// The body's collision box half-extents for the physics engine (robot, car, jet).
export function kinShape(s) {
  const k = s.scale;
  if (s.mode === 'robot') return [1.3 * k, 3 * k, 0.8 * k];
  if (s.mode === 'car') return [1.0 * k, 0.6 * k, 2.3 * k];
  return [2.5 * k, 0.8 * k, 4 * k];
}
