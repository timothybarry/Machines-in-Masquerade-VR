// Civilian traffic: cars drive the street grid on the right, turning at junctions on smooth curves and
// braking for each other and for you. Ram one, shoot it or blast it and it becomes a physics wreck.
import * as THREE from 'three';
import { V, clamp, makeRand, segmentSphere } from './util.js';
import { G } from './state.js';
import { CELL } from './collision.js';

const R = makeRand(808);
const N = 25;                    // junctions 0..25 across, at (k - 12.5) * 80 = -1000..1000
const LANE = 3.2, TURN = 9;
const D = [[1, 0], [0, 1], [-1, 0], [0, -1]];     // +x, +z, -x, -z
const RIGHT = d => [-D[d][1], D[d][0]];           // the right-hand side of travel
const nodePos = (ix, iz) => V((ix - 12.5) * CELL, 0, (iz - 12.5) * CELL);
const COLORS = [[0.8, 0.8, 0.82], [0.1, 0.1, 0.12], [0.6, 0.08, 0.08], [0.1, 0.2, 0.45], [0.95, 0.78, 0.15], [0.9, 0.9, 0.85], [0.15, 0.35, 0.2], [0.55, 0.57, 0.6]];

export function createTraffic(scene, props) {
  const T = props.types.car;
  const meshes = T.parts.map(p => {
    const m = new THREE.InstancedMesh(p.geo, p.mat, 48);
    m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (p.tint) m.setColorAt(0, new THREE.Color());
    scene.add(m);
    return m;
  });
  const cars = [];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), ONE = V(1, 1, 1), up = V(0, 1, 0);

  const lanePoint = (node, d, along) => { // a point on the right lane of the street leaving node in direction d
    const r = RIGHT(d);
    return node.clone().add(V(D[d][0] * along + r[0] * LANE, 0, D[d][1] * along + r[1] * LANE));
  };
  function straight(car) { // from just past this junction to just before the next
    const a = nodePos(car.ix, car.iz), b = nodePos(car.ix + D[car.dir][0], car.iz + D[car.dir][1]);
    car.p0 = lanePoint(a, car.dir, TURN); car.p2 = lanePoint(b, car.dir, -TURN); car.p1 = car.p0.clone().lerp(car.p2, 0.5);
    car.len = car.p0.distanceTo(car.p2); car.s = 0; car.curve = false;
    car.ix += D[car.dir][0]; car.iz += D[car.dir][1];
  }
  function turn(car) { // through the junction onto a new street, on a curve between the two lanes
    const options = [car.dir, (car.dir + 1) % 4, (car.dir + 3) % 4].filter(d => {
      const nx = car.ix + D[d][0], nz = car.iz + D[d][1];
      return nx >= 0 && nx <= N && nz >= 0 && nz <= N;
    });
    const d2 = options.length === 0 ? (car.dir + 2) % 4 : R() < 0.6 && options.includes(car.dir) ? car.dir : options[Math.floor(R() * options.length)];
    const node = nodePos(car.ix, car.iz);
    car.p0 = lanePoint(node, car.dir, -TURN); car.p2 = lanePoint(node, d2, TURN);
    if (d2 === car.dir) car.p1 = car.p0.clone().lerp(car.p2, 0.5);
    else { const r1 = RIGHT(car.dir), r2 = RIGHT(d2); car.p1 = node.clone().add(V((r1[0] + r2[0]) * LANE, 0, (r1[1] + r2[1]) * LANE)); }
    car.len = car.p0.distanceTo(car.p1) + car.p1.distanceTo(car.p2); car.s = 0; car.curve = true;
    car.dir = d2;
  }
  const bez = (c, t, out) => out.copy(c.p0).multiplyScalar((1 - t) * (1 - t)).addScaledVector(c.p1, 2 * (1 - t) * t).addScaledVector(c.p2, t * t);

  function spawnGrid(farFrom) {
    for (let tries = 0; tries < 30; tries++) {
      const ix = Math.floor(R() * (N + 1)), iz = Math.floor(R() * (N + 1));
      const n = nodePos(ix, iz);
      if (farFrom && n.distanceTo(farFrom) < 250) continue;
      const car = { kind: 'grid', ix, iz, dir: Math.floor(R() * 4), speed: 0, max: 11 + R() * 6, color: new THREE.Color().setRGB(...COLORS[Math.floor(R() * COLORS.length)], THREE.SRGBColorSpace),
        pos: V(), fwd: V(0, 0, -1), hp: 60, alive: true, p0: V(), p1: V(), p2: V(), len: 1, s: 0, curve: false, honk: 0 };
      const nx = ix + D[car.dir][0], nz = iz + D[car.dir][1];
      if (nx < 0 || nx > N || nz < 0 || nz > N) car.dir = (car.dir + 2) % 4;
      straight(car);
      bez(car, 0, car.pos);
      return car;
    }
    return null;
  }
  function spawnBoulevard(k) { // straight runs down the four lanes of a boulevard, looping end to end
    const alongZ = k % 2 === 0, lane = [-11.25, -3.75, 3.75, 11.25][k % 4], sgn = lane > 0 ? -1 : 1;
    const car = { kind: 'blvd', alongZ, lane, sgn, speed: 14, max: 16 + R() * 6, t: (R() - 0.5) * 2800, color: new THREE.Color().setRGB(...COLORS[Math.floor(R() * COLORS.length)], THREE.SRGBColorSpace),
      pos: V(), fwd: V(), hp: 60, alive: true, honk: 0 };
    return car;
  }
  for (let i = 0; i < 36; i++) { const c = spawnGrid(null); if (c) cars.push(c); }
  for (let k = 0; k < 8; k++) cars.push(spawnBoulevard(k));
  let respawn = 0;

  const rel = V(), tmp = V();
  // Something rams a car or a blast catches it: it leaves the traffic and becomes a physics body.
  function toPhysics(car, vel, spin = null) {
    if (!car.alive) return null;
    car.alive = false;
    const quat = q.setFromUnitVectors(V(0, 0, -1), car.fwd).clone();
    const item = props.spawnCar(car.pos.clone(), quat, vel, spin ?? V((R() - 0.5) * 2, (R() - 0.5) * 3, (R() - 0.5) * 2), car.color, car.hp);
    return item;
  }

  return {
    cars,
    // A body moving through traffic: knocks cars aside. Returns the mass it hit.
    collide(pos, r, vel, mass) {
      let hit = 0;
      for (const c of cars) {
        if (!c.alive || Math.abs(c.pos.y - pos.y) > 3) continue;
        const dx = c.pos.x - pos.x, dz = c.pos.z - pos.z;
        if (dx * dx + dz * dz > (r + 2.2) ** 2) continue;
        rel.copy(vel).sub(tmp.copy(c.fwd).multiplyScalar(c.speed));
        if (rel.length() < 4) { c.speed = 0; continue; }
        const k = clamp(mass / (mass + 1300) * 1.5, 0.3, 1.5);
        toPhysics(c, V(vel.x * k + dx * 0.5, rel.length() * 0.25 + 2, vel.z * k + dz * 0.5));
        G.audio?.crunch(c.pos);
        hit += 1300;
      }
      return hit;
    },
    // First car hit by a shot a-b: { car, t, point } or null.
    hitSegment(a, b) {
      let best = null;
      for (const c of cars) {
        if (!c.alive) continue;
        const t = segmentSphere(a, b, tmp.copy(c.pos).add(V(0, 0.8, 0)), 2);
        if (t >= 0 && (!best || t < best.t)) best = { car: c, t };
      }
      if (best) best.point = a.clone().lerp(b, best.t);
      return best;
    },
    damage(c, amount, dir) {
      c.hp -= amount;
      if (c.hp <= 0) { const it = toPhysics(c, dir.clone().multiplyScalar(4).add(V(0, 5, 0))); if (it) props.carExplode(null, it); }
      else if (c.hp < 40 && !c.panicked) { c.panicked = true; c.max *= 1.6; } // floor it
    },
    blast(center, radius) {
      for (const c of cars) {
        if (!c.alive) continue;
        const d = c.pos.distanceTo(center);
        if (d > radius) continue;
        const k = 1 - d / radius, away = c.pos.clone().sub(center).setY(0).normalize();
        const it = toPhysics(c, away.multiplyScalar(18 * k).add(V(0, 10 * k + 2, 0)), V((R() - 0.5) * 6 * k, (R() - 0.5) * 4, (R() - 0.5) * 6 * k));
        if (it && k > 0.45) props.carExplode(null, it);
      }
    },
    update(dt, playerPos) {
      for (const c of cars) {
        if (!c.alive) continue;
        // brake for cars ahead and for the player
        let target = c.curve ? Math.min(c.max, 7.5) : c.max;
        for (const o of cars) {
          if (o === c || !o.alive) continue;
          rel.subVectors(o.pos, c.pos);
          const ahead = rel.dot(c.fwd), side = Math.abs(rel.x * c.fwd.z - rel.z * c.fwd.x);
          if (ahead > 0 && ahead < 13 && side < 2.6) target = Math.min(target, Math.max(0, (ahead - 6) * 1.5));
        }
        rel.subVectors(playerPos, c.pos);
        const pa = rel.dot(c.fwd), ps = Math.abs(rel.x * c.fwd.z - rel.z * c.fwd.x);
        if (pa > 0 && pa < 18 && ps < 4 && playerPos.y < 4) { target = 0; if ((c.honk -= dt) <= 0) { c.honk = 3 + R() * 3; G.audio?.honk(c.pos); } }
        c.speed += clamp(target - c.speed, -12 * dt, 4 * dt);
        if (c.kind === 'grid') {
          c.s += c.speed * dt;
          if (c.s >= c.len) { if (c.curve) straight(c); else turn(c); }
          const t = clamp(c.s / c.len, 0, 1);
          bez(c, t, c.pos);
          bez(c, Math.min(1, t + 0.02), tmp);
          if (tmp.distanceToSquared(c.pos) > 1e-6) c.fwd.subVectors(tmp, c.pos).normalize();
        } else {
          c.t += c.speed * dt * c.sgn;
          if (c.t > 1480) c.t = -1480; if (c.t < -1480) c.t = 1480;
          if (c.alongZ) { c.pos.set(c.lane, 0, c.t); c.fwd.set(0, 0, c.sgn); } else { c.pos.set(c.t, 0, -c.lane); c.fwd.set(c.sgn, 0, 0); }
        }
      }
      // wrecked cars are replaced by new ones out of sight
      for (let i = 0; i < cars.length; i++) {
        if (cars[i].alive) continue;
        if ((respawn -= dt) > 0) break;
        respawn = 4;
        cars[i] = cars[i].kind === 'grid' ? spawnGrid(playerPos) ?? cars[i] : spawnBoulevard(i);
        break;
      }
      let n = 0;
      for (const c of cars) {
        if (!c.alive) continue;
        q.setFromUnitVectors(V(0, 0, 1), c.fwd.clone().negate()); // the model's nose is -z
        m4.compose(c.pos, q, ONE);
        meshes.forEach((m, k) => { m.setMatrixAt(n, m4); if (T.parts[k].tint) m.setColorAt(n, c.color); });
        n++;
      }
      for (const m of meshes) { m.count = n; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    },
  };
}
