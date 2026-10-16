// Projectiles and explosions. Everything that shoots goes through here, and so does every blast,
// whatever set it off: it lights up, shoves the debris, and damages buildings, props, traffic,
// enemies and you.
import * as THREE from 'three';
import { V, clamp, segmentSphere } from './util.js';
import { G, st } from './state.js';
import { segmentHit } from './collision.js';
import { blastAll } from './physics.js';

// speed m/s, life s (range = speed x life), dmg on a direct hit, splash radius, bld = building damage,
// hole = radius of the hole it punches, color = HDR glow colour
export const SHOTS = {
  bolt: { speed: 330, life: 2.6, dmg: 10, splash: 0, bld: 10, hole: 0.9, color: [0.4, 1.8, 2.2], size: 0.9, streak: true },
  missile: { speed: 70, accel: 170, max: 210, life: 6, dmg: 70, splash: 9, bld: 150, hole: 4, color: [2.2, 1.2, 0.4], size: 1.3, homing: 3.2, smoke: true },
  plasma: { speed: 150, life: 9.5, dmg: 5, splash: 3, bld: 18, hole: 1.6, color: [2.0, 0.35, 2.3], size: 1.6, orb: true },
  jetBolt: { speed: 290, life: 5, dmg: 4, splash: 0, bld: 12, hole: 1.2, color: [2.4, 0.6, 0.3], size: 1.0, streak: true },
  eMissile: { speed: 60, accel: 90, max: 150, life: 8, dmg: 14, splash: 8, bld: 90, hole: 3, color: [2.4, 0.5, 1.4], size: 1.2, homing: 0.9, smoke: true },
  orb: { speed: 95, life: 14, dmg: 22, splash: 14, bld: 260, hole: 5, color: [0.6, 2.6, 1.0], size: 3.4, orb: true, crackle: true },
};

export function createWeapons(scene) {
  const shots = [];
  // bolts are drawn as glowing streaks; everything else is particles
  const streakMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const streaks = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 0.16, 1), streakMat, 300);
  streaks.frustumCulled = false; streaks.count = 0; streaks.setColorAt(0, new THREE.Color());
  scene.add(streaks);
  const missileMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.16, 1.4, 8).rotateX(Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.6, roughness: 0.3 }), 80);
  missileMesh.frustumCulled = false; missileMesh.count = 0;
  scene.add(missileMesh);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), S = V(), Z = V(0, 0, -1), col = new THREE.Color(), prev = V(), tmp = V();

  const weapons = {
    shots,
    // owner: 'player' or 'enemy'; dmgMul for overcharge; target: an enemy (or 'player') for homing shots
    fire(type, pos, dir, { owner = 'player', inherit = null, dmgMul = 1, target = null } = {}) {
      const T = SHOTS[type];
      if (shots.length > 400) shots.shift();
      const vel = dir.clone().normalize().multiplyScalar(T.speed);
      if (inherit) vel.add(inherit);
      shots.push({ type, T, pos: pos.clone(), vel, life: T.life, owner, dmgMul, target, trailT: 0 });
      G.fx.muzzle(pos, dir.clone().normalize(), T.color, T.size * 1.3);
      G.audio?.shot(type, pos);
    },

    // One blast, whatever caused it. o: { radius, damage, bld, hole, scale, owner, color }
    explode(pos, o) {
      const r = o.radius;
      if (o.plasma) G.fx.plasmaBurst(pos, o.color, o.scale ?? r / 8);
      else G.fx.explosion(pos, o.scale ?? r / 8, o.color ?? [1, 0.55, 0.2]);
      const ground = G.groundAt(pos.x, pos.z, pos.y);
      if (pos.y - ground < r * 0.4) G.fx.scorch(V(pos.x, ground, pos.z), r * 1.1);
      blastAll(pos, r * 2, r * 1.6);
      G.props.blast(pos, r * 1.3, o.damage);
      G.traffic.blast(pos, r * 1.2);
      if (o.bld) G.city.blast(pos, r, o.bld, o.hole ?? 0);
      if (o.owner !== 'enemy') G.enemies.blast(pos, r, o.damage);
      if (o.owner !== 'player') { // the player's own shots never hurt them
        const s = G.player.sphere();
        const d = s.c.distanceTo(pos) - s.r;
        if (d < r) G.player.damage(o.damage * clamp(1 - d / r, 0, 1), pos);
      }
      G.audio?.explosion(pos, r);
    },

    update(dt) {
      let ns = 0, nm = 0;
      for (let i = shots.length - 1; i >= 0; i--) {
        const s = shots[i], T = s.T;
        prev.copy(s.pos);
        if (T.homing && s.target) { // steer toward the target, limited to a turn rate
          const tp = s.target === 'player' ? G.player.sphere().c : s.target.alive ? G.enemies.center(s.target) : null;
          if (tp) {
            const want = tmp.subVectors(tp, s.pos).normalize(), cur = s.vel.clone().normalize();
            const ang = cur.angleTo(want);
            if (ang > 1e-4) cur.applyQuaternion(q.setFromUnitVectors(cur, want).slerp(new THREE.Quaternion(), 1 - Math.min(1, T.homing * dt / ang)));
            s.vel.copy(cur.multiplyScalar(s.vel.length()));
          }
        }
        if (T.accel) s.vel.setLength(Math.min(T.max, s.vel.length() + T.accel * dt));
        s.pos.addScaledVector(s.vel, dt);
        s.life -= dt;
        // trails
        s.trailT -= dt;
        const dir = tmp.copy(s.vel).normalize();
        if (T.smoke) {
          if (s.trailT <= 0) { s.trailT = 0.02; G.fx.smoke(s.pos.clone().addScaledVector(dir, -1), 0.5, 1.6, 0.8, V((Math.random() - 0.5), Math.random() + 0.3, Math.random() - 0.5), 0.5); }
          G.fx.glow(s.pos.clone().addScaledVector(dir, -0.8), 1.4, [T.color[0] * 1.5, T.color[1] * 1.5, T.color[2] * 1.5, 1], 0.05);
        } else if (T.orb) {
          G.fx.glow(s.pos, T.size, [...T.color, 1], dt * 1.6);
          G.fx.glow(s.pos, T.size * 2.2, [T.color[0] * 0.4, T.color[1] * 0.4, T.color[2] * 0.4, 0.8], dt * 1.6);
          if (s.trailT <= 0) {
            s.trailT = 0.015;
            G.fx.add.spawn({ pos: s.pos.clone().add(V((Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4)), size: T.size * 0.8, size1: 0.1, life: 0.6,
              color: [T.color[0] * 0.8, T.color[1] * 0.8, T.color[2] * 0.8, 0.9], tile: 0, vel: V((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2) });
            if (T.crackle && Math.random() < 0.5) G.fx.sparks(s.pos, null, T.color, 2, 12);
          }
        } else {
          G.fx.glow(s.pos, T.size * 1.2, [...T.color, 0.9], dt * 1.6);
          if (s.trailT <= 0) { s.trailT = 0.03; G.fx.glow(s.pos, T.size * 0.7, [T.color[0] * 0.5, T.color[1] * 0.5, T.color[2] * 0.5, 0.7], 0.25); }
        }
        // what did it hit first this frame?
        let hit = segmentHit(prev, s.pos), kind = hit ? (hit.solid ? 'solid' : 'ground') : null, target = null;
        const take = (t, k, tg, point) => { if (!hit || t < hit.t) { hit = { t, point, normal: dir.clone().negate() }; kind = k; target = tg; } };
        if (s.owner === 'player') {
          const e = G.enemies.hitSegment(prev, s.pos); if (e) take(e.t, 'enemy', e.enemy, e.point);
        } else {
          const ps = G.player.sphere(), t = segmentSphere(prev, s.pos, ps.c, ps.r);
          if (t >= 0 && !st.dead) take(t, 'player', null, prev.clone().lerp(s.pos, t));
        }
        const p = G.props.hitSegment(prev, s.pos); if (p) take(p.t, 'prop', p.prop, p.point);
        const c = G.traffic.hitSegment(prev, s.pos); if (c) take(c.t, 'car', c.car, c.point);
        if (hit) { impact(s, hit, kind, target); shots.splice(i, 1); continue; }
        if (s.life <= 0) {
          if (T.splash) weapons.explode(s.pos, { radius: T.splash, damage: T.dmg * s.dmgMul * 0.6, bld: T.bld, hole: T.hole, owner: s.owner, plasma: T.orb, color: T.color, scale: T.splash / 9 });
          shots.splice(i, 1); continue;
        }
        // draw
        if (T.streak && ns < 300) {
          q.setFromUnitVectors(Z, dir);
          streaks.setMatrixAt(ns, m4.compose(s.pos, q, S.set(1, 1, Math.min(9, s.vel.length() * 0.02))));
          streaks.setColorAt(ns, col.setRGB(T.color[0], T.color[1], T.color[2]));
          ns++;
        } else if (T.smoke && nm < 80) {
          q.setFromUnitVectors(Z, dir);
          missileMesh.setMatrixAt(nm++, m4.compose(s.pos, q, S.set(1, 1, 1)));
        }
      }
      streaks.count = ns; streaks.instanceMatrix.needsUpdate = true; if (streaks.instanceColor) streaks.instanceColor.needsUpdate = true;
      missileMesh.count = nm; missileMesh.instanceMatrix.needsUpdate = true;
    },
  };

  function impact(s, hit, kind, target) {
    const T = s.T, dmg = T.dmg * s.dmgMul, dir = s.vel.clone().normalize();
    const point = hit.point, normal = hit.normal ?? dir.clone().negate();
    if (kind === 'enemy') { G.enemies.damage(target, dmg, point); G.hud?.hitMarker(target.hp <= 0); }
    else if (kind === 'player') G.player.damage(dmg, s.pos.clone().sub(s.vel));
    else if (kind === 'prop') G.props.damage(target, dmg * 1.5, dir, point);
    else if (kind === 'car') G.traffic.damage(target, dmg * 1.5, dir);
    else if (kind === 'solid') G.city.hitSolid(hit.solid, point, normal, T.bld * s.dmgMul, T.splash ? 0 : T.hole);
    if (T.splash) {
      weapons.explode(point.clone().addScaledVector(normal, 0.5), { radius: T.splash, damage: dmg * 0.6, bld: T.bld * s.dmgMul, hole: T.hole, owner: s.owner, plasma: T.orb, color: T.color, scale: T.splash / 9 });
    } else {
      G.fx.impact(point, normal, T.color, T.size);
      if (kind === 'ground') G.fx.scorch(point, 0.8);
    }
  }
  return weapons;
}
