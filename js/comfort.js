// Comfort in the headset: a shell round your head that
//  - darkens the edges of your view while the game turns or jolts you (a tunnel vignette, which cuts
//    motion sickness; your own head movement doesn't count),
//  - blacks the view out for a moment (a blink) to hide the camera jumping, e.g. to a new seat,
//  - tints the edges red when you are hurt (on a screen the HUD canvas does that).
import * as THREE from 'three';
import { DEG, clamp } from './util.js';

const VIGNETTE = { off: 0, low: 0.6, high: 1 };
const FADE_OUT = 0.1, FADE_IN = 0.3;

export function createComfort(camera) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uVig: { value: 0 }, uFade: { value: 0 }, uRed: { value: 0 } },
    vertexShader: 'varying vec3 vDir;\nvoid main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
uniform float uVig, uFade, uRed;
varying vec3 vDir;
void main() {
  float ang = acos(clamp(-normalize(vDir).z, -1.0, 1.0)); // radians from straight ahead
  float inner = mix(1.2, 0.5, uVig);                      // the clear middle shrinks from ~70 to ~29 degrees
  float a = max(uVig > 0.001 ? smoothstep(inner, inner + 0.3, ang) : 0.0, uFade);
  float r = uRed * smoothstep(0.35, 1.0, ang) * (1.0 - a);
  gl_FragColor = vec4(vec3(0.75, 0.0, 0.08) * r, a + r); // premultiplied: black over the edges, red under it
}`,
    transparent: true, premultipliedAlpha: true, depthTest: false, depthWrite: false, side: THREE.BackSide, fog: false,
  });
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.25, 32, 16), mat);
  shell.renderOrder = 30; shell.frustumCulled = false; shell.visible = false;
  camera.add(shell);

  const q = new THREE.Quaternion(), qPrev = new THREE.Quaternion(), p = new THREE.Vector3(), pPrev = new THREE.Vector3();
  const v = new THREE.Vector3(), vPrev = new THREE.Vector3();
  let stage = 0, motion = 0, fade = 0, darken = false, holdLeft = 0; // stage: readings so far (0, 1, then 2 = enough for acceleration)

  return {
    // Black out: over 0.1 s (or at once), stay dark for `hold` seconds, then fade back in over 0.3 s.
    blink(instant = false, hold = 0.05) {
      if (instant && darken && fade < 1) holdLeft += (1 - fade) * FADE_OUT; // a blink already on its way stays dark as long as it would have
      darken = true; holdLeft = Math.max(holdLeft, hold);
      if (instant) fade = 1;
    },
    get fade() { return fade; },
    // rig: what the game moves you with; o: { vr, vignette: 'off' | 'low' | 'high', hurt: 0..1 }
    update(dt, rig, o) {
      if (darken) { fade = Math.min(1, fade + dt / FADE_OUT); if (fade >= 1 && (holdLeft -= dt) <= 0) darken = false; }
      else fade = Math.max(0, fade - dt / FADE_IN);

      rig.getWorldQuaternion(q); rig.getWorldPosition(p);
      // a jump (respawn, the eye cut to a new seat) is not motion: start the readings again after it
      const jumped = stage === 2 ? p.distanceTo(v.copy(vPrev).multiplyScalar(dt).add(pPrev)) > 2 : p.distanceTo(pPrev) > 5 + 350 * dt; // 350 m/s: faster than anything flies
      if (stage === 0 || dt <= 0 || jumped) stage = 1;
      else {
        const turn = 2 * Math.acos(Math.min(1, Math.abs(q.dot(qPrev)))) / dt; // radians per second
        v.subVectors(p, pPrev).divideScalar(dt);
        const acc = stage === 2 ? vPrev.distanceTo(v) / dt : 0;
        const want = clamp(Math.max(turn / (90 * DEG), acc / 15), 0, 1); // full at 90 degrees/s or 15 m/s²
        motion += (want - motion) * (1 - Math.exp(-dt / 0.15));
        vPrev.copy(v); stage = 2;
      }
      qPrev.copy(q); pPrev.copy(p);

      const u = mat.uniforms;
      u.uVig.value = o.vr ? motion * (VIGNETTE[o.vignette] ?? 0) : 0;
      u.uFade.value = fade;
      u.uRed.value = o.vr ? clamp(o.hurt, 0, 1) : 0;
      shell.visible = o.vr && (u.uVig.value > 0.002 || fade > 0.002 || u.uRed.value > 0.002);
    },
  };
}
