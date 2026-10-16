// The world: sky, sun and its shadows, the terrain, streets, the airport, the lake, mountains and
// clouds; then the city and its props on top.
import * as THREE from 'three';
import { V, makeRand } from './util.js';
import { macroTint } from './shaders.js';
import { canvasTex, grassTexture, roadTexture, cityTileTexture, runwayTexture } from './textures.js';
import { buildTerrain, terrainHeight, LAKE, RUNWAY } from './terrain.js';
import { addSolid, CELL } from './collision.js';
import { addTrimesh, addBox, addCylinder } from './physics.js';
import { createProps } from './props.js';
import { createCity } from './city.js';

export const SUN_DIR = V(-0.45, 0.62, 0.35).normalize();
const CITY = 12, WORLD = 40000, ROAD_LEN = 3000;
const HORIZON = new THREE.Color().setRGB(0.47, 0.64, 0.86); // linear; the sky's horizon and the fog share it
const rand = makeRand(1337);
const srgb = (r, g, b) => new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);

function instanced(scene, geo, mat, list, place) {
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length)), o = new THREE.Object3D();
  list.forEach((item, i) => {
    o.position.set(0, 0, 0); o.rotation.set(0, 0, 0); o.scale.set(1, 1, 1);
    const color = place(o, item, i);
    o.updateMatrix(); mesh.setMatrixAt(i, o.matrix);
    if (color) mesh.setColorAt(i, color);
  });
  mesh.count = list.length;
  scene.add(mesh);
  return mesh;
}

export function buildWorld(scene, renderer) {
  scene.fog = new THREE.Fog(HORIZON.clone(), 700, 5500);
  const sky = makeSky();
  scene.add(sky);
  scene.environment = envFromSky(renderer, sky.material);
  scene.environmentIntensity = 0.8;
  scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x55603f, 0.75));

  // The sun casts shadows in a 340 m square that follows you around.
  const sun = new THREE.DirectionalLight(0xfff0dc, 2.7);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -170, right: 170, top: 170, bottom: -170, near: 10, far: 1600 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.6;
  scene.add(sun, sun.target);

  const grass = grassTexture(WORLD / 24);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(WORLD, WORLD).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ map: grass }));
  ground.position.y = -0.4; // under the terrain; only seen far out past it
  scene.add(ground);
  const terrain = buildTerrain(scene, grass);
  addTrimesh(terrain.vertices, terrain.indices);

  cityGround(scene);
  roads(scene);
  airport(scene);
  lake(scene);
  mountains(scene);
  clouds(scene);

  const props = createProps(scene);
  const city = createCity(scene, props);
  props.build();

  const snap = 340 / 2048;
  return {
    props, city,
    update(eye, focus, t, dt) {
      sky.position.copy(eye); // the sky never gets closer
      // keep the shadow square on the action, snapped to its texels so edges don't crawl
      const fx = Math.round(focus.x / snap) * snap, fz = Math.round(focus.z / snap) * snap;
      sun.target.position.set(fx, 0, fz);
      sun.position.set(fx, 0, fz).addScaledVector(SUN_DIR, 800);
      city.update(dt, t);
    },
  };
}

function makeSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { sunDir: { value: SUN_DIR }, horizon: { value: HORIZON }, zenith: { value: new THREE.Color().setRGB(0.03, 0.14, 0.52) } },
    vertexShader: `varying vec3 vDir;
      void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 sunDir, horizon, zenith; varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        vec3 col = d.y > 0.0 ? mix(horizon, zenith, pow(d.y, 0.5)) : horizon * mix(1.0, 0.75, clamp(-d.y * 4.0, 0.0, 1.0));
        float s = max(dot(d, sunDir), 0.0);
        col += vec3(1.0, 0.9, 0.7) * (pow(s, 900.0) * 30.0 + pow(s, 16.0) * 0.35);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(6000, 32, 16), mat);
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  return sky;
}
function envFromSky(renderer, skyMat) {
  const pm = new THREE.PMREMGenerator(renderer);
  const s = new THREE.Scene();
  s.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), skyMat));
  const floor = new THREE.Mesh(new THREE.CircleGeometry(49, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: srgb(0.3, 0.33, 0.28) }));
  floor.position.y = -3; s.add(floor);
  const tex = pm.fromScene(s, 0.02).texture;
  pm.dispose();
  return tex;
}

function cityGround(scene) {
  const n = CITY * 2 + 1;
  const mat = new THREE.MeshLambertMaterial({ map: cityTileTexture(CELL, n), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  macroTint(mat, 250, 0.2);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(n * CELL, n * CELL).rotateX(-Math.PI / 2), mat);
  m.position.y = 0.02; m.receiveShadow = true;
  scene.add(m);
}

function roads(scene) {
  const geo = new THREE.PlaneGeometry(30, ROAD_LEN).rotateX(-Math.PI / 2);
  const mat = new THREE.MeshLambertMaterial({ map: roadTexture(ROAD_LEN), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const a = new THREE.Mesh(geo, mat); a.position.y = 0.05; a.receiveShadow = true; scene.add(a);
  const b = new THREE.Mesh(geo, mat); b.position.y = 0.06; b.rotation.y = Math.PI / 2; b.receiveShadow = true; scene.add(b);
}

function airport(scene) {
  const len = RUNWAY.z1 - RUNWAY.z0;
  const mat = new THREE.MeshLambertMaterial({ map: runwayTexture(len, RUNWAY.w), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const rw = new THREE.Mesh(new THREE.PlaneGeometry(RUNWAY.w, len).rotateX(-Math.PI / 2), mat);
  rw.position.set(0, 0.05, (RUNWAY.z0 + RUNWAY.z1) / 2); rw.receiveShadow = true;
  scene.add(rw);
  const lampGeo = new THREE.BoxGeometry(0.5, 0.4, 0.5);
  const lights = [];
  for (let z = RUNWAY.z0; z <= RUNWAY.z1; z += 60) for (const s of [-1, 1]) lights.push([s * (RUNWAY.w / 2 + 1.5), z]);
  instanced(scene, lampGeo, new THREE.MeshBasicMaterial({ color: 0xfff3c8 }), lights, (o, [x, z]) => { o.position.set(x, 0.2, z); });
  for (const [z, c] of [[RUNWAY.z0 - 2, 0x33ff66], [RUNWAY.z1 + 2, 0xff3333]])
    instanced(scene, lampGeo, new THREE.MeshBasicMaterial({ color: c }), Array.from({ length: 14 }, (_, i) => i), (o, i) => { o.position.set((i - 6.5) * 4, 0.2, z); });

  const apron = new THREE.Mesh(new THREE.PlaneGeometry(180, 520).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: srgb(0.52, 0.53, 0.54), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  apron.position.set(125, 0.03, 1980); apron.receiveShadow = true; scene.add(apron);
  const hangarGeo = new THREE.CylinderGeometry(20, 20, 50, 20, 1, false, 0, Math.PI).rotateZ(Math.PI / 2);
  const hangarMat = new THREE.MeshStandardMaterial({ color: srgb(0.55, 0.6, 0.58), metalness: 0.6, roughness: 0.45, side: THREE.DoubleSide });
  const doorMat = new THREE.MeshStandardMaterial({ color: srgb(0.2, 0.22, 0.24), metalness: 0.4, roughness: 0.6 });
  for (const z of [1780, 1880, 1980]) {
    const h = new THREE.Mesh(hangarGeo, hangarMat); h.position.set(160, 0, z); h.castShadow = h.receiveShadow = true; scene.add(h);
    const door = new THREE.Mesh(new THREE.PlaneGeometry(30, 16).rotateY(-Math.PI / 2), doorMat); door.position.set(134.9, 8, z); scene.add(door);
    addSolid(160, z, 50, 40, 18);
    addBox(160, 9, z, 25, 9, 20);
  }
  const concrete = new THREE.MeshStandardMaterial({ color: srgb(0.75, 0.74, 0.7), roughness: 0.8 });
  const glass = new THREE.MeshStandardMaterial({ color: srgb(0.15, 0.25, 0.32), metalness: 0.8, roughness: 0.05 });
  const tower = new THREE.Group();
  const parts = [[new THREE.CylinderGeometry(3.5, 4.5, 32, 16), concrete, 16], [new THREE.CylinderGeometry(7.5, 6, 5, 16), glass, 34.5],
    [new THREE.CylinderGeometry(8.2, 8.2, 0.8, 16), concrete, 37.4], [new THREE.CylinderGeometry(0.2, 0.2, 8, 6), concrete, 41.8]];
  for (const [g, m, y] of parts) { const mesh = new THREE.Mesh(g, m); mesh.position.y = y; mesh.castShadow = true; tower.add(mesh); }
  tower.position.set(115, 0, 2240); scene.add(tower);
  addSolid(115, 2240, 12, 12, 38);
  addCylinder(115, 19, 2240, 19, 7);
}

function lake(scene) {
  const water = new THREE.Mesh(new THREE.CircleGeometry(LAKE.r + 160, 72).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: srgb(0.05, 0.22, 0.3), roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.92 }));
  water.position.set(LAKE.x, LAKE.level, LAKE.z);
  water.receiveShadow = true;
  scene.add(water);
}

// Craggy mountains on the horizon: jittered cones, green at the foot, grey rock, then snow.
function mountainGeo() {
  const g = new THREE.ConeGeometry(1, 1, 18, 8).translate(0, 0.5, 0);
  const pos = g.attributes.position, colors = [];
  const grassC = srgb(0.3, 0.38, 0.26), rock = srgb(0.42, 0.42, 0.44), snow = srgb(0.95, 0.96, 1);
  const hash = (x, y, z) => { const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453; return s - Math.floor(s); };
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (y > 0.001 && y < 0.999) { // the same jitter for the duplicated seam vertices, so no cracks
      const n = hash(+x.toFixed(3), +y.toFixed(3), +z.toFixed(3)), k = 1 + (n - 0.5) * 0.45;
      x *= k; z *= k; y += (hash(+z.toFixed(3), +x.toFixed(3), 1) - 0.5) * 0.06;
      pos.setXYZ(i, x, y, z);
    }
    const snowLine = 0.62 + (hash(+x.toFixed(2), 3, +z.toFixed(2)) - 0.5) * 0.12;
    c.copy(y > snowLine ? snow : y > 0.3 ? rock : grassC);
    colors.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}
function mountains(scene) {
  const list = Array.from({ length: 56 }, () => {
    const a = rand() * Math.PI * 2, r = 3900 + rand() * 900, h = 500 + rand() * 700;
    return [Math.cos(a) * r, Math.sin(a) * r, h];
  });
  instanced(scene, mountainGeo(), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), list, (o, [x, z, h]) => {
    o.position.set(x, terrainHeight(x, z) - 10, z); o.scale.set(h * (1.3 + rand() * 0.6), h, h * (1.3 + rand() * 0.6)); o.rotation.y = rand() * 6;
  });
}

function clouds(scene) {
  const puffs = [];
  for (let c = 0; c < 70; c++) {
    const x = (rand() - 0.5) * 7000, z = (rand() - 0.5) * 7000, y = 480 + rand() * 320;
    for (let p = 0; p < 5; p++) puffs.push([x + (rand() - 0.5) * 90, y + rand() * 12, z + (rand() - 0.5) * 50, 22 + rand() * 26]);
  }
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: srgb(0.45, 0.48, 0.55), flatShading: true });
  instanced(scene, new THREE.IcosahedronGeometry(1, 1), mat, puffs, (o, [x, y, z, s]) => { o.position.set(x, y, z); o.scale.set(s * 1.5, s * 0.6, s); });
}
