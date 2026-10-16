// Transformers: every part has a pose in each mode and the parts swing between them.
// All transformers (the player and the enemies) are drawn together with instancing, one mesh per
// geometry-and-material pair, so a dozen of them cost about as much as one.
import * as THREE from 'three';
import { V, DEG, clamp, ease } from './util.js';
import { MODES, TDUR, TTOTAL, ROBOT_SPEED } from './state.js';
import { spawnDebris } from './physics.js';

export const TEAMS = {
  player: { paint: 0xc8102e, eye: 0x40e0ff, emblem: 0xff2a3a, glow: 0xff3a1a },
  enemy: { paint: 0x5a2f94, eye: 0xff2828, emblem: 0xb04cff, glow: 0xff2020 },
  heavy: { paint: 0x4f5c2a, eye: 0xffb020, emblem: 0xff6a00, glow: 0xff5010 },
};
const MAT = {
  paint: new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0.45, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.06 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x2a2e35, metalness: 0.75, roughness: 0.38 }),
  silver: new THREE.MeshStandardMaterial({ color: 0xd0d5dc, metalness: 1, roughness: 0.18 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x0e1c28, metalness: 0.9, roughness: 0.04, transparent: true, opacity: 0.55 }),
  tire: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.92 }),
  eye: new THREE.MeshBasicMaterial({ color: 0xffffff }),
  lamp: new THREE.MeshBasicMaterial({ color: 0xfff6d8 }),
  glow: new THREE.MeshBasicMaterial({ color: 0xffffff }),
  emblem: new THREE.MeshBasicMaterial({ color: 0xffffff }),
};
const TINTED = { paint: 'paint', eye: 'eye', glow: 'glow', emblem: 'emblem' };
const DEBRIS_COLOR = { dark: 0x2a2e35, silver: 0xc9ced6, glass: 0x10202c, tire: 0x151515, lamp: 0xfff6d8 };
const GEO = {
  box: new THREE.BoxGeometry(1, 1, 1),
  wheel: new THREE.CylinderGeometry(0.5, 0.5, 1, 20),
  rim: new THREE.CylinderGeometry(0.5, 0.5, 1, 5),     // five edges, so you can see it spin
  cone: new THREE.ConeGeometry(Math.SQRT1_2, 1, 4).rotateY(Math.PI / 4),
};

// A pose is [x,y,z, rx,ry,rz (degrees), sx,sy,sz] in metres; forward is -z, the feet or wheels touch y = 0.
// Mirrored parts are written for the right side (+x) and copied to the left.
// Each line reads: what it is as a robot / as the car / as the jet.
const PARTS = [
  ['pelvis', 'dark', 'box', 0, [0, 3.0, 0, 0, 0, 0, 1.4, 0.6, 0.8], [0, 0.55, 1.35, 0, 0, 0, 1.95, 0.5, 1.7], [0, 1.0, 2.3, 0, 0, 0, 1.5, 0.85, 2.4]],
  ['torso', 'paint', 'box', 0, [0, 4.25, 0, 0, 0, 0, 2.2, 1.5, 1.1], [0, 0.5, -1.1, 0, 0, 0, 1.95, 0.42, 2.3], [0, 1.05, -0.8, 0, 0, 0, 1.7, 1.0, 3.2]],
  ['abdomen', 'dark', 'box', 0, [0, 3.45, 0, 0, 0, 0, 1.1, 0.5, 0.7], [0, 0.45, 0.3, 0, 0, 0, 1.7, 0.4, 1.0], [0, 0.85, 0.9, 0, 0, 0, 1.2, 0.7, 1.0]],
  ['grille', 'dark', 'box', 0, [0, 3.45, -0.37, 0, 0, 0, 0.8, 0.35, 0.04], [0, 0.52, -2.265, 0, 0, 0, 0.7, 0.16, 0.02], [0, 1.96, -2.4, 0, 0, 0, 0.06, 0.04, 2.0]],
  ['windshield', 'glass', 'box', 0, [0, 4.45, -0.56, 0, 0, 0, 1.7, 0.7, 0.06], [0, 0.92, -0.15, 60, 0, 0, 1.6, 0.8, 0.05], [0, 1.7, -2.4, 0, 0, 0, 0.8, 0.5, 2.0]],
  ['roof', 'paint', 'box', 0, [0, 4.3, 0.75, 0, 0, 0, 1.6, 1.3, 0.45], [0, 1.1, 0.55, 0, 0, 0, 1.5, 0.12, 1.1], [0, 1.6, -0.4, 0, 0, 0, 0.9, 0.35, 2.4]],
  ['rearGlass', 'glass', 'box', 0, [0, 4.3, 0.75, 0, 0, 0, 1.4, 1.1, 0.4], [0, 0.9, 1.25, -55, 0, 0, 1.5, 0.7, 0.05], [0, 1.5, 0.4, 0, 0, 0, 0.7, 0.3, 1.0]],
  ['head', 'dark', 'box', 0, [0, 5.35, 0, 0, 0, 0, 0.6, 0.7, 0.65], [0, 0.6, 0.3, 0, 0, 0, 0.3, 0.3, 0.3], [0, 1.0, -1.0, 0, 0, 0, 0.3, 0.3, 0.3]],
  ['visor', 'eye', 'box', 0, [0, 5.45, -0.33, 0, 0, 0, 0.46, 0.12, 0.03], [0, 0.6, 0.3, 0, 0, 0, 0.1, 0.05, 0.05], [0, 1.0, -1.0, 0, 0, 0, 0.1, 0.05, 0.05]],
  ['face', 'silver', 'box', 0, [0, 5.22, -0.33, 0, 0, 0, 0.34, 0.2, 0.04], [0, 0.6, 0.3, 0, 0, 0, 0.1, 0.05, 0.05], [0, 1.0, -1.0, 0, 0, 0, 0.1, 0.05, 0.05]],
  ['crest', 'paint', 'box', 0, [0, 5.78, -0.05, 0, 0, 0, 0.12, 0.2, 0.5], [0, 1.1, 0.55, 0, 0, 0, 0.1, 0.05, 0.1], [0, 1.6, -0.4, 0, 0, 0, 0.1, 0.1, 0.1]],
  ['emblem', 'emblem', 'box', 0, [0, 4.95, -0.57, 0, 0, 45, 0.2, 0.2, 0.02], [0, 0.715, -1.9, -90, 0, 45, 0.14, 0.14, 0.02], [0, 1.42, -3.3, -90, 0, 45, 0.16, 0.16, 0.02]],
  ['nose', 'paint', 'cone', 0, [0, 5.0, 1.05, 20, 0, 0, 0.5, 1.8, 0.4], [0, 0.2, -2.3, -90, 0, 0, 1.9, 0.5, 0.12], [0, 0.95, -4.1, -90, 0, 0, 1.3, 2.6, 0.9]],
  ['shoulder', 'paint', 'box', 1, [1.45, 4.75, 0, 0, 0, 0, 0.8, 0.7, 1.0], [0.82, 0.58, -1.45, 0, 0, 0, 0.36, 0.5, 1.4], [1.05, 0.95, -1.4, 0, 0, 0, 0.55, 0.75, 2.0]],
  ['missile', 'silver', 'wheel', 1, [1.45, 5.2, 0.15, 90, 0, 0, 0.2, 0.8, 0.2], [0.82, 0.58, -1.45, 90, 0, 0, 0.1, 0.3, 0.1], [3.7, 0.72, 1.4, 90, 0, 0, 0.18, 2.2, 0.18]],
  ['mirror', 'dark', 'box', 1, [0.36, 5.6, 0, 0, 0, -12, 0.08, 0.45, 0.08], [1.08, 0.85, -0.45, 0, 0, 0, 0.22, 0.12, 0.08], [1.05, 0.95, -1.4, 0, 0, 0, 0.05, 0.05, 0.05]],
  ['upperArm', 'dark', 'box', 1, [1.5, 3.9, 0, 0, 0, 0, 0.5, 1.2, 0.5], [0.95, 0.3, 0.05, 0, 0, 0, 0.12, 0.2, 1.6], [2.3, 0.62, 0.6, 0, 0, 0, 0.22, 0.22, 2.4]],
  ['forearm', 'paint', 'box', 1, [1.5, 2.8, -0.1, 0, 0, 0, 0.65, 1.1, 0.7], [0.84, 0.62, 1.5, 0, 0, 0, 0.4, 0.55, 1.3], [0.55, 1.0, 3.9, 0, 0, 0, 0.8, 0.8, 1.6]],
  ['gun', 'dark', 'wheel', 1, [1.55, 2.65, -0.55, 90, 0, 0, 0.16, 0.7, 0.16], [0.6, 0.4, -1.6, 90, 0, 0, 0.1, 0.3, 0.1], [0.55, 0.75, -3.4, 90, 0, 0, 0.07, 1.0, 0.07]],
  ['fist', 'dark', 'box', 1, [1.5, 2.05, -0.1, 0, 0, 0, 0.5, 0.45, 0.5], [0.45, 0.95, 2.1, 0, 0, 0, 0.08, 0.3, 0.15], [0.55, 1.0, 4.8, 0, 0, 0, 0.7, 0.7, 0.3]],
  ['hip', 'dark', 'box', 1, [0.78, 2.95, 0, 0, 0, 0, 0.2, 0.7, 0.85], [0.3, 0.16, 2.2, 0, 0, 0, 0.05, 0.18, 0.35], [0.45, 0.35, 3.3, 0, 0, 15, 0.05, 0.5, 1.0]],
  ['thigh', 'dark', 'box', 1, [0.45, 2.05, 0, 0, 0, 0, 0.6, 1.3, 0.7], [0.45, 0.3, 0.5, 0, 0, 0, 0.8, 0.2, 1.4], [0.75, 0.85, 1.6, 0, 0, 0, 0.6, 0.7, 2.0]],
  ['intake', 'dark', 'box', 1, [0.45, 2.2, -0.36, 0, 0, 0, 0.4, 0.5, 0.03], [1.045, 0.62, 1.1, 0, 0, 0, 0.02, 0.3, 0.4], [1.05, 0.95, -2.41, 0, 0, 0, 0.45, 0.6, 0.02]],
  ['knee', 'paint', 'box', 1, [0.5, 1.55, -0.5, 0, 0, 0, 0.55, 0.45, 0.14], [0.45, 0.3, 0.5, 0, 0, 0, 0.1, 0.1, 0.1], [0.35, 0.4, 0.9, 0, 0, 0, 0.3, 0.3, 1.6]],
  ['shin', 'paint', 'box', 1, [0.5, 0.95, 0.05, 0, 0, 0, 0.75, 1.3, 0.95], [0.5, 0.42, 2.15, 0, 0, 0, 0.9, 0.36, 0.3], [1.9, 1.0, 4.3, 0, -20, 0, 2.2, 0.1, 1.3]],
  ['foot', 'dark', 'box', 1, [0.5, 0.15, -0.25, 0, 0, 0, 0.8, 0.3, 1.4], [0.5, 0.32, -2.25, 0, 0, 0, 0.95, 0.3, 0.25], [1.0, 0.55, 0.6, 0, 0, 0, 0.15, 0.6, 0.15]],
  ['wheelF', 'tire', 'wheel', 1, [1.9, 4.75, 0, 0, 0, 90, 0.75, 0.3, 0.75], [0.95, 0.36, -1.45, 0, 0, 90, 0.72, 0.3, 0.72], [0.15, 0.22, -2.2, 0, 0, 90, 0.44, 0.15, 0.44]],
  ['wheelR', 'tire', 'wheel', 1, [0.95, 1.1, 0.2, 0, 0, 90, 0.75, 0.3, 0.75], [0.95, 0.38, 1.45, 0, 0, 90, 0.76, 0.34, 0.76], [1.0, 0.25, 0.6, 0, 0, 90, 0.5, 0.25, 0.5]],
  ['exhaust', 'silver', 'wheel', 1, [0.5, 5.3, 1.0, 0, 0, 0, 0.2, 1.1, 0.2], [0.5, 0.36, 2.32, 90, 0, 0, 0.14, 0.3, 0.14], [0.55, 1.0, 4.2, 90, 0, 0, 0.1, 0.2, 0.1]],
  ['wing', 'paint', 'box', 1, [1.4, 5.2, 0.9, 0, 0, 60, 2.4, 0.1, 1.2], [0.99, 0.62, 0.05, 0, 0, 0, 0.06, 0.5, 1.3], [2.6, 0.95, 0.9, 0, -25, 0, 4.2, 0.12, 2.6]],
  ['fin', 'dark', 'box', 1, [0.55, 2.2, 0.65, 0, 0, 0, 0.08, 1.0, 1.0], [0.45, 1.12, 2.15, 0, 0, 0, 0.9, 0.05, 0.4], [0.9, 1.9, 3.3, 0, 0, -15, 0.08, 1.5, 1.5]],
  ['lampF', 'lamp', 'box', 1, [0.6, 4.9, -0.56, 0, 0, 0, 0.4, 0.12, 0.02], [0.7, 0.55, -2.26, 0, 0, 0, 0.45, 0.12, 0.02], [4.5, 0.95, 1.8, 0, 0, 0, 0.15, 0.15, 0.15]],
  ['lampR', 'glow', 'box', 1, [0.45, 3.7, 0.98, 0, 0, 0, 0.35, 0.35, 0.05], [0.7, 0.62, 2.31, 0, 0, 0, 0.5, 0.1, 0.02], [0.55, 1.0, 4.97, 0, 0, 0, 0.55, 0.55, 0.05]],
];
const HIDE_IN_COCKPIT = {
  robot: ['head', 'visor', 'face', 'crest', 'mirror', 'upperArm', 'forearm', 'fist', 'gun'],
  car: ['head', 'visor', 'face', 'crest', 'roof', 'windshield', 'rearGlass'],
  jet: ['head', 'visor', 'face', 'crest', 'windshield', 'grille'],
};
const ROLE = { thigh: 'upper', fin: 'upper', intake: 'upper', shin: 'lower', foot: 'lower', wheelR: 'lower', knee: 'lower', upperArm: 'arm', forearm: 'arm', fist: 'arm', gun: 'arm' };
const PIVOT = { hip: V(0.45, 2.7, 0), knee: V(0.5, 1.6, 0), shoulder: V(1.5, 4.55, 0) };
const GEAR = ['wheelF', 'wheelR', 'foot'];

const flip = a => [-a[0], a[1], a[2], a[3], -a[4], -a[5], a[6], a[7], a[8]];
const rimOf = a => [...a.slice(0, 6), a[6] * 0.62, a[7] * 1.06, a[8] * 0.62];
const toPose = a => ({ pos: V(a[0], a[1], a[2]), quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(a[3] * DEG, a[4] * DEG, a[5] * DEG)), scale: V(a[6], a[7], a[8]) });

// One template per part (both sides, plus a rim for each wheel), grouped by geometry and material.
const templates = [];
const combos = new Map();
for (const [name, mat, geo, mirrored, ...poses] of PARTS)
  for (const side of mirrored ? [1, -1] : [1]) {
    const add = (m, g, ps) => {
      const byMode = {};
      MODES.forEach((mode, k) => { byMode[mode] = toPose(side > 0 ? ps[k] : flip(ps[k])); });
      const key = g + '|' + m;
      if (!combos.has(key)) combos.set(key, { geo: g, mat: m, list: [] });
      const combo = combos.get(key);
      templates.push({ name, key: name + (side < 0 ? 'L' : ''), side, mat: m, poses: byMode, role: ROLE[name], wheel: name.startsWith('wheel'),
        front: name === 'wheelF', gear: GEAR.includes(name), delay: (templates.length * 0.618) % 1 * 0.45, combo, slot: combo.list.length });
      combo.list.push(templates.length - 1);
    };
    add(mat, geo, poses);
    if (name.startsWith('wheel')) add('silver', 'rim', poses.map(rimOf));
  }

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

export function createTransformers(scene, maxUnits) {
  for (const c of combos.values()) {
    const m = c.mesh = new THREE.InstancedMesh(GEO[c.geo], MAT[c.mat], c.list.length * maxUnits);
    m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < m.count; i++) m.setMatrixAt(i, ZERO);
    if (TINTED[c.mat]) m.setColorAt(0, new THREE.Color());
    scene.add(m);
  }
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  const flameMesh = new THREE.InstancedMesh(new THREE.ConeGeometry(0.28, 1, 12).translate(0, 0.5, 0), flameMat, maxUnits * 2);
  flameMesh.frustumCulled = false;
  for (let i = 0; i < flameMesh.count; i++) { flameMesh.setMatrixAt(i, ZERO); flameMesh.setColorAt(i, new THREE.Color()); }
  scene.add(flameMesh);

  const free = Array.from({ length: maxUnits }, (_, i) => maxUnits - 1 - i);
  const units = new Set();
  const m4 = new THREE.Matrix4(), bodyM = new THREE.Matrix4(), qa = new THREE.Quaternion(), piv = V(), X = V(1, 0, 0), Y = V(0, 1, 0);
  const P = V(), Q = new THREE.Quaternion(), S = V(), col = new THREE.Color();

  function spawn(teamName, scale = 1) {
    const slot = free.pop();
    if (slot === undefined) return null;
    const team = TEAMS[teamName];
    const parts = templates.map(t => ({
      t, pos: t.poses.robot.pos.clone(), quat: t.poses.robot.quat.clone(), scale: t.poses.robot.scale.clone(), visible: true,
      from: { pos: t.poses.robot.pos.clone(), quat: t.poses.robot.quat.clone(), scale: t.poses.robot.scale.clone() },
    }));
    // team colours into this unit's instances
    for (const c of combos.values()) {
      const tint = TINTED[c.mat];
      if (!tint) continue;
      for (let j = 0; j < c.list.length; j++) c.mesh.setColorAt(slot * c.list.length + j, col.set(team[tint]));
      c.mesh.instanceColor.needsUpdate = true;
    }
    const u = {
      slot, team, teamName, scale, parts, alive: true,
      walkPhase: 0, walkAmt: 0, spin: 0, gear: 1,
      flames: [{ on: false, m: new THREE.Matrix4(), color: new THREE.Color() }, { on: false, m: new THREE.Matrix4(), color: new THREE.Color() }],
      bodyPos: V(), bodyQuat: new THREE.Quaternion(),
      startTransform() { for (const p of parts) { p.from.pos.copy(p.pos); p.from.quat.copy(p.quat); p.from.scale.copy(p.scale); } },
      // s: the body state; fx: { throttle, afterburner, nitro, jets, gearDown }
      update(dt, s, bq, fx, cockpit = false) {
        const hide = cockpit ? HIDE_IN_COCKPIT[s.mode] : null;
        const settled = s.T >= TTOTAL;
        const hs = Math.hypot(s.vel.x, s.vel.z);
        const walking = s.mode === 'robot' && settled && s.grounded ? clamp(hs / (ROBOT_SPEED * scale), 0, 1) : 0;
        u.walkAmt += (walking - u.walkAmt) * (1 - Math.exp(-8 * dt));
        u.walkPhase += dt * hs * 0.75 / scale;
        if (s.mode === 'car') u.spin += dt * s.speed / (0.36 * scale);
        u.gear += ((s.mode !== 'jet' || fx.gearDown ? 1 : 0.02) - u.gear) * (1 - Math.exp(-3 * dt));
        const steerYaw = s.mode === 'car' ? s.steer * 0.45 : 0;
        for (const p of parts) {
          const t = p.t, k = ease(clamp((s.T - t.delay) / TDUR, 0, 1)), to = t.poses[s.mode];
          p.pos.lerpVectors(p.from.pos, to.pos, k);
          p.pos.y += Math.sin(Math.PI * k) * 0.35; // parts lift clear as they swing
          p.quat.slerpQuaternions(p.from.quat, to.quat, k);
          p.scale.lerpVectors(p.from.scale, to.scale, k);
          if (u.walkAmt > 0.01 && t.role) walk(u, p);
          if (t.wheel && s.mode === 'car') {
            p.quat.multiply(qa.setFromAxisAngle(Y, u.spin * t.side)); // roll about the axle
            if (t.front) p.quat.premultiply(qa.setFromAxisAngle(Y, steerYaw));
          }
          if (t.gear && s.mode === 'jet') p.scale.multiplyScalar(u.gear);
          p.visible = !(hide && hide.includes(t.name));
        }
        u.bodyPos.copy(s.pos);
        if (!cockpit) u.bodyPos.y += Math.abs(Math.sin(u.walkPhase)) * 0.12 * u.walkAmt * scale;
        u.bodyQuat.copy(bq);
        // flames: jet engines, car nitro from the exhausts, robot jump jets under the feet
        const kind = s.mode === 'jet' && settled ? 'jet' : s.mode === 'car' && fx.nitro ? 'car' : s.mode === 'robot' && fx.jets ? 'robot' : null;
        u.flames.forEach((f, i) => {
          f.on = !!kind;
          if (!kind) return;
          const sd = i ? -1 : 1, flick = 0.9 + Math.random() * 0.2;
          if (kind === 'jet') f.m.compose(P.set(0.55 * sd, 1.0, 5.0), Q.setFromAxisAngle(X, Math.PI / 2), S.set(1, (0.6 + fx.throttle * 2.5 + (fx.afterburner ? 3 : 0)) * flick, 1));
          else if (kind === 'car') f.m.compose(P.set(0.5 * sd, 0.36, 2.45), Q.setFromAxisAngle(X, Math.PI / 2), S.set(0.5, 1.4 * flick, 0.5));
          else f.m.compose(P.set(0.5 * sd, 0.05, -0.25), Q.setFromAxisAngle(X, Math.PI), S.set(1.2, 1.8 * flick, 1.2));
          f.color.set(kind === 'car' || fx.afterburner ? 0x88bbff : 0xffa040);
        });
      },
      // world position of a part (for muzzles): name like 'gun' or 'gunL'
      partWorld(key, out = V()) {
        const p = parts.find(q => q.t.key === key);
        bodyM.compose(u.bodyPos, u.bodyQuat, S.set(scale, scale, scale));
        return out.copy(p.pos).applyMatrix4(bodyM);
      },
      // Blow apart: every part becomes a tumbling piece of debris.
      breakApart(center, power, baseVel = V()) {
        bodyM.compose(u.bodyPos, u.bodyQuat, S.set(scale, scale, scale));
        for (const p of parts) {
          if (!p.visible || p.scale.lengthSq() < 0.01) continue;
          m4.compose(p.pos, p.quat, p.scale).premultiply(bodyM);
          m4.decompose(P, Q, S);
          const size = V(Math.max(0.15, S.x), Math.max(0.15, S.y), Math.max(0.15, S.z));
          const tint = TINTED[p.t.mat], color = tint ? team[tint] : DEBRIS_COLOR[p.t.mat] ?? 0x333333;
          const vel = P.clone().sub(center).normalize().multiplyScalar(power * (0.4 + Math.random() * 0.8)).add(baseVel).add(V(0, 4 + Math.random() * 8, 0));
          spawnDebris(P.clone(), size, color, vel, 25, Q.clone());
        }
        u.release();
      },
      release() {
        if (!u.alive) return;
        u.alive = false; units.delete(u);
        for (const c of combos.values()) for (let j = 0; j < c.list.length; j++) c.mesh.setMatrixAt(slot * c.list.length + j, ZERO);
        flameMesh.setMatrixAt(slot * 2, ZERO); flameMesh.setMatrixAt(slot * 2 + 1, ZERO);
        for (const c of combos.values()) c.mesh.instanceMatrix.needsUpdate = true;
        flameMesh.instanceMatrix.needsUpdate = true;
        free.push(slot);
      },
    };
    units.add(u);
    return u;
  }

  function walk(u, p) {
    const t = p.t, ph = u.walkPhase + (t.side < 0 ? Math.PI : 0), swing = Math.sin(ph) * 0.55 * u.walkAmt;
    if (t.role === 'arm') return rotateAbout(p, PIVOT.shoulder, t.side, -swing * 0.8);
    if (t.role === 'lower') rotateAbout(p, PIVOT.knee, t.side, -Math.max(0, Math.cos(ph)) * 0.9 * u.walkAmt);
    rotateAbout(p, PIVOT.hip, t.side, swing);
  }
  function rotateAbout(p, pivot, side, angle) {
    qa.setFromAxisAngle(X, angle);
    piv.set(pivot.x * side, pivot.y, pivot.z);
    p.pos.sub(piv).applyQuaternion(qa).add(piv);
    p.quat.premultiply(qa);
  }

  // Writes every live unit into the instance buffers; call once a frame after all updates.
  function render() {
    for (const u of units) {
      bodyM.compose(u.bodyPos, u.bodyQuat, S.set(u.scale, u.scale, u.scale));
      for (const p of u.parts) {
        const c = p.t.combo, i = u.slot * c.list.length + p.t.slot;
        if (!p.visible) { c.mesh.setMatrixAt(i, ZERO); continue; }
        m4.compose(p.pos, p.quat, p.scale).premultiply(bodyM);
        c.mesh.setMatrixAt(i, m4);
      }
      u.flames.forEach((f, k) => {
        flameMesh.setMatrixAt(u.slot * 2 + k, f.on ? m4.copy(f.m).premultiply(bodyM) : ZERO);
        if (f.on) flameMesh.setColorAt(u.slot * 2 + k, f.color);
      });
    }
    for (const c of combos.values()) c.mesh.instanceMatrix.needsUpdate = true;
    flameMesh.instanceMatrix.needsUpdate = true;
    flameMesh.instanceColor.needsUpdate = true;
  }

  return { spawn, render };
}
