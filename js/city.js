// The city: districts of towers, shop streets, suburbs, industry and a gas-station strip, all of it
// destructible. Shots blast holes through walls; a building that loses all its strength either
// shatters (small ones) or collapses into the ground in a cloud of dust (big ones), leaving rubble.
import * as THREE from 'three';
import { V, UP, clamp, makeRand, yq } from './util.js';
import { G, st } from './state.js';
import { Batch } from './batch.js';
import { addSolid, solidsNear, CELL } from './collision.js';
import { addBox, removeCollider, spawnDebris } from './physics.js';
import { NOISE_GLSL, WORLD_POS_VERT, macroTint } from './shaders.js';
import { signAtlas, stripeTexture, helipadTexture, grassTexture } from './textures.js';
import { terrainHeight, LAKE, RUNWAY } from './terrain.js';

const CITY = 12;
const R = makeRand(1337);
const IDQ = new THREE.Quaternion();
const srgb = (r, g, b) => new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
const pick = a => a[Math.floor(R() * a.length)];
const faceYaw = n => Math.atan2(n.x, n.z);      // turns +z to face n
const armYaw = n => Math.atan2(-n.x, -n.z);     // turns -z (a prop's front) to face n
const SIDES = [V(1, 0, 0), V(-1, 0, 0), V(0, 0, 1), V(0, 0, -1)];

// ---------- blast holes: the latest hits, shared by every building ----------
const MAX_HOLES = 96;
const holeUniforms = { uHoles: { value: Array.from({ length: MAX_HOLES }, () => new THREE.Vector4(0, -1e5, 0, 0)) }, uHoleCount: { value: 0 } };
let holeNext = 0;
function addHole(p, r) {
  holeUniforms.uHoles.value[holeNext % MAX_HOLES].set(p.x, p.y, p.z, r);
  holeNext++;
  holeUniforms.uHoleCount.value = Math.min(MAX_HOLES, holeNext);
}

// Windows are drawn by the shader from world position, so they are the same size on every building,
// and the glass reflects the sky. Kinds: 0 glass tower, 1 concrete, 2 brick, 3 house, 4 warehouse, 5 stucco.
function buildingShader(mat) {
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, holeUniforms);
    sh.vertexShader = 'attribute vec2 aStyle;\nvarying vec2 vStyle;\nvarying vec3 vWP;\nvarying vec3 vObjN;\n'
      + sh.vertexShader.replace('#include <begin_vertex>', WORLD_POS_VERT + '\n  vObjN = normal; vStyle = aStyle;');
    sh.fragmentShader = `varying vec2 vStyle;\nvarying vec3 vWP;\nvarying vec3 vObjN;\nuniform vec4 uHoles[${MAX_HOLES}];\nuniform int uHoleCount;\nfloat winMask = 0.0;\n` + NOISE_GLSL
      + sh.fragmentShader
        .replace('#include <color_fragment>', `#include <color_fragment>
  {
    float scorch = 0.0;
    for (int i = 0; i < ${MAX_HOLES}; i++) { // blast holes: jagged edges ringed with scorch
      if (i >= uHoleCount) break;
      vec4 h = uHoles[i];
      float d = distance(vWP, h.xyz);
      if (d > h.w * 2.3) continue;
      float rr = h.w * (0.7 + 0.5 * vnoise(vWP.xy * 1.3 + vWP.zy * 1.1 + h.xz));
      if (d < rr) discard;
      scorch = max(scorch, 1.0 - smoothstep(rr, h.w * 2.3, d));
    }
    float far = smoothstep(450.0, 1400.0, distance(vWP, cameraPosition));
    if (!gl_FrontFacing) { // seen through a hole: bare concrete and floor slabs
      diffuseColor.rgb = vec3(0.1, 0.095, 0.09) + step(0.88, fract(vWP.y / 3.4)) * 0.14;
    } else if (abs(vObjN.y) < 0.5) {
      float u = abs(vObjN.x) > 0.5 ? vWP.z : vWP.x, v = vWP.y, kind = vStyle.x;
      float spacing = 3.2, floorH = 3.3, mx = 0.2, lo = 0.28, hi = 0.82, shopBand = 1.0, minV = 4.2;
      if (kind < 0.5) { spacing = 2.0; floorH = 3.6; mx = 0.06; lo = 0.1; hi = 0.94; }
      else if (kind < 1.5) { }
      else if (kind < 2.5) { spacing = 2.8; mx = 0.28; }
      else if (kind < 3.5) { spacing = 4.2; floorH = 3.0; mx = 0.36; lo = 0.3; hi = 0.75; shopBand = 0.0; minV = 0.8; }
      else if (kind < 4.5) { spacing = 4.0; floorH = 9.0; mx = 0.12; lo = 0.72; hi = 0.86; shopBand = 0.0; minV = 5.0; }
      else { spacing = 3.6; floorH = 3.4; mx = 0.25; lo = 0.3; hi = 0.8; }
      vec2 id = vec2(floor(u / spacing), floor(v / floorH));
      vec2 f = vec2(fract(u / spacing), fract(v / floorH));
      float win = step(mx, f.x) * step(f.x, 1.0 - mx) * step(lo, f.y) * step(f.y, hi) * step(minV, v);
      float s6 = fract(u / 6.0);
      float shop = shopBand * step(0.5, v) * step(v, 3.6) * step(0.05, s6) * step(s6, 0.95);
      float m = mix(max(win, shop), (1.0 - 2.0 * mx) * (hi - lo), far);
      float hsh = h21(id + vStyle.y);
      vec3 glass = mix(vec3(0.14, 0.2, 0.28), vec3(0.26, 0.34, 0.42), hsh);
      glass = mix(glass, vec3(1.0, 0.72, 0.38), step(0.95, hsh) * (1.0 - far) * 0.7);
      if (kind > 1.5 && kind < 2.5) { // brick courses
        float by = fract(v / 0.32), bx = fract(u / 0.7 + 0.5 * floor(v / 0.32));
        diffuseColor.rgb *= 1.0 - (1.0 - far) * 0.18 * max(step(0.88, by), step(0.94, bx));
      } else if (kind > 2.5 && kind < 3.5) { // lap siding
        diffuseColor.rgb *= 1.0 - (1.0 - far) * 0.1 * step(0.8, fract(v / 0.28));
      } else if (kind > 3.5 && kind < 4.5) { // corrugated metal and roll-up doors
        diffuseColor.rgb *= 0.86 + 0.14 * step(0.5, fract(u / 0.9));
        float s16 = fract(u / 16.0), door = step(0.25, s16) * step(s16, 0.6) * step(v, 5.5);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.28, 0.29, 0.31) * (0.85 + 0.15 * step(0.5, fract(v / 0.35))), door);
      }
      diffuseColor.rgb *= 1.0 - 0.14 * step(0.95, f.y) * (1.0 - far) * step(kind, 2.5);
      diffuseColor.rgb = mix(diffuseColor.rgb, glass, m);
      diffuseColor.rgb *= mix(0.6, 1.0, smoothstep(0.0, 7.0, v));   // darker where walls meet the street
      winMask = m;
    } else {
      diffuseColor.rgb *= 0.5 + 0.12 * h21(floor(vWP.xz * 1.5));    // tar and gravel roof
    }
    diffuseColor.rgb *= 1.0 - 0.85 * scorch;
  }`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = mix(roughnessFactor, 0.06, winMask);')
        .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n  metalnessFactor = mix(metalnessFactor, 0.6, winMask);');
  };
  mat.customProgramCacheKey = () => 'buildings2';
}

// Shop signs pick their tile from the atlas per instance.
function signShader(mat) {
  mat.onBeforeCompile = sh => {
    sh.vertexShader = 'attribute float aTile;\n' + sh.vertexShader.replace('#include <uv_vertex>', `#include <uv_vertex>
  vec2 tOff = vec2(mod(aTile, 4.0) * 0.25, floor(aTile / 4.0) * 0.5);
  #ifdef USE_MAP
    vMapUv = vMapUv * vec2(0.25, 0.5) + tOff;
  #endif
  #ifdef USE_EMISSIVEMAP
    vEmissiveMapUv = vEmissiveMapUv * vec2(0.25, 0.5) + tOff;
  #endif`);
  };
  mat.customProgramCacheKey = () => 'signs';
}

// A roof: 1 wide (x), 1 deep (z), ridge 1 high running along z.
function prismGeometry() {
  const A = [-0.5, 0, -0.5], B = [0.5, 0, -0.5], C = [0.5, 0, 0.5], D = [-0.5, 0, 0.5], E = [0, 1, -0.5], F = [0, 1, 0.5];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([A, D, F, A, F, E, B, E, F, B, F, C, A, E, B, D, C, F].flat(), 3));
  g.computeVertexNormals();
  return g;
}

const BCOL = {
  0: () => srgb(0.42 + R() * 0.1, 0.5 + R() * 0.1, 0.58 + R() * 0.1),
  1: () => { const l = 0.62 + R() * 0.22; return srgb(l, l * 0.97, l * 0.92); },
  2: () => srgb(0.45 + R() * 0.15, 0.22 + R() * 0.08, 0.16 + R() * 0.06),
  3: () => srgb(...pick([[0.95, 0.94, 0.9], [0.9, 0.84, 0.7], [0.72, 0.82, 0.9], [0.95, 0.9, 0.62], [0.93, 0.72, 0.62], [0.78, 0.8, 0.78]])),
  4: () => srgb(...pick([[0.55, 0.58, 0.62], [0.4, 0.5, 0.62], [0.7, 0.66, 0.55], [0.45, 0.55, 0.45], [0.62, 0.35, 0.3]])),
  5: () => srgb(...pick([[0.95, 0.85, 0.7], [0.85, 0.93, 0.85], [0.95, 0.78, 0.75], [0.8, 0.88, 0.95], [0.98, 0.95, 0.8]])),
};
const ROOF_COLORS = [[0.55, 0.2, 0.15], [0.35, 0.3, 0.28], [0.25, 0.28, 0.33], [0.5, 0.35, 0.22], [0.6, 0.45, 0.3]];
const CAR_COLORS = [[0.8, 0.8, 0.82], [0.1, 0.1, 0.12], [0.6, 0.08, 0.08], [0.1, 0.2, 0.45], [0.55, 0.57, 0.6], [0.95, 0.78, 0.15], [0.15, 0.35, 0.2], [0.9, 0.9, 0.85]];
const AWNING_COLORS = [[0.7, 0.1, 0.1], [0.1, 0.45, 0.2], [0.1, 0.25, 0.6], [0.85, 0.45, 0.1], [0.1, 0.5, 0.5], [0.45, 0.1, 0.25]];

function district(i, j) {
  const x = i * CELL, z = j * CELL, r = Math.hypot(x, z);
  if (r < 430) return 'downtown';
  if (x > 560 && z < 600) return 'industrial';
  if (r < 740) return 'commercial';
  if (z > 520 && Math.abs(x) < 560) return 'strip';
  return 'suburb';
}

export function createCity(scene, props) {
  const bldMat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.05, side: THREE.DoubleSide });
  buildingShader(bldMat);
  const signMat = new THREE.MeshStandardMaterial({ map: signAtlas(), roughness: 0.4, emissive: 0xffffff, emissiveIntensity: 0.55, side: THREE.DoubleSide });
  signMat.emissiveMap = signMat.map;
  signShader(signMat);
  const grass = grassTexture(2.6);
  const lawnMat = new THREE.MeshLambertMaterial({ map: grass, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  macroTint(lawnMat, 60, 0.3);
  const flatMat = color => new THREE.MeshLambertMaterial({ color, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const box1 = () => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const plane = () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const stdc = (c, m = 0.2, r = 0.7) => new THREE.MeshStandardMaterial({ color: c, metalness: m, roughness: r });

  const B = {
    bld: new Batch(box1(), bldMat, { tint: true, attrs: { aStyle: 2 } }),
    roof: new Batch(prismGeometry(), new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0.05 }), { tint: true }),
    parapet: new Batch(box1(), stdc(0x8e9093, 0.25, 0.75), { shadow: false }),
    unit: new Batch(box1(), stdc(0x9a9ca0, 0.5, 0.5)),
    tank: new Batch(new THREE.CylinderGeometry(2.5, 2.5, 4, 12).translate(0, 3.2, 0), stdc(0x735438, 0, 0.8)),
    spire: new Batch(new THREE.CylinderGeometry(0.25, 0.9, 1, 8).translate(0, 0.5, 0), stdc(0xcfd2d8, 0.9, 0.3)),
    warn: new Batch(new THREE.SphereGeometry(0.6, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2020 }), { shadow: false }),
    helipad: new Batch(plane(), new THREE.MeshStandardMaterial({ map: helipadTexture(), roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 }), { shadow: false }),
    sign: new Batch(new THREE.PlaneGeometry(1, 1), signMat, { attrs: { aTile: 1 }, shadow: false }),
    awning: new Batch(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ map: stripeTexture(), roughness: 0.8 }), { tint: true }),
    lawn: new Batch(plane(), lawnMat, { shadow: false }),
    paving: new Batch(plane(), flatMat(srgb(0.72, 0.7, 0.66)), { shadow: false }),
    pool: new Batch(plane(), new THREE.MeshStandardMaterial({ color: srgb(0.2, 0.6, 0.85), roughness: 0.05, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }), { shadow: false }),
    canopy: new Batch(box1(), stdc(0xe8e8e8, 0.3, 0.5)),
    pillar: new Batch(new THREE.CylinderGeometry(0.3, 0.3, 1, 8).translate(0, 0.5, 0), stdc(0xc0392b, 0.3, 0.5)),
    chimney: new Batch(new THREE.CylinderGeometry(2.2, 2.8, 1, 16).translate(0, 0.5, 0), stdc(0x8a6a5a, 0, 0.85)),
    rubble: new Batch(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true }), { tint: true, extra: 2400 }),
  };
  const warnMat = B.warn.mat; warnMat.userData.base = warnMat.color.clone();

  const buildings = [];
  const spawns = [];            // power-up spots
  const parks = [];
  function addBuilding(x, z, w, d, bottom, top, kind, color) {
    const i = B.bld.add(V(x, bottom, z), IDQ, V(w, top - bottom, d), color, { aStyle: [kind, R() * 100] });
    const h = top - bottom;
    const b = { i, x, z, w, d, bottom, top, h, kind, color: new THREE.Color(color), state: 'ok', attach: [], upper: [], lower: null,
      maxHp: clamp(w * d * h / 100, 120, 2600), value: Math.round(w * d * h * 150 / 1000) * 1000, t: 0 };
    b.hp = b.maxHp;
    b.solid = addSolid(x, z, w, d, top, bottom, { building: b });
    buildings.push(b);
    return b;
  }
  const attach = (b, batch, pos, quat = IDQ, scale = V(1, 1, 1), color = null, attrs = {}) =>
    b.attach.push({ batch, i: batch.add(pos, quat, scale, color, attrs), pos, quat, scale, color: color ? new THREE.Color(color) : null });

  // ---------- rooftops ----------
  function roofStuff(b, parapet = true) {
    const { x, z, w, d, top } = b;
    if (parapet) for (const [px, pz, sw, sd] of [[x, z - d / 2 + 0.25, w, 0.5], [x, z + d / 2 - 0.25, w, 0.5], [x - w / 2 + 0.25, z, 0.5, d], [x + w / 2 - 0.25, z, 0.5, d]])
      attach(b, B.parapet, V(px, top, pz), IDQ, V(sw, 1, sd));
    for (let n = 1 + Math.floor(R() * 4); n > 0; n--)
      attach(b, B.unit, V(x + (R() - 0.5) * (w - 8), top, z + (R() - 0.5) * (d - 8)), IDQ, V(2 + R() * 3, 1.5 + R() * 1.5, 2 + R() * 3));
    if (R() < 0.3 && w > 14 && d > 14) attach(b, B.tank, V(x + (R() - 0.5) * (w - 10), top, z + (R() - 0.5) * (d - 10)));
  }
  function spire(b) {
    const h = 8 + R() * 25;
    attach(b, B.spire, V(b.x, b.top, b.z), IDQ, V(1, h, 1));
    attach(b, B.warn, V(b.x, b.top + h, b.z));
  }
  function helipad(b) {
    const s = Math.min(b.w, b.d) * 0.7;
    attach(b, B.helipad, V(b.x, b.top + 0.05, b.z), IDQ, V(s, 1, s));
    spawns.push(V(b.x, b.top + 1.5, b.z));
  }

  // A shop front on one face: a sign over a striped awning.
  function shopFront(b, n) {
    const along = Math.abs(n.x) > 0.5 ? b.d : b.w;
    const cx = b.x + n.x * (b.w / 2), cz = b.z + n.z * (b.d / 2);
    const q = yq(faceYaw(n));
    const sy = b.h >= 5.5 ? 4.4 : b.h - 1;
    attach(b, B.sign, V(cx + n.x * 0.12, sy, cz + n.z * 0.12), q, V(Math.min(along * 0.7, 9), 1.5, 1), null, { aTile: Math.floor(R() * 8) });
    if (b.h >= 5.5) {
      const aq = q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), 0.28));
      attach(b, B.awning, V(cx + n.x * 0.9, 3.3, cz + n.z * 0.9), aq, V(Math.min(along * 0.8, 14), 0.12, 1.9), srgb(...pick(AWNING_COLORS)));
    }
  }

  // ---------- districts ----------
  function tower(cx, cz) {
    const kind = R() < 0.65 ? 0 : 1;
    const w = 26 + R() * 30, d = 26 + R() * 30, h = 50 + R() * 125;
    const b = addBuilding(cx, cz, w, d, 0, h, kind, BCOL[kind]());
    let roofB = b;
    if (h > 75 && R() < 0.75) {
      const w2 = w * (0.5 + R() * 0.3), d2 = d * (0.5 + R() * 0.3), h2 = h + 12 + R() * 45;
      const t = addBuilding(cx + (R() - 0.5) * (w - w2) * 0.6, cz + (R() - 0.5) * (d - d2) * 0.6, w2, d2, h, h2, kind, BCOL[kind]());
      t.lower = b; b.upper.push(t); roofB = t;
    }
    const r = R();
    if (r < 0.35) spire(roofB);
    else if (r < 0.6) { helipad(roofB); roofStuff(roofB, true); }
    else roofStuff(roofB);
  }

  function commercialBlock(cx, cz, low) {
    const xs = R() < 0.65 ? [[-29, -2], [2, 29]] : [[-29, 29]];
    const zs = R() < 0.5 ? [[-29, -2], [2, 29]] : [[-29, 29]];
    for (const [x0, x1] of xs) for (const [z0, z1] of zs) {
      const insetX = x0 === -29 && x1 === 29 ? 0 : 1 + R() * 3, insetZ = z0 === -29 && z1 === 29 ? 0 : 1 + R() * 3;
      const w = x1 - x0 - insetX, d = z1 - z0 - insetZ;
      const x = cx + (x0 === -29 ? x0 + w / 2 : x1 - w / 2), z = cz + (z0 === -29 ? z0 + d / 2 : z1 - d / 2);
      const h = low ? 4.5 + R() * 5 : 8 + R() * 30;
      const kind = R() < 0.4 ? 2 : R() < 0.65 ? 5 : 1;
      const b = addBuilding(x, z, w, d, 0, h, kind, BCOL[kind]());
      const outer = [];
      if (x0 === -29) outer.push(V(-1, 0, 0)); if (x1 === 29) outer.push(V(1, 0, 0));
      if (z0 === -29) outer.push(V(0, 0, -1)); if (z1 === 29) outer.push(V(0, 0, 1));
      for (const n of outer) if (R() < 0.8) shopFront(b, n);
      roofStuff(b);
      if (R() < 0.08 && h < 40) spawns.push(V(x, h + 1.5, z));
    }
  }

  function suburbBlock(cx, cz) {
    for (const qx of [-1, 1]) for (const qz of [-1, 1]) {
      const lx = cx + qx * 15, lz = cz + qz * 15;
      B.lawn.add(V(lx, 0.045, lz), IDQ, V(27.5, 1, 27.5));
      const n = R() < 0.5 ? V(qx, 0, 0) : V(0, 0, qz);       // the street the house faces
      const lat = V(n.z, 0, n.x);                             // along the street
      const alongX = Math.abs(n.x) > 0.5;
      const edge = alongX ? V(cx + n.x * 29, 0, lz) : V(lx, 0, cz + n.z * 29); // the lot's curb, level with its middle
      const w = 10 + R() * 4.5, d = 8 + R() * 3.5, h = R() < 0.55 ? 3.4 : 6.3;
      const off = (R() - 0.5) * 6;
      const c = edge.clone().addScaledVector(n, -(7 + d / 2)).addScaledVector(lat, off);
      const b = addBuilding(c.x, c.z, alongX ? d : w, alongX ? w : d, 0, h, 3, BCOL[3]());
      const roofH = 2 + R() * 1.5;
      attach(b, B.roof, V(c.x, h, c.z), yq(alongX ? 0 : Math.PI / 2), V(d + 0.9, roofH, w + 0.9), srgb(...pick(ROOF_COLORS)));
      // driveway, fence, mailbox, maybe a car, pool and trees
      const dside = R() < 0.5 ? -1 : 1, dlat = off + dside * (w / 2 + 2);
      const drive = edge.clone().addScaledVector(lat, dlat).addScaledVector(n, -4.5);
      B.paving.add(V(drive.x, 0.05, drive.z), yq(alongX ? Math.PI / 2 : 0), V(3.6, 1, 9));
      if (R() < 0.5) for (let t = -12; t <= 12; t += 4) {
        if (Math.abs(t - dlat) < 3.5) continue;
        const f = edge.clone().addScaledVector(n, -1).addScaledVector(lat, t);
        props.add('fence', f.x, f.z, alongX ? Math.PI / 2 : 0, { y: 0 });
      }
      const mb = edge.clone().addScaledVector(n, -1.2).addScaledVector(lat, dlat + 2.4);
      props.add('mailbox', mb.x, mb.z, armYaw(n), { y: 0 });
      if (R() < 0.4) props.add('car', drive.x, drive.z, faceYaw(n) + (R() < 0.5 ? 0 : Math.PI), { y: 0, color: srgb(...pick(CAR_COLORS)) });
      const back = c.clone().addScaledVector(n, -(d / 2 + 5.5));
      if (R() < 0.25) {
        B.paving.add(V(back.x, 0.055, back.z), yq(alongX ? Math.PI / 2 : 0), V(8, 1, 5));
        B.pool.add(V(back.x, 0.06, back.z), yq(alongX ? Math.PI / 2 : 0), V(6.4, 1, 3.4));
      } else if (R() < 0.2) spawns.push(V(back.x, 1.2, back.z));
      for (let k = Math.floor(R() * 3); k > 0; k--) {
        const tp = V(lx, 0, lz).addScaledVector(n, -(8 + R() * 4)).addScaledVector(lat, (R() - 0.5) * 22);
        props.add(R() < 0.35 ? 'palm' : 'tree', tp.x, tp.z, R() * 6, { y: 0, scale: 0.7 + R() * 0.5, color: srgb(0.18 + R() * 0.12, 0.38 + R() * 0.15, 0.14 + R() * 0.08) });
      }
    }
  }

  function industrialBlock(cx, cz) {
    const w = 38 + R() * 16, d = 28 + R() * 16, h = 9 + R() * 6;
    const b = addBuilding(cx + (R() - 0.5) * (58 - w), cz - (29 - d / 2), w, d, 0, h, 4, BCOL[4]());
    roofStuff(b, false);
    const yardZ0 = cz - 29 + d + 2, yardZ1 = cz + 29, yd = yardZ1 - yardZ0;
    if (yd > 7) {
      const zc = (yardZ0 + yardZ1) / 2;
      if (R() < 0.3 && yd > 14) { // fuel tanks
        for (const k of [-1, 1]) if (R() < 0.8) props.add('fuelTank', cx + k * 14, zc, 0, { y: 0 });
      } else {
        for (let k = 0; k < 3; k++) {
          if (R() < 0.3) continue;
          const x = cx - 18 + k * 18, col = srgb(...pick([[0.7, 0.15, 0.1], [0.1, 0.3, 0.6], [0.15, 0.5, 0.25], [0.85, 0.55, 0.1], [0.5, 0.5, 0.52]]));
          for (let lv = 0, n = 1 + Math.floor(R() * 3); lv < n; lv++) props.add('container', x, zc + (R() - 0.5) * 2, 0, { y: lv * 2.62, color: lv ? srgb(...pick([[0.7, 0.15, 0.1], [0.1, 0.3, 0.6], [0.85, 0.55, 0.1]])) : col });
        }
        if (R() < 0.3) spawns.push(V(cx + 27, 1.2, zc));
      }
      for (let c = 1 + Math.floor(R() * 2); c > 0; c--) { // explosive barrels
        const bx = cx + (R() - 0.5) * 50, bz = yardZ0 + 1 + R() * (yd - 2);
        for (let k = 3 + Math.floor(R() * 3); k > 0; k--) props.add('barrel', bx + (R() - 0.5) * 3, bz + (R() - 0.5) * 3, 0, { y: 0 });
      }
    }
    if (R() < 0.18) { // chimney
      const ch = 35 + R() * 20, x = b.x + b.w / 2 - 4, z = b.z - b.d / 2 + 4;
      attach(b, B.chimney, V(x, 0, z), IDQ, V(1, ch, 1));
      addSolid(x, z, 5, 5, ch, 0);
    }
  }

  function gasStation(cx, cz) {
    const shop = addBuilding(cx, cz - 20, 16, 10, 0, 4.6, 5, BCOL[5]());
    shopFront(shop, V(0, 0, 1));
    const top = 5.5;
    B.canopy.add(V(cx, top - 0.6, cz + 6), IDQ, V(20, 0.6, 13));
    for (const [px, pz] of [[-8, 1], [8, 1], [-8, 11], [8, 11]]) B.pillar.add(V(cx + px, 0, cz + pz), IDQ, V(1, top - 0.6, 1));
    addSolid(cx, cz + 6, 20, 13, top, top - 0.6);
    for (const px of [-4, 4]) for (const pz of [3, 9]) props.add('pump', cx + px, cz + pz, 0, { y: 0 });
    for (let k = 0; k < 4; k++) props.add('barrel', cx + 22 + (R() - 0.5) * 3, cz - 20 + (R() - 0.5) * 3, 0, { y: 0 });
    spawns.push(V(cx, 1.2, cz + 6));
  }
  function motel(cx, cz) {
    const a = addBuilding(cx, cz - 22, 56, 12, 0, 6.6, 5, BCOL[5]());
    const b = addBuilding(cx - 22, cz + 6, 12, 40, 0, 6.6, 5, a.color);
    shopFront(a, V(0, 0, 1)); shopFront(b, V(1, 0, 0));
    roofStuff(a); roofStuff(b);
    for (let k = 0; k < 5; k++) props.add('car', cx + 4 + k * 5, cz + 4, 0, { y: 0, color: srgb(...pick(CAR_COLORS)) });
  }

  function park(cx, cz) {
    parks.push([cx, cz]);
    B.lawn.add(V(cx, 0.04, cz), IDQ, V(62, 1, 62));
    B.paving.add(V(cx, 0.05, cz), IDQ, V(4, 1, 62));
    B.paving.add(V(cx, 0.051, cz), IDQ, V(62, 1, 4));
    for (let n = 10 + Math.floor(R() * 8); n > 0; n--) {
      let x = (R() - 0.5) * 54, z = (R() - 0.5) * 54;
      if (Math.abs(x) < 4) x += 6 * Math.sign(x || 1);
      if (Math.abs(z) < 4) z += 6 * Math.sign(z || 1);
      props.add(R() < 0.3 ? 'palm' : 'tree', cx + x, cz + z, R() * 6, { y: 0, scale: 0.8 + R() * 0.6, color: srgb(0.18 + R() * 0.12, 0.38 + R() * 0.15, 0.14 + R() * 0.08) });
    }
    for (const [x, z, a] of [[5, 12, Math.PI / 2], [-5, -14, -Math.PI / 2], [12, -5, 0]]) props.add('bench', cx + x, cz + z, a, { y: 0 });
    spawns.push(V(cx, 1.2, cz));
  }

  // Lamps, trees, hydrants, bins, benches, bus stops, traffic lights and parked cars round a block.
  function furniture(cx, cz, dk) {
    const busy = dk === 'downtown' || dk === 'commercial' || dk === 'strip';
    SIDES.forEach((n, k) => {
      const lat = V(n.z, 0, n.x);
      const at = (off, t) => V(cx, 0, cz).addScaledVector(n, off).addScaledVector(lat, t);
      const l = at(32.6, k % 2 ? 12 : -12);
      props.add('lamp', l.x, l.z, armYaw(n), { y: 0 });
      if (busy) for (const t of [-24, 24]) {
        const p = at(32.3, t);
        props.add(dk === 'downtown' ? 'tree' : 'palm', p.x, p.z, R() * 6, { y: 0, scale: 0.75 + R() * 0.3, color: srgb(0.18 + R() * 0.1, 0.4 + R() * 0.12, 0.14) });
      }
      const skip = dk === 'suburb' ? 0.9 : 0.55;
      if (R() > skip) for (let c = 1 + Math.floor(R() * 2); c > 0; c--) {
        const p = at(35.2, (R() - 0.5) * 44);
        props.add('car', p.x, p.z, faceYaw(lat) + (R() < 0.5 ? 0 : Math.PI), { y: 0, color: srgb(...pick(CAR_COLORS)) });
      }
    });
    const side = pick(SIDES), lat = V(side.z, 0, side.x);
    const hp = V(cx, 0, cz).addScaledVector(side, 32.4).addScaledVector(lat, (R() - 0.5) * 40);
    props.add('hydrant', hp.x, hp.z, 0, { y: 0 });
    if (busy) {
      props.add('traffic', cx + 33, cz - 33, armYaw(V(1, 0, 0)), { y: 0 });
      props.add('traffic', cx - 33, cz + 33, armYaw(V(-1, 0, 0)), { y: 0 });
      const s2 = pick(SIDES), l2 = V(s2.z, 0, s2.x);
      const bp = V(cx, 0, cz).addScaledVector(s2, 32.3).addScaledVector(l2, (R() - 0.5) * 36);
      props.add('bin', bp.x, bp.z, 0, { y: 0 });
      if (R() < 0.35) { const p = V(cx, 0, cz).addScaledVector(s2, 32.2).addScaledVector(l2, 6); props.add('bench', p.x, p.z, armYaw(s2), { y: 0 }); }
      if (R() < 0.07) { const p = V(cx, 0, cz).addScaledVector(s2, 32.4).addScaledVector(l2, -8); props.add('busStop', p.x, p.z, armYaw(s2), { y: 0 }); }
      if (R() < 0.25) { // a stack of crates on a corner
        const cp = V(cx, 0, cz).addScaledVector(s2, 32.2).addScaledVector(l2, 27);
        for (let k = 1 + Math.floor(R() * 3); k > 0; k--) props.add('crate', cp.x + (R() - 0.5) * 0.4, cp.z + (R() - 0.5) * 0.4, R() * 0.6, { y: (k - 1) * 1.5 });
      }
    }
  }

  // ---------- lay out the city ----------
  let strips = 0;
  for (let i = -CITY; i <= CITY; i++) for (let j = -CITY; j <= CITY; j++) {
    const cx = i * CELL, cz = j * CELL;
    if (i === 0 || j === 0) continue; // the boulevards
    const dk = district(i, j);
    if (dk !== 'downtown' && dk !== 'industrial' && R() < 0.12) { park(cx, cz); furniture(cx, cz, 'park'); continue; }
    if (dk === 'downtown') tower(cx, cz);
    else if (dk === 'commercial') commercialBlock(cx, cz, false);
    else if (dk === 'strip') { const k = strips++; if (k === 2) gasStation(cx, cz); else if (k === 5) motel(cx, cz); else commercialBlock(cx, cz, true); }
    else if (dk === 'industrial') industrialBlock(cx, cz);
    else suburbBlock(cx, cz);
    furniture(cx, cz, dk);
  }
  // boulevards: palms and lamps down both sides, billboards out of town
  for (let t = -1480; t <= 1480; t += 28) {
    if (Math.abs(t) < 30) continue;
    const inTown = Math.abs(t) < 1000;
    for (const s of [-1, 1]) {
      if (inTown) {
        props.add('palm', s * 24, t, R() * 6, { y: 0, scale: 0.9 + R() * 0.3 });
        props.add('palm', t, s * 24, R() * 6, { y: 0, scale: 0.9 + R() * 0.3 });
      }
      if (Math.round(t / 28) % 2 === 0) {
        props.add('lamp', s * 17, t, armYaw(V(-s, 0, 0)));
        props.add('lamp', t, s * 17, armYaw(V(0, 0, -s)));
      }
    }
  }
  for (const t of [-1400, -1150, 1150, 1400]) {
    props.add('billboard' + Math.floor(R() * 4), 42, t, faceYaw(V(-1, 0, 0)) + Math.PI);
    props.add('billboard' + Math.floor(R() * 4), t, -42, faceYaw(V(0, 0, 1)) + Math.PI);
  }
  // airport clutter: containers, barrels and a fuel farm by the apron
  for (let k = 0; k < 4; k++) props.add('container', 200, 2120 + k * 3, 0, { y: 0, color: srgb(...pick([[0.7, 0.15, 0.1], [0.1, 0.3, 0.6], [0.85, 0.55, 0.1]])) });
  props.add('fuelTank', 205, 2330, 0, { y: 0 }); props.add('fuelTank', 225, 2330, 0, { y: 0 });
  for (let k = 0; k < 6; k++) props.add('barrel', 190 + (R() - 0.5) * 4, 2250 + (R() - 0.5) * 4, 0, { y: 0 });
  spawns.push(V(125, 1.2, 2050), V(125, 1.2, 1850));
  // the countryside: woods on the hills, palms round the lake
  let placed = 0;
  while (placed < 2600) {
    const a = R() * Math.PI * 2, r = 1150 + R() * 2600, x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.abs(x) < 45 || Math.abs(z) < 45) continue;
    if (Math.abs(x) < 320 && z > RUNWAY.z0 - 100 && z < RUNWAY.z1 + 250) continue;
    if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 60) continue;
    const pine = R() < 0.6;
    props.add(pine ? 'pineFar' : 'treeFar', x, z, R() * 6, { scale: 0.8 + R() * 0.9, color: pine ? srgb(0.12, 0.3, 0.13) : srgb(0.2 + R() * 0.1, 0.4 + R() * 0.12, 0.15) });
    placed++;
  }
  for (let k = 0; k < 40; k++) {
    const a = R() * Math.PI * 2, r = LAKE.r + 45 + R() * 40, x = LAKE.x + Math.cos(a) * r, z = LAKE.z + Math.sin(a) * r;
    if (terrainHeight(x, z) < 10) props.add('palm', x, z, R() * 6, { scale: 0.8 + R() * 0.4 });
  }
  spawns.push(V(LAKE.x + LAKE.r + 70, terrainHeight(LAKE.x + LAKE.r + 70, LAKE.z) + 1.2, LAKE.z));
  for (let k = 0; k < 6; k++) { // hilltops
    let best = null;
    for (let tries = 0; tries < 40; tries++) {
      const a = R() * Math.PI * 2, r = 1800 + R() * 900, x = Math.cos(a) * r, z = Math.sin(a) * r, h = terrainHeight(x, z);
      if (!best || h > best.y) best = V(x, h, z);
    }
    spawns.push(best.add(V(0, 1.2, 0)));
  }

  // ---------- build the meshes and the physics ----------
  for (const b of Object.values(B)) b.build(scene);
  for (const b of buildings) b.collider = addBox(b.x, (b.bottom + b.top) / 2, b.z, b.w / 2, b.h / 2, b.d / 2);
  const map = drawMap(buildings, parks);

  // ---------- damage ----------
  function damage(b, amount, point = null, holeR = 0, normal = null) {
    if (b.state !== 'ok') return;
    b.hp -= amount;
    if (point && holeR > 0) {
      addHole(point, holeR);
      const n = normal ?? V(0, 1, 0);
      for (let k = Math.min(4, 1 + Math.floor(holeR)); k > 0; k--)
        spawnDebris(point.clone().addScaledVector(n, 0.4), V(0.2 + R() * holeR * 0.4, 0.2 + R() * holeR * 0.3, 0.2 + R() * holeR * 0.4), b.color,
          n.clone().multiplyScalar(4 + R() * 6).add(V((R() - 0.5) * 4, 2 + R() * 3, (R() - 0.5) * 4)), 15);
      G.fx.smoke(point.clone().addScaledVector(n, 1), 1.5 + holeR * 0.5, 3, 0.45, n.clone().multiplyScalar(2).add(V(0, 1, 0)), 0.55);
    }
    if (b.hp < b.maxHp * 0.5 && !b.smoking && point) { b.smoking = true; G.fx.emit('smoke', point, 45, 1.5 + b.h / 60); }
    if (b.hp <= 0) collapse(b, point ?? V(b.x, b.bottom + b.h / 2, b.z));
  }
  function stackTop(b) { let t = b.top; for (const u of b.upper) t = Math.max(t, stackTop(u)); return t; }
  function collapse(b, from, shared = null) {
    if (b.state !== 'ok') return;
    removeCollider(b.collider); b.collider = null;
    for (const a of b.attach) { // rooftop gear flies off
      const size = a.scale.clone(); size.x = Math.max(0.3, Math.min(size.x, 6)); size.y = Math.max(0.3, Math.min(size.y, 6)); size.z = Math.max(0.3, Math.min(size.z, 6));
      if (a.batch !== B.sign && a.batch !== B.helipad) spawnDebris(a.pos.clone().add(V(0, 1, 0)), size, a.color ?? 0x8e9093, V((R() - 0.5) * 12, 6 + R() * 8, (R() - 0.5) * 12), 25);
      a.batch.hide(a.i);
    }
    st.cash += b.value;
    G.hud?.toast(`COLLATERAL  +$${b.value.toLocaleString()}`, '#ffb238');
    const small = !shared && (b.h <= 14 || b.kind === 3) && b.bottom === 0;
    if (small) return shatter(b, from);
    b.state = 'collapsing'; b.t = 0;
    b.sink = shared?.sink ?? stackTop(b) - b.bottom;
    b.dur = shared?.dur ?? clamp(b.sink / 28, 2.4, 6.5);
    b.dustT = 0; b.debrisT = 0;
    b.tilt = shared?.tilt ?? new THREE.Quaternion().setFromAxisAngle(V(R() - 0.5, 0, R() - 0.5).normalize(), 0.05 + R() * 0.05);
    for (const u of b.upper) collapse(u, from, { sink: b.sink, dur: b.dur, tilt: b.tilt });
    if (!shared) {
      G.fx.dust(V(b.x, 2, b.z), Math.max(b.w, b.d) * 0.7, 30, 0.55);
      G.fx.addShake(1.0, V(b.x, 0, b.z));
      G.audio?.collapse(V(b.x, 0, b.z), b.sink);
    }
  }
  // Small buildings break into tumbling chunks all at once.
  function shatter(b, from) {
    B.bld.hide(b.i); b.solid.dead = true; b.state = 'rubble';
    const nx = clamp(Math.round(b.w / 4), 2, 4), ny = clamp(Math.round(b.h / 3), 1, 3), nz = clamp(Math.round(b.d / 4), 2, 4);
    const sx = b.w / nx, sy = b.h / ny, sz = b.d / nz;
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) {
      const p = V(b.x - b.w / 2 + (i + 0.5) * sx, b.bottom + (j + 0.5) * sy, b.z - b.d / 2 + (k + 0.5) * sz);
      const away = p.clone().sub(from); away.y = Math.abs(away.y) + 2;
      spawnDebris(p, V(sx * 0.95, sy * 0.95, sz * 0.95), b.color, away.normalize().multiplyScalar(6 + R() * 10), 30, IDQ.clone());
    }
    for (const a of b.attach) if (a.batch === B.roof) for (let k = 0; k < 4; k++)
      spawnDebris(a.pos.clone().add(V((R() - 0.5) * b.w * 0.6, 1, (R() - 0.5) * b.d * 0.6)), V(b.w * 0.45, 0.4, b.d * 0.45), a.color, V((R() - 0.5) * 8, 8 + R() * 6, (R() - 0.5) * 8), 30);
    G.fx.dust(V(b.x, 1, b.z), Math.max(b.w, b.d) * 0.6, 14, 0.6);
    G.audio?.collapse(V(b.x, 0, b.z), b.h);
    rubble(b);
  }
  function rubble(b) {
    if (b.bottom > 0) return;
    const col = b.color.clone().multiplyScalar(0.7);
    for (let k = 0; k < 10; k++) {
      const s = V(b.w * (0.12 + R() * 0.12), 1 + R() * 2.5, b.d * (0.12 + R() * 0.12));
      B.rubble.append(V(b.x + (R() - 0.5) * b.w * 0.7, 0, b.z + (R() - 0.5) * b.d * 0.7), new THREE.Quaternion().setFromEuler(new THREE.Euler(R(), R() * 6, R())), s, col);
    }
    B.rubble.append(V(b.x, 0, b.z), IDQ, V(b.w * 0.45, 0.9, b.d * 0.45), col.clone().multiplyScalar(0.8));
    addSolid(b.x, b.z, b.w * 0.85, b.d * 0.85, 0.8, 0);
    addBox(b.x, 0.4, b.z, b.w * 0.42, 0.4, b.d * 0.42);
    map.rubble(b);
    const chance = b.kind === 5 ? 0.5 : b.kind === 3 ? 0.35 : 0.25;
    if (R() < chance) G.powerups.drop(V(b.x, 2, b.z));
  }

  const m4q = new THREE.Quaternion(), P = V(), S = V();
  return {
    buildings, spawns, map, B,
    damage,
    // A shot hit a solid box: damage its building (or prop) with a hole where it hit.
    hitSolid(solid, point, normal, amount, holeR) {
      const o = solid.owner;
      if (o?.building) damage(o.building, amount, point, holeR, normal);
      else if (o?.prop) props.damage(o.prop, amount, normal.clone().negate(), point);
    },
    // An explosion: damages every building in range, holing the wall nearest the blast.
    blast(center, radius, amount, holeR) {
      for (const s of solidsNear(center, radius)) {
        const b = s.owner?.building;
        if (!b) continue;
        const cp = V(clamp(center.x, s.minX, s.maxX), clamp(center.y, s.bottom, s.top), clamp(center.z, s.minZ, s.maxZ));
        const d = cp.distanceTo(center), k = 1 - d / radius;
        const n = center.clone().sub(cp); if (n.lengthSq() < 1e-6) n.set(0, 1, 0); n.normalize();
        damage(b, amount * k, holeR > 0 && k > 0.3 ? cp : null, holeR * k, n);
      }
    },
    update(dt, t) {
      warnMat.color.copy(warnMat.userData.base).multiplyScalar(Math.sin(t * 3) > 0.3 ? 1 : 0.15);
      for (const b of buildings) {
        if (b.state !== 'collapsing') continue;
        b.t += dt;
        const k = Math.min(1, b.t / b.dur), e = k * k * (1.6 - 0.6 * k); // speeds up as it goes
        const off = -b.sink * e, jig = (1 - k) * 0.25;
        m4q.copy(IDQ).slerp(b.tilt, k);
        P.set(b.x + Math.sin(b.t * 37) * jig, b.bottom + off, b.z + Math.cos(b.t * 41) * jig);
        B.bld.set(b.i, P, m4q, S.set(b.w, b.h, b.d));
        b.solid.top = Math.max(0, b.top + off); b.solid.bottom = Math.max(0, b.bottom + off);
        if (!b.lower) { // the base throws debris off its crumbling top edge and dust from its foot
          const topNow = b.bottom + b.sink + off;
          if ((b.debrisT -= dt) <= 0 && topNow > 2) {
            b.debrisT = 0.05;
            const side = SIDES[Math.floor(R() * 4)];
            const p = V(b.x + side.x * b.w / 2 + side.z * (R() - 0.5) * b.w, topNow - R() * 4, b.z + side.z * b.d / 2 + side.x * (R() - 0.5) * b.d);
            spawnDebris(p, V(1 + R() * 3, 1 + R() * 2.5, 1 + R() * 3), b.color, side.clone().multiplyScalar(3 + R() * 6).add(V(0, R() * 3, 0)), 20);
          }
          if ((b.dustT -= dt) <= 0) { b.dustT = 0.18; G.fx.dust(V(b.x, 2, b.z), Math.max(b.w, b.d) * 0.6, 3, 0.55); }
        }
        if (k >= 1) {
          b.state = 'rubble'; b.solid.dead = true;
          B.bld.hide(b.i);
          rubble(b);
        }
      }
    },
  };
}

// ---------- the minimap: painted once, then rubble is drawn over destroyed buildings ----------
export const MAP = { x0: -2800, z0: -2200, size: 6400, px: 2048 };
function drawMap(buildings, parks) {
  const c = document.createElement('canvas'); c.width = c.height = MAP.px;
  const g = c.getContext('2d');
  const k = MAP.px / MAP.size, X = x => (x - MAP.x0) * k, Z = z => (z - MAP.z0) * k;
  const step = 50;
  for (let x = MAP.x0; x < MAP.x0 + MAP.size; x += step) for (let z = MAP.z0; z < MAP.z0 + MAP.size; z += step) {
    const h = terrainHeight(x + step / 2, z + step / 2);
    if (h < LAKE.level) g.fillStyle = '#2b6d9a';
    else { const l = clamp(0.32 - h / 900, 0.12, 0.34); g.fillStyle = `rgb(${Math.round(60 * l / 0.3)},${Math.round(120 * l / 0.3)},${Math.round(55 * l / 0.3)})`; }
    g.fillRect(X(x), Z(z), step * k + 1, step * k + 1);
  }
  g.fillStyle = '#5c5f63'; g.fillRect(X(-1000), Z(-1000), 2000 * k, 2000 * k);
  g.fillStyle = '#2a2c30';
  for (let v = -1000; v <= 1000; v += CELL) { g.fillRect(X(v - 6), Z(-1000), 12 * k, 2000 * k); g.fillRect(X(-1000), Z(v - 6), 2000 * k, 12 * k); }
  g.fillRect(X(-15), Z(-1500), 30 * k, 3000 * k); g.fillRect(X(-1500), Z(-15), 3000 * k, 30 * k);
  g.fillRect(X(-30), Z(RUNWAY.z0), 60 * k, (RUNWAY.z1 - RUNWAY.z0) * k);
  g.fillStyle = '#3f7a3a'; for (const [x, z] of parks) g.fillRect(X(x - 31), Z(z - 31), 62 * k, 62 * k);
  for (const b of buildings) {
    if (b.bottom > 0) continue;
    g.fillStyle = b.kind === 3 ? '#c9b89a' : b.kind === 4 ? '#8d949c' : b.h > 45 ? '#b8c4d2' : '#a9adb3';
    g.fillRect(X(b.x - b.w / 2), Z(b.z - b.d / 2), b.w * k, b.d * k);
  }
  return {
    canvas: c, k, X, Z,
    rubble(b) { g.fillStyle = '#6b5a48'; g.fillRect(X(b.x - b.w / 2), Z(b.z - b.d / 2), b.w * k, b.d * k); },
  };
}
