// Rolling hills around a flat city, with cuts for the two roads, a flat airport and a lake basin.
import * as THREE from 'three';
import { V, smoothstep, fbm2 } from './util.js';
import { NOISE_GLSL, WORLD_POS_VERT } from './shaders.js';

export const LAKE = { x: -1900, z: -700, r: 450, level: 0.3 };
export const RUNWAY = { z0: 1500, z1: 3500, w: 60 };
const SIZE = 12000, SEG = 240;

// 1 inside [a, b], easing to 0 over `soft` metres outside it.
const band = (v, a, b, soft = 200) => smoothstep(a - soft, a, v) * (1 - smoothstep(b, b + soft, v));

export function terrainHeight(x, z) {
  const r = Math.hypot(x, z);
  let k = smoothstep(1150, 1750, r) * (1 - smoothstep(4700, 5700, r));   // flat city, hills, flat far plain
  let h = 0;
  if (k > 0) {
    k *= 1 - (1 - smoothstep(40, 170, Math.abs(x))) * band(z, -1550, 3600); // north-south road and the runway
    k *= 1 - (1 - smoothstep(40, 170, Math.abs(z))) * band(x, -1550, 1550); // east-west road
    k *= 1 - (1 - smoothstep(280, 480, Math.abs(x))) * band(z, 1350, 3650); // airport
    const ridges = Math.max(0, fbm2(x / 260 + 40, z / 260) - 0.55) * 160;
    h = k * (25 + fbm2(x / 650, z / 650) * 260 + ridges);
  }
  const basin = 1 - smoothstep(LAKE.r - 40, LAKE.r + 260, Math.hypot(x - LAKE.x, z - LAKE.z));
  return h * (1 - basin) - 5 * basin;
}

export function terrainNormal(x, z, out = V()) {
  const e = 2;
  return out.set(terrainHeight(x - e, z) - terrainHeight(x + e, z), 2 * e, terrainHeight(x, z - e) - terrainHeight(x, z + e)).normalize();
}

// The hills as a mesh, grass with rock on the steep slopes and sand round the lake.
// Returns the mesh plus its vertices and indices for the physics collider.
export function buildTerrain(scene, grassMap) {
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG).rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, terrainHeight(pos.getX(i), pos.getZ(i)));
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal, mix = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    mix[i * 2] = Math.max(smoothstep(0.93, 0.78, nrm.getY(i)), smoothstep(170, 250, y) * 0.6);
    mix[i * 2 + 1] = (1 - smoothstep(LAKE.r + 40, LAKE.r + 120, Math.hypot(x - LAKE.x, z - LAKE.z))) * (1 - smoothstep(2, 7, y));
  }
  geo.setAttribute('aMix', new THREE.BufferAttribute(mix, 2));
  const map = grassMap.clone(); map.repeat.set(SIZE / 24, SIZE / 24); map.needsUpdate = true;
  const mat = new THREE.MeshLambertMaterial({ map });
  mat.onBeforeCompile = sh => {
    sh.vertexShader = 'attribute vec2 aMix;\nvarying vec2 vMix;\nvarying vec3 vWP;\n'
      + sh.vertexShader.replace('#include <begin_vertex>', WORLD_POS_VERT + '\n  vMix = aMix;');
    sh.fragmentShader = 'varying vec2 vMix;\nvarying vec3 vWP;\n' + NOISE_GLSL + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
  diffuseColor.rgb *= 1.0 + 0.4 * (vnoise(vWP.xz / 400.0) - 0.5) + 0.25 * (vnoise(vWP.xz / 70.0) - 0.5);
  vec3 rock = vec3(0.22, 0.21, 0.19) * (0.7 + 0.6 * vnoise(vWP.xz / 7.0)) * (0.8 + 0.4 * vnoise(vWP.xz / 90.0));
  diffuseColor.rgb = mix(diffuseColor.rgb, rock, vMix.x);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.55, 0.47, 0.3) * (0.85 + 0.3 * vnoise(vWP.xz / 5.0)), vMix.y);`);
  };
  mat.customProgramCacheKey = () => 'terrain';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  scene.add(mesh);
  return { mesh, vertices: new Float32Array(pos.array), indices: new Uint32Array(geo.index.array) };
}
