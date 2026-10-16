// Visual effects: camera-facing particles (glow, fire, smoke, sparks, shock rings), light flashes,
// scorch marks, lasting emitters (fires, water) and camera shake.
import * as THREE from 'three';
import { V, clamp } from './util.js';
import { particleAtlas, scorchTexture } from './textures.js';

export const TILE = { GLOW: 0, SMOKE: 1, RING: 2, SPARK: 3 };

const VERT = `
attribute vec3 iPos; attribute vec4 iColor; attribute vec3 iMisc; // size, rotation, tile
uniform vec2 uFog;
varying vec2 vUv; varying vec4 vColor; varying float vFog;
void main() {
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
  float c = cos(iMisc.y), s = sin(iMisc.y);
  mv.xy += vec2(c * position.x - s * position.y, s * position.x + c * position.y) * iMisc.x;
  gl_Position = projectionMatrix * mv;
  vUv = (position.xy * 0.5 + 0.5 + vec2(mod(iMisc.z, 2.0), floor(iMisc.z / 2.0))) * 0.5;
  vColor = iColor;
  vFog = smoothstep(uFog.x, uFog.y, -mv.z);
}`;
const frag = additive => `
uniform sampler2D map; uniform vec3 uFogColor;
varying vec2 vUv; varying vec4 vColor; varying float vFog;
void main() {
  vec4 t = texture2D(map, vUv);
  vec4 c = vec4(vColor.rgb * t.rgb, vColor.a * t.a);
  ${additive ? 'c.rgb *= 1.0 - vFog;' : 'c.rgb = mix(c.rgb, uFogColor, vFog);'}
  if (c.a < 0.003) discard;
  gl_FragColor = c;
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

class Particles {
  constructor(scene, cap, additive, map) {
    this.cap = cap; this.n = 0;
    this.ps = Array.from({ length: cap }, () => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, s0: 1, s1: 1, rot: 0, vr: 0, c0: [1, 1, 1, 1], c1: [1, 1, 1, 0], tile: 0, drag: 0, grav: 0 }));
    const g = this.geo = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const attr = size => new THREE.InstancedBufferAttribute(new Float32Array(cap * size), size).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.aPos = attr(3));
    g.setAttribute('iColor', this.aCol = attr(4));
    g.setAttribute('iMisc', this.aMisc = attr(3));
    g.instanceCount = 0;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: map }, uFog: { value: new THREE.Vector2(600, 5200) }, uFogColor: { value: new THREE.Color() } },
      vertexShader: VERT, fragmentShader: frag(additive),
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const mesh = new THREE.Mesh(g, this.mat);
    mesh.frustumCulled = false; mesh.renderOrder = additive ? 12 : 11;
    scene.add(mesh);
  }
  spawn(o) {
    if (this.n >= this.cap) return;
    const p = this.ps[this.n++];
    p.x = o.pos.x; p.y = o.pos.y; p.z = o.pos.z;
    const v = o.vel; p.vx = v ? v.x : 0; p.vy = v ? v.y : 0; p.vz = v ? v.z : 0;
    p.life = p.max = o.life ?? 1;
    p.s0 = o.size ?? 1; p.s1 = o.size1 ?? p.s0;
    p.rot = o.rot ?? Math.random() * 6.28; p.vr = o.spin ?? 0;
    p.c0 = o.color ?? [1, 1, 1, 1]; p.c1 = o.color1 ?? [p.c0[0], p.c0[1], p.c0[2], 0];
    p.tile = o.tile ?? 0; p.drag = o.drag ?? 0; p.grav = o.grav ?? 0;
  }
  update(dt, fog) {
    if (fog) { this.mat.uniforms.uFog.value.set(fog.near, fog.far); this.mat.uniforms.uFogColor.value.copy(fog.color); }
    const P = this.aPos.array, C = this.aCol.array, M = this.aMisc.array;
    for (let i = 0; i < this.n; i++) {
      const p = this.ps[i];
      p.life -= dt;
      if (p.life <= 0) { this.ps[i] = this.ps[--this.n]; this.ps[this.n] = p; i--; continue; } // swap with the last live one
      const k = Math.exp(-p.drag * dt);
      p.vx *= k; p.vy = p.vy * k - p.grav * dt; p.vz *= k;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.rot += p.vr * dt;
      const t = 1 - p.life / p.max;
      P[i * 3] = p.x; P[i * 3 + 1] = p.y; P[i * 3 + 2] = p.z;
      for (let c = 0; c < 4; c++) C[i * 4 + c] = p.c0[c] + (p.c1[c] - p.c0[c]) * t;
      M[i * 3] = p.s0 + (p.s1 - p.s0) * t; M[i * 3 + 1] = p.rot; M[i * 3 + 2] = p.tile;
    }
    this.geo.instanceCount = this.n;
    this.aPos.needsUpdate = this.aCol.needsUpdate = this.aMisc.needsUpdate = true;
  }
}

const rnd = (a, b) => a + Math.random() * (b - a);
const rv = s => V(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).normalize().multiplyScalar(s);

export function createFx(scene, camera) {
  const atlas = particleAtlas();
  const add = new Particles(scene, 5000, true, atlas);
  const alpha = new Particles(scene, 3000, false, atlas);

  // a few point lights that flash with explosions (always present, so shaders never recompile)
  const flashes = Array.from({ length: 3 }, () => {
    const l = new THREE.PointLight(0xffaa55, 0, 140, 2); scene.add(l); return { l, t: 1, dur: 1, power: 0 };
  });
  let flashNext = 0;

  // scorch marks on the ground
  const SCORCH = 90;
  const scorchMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: scorchTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }), SCORCH);
  scorchMesh.count = 0; scorchMesh.frustumCulled = false; scorchMesh.renderOrder = 2;
  scene.add(scorchMesh);
  let scorchNext = 0;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();

  const emitters = []; // { pos, kind, t, dur, follow, acc, size }
  let shake = 0;

  const fx = {
    add, alpha,
    get shake() { return shake; },

    // ---------- building blocks ----------
    glow(pos, size, color, life = 0.1, vel = null) { add.spawn({ pos, vel, size, size1: size * 0.6, life, color, tile: TILE.GLOW }); },
    sparks(pos, dir, color, n = 10, speed = 20) {
      for (let i = 0; i < n; i++) {
        const v = rv(speed * rnd(0.3, 1)); if (dir) v.addScaledVector(dir, speed * 0.6);
        add.spawn({ pos, vel: v, size: rnd(0.12, 0.3), size1: 0.02, life: rnd(0.25, 0.7), color: [...color, 1], color1: [color[0], color[1] * 0.5, color[2] * 0.3, 0], tile: TILE.SPARK, drag: 1.5, grav: 18 });
      }
    },
    smoke(pos, size, life = 3, shade = 0.25, vel = null, alphaMax = 0.6) {
      alpha.spawn({ pos, vel: vel ?? V(rnd(-1, 1), rnd(1.5, 3.5), rnd(-1, 1)), size, size1: size * 2.6, life: life * rnd(0.8, 1.2), color: [shade, shade, shade * 0.95, alphaMax], color1: [shade * 1.3, shade * 1.3, shade * 1.3, 0], tile: TILE.SMOKE, spin: rnd(-0.4, 0.4), drag: 0.6 });
    },
    muzzle(pos, dir, color, size = 1.2) {
      add.spawn({ pos, size, size1: size * 0.3, life: 0.07, color: [color[0] * 2, color[1] * 2, color[2] * 2, 1], tile: TILE.SPARK, rot: Math.random() * 6 });
      add.spawn({ pos: pos.clone().addScaledVector(dir, 0.6), vel: dir.clone().multiplyScalar(12), size: size * 0.9, size1: size * 1.4, life: 0.1, color: [...color, 0.9], tile: TILE.GLOW });
    },
    // a shot hitting something solid
    impact(pos, normal, color, scale = 1) {
      add.spawn({ pos, size: 1.6 * scale, size1: 3 * scale, life: 0.12, color: [color[0] * 2, color[1] * 2, color[2] * 2, 1], tile: TILE.GLOW });
      add.spawn({ pos, size: 0.5 * scale, size1: 4 * scale, life: 0.25, color: [...color, 0.8], tile: TILE.RING });
      fx.sparks(pos, normal, color, Math.round(10 * scale), 14 * scale);
      fx.smoke(pos.clone().addScaledVector(normal ?? V(0, 1, 0), 0.5), 0.8 * scale, 1.5, 0.35, V(rnd(-0.5, 0.5), 1.2, rnd(-0.5, 0.5)), 0.45);
    },
    // The big one: flash, fireball, smoke column, sparks, shock ring, a light flash and a scorch mark.
    explosion(pos, scale = 1, tint = [1, 0.55, 0.2]) {
      const s = scale;
      add.spawn({ pos, size: 5 * s, size1: 11 * s, life: 0.18, color: [4, 3.2, 2.4, 1], tile: TILE.GLOW });
      add.spawn({ pos, size: 1 * s, size1: 26 * s, life: 0.5, color: [2 * tint[0] + 0.5, 2 * tint[1] + 0.5, 2 * tint[2] + 0.5, 0.9], color1: [tint[0], tint[1], tint[2], 0], tile: TILE.RING });
      for (let i = 0; i < 14 + 6 * s; i++) {
        add.spawn({ pos: pos.clone().add(rv(1.5 * s)), vel: rv(rnd(4, 11) * s).add(V(0, 3 * s, 0)), size: rnd(1.6, 3) * s, size1: rnd(4, 7) * s, life: rnd(0.55, 1.1),
          color: [3 * tint[0], 3 * tint[1], 3 * tint[2], 1], color1: [0.6, 0.12, 0.02, 0], tile: TILE.SMOKE, spin: rnd(-2, 2), drag: 2.2 });
      }
      for (let i = 0; i < 10 + 4 * s; i++) fx.smoke(pos.clone().add(rv(2 * s)), rnd(2.5, 4) * s, rnd(3, 5.5), rnd(0.08, 0.2), rv(3 * s).add(V(0, rnd(3, 7) * s, 0)), 0.75);
      fx.sparks(pos, V(0, 0.6, 0), [2.5, 1.6, 0.6], Math.round(26 * s), 28 * s);
      fx.flash(pos, 0xffa050, 900 * s * s, 0.45 + 0.15 * s);
      fx.addShake(0.6 * s, pos);
    },
    plasmaBurst(pos, color, scale = 1) { // energy-weapon impacts: bright core, ring, crackle, little smoke
      add.spawn({ pos, size: 3 * scale, size1: 7 * scale, life: 0.2, color: [color[0] * 3, color[1] * 3, color[2] * 3, 1], tile: TILE.GLOW });
      add.spawn({ pos, size: 1 * scale, size1: 14 * scale, life: 0.4, color: [...color, 1], tile: TILE.RING });
      for (let i = 0; i < 8; i++) add.spawn({ pos: pos.clone().add(rv(scale)), vel: rv(6 * scale), size: 1.5 * scale, size1: 3 * scale, life: rnd(0.3, 0.6), color: [...color, 0.9], tile: TILE.SMOKE, drag: 3 });
      fx.sparks(pos, null, color, Math.round(18 * scale), 22 * scale);
      fx.flash(pos, new THREE.Color(color[0], color[1], color[2]).getHex(), 500 * scale * scale, 0.35);
    },
    flash(pos, color, power, dur) {
      const f = flashes[flashNext++ % flashes.length];
      f.l.position.copy(pos); f.l.color.set(color); f.power = power; f.t = 0; f.dur = dur;
    },
    scorch(pos, size) {
      const i = scorchNext++ % SCORCH;
      m4.compose(V(pos.x, pos.y + 0.06, pos.z), q.setFromAxisAngle(V(0, 1, 0), Math.random() * 6), V(size, 1, size));
      scorchMesh.setMatrixAt(i, m4); scorchMesh.count = Math.min(SCORCH, scorchNext);
      scorchMesh.instanceMatrix.needsUpdate = true;
    },
    // collapse dust: a ring of big slow clouds
    dust(pos, radius, n = 30, shade = 0.55) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * 6.28, r = radius * rnd(0.3, 1.1);
        fx.smoke(V(pos.x + Math.cos(a) * r, pos.y + rnd(0, radius * 0.4), pos.z + Math.sin(a) * r), rnd(5, 9), rnd(5, 9), shade,
          V(Math.cos(a) * rnd(3, 8), rnd(0.5, 3), Math.sin(a) * rnd(3, 8)), 0.8);
      }
    },
    // lasting emitters: 'fire' (burning wreck), 'smoke' (damaged building), 'water' (broken hydrant)
    emit(kind, pos, dur, size = 1, follow = null) { const e = { kind, pos: pos.clone(), dur, t: 0, size, follow, acc: 0 }; emitters.push(e); return e; },
    addShake(amount, from) {
      const d = from && G_eye ? G_eye.distanceTo(from) : 0;
      shake = Math.min(1.5, shake + amount * clamp(1 - d / 400, 0, 1));
    },

    update(dt, eye, fog) {
      G_eye = eye;
      shake *= Math.exp(-5 * dt);
      for (const f of flashes) {
        f.t += dt;
        const k = Math.max(0, 1 - f.t / f.dur);
        f.l.intensity = f.power * k * k;
      }
      for (let i = emitters.length - 1; i >= 0; i--) {
        const e = emitters[i];
        e.t += dt;
        if (e.t > e.dur) { emitters.splice(i, 1); continue; }
        if (e.follow) { const t = e.follow.body?.translation?.(); if (t) e.pos.set(t.x, t.y + 0.8, t.z); }
        e.acc += dt;
        const fade = 1 - e.t / e.dur;
        if (e.kind === 'fire') {
          while (e.acc > 0.04) {
            e.acc -= 0.04;
            add.spawn({ pos: e.pos.clone().add(rv(0.6 * e.size)), vel: V(rnd(-0.5, 0.5), rnd(2, 5) * e.size, rnd(-0.5, 0.5)), size: rnd(0.8, 1.6) * e.size * (0.4 + fade), size1: 0.3 * e.size,
              life: rnd(0.4, 0.8), color: [2.5, 1.2, 0.3, 1], color1: [1.2, 0.2, 0.02, 0], tile: TILE.SMOKE, spin: rnd(-2, 2) });
            if (Math.random() < 0.35) fx.smoke(e.pos.clone().add(V(0, 1.5 * e.size, 0)), 1.2 * e.size, 3.5, 0.1, V(rnd(-0.6, 0.6), rnd(3, 5), rnd(-0.6, 0.6)), 0.6);
          }
        } else if (e.kind === 'smoke') {
          while (e.acc > 0.12) { e.acc -= 0.12; fx.smoke(e.pos.clone().add(rv(e.size)), 2 * e.size, 5, 0.12, V(rnd(-0.5, 0.5), rnd(3, 5), rnd(-0.5, 0.5)), 0.5 * fade + 0.1); }
        } else if (e.kind === 'water') {
          while (e.acc > 0.03) {
            e.acc -= 0.03;
            alpha.spawn({ pos: e.pos.clone().add(V(rnd(-0.1, 0.1), 0.4, rnd(-0.1, 0.1))), vel: V(rnd(-1.2, 1.2), rnd(13, 17) * (0.3 + 0.7 * fade), rnd(-1.2, 1.2)), size: rnd(0.3, 0.6), size1: rnd(1.2, 2),
              life: rnd(1.2, 1.8), color: [0.75, 0.85, 0.95, 0.7], color1: [0.9, 0.95, 1, 0], tile: TILE.SMOKE, grav: 12, drag: 0.4 });
          }
        }
      }
      add.update(dt, fog);
      alpha.update(dt, fog);
    },
  };
  let G_eye = null;
  return fx;
}
