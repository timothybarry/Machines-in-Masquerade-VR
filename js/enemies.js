// Enemy transformers, in waves. Troopers drive in as cars, transform to fight, strafe, jump and fire
// plasma; jets make strafing runs with cannons and missiles; heavies walk in slowly and lob fusion orbs
// that bring buildings down. They use the same bodies and movement as the player.
import * as THREE from 'three';
import { V, UP, clamp, makeRand, yawTo, angleDiff, segmentSphere, yq } from './util.js';
import { G, st, newBody, TTOTAL } from './state.js';
import { bodyQuat, transformTo, stepRobot, stepCar, hitSphere, kinShape } from './vehicle.js';
import { groundAt, pushOut, solidAt, segmentHit } from './collision.js';
import { kinematic } from './physics.js';

const R = makeRand(4040);
const TYPES = {
  trooper: { hp: 120, scale: 1, team: 'enemy', gun: 'plasma', every: [2.2, 3.6], burst: 3, gap: 0.22, range: 950, fight: 260, keep: [70, 160], speed: 1, value: 5000 },
  jet: { hp: 80, scale: 1, team: 'enemy', gun: 'jetBolt', every: [2.2, 3.4], burst: 6, gap: 0.11, range: 900, value: 6000 },
  heavy: { hp: 450, scale: 1.45, team: 'heavy', gun: 'orb', every: [3.4, 4.4], burst: 1, gap: 0, range: 1150, fight: 420, keep: [120, 280], speed: 0.6, value: 15000 },
};
const MAX = 10;

export function createEnemies(tf) {
  const list = [];
  let wave = 0, waveT = 6, banner = '';
  const tmp = V(), tmp2 = V();

  function spawn(type, pos, yaw) {
    const T = TYPES[type];
    const unit = tf.spawn(T.team, T.scale);
    if (!unit) return null;
    const s = newBody(pos, yaw);
    s.scale = T.scale;
    const e = { type, T, s, unit, hp: T.hp, alive: true, fireT: 2 + R() * 2, burst: 0, burstT: 0, strafe: R() < 0.5 ? -1 : 1, strafeT: 2, stuckT: 0, reverseT: 0,
      jumpT: 3 + R() * 4, kin: kinematic(), flash: 0, losT: 0, los: false, wp: null, node: null, speedJet: 110, bank: 0, phase: 'attack', phaseT: 0 };
    if (type === 'jet') { transformTo(s, 'jet'); s.T = 9; s.grounded = false; s.speed = 110; }
    else if (R() < 0.8) { transformTo(s, 'car'); s.T = 9; }
    list.push(e);
    return e;
  }

  function spawnWave() {
    wave++;
    const troopers = 2 + wave, jets = Math.floor(wave / 2) + (wave > 1 ? 1 : 0), heavies = Math.floor((wave - 1) / 2);
    const total = Math.min(MAX, troopers + jets + heavies);
    let made = 0;
    const around = (d0, d1) => { // a street junction some way from the player
      for (let k = 0; k < 30; k++) {
        const a = R() * Math.PI * 2, d = d0 + R() * (d1 - d0);
        const x = Math.round((st.pos.x + Math.cos(a) * d) / 80 - 0.5) * 80 + 40, z = Math.round((st.pos.z + Math.sin(a) * d) / 80 - 0.5) * 80 + 40;
        if (Math.abs(x) < 1100 && Math.abs(z) < 1100 && !solidAt(x, 1, z)) return V(x, groundAt(x, z), z);
      }
      return V(st.pos.x + 600, 0, st.pos.z);
    };
    for (let i = 0; i < heavies && made < total; i++, made++) { const p = around(500, 800); spawn('heavy', p, yawTo(p, st.pos)); }
    for (let i = 0; i < jets && made < total; i++, made++) {
      const a = R() * Math.PI * 2, p = V(st.pos.x + Math.cos(a) * 1300, 260 + R() * 120, st.pos.z + Math.sin(a) * 1300);
      spawn('jet', p, yawTo(p, st.pos));
    }
    for (; made < total; made++) { const p = around(450, 750); spawn('trooper', p, yawTo(p, st.pos)); }
    banner = `WAVE ${wave}`;
    G.hud?.banner(`WAVE ${wave}`, `${total} HOSTILES INBOUND`);
    G.audio?.alarm();
  }

  const center = e => hitSphere(e.s, V()).c;
  function muzzle(e) {
    const s = e.s;
    if (s.mode === 'robot') return e.unit.partWorld(R() < 0.5 ? 'gun' : 'gunL', V()).add(V(0, 0, 0));
    const local = s.mode === 'car' ? V(R() < 0.5 ? 0.6 : -0.6, 0.6, -2.6) : V(R() < 0.5 ? 0.55 : -0.55, 0.75, -4.2);
    return local.multiplyScalar(s.scale).applyQuaternion(bodyQuat(s)).add(s.pos);
  }
  function fireAt(e) {
    const from = muzzle(e), ps = G.player.sphere(), T = e.T;
    const speed = (T.gun === 'jetBolt' ? 290 : T.gun === 'orb' ? 95 : 150);
    const dist = from.distanceTo(ps.c);
    const lead = ps.c.clone().addScaledVector(st.vel, dist / speed * 0.85);
    lead.add(V((R() - 0.5), (R() - 0.5), (R() - 0.5)).multiplyScalar(dist * 0.035 + 1.5)); // not deadly accurate
    const dir = lead.sub(from).normalize();
    G.weapons.fire(T.gun, from, dir, { owner: 'enemy', inherit: e.type === 'jet' ? e.s.vel.clone().multiplyScalar(0.5) : null });
    if (e.type === 'jet' && R() < 0.12) G.weapons.fire('eMissile', from, dir, { owner: 'enemy', target: 'player' });
  }

  // ---------- ground AI (troopers and heavies) ----------
  // With a clear line of sight they stand and fight; without one they drive or walk the streets,
  // junction to junction, until they find one.
  function thinkGround(e, dt) {
    const s = e.s, T = e.T, pc = G.player.sphere().c;
    const dist = Math.hypot(pc.x - s.pos.x, pc.z - s.pos.z), bearing = yawTo(s.pos, pc);
    const c = { mx: 0, my: 0, rx: 0, trigR: 0, trigL: 0, action: false };
    if (st.dead) { c.trigL = 1; return c; }
    if ((e.losT -= dt) <= 0) { e.losT = 0.25 + R() * 0.1; e.los = !segmentHit(center(e), pc); }
    if (s.mode === 'car') {
      if (dist < T.fight && (e.los || dist < 90) && s.T > TTOTAL) { transformTo(s, 'robot'); e.unit.startTransform(); G.audio?.transformFar(s.pos); e.wp = null; return c; }
      const want = route(e, pc, dist);
      const diff = angleDiff(s.yaw, want);
      if (e.reverseT > 0) { e.reverseT -= dt; c.trigL = 1; c.mx = -Math.sign(diff || 1); return c; }
      c.mx = clamp(-diff * 2, -1, 1);
      c.trigR = Math.abs(diff) < 0.35 ? 1 : 0.4;
      const nearTurn = e.wp && Math.hypot(e.wp.x - s.pos.x, e.wp.z - s.pos.z) < 32;
      if ((nearTurn && s.speed > 13) || (Math.abs(diff) > 1 && s.speed > 10)) { c.trigR = 0; c.trigL = 0.6; } // slow for the corner
      if (Math.abs(s.speed) < 2) { if ((e.stuckT += dt) > 1.2) { e.stuckT = 0; e.reverseT = 1.2; e.wp = null; } } else e.stuckT = 0;
      if (e.los && dist < T.range * 0.8 && Math.abs(angleDiff(s.yaw, bearing)) < 0.3) tryFire(e, dt);
      return c;
    }
    if (dist > T.fight * 1.9 && s.T > TTOTAL) { transformTo(s, 'car'); e.unit.startTransform(); return c; }
    if (!e.los && dist > 60) { // walk the streets to find a line of fire
      const want = route(e, pc, dist);
      const diff = angleDiff(s.yaw, want);
      c.rx = clamp(-diff * 2.5, -1, 1);
      c.my = Math.abs(diff) < 0.8 ? -1 : 0;
      const moved = Math.hypot(s.vel.x, s.vel.z);
      if (moved < 1) { if ((e.stuckT += dt) > 1.5) { e.stuckT = 0; e.wp = null; c.action = true; } } else e.stuckT = 0;
      return c;
    }
    // fight: face the player, keep a fighting distance, strafe and jump
    const diff = angleDiff(s.yaw, bearing);
    c.rx = clamp(-diff * 2.5, -1, 1);
    c.my = dist > T.keep[1] ? -1 : dist < T.keep[0] ? 0.7 : 0;
    if ((e.strafeT -= dt) <= 0) { e.strafeT = 1.5 + R() * 2.5; e.strafe = -e.strafe; }
    c.mx = e.strafe * 0.8;
    if ((e.jumpT -= dt) <= 0) { e.jumpT = 3 + R() * 5; c.action = true; }
    if (Math.abs(diff) < 0.35 && dist < T.range) tryFire(e, dt);
    return c;
  }
  // The heading to follow: along the streets while far and out of sight, straight at the player otherwise.
  function route(e, pc, dist) {
    const s = e.s;
    const inTown = Math.abs(pc.x) < 1000 && Math.abs(pc.z) < 1000 && Math.abs(s.pos.x) < 1000 && Math.abs(s.pos.z) < 1000;
    if (!inTown || (dist < 170 && e.los)) { e.wp = null; return yawTo(s.pos, pc); }
    if (!e.wp) { e.node = null; e.wp = V(snap(s.pos.x), 0, snap(s.pos.z)); }
    if (Math.hypot(e.wp.x - s.pos.x, e.wp.z - s.pos.z) < 9) nextJunction(e, pc);
    return yawTo(s.pos, e.wp);
  }
  // Streets run along x and z = 40 + 80k; junctions are where they cross.
  const snap = v => Math.round((v - 40) / 80) * 80 + 40;
  function nextJunction(e, target) {
    let best = null, bd = Infinity;
    for (const [dx, dz] of [[80, 0], [-80, 0], [0, 80], [0, -80]]) {
      const x = e.wp.x + dx, z = e.wp.z + dz;
      if (Math.abs(x) > 1000 || Math.abs(z) > 1000) continue;
      const back = e.node && Math.abs(e.node.x - x) < 1 && Math.abs(e.node.z - z) < 1;
      const d = Math.hypot(target.x - x, target.z - z) + (back ? 120 : 0) + R() * 20;
      if (d < bd) { bd = d; best = V(x, 0, z); }
    }
    e.node = e.wp; e.wp = best ?? e.node.clone();
  }
  function tryFire(e, dt) {
    if (e.burst > 0) {
      if ((e.burstT -= dt) <= 0) { e.burstT = e.T.gap; e.burst--; fireAt(e); }
      return;
    }
    if ((e.fireT -= dt) <= 0) { e.fireT = e.T.every[0] + R() * (e.T.every[1] - e.T.every[0]); e.burst = e.T.burst; e.burstT = 0; }
  }

  // ---------- jet AI: flies straight at you, strafes, pulls away, comes round again ----------
  const qf = new THREE.Quaternion(), axis = V();
  function flyJet(e, dt) {
    const s = e.s, pc = G.player.sphere().c;
    const f = V(0, 0, -1).applyQuaternion(s.quat);
    const toP = tmp.subVectors(pc, s.pos), dist = toP.length();
    e.phaseT -= dt;
    let aim;
    if (e.phase === 'attack') {
      aim = pc.clone().addScaledVector(st.vel, dist / 300).add(V(0, 4, 0));
      if (dist < 230 || st.dead) { e.phase = 'extend'; e.phaseT = 3 + R() * 2; }
    } else {
      aim = s.pos.clone().addScaledVector(f, 500).add(V(0, 120, 0));
      if (e.phaseT <= 0) e.phase = 'attack';
    }
    // look ahead for rooftops and hills and stay well above them
    let floor = 0;
    const lx = -f.z, lz = f.x; // sideways, to check both wingtips' paths
    for (const d of [0, 50, 110, 180, 260]) for (const w of [-14, 0, 14])
      floor = Math.max(floor, groundAt(s.pos.x + f.x * d + lx * w, s.pos.z + f.z * d + lz * w));
    if (s.pos.y < floor + 90) aim.y = Math.max(aim.y, floor + 180);
    aim.y = Math.max(aim.y, groundAt(aim.x, aim.z) + 40);
    const want = tmp2.subVectors(aim, s.pos).normalize();
    const ang = f.angleTo(want);
    // turn toward it (the heading lives in e.head, the bank is added for looks)
    e.head ??= s.quat.clone();
    if (ang > 1e-4) {
      axis.crossVectors(f, want).normalize();
      e.head.premultiply(qf.setFromAxisAngle(axis, Math.min(ang, 1.15 * dt))).normalize();
    }
    const side = V(1, 0, 0).applyQuaternion(e.head).dot(want);
    e.bank += (clamp(-side * 2.5, -1.2, 1.2) - e.bank) * (1 - Math.exp(-3 * dt));
    s.quat.copy(e.head).multiply(qf.setFromAxisAngle(V(0, 0, 1), e.bank));
    const fwd = V(0, 0, -1).applyQuaternion(e.head);
    s.vel.copy(fwd).multiplyScalar(e.speedJet);
    s.pos.addScaledVector(s.vel, dt);
    s.speed = e.speedJet;
    if (pushOut(s.pos, 4, s.vel, 0.5) || s.pos.y < groundAt(s.pos.x, s.pos.z) + 1) return kill(e, V(0, 0, 0));
    if (e.phase === 'attack' && dist < 950 && fwd.dot(toP.normalize()) > 0.96) tryFire(e, dt);
  }

  function kill(e, from) {
    if (!e.alive) return;
    e.alive = false;
    const c = center(e);
    G.weapons.explode(c, { radius: 10 * e.T.scale, damage: 30, bld: 80, hole: 2, scale: 1.8 * e.T.scale, owner: 'world' });
    e.unit.breakApart(c.clone().add(V(0, -1, 0)), 16, e.s.vel.clone().multiplyScalar(0.6));
    e.kin.remove();
    st.kills++; st.cash += e.T.value;
    G.hud?.toast(`HOSTILE DESTROYED  +$${e.T.value.toLocaleString()}`, '#ff4057');
    if (R() < 0.35) G.powerups.drop(c);
  }

  return {
    list,
    get wave() { return wave; },
    get alive() { return list.filter(e => e.alive).length; },
    center,
    hitSegment(a, b) {
      let best = null;
      for (const e of list) {
        if (!e.alive) continue;
        const hs = hitSphere(e.s, tmp), t = segmentSphere(a, b, hs.c, hs.r);
        if (t >= 0 && (!best || t < best.t)) best = { enemy: e, t };
      }
      if (best) best.point = a.clone().lerp(b, best.t);
      return best;
    },
    damage(e, amount, point) {
      if (!e.alive) return;
      e.hp -= amount; e.flash = 0.1;
      G.fx.sparks(point ?? center(e), null, [2.5, 1.5, 0.6], 6, 12);
      if (e.hp <= 0) kill(e, point);
    },
    blast(pos, r, damage) {
      for (const e of list) {
        if (!e.alive) continue;
        const hs = hitSphere(e.s, tmp), d = hs.c.distanceTo(pos) - hs.r;
        if (d < r) { e.hp -= damage * clamp(1 - d / r, 0, 1); if (e.hp <= 0) kill(e, pos); }
      }
    },
    update(dt) {
      if (!st.dead && list.every(e => !e.alive)) {
        if ((waveT -= dt) <= 0) { waveT = 9; for (let i = list.length - 1; i >= 0; i--) if (!list[i].alive) list.splice(i, 1); spawnWave(); }
      }
      for (const e of list) {
        if (!e.alive) continue;
        const s = e.s;
        s.T += dt;
        if (e.type === 'jet') flyJet(e, dt);
        else {
          const c = thinkGround(e, dt);
          // they plough through props and traffic too (knocked clear before they move into them)
          const ahead = s.pos.clone().addScaledVector(s.vel, dt * 2);
          G.props.knock(ahead, 2 * s.scale, s.vel, 8000 * s.scale, 5 * s.scale);
          G.traffic.collide(ahead, 2 * s.scale, s.vel, 8000);
          s.mode === 'car' ? stepCar(s, dt, c, { speedMul: e.T.speed }) : stepRobot(s, dt, c, { speedMul: e.T.speed });
          s.actionHeld = c.action;
          // ramming the player
          const ps = G.player.sphere(), hs = hitSphere(s, tmp);
          if (!st.dead && hs.c.distanceTo(ps.c) < hs.r + ps.r && s.mode === 'car' && Math.abs(s.speed) > 12) {
            G.player.damage(Math.abs(s.speed) * 0.4, s.pos.clone()); s.speed *= -0.3;
          }
        }
        if (!e.alive) continue;
        const [hx, hy, hz] = kinShape(s);
        e.kin.setShape(hx, hy, hz);
        const bq = bodyQuat(s);
        e.kin.move(s.pos, bq);
        e.unit.update(dt, s, bq, { throttle: 0.6, afterburner: false, nitro: false, jets: s.jets, gearDown: false });
      }
    },
  };
}
