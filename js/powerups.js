// Power-ups: spinning holograms under a beam of light you can spot from far off. Some sit at fixed
// spots and come back after a while; others drop out of crates, containers, cars, buildings and enemies.
import * as THREE from 'three';
import { V, makeRand } from './util.js';
import { G, st, MAX_HP, MAX_SHIELD, MAX_MISSILES } from './state.js';
import { beamTexture } from './textures.js';

const R = makeRand(777);
export const POWER = {
  enercore: { color: 0x33e0ff, label: 'ENERCORE +40', weight: 25, geo: () => new THREE.OctahedronGeometry(0.9), apply: () => { st.hp = Math.min(MAX_HP, st.hp + 40); } },
  shield: { color: 0x3a7bff, label: 'SHIELD +60', weight: 15, geo: () => new THREE.IcosahedronGeometry(0.9, 0), apply: () => { st.shield = Math.min(MAX_SHIELD, st.shield + 60); } },
  missiles: { color: 0xff8a2a, label: 'MISSILES +6', weight: 20, geo: () => new THREE.CylinderGeometry(0.25, 0.25, 1.6, 8).rotateZ(0.6), apply: () => { st.missiles = Math.min(MAX_MISSILES, st.missiles + 6); } },
  rapid: { color: 0xffd23a, label: 'RAPID FIRE', weight: 12, timer: 'rapid', geo: () => new THREE.ConeGeometry(0.6, 1.4, 4) },
  over: { color: 0xff3a3a, label: 'OVERCHARGE', weight: 10, timer: 'over', geo: () => new THREE.TetrahedronGeometry(1) },
  turbo: { color: 0x3aff7a, label: 'TURBO', weight: 10, timer: 'turbo', geo: () => new THREE.TorusGeometry(0.6, 0.22, 8, 16) },
  triple: { color: 0xb455ff, label: 'TRIPLE SHOT', weight: 8, timer: 'triple', geo: () => new THREE.DodecahedronGeometry(0.8) },
};
const KINDS = Object.keys(POWER);
const TIMER = 20, RESPAWN = 45, DROP_LIFE = 35;
function randomKind() {
  let r = R() * KINDS.reduce((a, k) => a + POWER[k].weight, 0);
  for (const k of KINDS) if ((r -= POWER[k].weight) <= 0) return k;
  return 'enercore';
}

export function createPowerups(scene) {
  const CAP = 80;
  const icons = {};
  for (const k of KINDS) {
    const m = new THREE.InstancedMesh(POWER[k].geo(), new THREE.MeshBasicMaterial({ color: POWER[k].color, toneMapped: false }), CAP);
    m.count = 0; m.frustumCulled = false; scene.add(m); icons[k] = m;
  }
  const ring = new THREE.InstancedMesh(new THREE.TorusGeometry(1.5, 0.08, 6, 32).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ toneMapped: false }), CAP);
  const beam = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.7, 0.7, 70, 12, 1, true).translate(0, 35, 0),
    new THREE.MeshBasicMaterial({ map: beamTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false }), CAP);
  for (const m of [ring, beam]) { m.count = 0; m.frustumCulled = false; m.setColorAt(0, new THREE.Color()); scene.add(m); }

  const items = []; // { kind, pos, fixed, down (respawn timer), life }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), S = V(), col = new THREE.Color();

  return {
    items,
    addSpawn(pos) { items.push({ kind: randomKind(), pos: pos.clone(), fixed: true, down: 0, life: Infinity, phase: R() * 6 }); },
    drop(pos, kind = null) {
      const dynamic = items.filter(i => !i.fixed).length;
      if (dynamic > 30) return;
      const y = G.groundAt(pos.x, pos.z, pos.y + 2);
      items.push({ kind: kind ?? randomKind(), pos: V(pos.x, y + 1.3, pos.z), fixed: false, down: 0, life: DROP_LIFE, phase: R() * 6 });
    },
    update(dt, t) {
      const ps = G.player.sphere();
      const reach = st.mode === 'jet' ? 11 : 5;
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        if (it.down > 0) { if ((it.down -= dt) <= 0) it.kind = randomKind(); continue; }
        if (!it.fixed && (it.life -= dt) <= 0) { items.splice(i, 1); continue; }
        if (!st.dead && ps.c.distanceTo(it.pos) < reach + ps.r * 0.5) {
          const P = POWER[it.kind];
          if (P.timer) st.power[P.timer] = TIMER; else P.apply();
          G.hud?.toast(P.label, '#' + P.color.toString(16).padStart(6, '0'));
          G.audio?.powerup();
          const c = new THREE.Color(P.color);
          G.fx.sparks(it.pos, V(0, 1, 0), [c.r * 2, c.g * 2, c.b * 2], 30, 14);
          G.fx.glow(it.pos, 6, [c.r * 2, c.g * 2, c.b * 2, 1], 0.3);
          if (it.fixed) it.down = RESPAWN; else items.splice(i, 1);
        }
      }
      const counts = Object.fromEntries(KINDS.map(k => [k, 0]));
      let n = 0;
      for (const it of items) {
        if (it.down > 0 || n >= CAP) continue;
        const blink = !it.fixed && it.life < 8 && Math.sin(t * 14) < 0 ? 0 : 1;
        const y = it.pos.y + Math.sin(t * 2 + it.phase) * 0.3;
        q.setFromAxisAngle(V(0, 1, 0), t * 1.8 + it.phase);
        icons[it.kind].setMatrixAt(counts[it.kind]++, m4.compose(S.set(it.pos.x, y, it.pos.z), q, V(blink, blink, blink)));
        col.set(POWER[it.kind].color);
        ring.setMatrixAt(n, m4.compose(S.set(it.pos.x, it.pos.y - 1, it.pos.z), q.identity(), V(1 + 0.1 * Math.sin(t * 4), 1, 1 + 0.1 * Math.sin(t * 4)).multiplyScalar(blink)));
        ring.setColorAt(n, col);
        beam.setMatrixAt(n, m4.compose(S.set(it.pos.x, it.pos.y - 1.2, it.pos.z), q.identity(), V(blink, 1, blink)));
        beam.setColorAt(n, col.multiplyScalar(0.8));
        n++;
      }
      for (const k of KINDS) { icons[k].count = counts[k]; icons[k].instanceMatrix.needsUpdate = true; }
      for (const m of [ring, beam]) { m.count = n; m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; }
    },
  };
}
