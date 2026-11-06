// The HUD. On a screen it is one overlay canvas. In VR it is two glass panels and a few small marks:
//  - a near panel 2 m ahead, fixed to the cockpit, for readouts (health, wave, missiles, minimap...);
//  - a far panel 600 m out for the marks that sit on things in the world (enemy brackets, the pitch
//    ladder, the flight-path marker). Being far, it lines up for both eyes, and it stays fixed to the
//    world between its redraws, so the marks don't double or judder;
//  - marks drawn once and moved every frame, also 600 m out: the robot's aiming reticle (it rides your
//    head), the car's and jet's gun cross (it rides the body's nose) and the hit markers on them.
// The VR layout keeps the readouts within about 24 degrees of straight ahead, with bigger outlined text.
import * as THREE from 'three';
import { V, DEG, clamp } from './util.js';
import { MAX_SHIELD } from './state.js';
import { POWER } from './powerups.js';

const COL = { main: '#62f4ff', dim: 'rgba(98,244,255,0.45)', faint: 'rgba(98,244,255,0.18)', red: '#ff4057', amber: '#ffb238', white: '#e8feff', panel: 'rgba(0,18,28,0.55)', green: '#3aff7a', blue: '#4a8bff' };
const FONT = '"Orbitron", "Segoe UI", sans-serif', MONO = '"Share Tech Mono", Consolas, monospace';
const VR_W = 1024, VR_H = 768, VR_DIST = 2, VR_PW = 2.4, VR_PPM = VR_W / VR_PW;
const FAR = 600; // metres to the world-locked panel
const MODE_NAME = { robot: 'ROBOT', car: 'SUPERCAR', jet: 'FIGHTER JET', suit: 'FLIGHT SUIT' };
const hexColor = n => '#' + n.toString(16).padStart(6, '0');

// Where each block goes: on a screen (the original layout) and in VR (pulled in, scaled up).
const DESK = {
  vr: false, glow: 1, heading: [0, -335, 1], mode: [-470, -338, 1], vitals: [-492, -298, 1], score: [492, -352, 1],
  weapon: [400, 150, 1], timers: [480, 262, 1], map: [-410, 265, 88, 1], banner: [0, -255, 1], toast: [0, -168, 1],
  msg: [0, -120, 1], transform: [0, -60, 1], dead: [0, -20, 1], hurtR: 130, jet: [300, -420, 1], car: [0, 235, 1],
  edge: [300, 250, 480, 350],
};
// In VR the side blocks sit high (vitals left, wave and missiles right), the middle column below them
// takes the passing text (banner, toasts, messages), and the car and jet readouts sit under the middle.
const VRL = {
  vr: true, glow: 0, heading: [0, -262, 1.15], mode: [-380, -248, 1], vitals: [-352, -212, 1.2], score: [352, -250, 1.2],
  weapon: null, timers: [340, 170, 1.2], map: [-268, 210, 78, 1.4], banner: [0, -165, 1.1], toast: [0, -95, 1.25], toasts: 1,
  msg: [0, -62, 1.25], deadMsg: [0, 110, 1.25], transform: [0, 12, 1.1], dead: [0, -10, 1.3], hurtR: 170, jet: [0, 80, 1.35], car: [0, 74, 1.4],
  edge: [250, 180, 300, 220],
};
let GLOW = 1, OUTLINE = false;

// A canvas texture uploaded as plain RGBA (an sRGB-tagged canvas upload stalls Chromium's GPU process
// for tens of milliseconds) on a material that shows the canvas pixels as they are.
function panel(canvas, w, h = w * canvas.height / canvas.width) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false });
  mat.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <colorspace_fragment>', ''); };
  mat.customProgramCacheKey = () => 'hud-raw';
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  mesh.renderOrder = 20; mesh.visible = false; mesh.frustumCulled = false;
  return { tex, mesh, g: canvas.getContext('2d') };
}
const makeCanvas = (w = VR_W, h = VR_H) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
// A small VR mark: drawn once (layout units, origin at the middle) and shown at the far panel's distance.
function mark(size, draw) {
  const c = makeCanvas(size, size), g = c.getContext('2d');
  GLOW = 0; OUTLINE = false;
  g.translate(size / 2, size / 2); draw(g);
  const m = panel(c, size / VR_PPM * FAR / VR_DIST).mesh;
  m.material.color.setRGB(1, 1, 1);
  return m;
}

export function createHud({ renderer, rig, camera, scene }) {
  const overlay = document.createElement('canvas');
  overlay.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none';
  document.body.appendChild(overlay);
  const og = overlay.getContext('2d');

  const near = panel(makeCanvas(), VR_PW);
  near.mesh.position.set(0, 0, -VR_DIST);
  rig.add(near.mesh);
  const far = panel(makeCanvas(), VR_PW);
  far.mesh.scale.setScalar(FAR / VR_DIST);
  scene.add(far.mesh);
  const farQ = new THREE.Quaternion(), farZ = V();
  // the marks that move every frame
  const reticle = mark(128, g => { g.scale(1.2, 1.2); robotReticle(g, { time: 0 }, false); });
  const hitHead = mark(64, g => { g.scale(1.2, 1.2); hitMark(g, 0, 0, false); });
  reticle.position.z = hitHead.position.z = -FAR;
  camera.add(reticle, hitHead);
  const jetCross = mark(64, g => { style(g, COL.main, 2.5); jetNose(g, 0, 0); });
  const carCross = mark(64, g => { style(g, COL.main, 2.5); line(g, -16, 0, -6, 0); line(g, 6, 0, 16, 0); line(g, 0, -4, 0, 4); });
  const hitGun = mark(64, g => { g.scale(1.2, 1.2); hitMark(g, 0, 0, false); });
  rig.add(jetCross, carCross, hitGun);
  const rq = new THREE.Quaternion(), fwdLocal = V(), BACK = V(0, 0, 1);
  const KILL = [1, 0.25, 0.34]; // the HUD's red, as raw canvas values

  const tmp = V(), eye = V(), inv = new THREE.Matrix4();
  // Where a world point lands on a VR panel: by angle from the rig's origin (your head, after recentering).
  const projVR = p => {
    rig.worldToLocal(tmp.copy(p));
    if (tmp.z > -1) return null;
    const s = VR_DIST / -tmp.z;
    return { x: VR_W / 2 + tmp.x * s * VR_PPM, y: VR_H / 2 - tmp.y * s * VR_PPM };
  };
  const projDesk = p => {
    tmp.copy(p).project(camera);
    if (tmp.z > 1 || tmp.z < -1) return null;
    return { x: (tmp.x + 1) / 2 * overlay.width, y: (1 - tmp.y) / 2 * overlay.height };
  };
  // a world point in view space (x right, y up, -z ahead), for arrows toward things off screen
  const viewVR = p => rig.worldToLocal(V().copy(p));
  const viewDesk = p => V().copy(p).applyMatrix4(inv.copy(camera.matrixWorld).invert());

  const s8 = { toasts: [], banner: null, hit: 0, kill: false, hurts: [], cash: 0, card: null };
  let vrClock = 0;

  // The reticle sits where your head points (that's where the robot's head-aimed shots and missile
  // lock go); the gun cross along the body's nose; a hit flashes on whichever one is showing.
  function placeMarks(show, d) {
    const robot = d.mode === 'robot' || d.mode === 'suit', cross = d.mode === 'jet' ? jetCross : carCross; // the suit aims like the robot
    reticle.visible = show && robot;
    jetCross.visible = show && d.mode === 'jet'; carCross.visible = show && d.mode === 'car';
    const hit = show && s8.hit > 0;
    hitHead.visible = hit && robot; hitGun.visible = hit && !robot;
    for (const m of [hitHead, hitGun]) m.material.color.setRGB(...(s8.kill ? KILL : [1, 1, 1]));
    if (!show || robot) return;
    fwdLocal.copy(d.bodyFwd).applyQuaternion(rig.getWorldQuaternion(rq).invert()); // the nose, seen from the seat
    for (const m of [cross, hitGun]) { m.position.copy(fwdLocal).multiplyScalar(FAR); m.quaternion.setFromUnitVectors(BACK, fwdLocal.clone().negate()); }
  }

  return {
    toast(text, color = COL.amber) { s8.toasts.unshift({ text, color, t: 2.6 }); s8.toasts.length = Math.min(s8.toasts.length, 4); },
    banner(title, sub = '') { s8.banner = { title, sub, t: 3.5 }; },
    hitMarker(kill) { s8.hit = kill ? 0.35 : 0.15; s8.kill = kill; },
    damageFrom(pos) { s8.hurts.push({ pos: pos.clone(), t: 1.2 }); if (s8.hurts.length > 6) s8.hurts.shift(); },
    // A card of text in the middle of the VR view, for `seconds` (0 hides it).
    card(title, lines, seconds) { s8.card = seconds > 0 ? { title, lines, t: seconds } : null; },
    update(dt, d) {
      s8.hit -= dt;
      for (const t of s8.toasts) t.t -= dt;
      s8.toasts = s8.toasts.filter(t => t.t > 0);
      if (s8.banner && (s8.banner.t -= dt) <= 0) s8.banner = null;
      if (s8.card && (s8.card.t -= dt) <= 0) s8.card = null;
      for (const h of s8.hurts) h.t -= dt;
      s8.hurts = s8.hurts.filter(h => h.t > 0);
      s8.cash += (d.cash - s8.cash) * Math.min(1, dt * 4);
      if (Math.abs(d.cash - s8.cash) < 1) s8.cash = d.cash;

      const xr = renderer.xr.isPresenting;
      near.mesh.visible = far.mesh.visible = xr;
      overlay.style.display = xr ? 'none' : '';
      placeMarks(xr && !d.dead, d);
      if (xr) {
        // the far panel rides with your head's position but keeps the world orientation it was drawn with
        rig.getWorldPosition(eye);
        far.mesh.quaternion.copy(farQ);
        far.mesh.position.copy(eye).add(farZ.set(0, 0, -FAR).applyQuaternion(farQ));
        vrClock -= dt;
        if (vrClock > 0) return;
        vrClock = Math.max(0, vrClock + 1 / 30); // ~30 redraws a second; one slow frame can't make it redraw every frame
        rig.getWorldQuaternion(farQ);
        far.mesh.quaternion.copy(farQ);
        far.mesh.position.copy(eye).add(farZ.set(0, 0, -FAR).applyQuaternion(farQ));
        drawVR(near.g, far.g, projVR, viewVR, eye, d, s8);
        near.tex.needsUpdate = far.tex.needsUpdate = true;
      } else {
        const dpr = Math.min(devicePixelRatio, 2), W = Math.round(innerWidth * dpr), H = Math.round(innerHeight * dpr);
        if (overlay.width !== W || overlay.height !== H) { overlay.width = W; overlay.height = H; }
        camera.updateMatrixWorld();
        camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
        camera.getWorldPosition(eye);
        drawDesk(og, W, H, Math.min(W / 1024, H / 768), projDesk, viewDesk, eye, d, s8);
      }
    },
  };
}

// ---------- drawing primitives (layout units: a 1024 x 768 box with the origin at the centre) ----------
function style(g, color = COL.main, width = 2, glow = 6) { g.strokeStyle = color; g.lineWidth = width; g.shadowColor = color; g.shadowBlur = glow * GLOW; }
function text(g, s, x, y, size, align = 'center', font = FONT, color = COL.main) {
  g.font = `${size}px ${font}`; g.textAlign = align; g.textBaseline = 'middle';
  if (OUTLINE) { // a dark outline keeps text readable over bright sky in the headset
    const ss = g.strokeStyle, lw = g.lineWidth, sb = g.shadowBlur;
    g.shadowBlur = 0; g.lineJoin = 'round'; g.strokeStyle = 'rgba(0,8,14,0.85)'; g.lineWidth = Math.max(3, size * 0.18);
    g.strokeText(s, x, y);
    g.strokeStyle = ss; g.lineWidth = lw; g.shadowBlur = sb;
  }
  g.fillStyle = color; g.fillText(s, x, y);
}
function line(g, x1, y1, x2, y2) { g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); }
function hexagon(g, x, y, r) {
  g.beginPath();
  for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + i * Math.PI / 3; g[i ? 'lineTo' : 'moveTo'](x + r * Math.cos(a), y + r * Math.sin(a)); }
  g.closePath();
}
function brackets(g, x, y, r, len) {
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    g.beginPath(); g.moveTo(x + sx * r, y + sy * (r - len)); g.lineTo(x + sx * r, y + sy * r); g.lineTo(x + sx * (r - len), y + sy * r); g.stroke();
  }
}
function bar(g, x, y, w, h, frac, color, back = 'rgba(255,255,255,0.08)') {
  g.shadowBlur = 0;
  g.fillStyle = back; g.fillRect(x, y, w, h);
  g.fillStyle = color; g.fillRect(x, y, w * clamp(frac, 0, 1), h);
  g.strokeStyle = 'rgba(255,255,255,0.25)'; g.lineWidth = 1; g.strokeRect(x, y, w, h);
}
// draw a block at an anchor [x, y, scale]
function place(g, [x, y, s], fn) { g.save(); g.translate(x, y); g.scale(s, s); fn(); g.restore(); }
const money = n => n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n).toLocaleString()}`;

// ---------- the screen ----------
function drawDesk(g, W, H, k, proj, view, eye, d, s8) {
  GLOW = 1; OUTLINE = false;
  g.clearRect(0, 0, W, H);
  if (d.hpFrac < 0.3 || d.hurt > 0) { // red vignette round the whole screen when hurt or low
    const a = Math.max(d.hurt * 0.6, d.hpFrac < 0.3 ? (0.25 + 0.15 * Math.sin(d.time * 6)) * (1 - d.hpFrac / 0.3) : 0);
    const gr = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.33, W / 2, H / 2, Math.hypot(W, H) * 0.55);
    gr.addColorStop(0, 'rgba(255,0,30,0)'); gr.addColorStop(1, `rgba(255,0,30,${a.toFixed(3)})`);
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
  }
  if (d.dead) { g.fillStyle = 'rgba(40,0,6,0.45)'; g.fillRect(0, 0, W, H); }
  g.save();
  g.translate(W / 2, H / 2); g.scale(k, k);
  const P = w => { const s = proj(w); return s && { x: (s.x - W / 2) / k, y: (s.y - H / 2) / k }; };
  const along = (dir, dist = 1000) => P(V().copy(dir).multiplyScalar(dist).add(eye));
  const L = DESK;
  style(g);
  frame(g);
  if (!d.dead) {
    enemyMarks(g, P, view, d, L.edge);
    if (d.mode === 'jet') { jetWorld(g, along, d, 235); jetGauges(g, d, L.jet); }
    else if (d.mode === 'car') place(g, L.car, () => carDial(g, d));
    else robotReticle(g, d, true);
    hurtArcs(g, view, s8, L.hurtR);
    if (s8.hit > 0) hitMark(g, 0, 0, s8.kill);
  }
  common(g, d, s8, L);
  text(g, d.hint, 0, 362, 13, 'center', FONT, COL.dim);
  g.restore();
}

// ---------- the headset ----------
function drawVR(gn, gf, proj, view, eye, d, s8) {
  GLOW = 0; OUTLINE = true;
  const W = VR_W, H = VR_H, L = VRL;
  const P = w => { const s = proj(w); return s && { x: s.x - W / 2, y: s.y - H / 2 }; };
  const along = (dir, dist = 1000) => P(V().copy(dir).multiplyScalar(dist).add(eye));
  // far panel: marks on things in the world
  gf.clearRect(0, 0, W, H);
  gf.save(); gf.translate(W / 2, H / 2);
  if (!d.dead) {
    enemyMarks(gf, P, view, d, L.edge, 1.35);
    if (d.mode === 'jet') jetWorld(gf, along, d, 200, false); // the nose cross is one of the moving marks
  }
  gf.restore();
  // near panel: readouts
  gn.clearRect(0, 0, W, H);
  gn.save(); gn.translate(W / 2, H / 2);
  if (!d.dead) {
    if (d.mode === 'jet' || d.mode === 'suit') place(gn, L.jet, () => jetCompact(gn, d));
    else if (d.mode === 'car') place(gn, L.car, () => carCompact(gn, d));
    hurtArcs(gn, view, s8, L.hurtR);
  }
  common(gn, d, s8, L);
  if (s8.card) helpCard(gn, s8.card);
  else wrap(d.hint, 60).forEach((l, i, all) => text(gn, l, 0, 350 - (all.length - 1 - i) * 26, 18, 'center', FONT, 'rgba(98,244,255,0.8)'));
  gn.restore();
}
// Splits an 'a · b · c' hint into lines of at most max characters, breaking only between items.
function wrap(s, max) {
  const out = [];
  let cur = '';
  for (const part of s.split(' · ')) {
    const next = cur ? `${cur} · ${part}` : part;
    if (next.length > max && cur) { out.push(cur); cur = part; } else cur = next;
  }
  if (cur) out.push(cur);
  return out;
}

// Everything both layouts share.
function common(g, d, s8, L) {
  place(g, L.heading, () => headingTape(g, d.heading));
  place(g, L.mode, () => modePanel(g, d, !L.vr));
  place(g, L.vitals, () => vitals(g, d, L.vr));
  place(g, L.score, () => scoreboard(g, d, s8, L.vr));
  if (L.weapon) place(g, L.weapon, () => weaponPanel(g, d)); // in VR, missiles are on the scoreboard
  place(g, L.timers, () => powerTimers(g, d, L.vr));
  minimap(g, d, L.map);
  if (s8.banner) place(g, L.banner, () => {
    g.globalAlpha = clamp(Math.min(1, s8.banner.t, 3.5 - s8.banner.t + 0.2), 0, 1);
    style(g, COL.red, 2, 12);
    text(g, s8.banner.title, 0, 0, 46, 'center', FONT, COL.red);
    text(g, s8.banner.sub, 0, 37, 16, 'center', FONT, COL.white);
    g.globalAlpha = 1;
  });
  place(g, L.toast, () => {
    s8.toasts.slice(0, L.toasts ?? 4).forEach((t, i) => {
      g.globalAlpha = clamp(t.t, 0, 1);
      style(g, t.color, 2, 10);
      text(g, t.text, 0, i * 26, i ? 16 : 22, 'center', FONT, t.color);
    });
    g.globalAlpha = 1;
  });
  if (d.transform !== null && !d.dead) place(g, L.transform, () => {
    style(g, COL.red);
    text(g, `TRANSFORMING  >  ${MODE_NAME[d.mode]}`, 0, 0, 16, 'center', FONT, COL.red);
    g.strokeRect(-110, 14, 220, 6);
    g.fillStyle = COL.red; g.fillRect(-110, 14, 220 * d.transform, 6);
  });
  if (d.msg) place(g, d.dead && L.deadMsg ? L.deadMsg : L.msg, () => text(g, d.msg, 0, 0, 24, 'center', FONT, COL.amber));
  if (d.dead) place(g, L.dead, () => {
    style(g, COL.red, 2, 16);
    text(g, 'SYSTEMS OFFLINE', 0, 0, 52, 'center', FONT, COL.red);
    text(g, `REBOOTING IN ${Math.ceil(d.respawnT)}`, 0, 54, 20, 'center', FONT, COL.white);
  });
}

function frame(g) {
  style(g, COL.faint, 2);
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    g.beginPath(); g.moveTo(sx * 505, sy * 330); g.lineTo(sx * 505, sy * 378); g.lineTo(sx * 455, sy * 378); g.stroke();
  }
}

function helpCard(g, card) {
  g.font = `22px ${FONT}`;
  const w = clamp(Math.max(...card.lines.map(l => g.measureText(l).width)) + 60, 560, 960), h = 120 + card.lines.length * 36;
  g.globalAlpha = clamp(card.t, 0, 1);
  g.fillStyle = 'rgba(0,14,22,0.86)'; g.fillRect(-w / 2, -h / 2, w, h);
  style(g, COL.main, 2); g.strokeRect(-w / 2, -h / 2, w, h);
  text(g, card.title, 0, -h / 2 + 40, 30, 'center', FONT, COL.main);
  card.lines.forEach((l, i) => text(g, l, -w / 2 + 30, -h / 2 + 92 + i * 36, 22, 'left', FONT, COL.white));
  g.globalAlpha = 1;
}

// ---------- blocks (each drawn about its own anchor) ----------
function headingTape(g, hdg) {
  const half = 170, ppd = 6;
  style(g);
  g.save(); g.beginPath(); g.rect(-half, -30, half * 2, 50); g.clip();
  for (let a = Math.ceil((hdg - 30) / 5) * 5; a <= hdg + 30; a += 5) {
    const x = (a - hdg) * ppd, n = ((a % 360) + 360) % 360;
    line(g, x, 12, x, n % 15 === 0 ? 0 : 6);
    if (n % 30 === 0) text(g, { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[n] ?? String(n / 10).padStart(2, '0'), x, -10, 16, 'center', MONO);
  }
  g.restore();
  g.fillStyle = COL.main;
  g.beginPath(); g.moveTo(0, 16); g.lineTo(-7, 26); g.lineTo(7, 26); g.closePath(); g.fill();
  g.fillStyle = COL.panel; g.fillRect(-32, 30, 64, 24); g.strokeRect(-32, 30, 64, 24);
  text(g, String(Math.round(hdg) % 360).padStart(3, '0'), 0, 42, 18, 'center', MONO, COL.white);
}

function modePanel(g, d, withName) {
  ['robot', 'car', 'jet', 'suit'].forEach((m, i) => {
    const x = i * 50, on = m === d.mode;
    style(g, on ? COL.red : COL.dim, on ? 3 : 2);
    hexagon(g, x, 0, 20);
    if (on) { g.fillStyle = 'rgba(255,64,87,0.25)'; g.fill(); }
    g.stroke();
    text(g, 'RCJS'[i], x, 1, 16, 'center', FONT, on ? COL.white : COL.dim);
  });
  if (withName) { style(g); text(g, MODE_NAME[d.mode], 190, 0, 16, 'left'); }
}

function vitals(g, d, vr) {
  const w = vr ? 160 : 230;
  const low = d.hpFrac < 0.3 && Math.sin(d.time * 8) > 0;
  text(g, vr ? 'HP' : 'ENERCORE', 0, 0, vr ? 13 : 11, 'left', FONT, low ? COL.red : vr ? COL.main : COL.dim);
  text(g, `${Math.ceil(d.hp)}`, w, 0, vr ? 16 : 13, 'right', MONO, low ? COL.red : COL.white);
  bar(g, 0, 10, w, vr ? 12 : 10, d.hpFrac, d.hpFrac < 0.3 ? COL.red : d.hpFrac < 0.6 ? COL.amber : COL.main);
  let y = 32;
  if (d.shield > 0) {
    text(g, 'SHIELD', 0, y, vr ? 13 : 11, 'left', FONT, vr ? COL.blue : COL.dim);
    text(g, `${Math.ceil(d.shield)}`, w, y, vr ? 16 : 13, 'right', MONO, COL.white);
    bar(g, 0, y + 9, w, 7, d.shield / MAX_SHIELD, COL.blue);
    y += 32;
  }
  if (vr && d.mode === 'robot') { // jump-jet fuel (on a screen it rings the reticle)
    text(g, 'JETS', 0, y, 13, 'left', FONT, d.jets ? COL.amber : COL.main);
    bar(g, 44, y - 5, w - 44, 9, d.fuel, d.jets ? COL.amber : COL.main);
  }
}

function scoreboard(g, d, s8, vr) {
  style(g);
  text(g, `WAVE ${d.wave}`, 0, 0, 20, 'right');
  if (vr) {
    text(g, `HOSTILES ${d.enemiesLeft}`, 0, 26, 16, 'right', FONT, COL.white);
    text(g, money(s8.cash), 0, 50, 16, 'right', MONO, COL.amber);
    text(g, `MISSILES ${d.missiles}`, 0, 74, 16, 'right', MONO, d.missiles > 0 ? COL.white : COL.red);
    return;
  }
  text(g, `HOSTILES ${d.enemiesLeft}   KILLS ${d.kills}`, 0, 24, 13, 'right', FONT, COL.white);
  text(g, `$${Math.round(s8.cash).toLocaleString()}`, 0, 48, 18, 'right', MONO, COL.amber);
  text(g, 'COLLATERAL DAMAGE', 0, 66, 10, 'right', FONT, COL.dim);
  text(g, d.music ? 'MUSIC ON' : 'MUSIC OFF', 0, 84, 10, 'right', FONT, COL.faint);
}

function weaponPanel(g, d) {
  g.shadowBlur = 0;
  g.fillStyle = COL.panel; g.fillRect(0, 0, 105, 62);
  style(g, COL.dim, 1); g.strokeRect(0, 0, 105, 62);
  text(g, 'BLASTER', 8, 13, 12, 'left', FONT, COL.main);
  const tags = [d.power.over > 0 && ['x2', COL.red], d.power.rapid > 0 && ['RAPID', COL.amber], d.power.triple > 0 && ['x3', '#b455ff']].filter(Boolean);
  tags.forEach(([t, c], i) => text(g, t, 8 + i * 34, 30, 11, 'left', FONT, c));
  text(g, `MISSILES ${d.missiles}`, 8, 48, 12, 'left', MONO, d.missiles > 0 ? COL.white : COL.red);
}

function powerTimers(g, d, vr) {
  Object.entries(d.power).filter(([, t]) => t > 0).forEach(([k, t], i) => {
    const P = POWER[k], x = -i * 56, c = hexColor(P.color);
    style(g, COL.faint, 4, 0); g.beginPath(); g.arc(x, 0, 20, 0, Math.PI * 2); g.stroke();
    style(g, c, 4, 8); g.beginPath(); g.arc(x, 0, 20, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * t / 20); g.stroke();
    text(g, Math.ceil(t), x, 0, 14, 'center', MONO, COL.white);
    if (!vr) text(g, P.label.split(' ')[0], x, 32, 9, 'center', FONT, c);
  });
}

// GTA-style radar: the real city map turning with you, with hostiles and power-ups on it.
function minimap(g, d, [cx, cy, R, fs]) {
  const map = d.map;
  if (!map) return;
  const scale = 0.19 * R / 88; // layout px per metre
  const h = d.viewYaw, c = Math.cos(h), s = Math.sin(h);
  const toMap = (x, z) => { const dx = (x - d.pos.x) * scale, dz = (z - d.pos.z) * scale; return [dx * c - dz * s, dx * s + dz * c]; };
  g.shadowBlur = 0;
  g.save();
  g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.closePath();
  g.fillStyle = '#10161c'; g.fill();
  g.clip();
  g.translate(cx, cy); g.rotate(h); g.scale(scale / map.k, scale / map.k);
  g.globalAlpha = 0.9;
  g.drawImage(map.canvas, -map.X(d.pos.x), -map.Z(d.pos.z));
  g.restore();
  g.globalAlpha = 1;
  for (const p of d.pickups) {
    const [x, y] = toMap(p.pos.x, p.pos.z);
    if (Math.hypot(x, y) > R - 4) continue;
    g.fillStyle = p.color; g.beginPath(); g.arc(cx + x, cy + y, 3.5 * fs, 0, Math.PI * 2); g.fill();
  }
  for (const e of d.enemies) {
    let [x, y] = toMap(e.pos.x, e.pos.z);
    const Lr = Math.hypot(x, y), edge = Lr > R - 6;
    if (edge) { x *= (R - 6) / Lr; y *= (R - 6) / Lr; }
    const q = (edge ? 3 : 4) * fs;
    g.fillStyle = COL.red;
    g.beginPath();
    if (e.type === 'jet') { g.moveTo(cx + x, cy + y - 6 * fs); g.lineTo(cx + x - 5 * fs, cy + y + 4 * fs); g.lineTo(cx + x + 5 * fs, cy + y + 4 * fs); }
    else g.rect(cx + x - q, cy + y - q, q * 2, q * 2);
    g.fill();
  }
  style(g, COL.dim, 2);
  g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
  const a = 8 * fs;
  g.fillStyle = COL.white; g.beginPath(); g.moveTo(cx, cy - a); g.lineTo(cx - a * 0.75, cy + a * 0.75); g.lineTo(cx, cy + a * 0.4); g.lineTo(cx + a * 0.75, cy + a * 0.75); g.closePath(); g.fill();
  text(g, 'N', cx + s * (R + 11 * fs), cy - c * (R + 11 * fs), 12 * fs, 'center', FONT, COL.main);
  if (fs === 1) text(g, `${Math.round(d.speed * 3.6)} KM/H   ALT ${Math.round(d.alt)} M`, cx, cy - R - 16, 11, 'center', MONO, COL.dim); // the headset shows these elsewhere
}

// Brackets with health bars on visible enemies; arrows toward those off screen.
function enemyMarks(g, P, view, d, [ex, ey, bx, by], k = 1) {
  for (const e of d.enemies) {
    if (e.dist > 2200) continue;
    const s = P(e.pos);
    if (s && Math.abs(s.x) < bx && Math.abs(s.y) < by) {
      const r = clamp(3000 / e.dist, 10, 40) * k;
      style(g, COL.red, 2 * k);
      brackets(g, s.x, s.y, r, r * 0.5);
      bar(g, s.x - r, s.y - r - 9 * k, r * 2, 4 * k, e.hp, COL.red);
      text(g, `${Math.round(e.dist)}m`, s.x, s.y + r + 11 * k, 11 * k, 'center', MONO, COL.red);
    } else { // off screen: an arrow near the edge pointing the way (things behind you point down)
      const v = view(e.pos);
      let ux = v.x, uy = -v.y;
      if (v.z > 0) uy = Math.abs(uy) + v.z * 0.5;
      const len = Math.hypot(ux, uy) || 1;
      ux /= len; uy /= len;
      g.save(); g.translate(ux * ex, uy * ey); g.rotate(Math.atan2(uy, ux) + Math.PI / 2); g.scale(k, k);
      g.shadowBlur = 0; g.fillStyle = COL.red; g.beginPath(); g.moveTo(0, -12); g.lineTo(-8, 6); g.lineTo(8, 6); g.closePath(); g.fill();
      g.restore();
    }
  }
}

function hurtArcs(g, view, s8, R) {
  for (const h of s8.hurts) {
    const v = view(h.pos);
    const a = Math.atan2(v.x, -v.z) - Math.PI / 2; // 0 = straight ahead is up
    style(g, `rgba(255,40,60,${clamp(h.t, 0, 1).toFixed(2)})`, 7, 12);
    g.beginPath(); g.arc(0, 0, R, a - 0.35, a + 0.35); g.stroke();
  }
}

function hitMark(g, x, y, kill) {
  style(g, kill ? COL.red : COL.white, 3);
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) line(g, x + sx * 8, y + sy * 8, x + sx * 18, y + sy * 18);
}

function tape(g, x, side, value, unitPx, step, major, title) {
  const h = 260;
  style(g);
  g.save(); g.beginPath(); g.rect(side < 0 ? x - 90 : x - 16, -h / 2, 106, h); g.clip();
  for (let v = Math.ceil((value - h / 2 / unitPx) / step) * step; v <= value + h / 2 / unitPx; v += step) {
    if (v < 0) continue;
    const y = (value - v) * unitPx, big = v % major === 0;
    line(g, x, y, x - side * (big ? 14 : 7), y);
    if (big) text(g, String(v), x + side * 10, y, 15, side < 0 ? 'right' : 'left', MONO);
  }
  g.restore();
  line(g, x, -h / 2, x, h / 2);
  const bx = side < 0 ? x - 96 : x + 6;
  g.shadowBlur = 0;
  g.fillStyle = 'rgba(0,18,28,0.85)'; g.fillRect(bx, -16, 90, 32); g.strokeRect(bx, -16, 90, 32);
  text(g, String(Math.round(value)), bx + 45, 0, 22, 'center', MONO, COL.white);
  text(g, title, x + side * 45, -h / 2 - 16, 13);
}

const fwd = V(), right = V(), ladderDir = V();
// The jet's marks on the world: pitch ladder, flight-path marker, nose.
function jetWorld(g, along, d, clipR, withNose = true) {
  const hv = d.viewYaw;
  fwd.set(-Math.sin(hv), 0, -Math.cos(hv)); right.set(-fwd.z, 0, fwd.x);
  g.save(); g.beginPath(); g.arc(0, 0, clipR, 0, Math.PI * 2); g.clip();
  for (let a = -80; a <= 80; a += 10) {
    const c = Math.cos(a * DEG), s = Math.sin(a * DEG);
    const pt = lat => along(ladderDir.set(fwd.x * c + right.x * lat, s, fwd.z * c + right.z * lat));
    const half = a === 0 ? 0.6 : 0.14, gap = a === 0 ? 0.06 : 0.035;
    const A = pt(-half), B = pt(-gap), C = pt(gap), D = pt(half);
    if (!A || !B || !C || !D) continue;
    style(g, a === 0 ? COL.main : COL.dim, a === 0 ? 2.5 : 2);
    g.setLineDash(a < 0 ? [10, 7] : []);
    line(g, A.x, A.y, B.x, B.y); line(g, C.x, C.y, D.x, D.y);
    g.setLineDash([]);
    if (a !== 0) { text(g, String(Math.abs(a)), A.x - 16, A.y, 13, 'center', MONO, COL.dim); text(g, String(Math.abs(a)), D.x + 16, D.y, 13, 'center', MONO, COL.dim); }
  }
  g.restore();
  style(g, COL.main, 2.5);
  if (d.speed > 5) {
    const fp = along(d.velDir);
    if (fp) { g.beginPath(); g.arc(fp.x, fp.y, 9, 0, Math.PI * 2); g.stroke(); line(g, fp.x - 24, fp.y, fp.x - 9, fp.y); line(g, fp.x + 9, fp.y, fp.x + 24, fp.y); line(g, fp.x, fp.y - 9, fp.x, fp.y - 18); }
  }
  const nose = withNose && along(d.bodyFwd);
  if (nose) jetNose(g, nose.x, nose.y);
}
function jetNose(g, x, y) { // the gun cross on the jet's nose: -^-^-
  g.beginPath(); g.moveTo(x - 22, y); g.lineTo(x - 11, y); g.lineTo(x - 5, y + 8); g.lineTo(x, y); g.lineTo(x + 5, y + 8); g.lineTo(x + 11, y); g.lineTo(x + 22, y); g.stroke();
}
// The jet's gauges: speed and altitude tapes, throttle, gear, warnings. [tapeX, throttleX, scale]
function jetGauges(g, d, [tx, thx, s]) {
  g.save(); g.scale(s, s);
  const X = tx / s, TH = thx / s;
  tape(g, -X, -1, d.speed * 3.6, 1.2, 10, 50, 'KM/H');
  tape(g, X, 1, d.alt, 1.6, 10, 50, 'ALT M');
  text(g, `VS ${d.vy >= 0 ? '+' : ''}${Math.round(d.vy)}`, X + 30, 150, 14, 'center', MONO);
  style(g);
  g.strokeRect(TH, -80, 18, 160);
  g.shadowBlur = 0;
  g.fillStyle = d.afterburner ? COL.amber : COL.main; g.fillRect(TH, 80 - 160 * clamp(d.throttle, 0, 1), 18, 160 * clamp(d.throttle, 0, 1));
  text(g, 'THR', TH + 9, 98, 12);
  text(g, `${Math.round(d.throttle * 100)}%`, TH + 9, -96, 13, 'center', MONO);
  if (d.afterburner) text(g, 'AB', TH + 9, -118, 16, 'center', FONT, COL.amber);
  text(g, d.gearDown ? 'GEAR DN' : 'GEAR UP', TH + 60, 140, 12, 'center', FONT, d.gearDown ? COL.amber : COL.dim);
  const flash = Math.sin(d.time * 12) > 0;
  if (d.stall && flash) text(g, 'STALL', 0, 125, 34, 'center', FONT, COL.red);
  if (d.pullUp && flash) text(g, 'PULL UP', 0, 170, 40, 'center', FONT, COL.red);
  g.restore();
}

// The car's dial (screen) about its centre.
function carDial(g, d) {
  const kmh = Math.abs(d.speed) * 3.6, max = 450, R = 110;
  const a0 = Math.PI * 0.8, a1 = Math.PI * 2.2, at = v => a0 + (a1 - a0) * clamp(v / max, 0, 1);
  g.shadowBlur = 0;
  g.fillStyle = COL.panel; g.beginPath(); g.arc(0, 0, R + 14, 0, Math.PI * 2); g.fill();
  style(g, COL.faint, 10); g.beginPath(); g.arc(0, 0, R, a0, a1); g.stroke();
  style(g, kmh > 330 ? COL.amber : COL.main, 10); g.beginPath(); g.arc(0, 0, R, a0, at(kmh)); g.stroke();
  style(g, COL.dim, 2);
  for (let v = 0; v <= max; v += 25) {
    const a = at(v), big = v % 50 === 0, r1 = R - 12, r2 = R - (big ? 24 : 18);
    line(g, Math.cos(a) * r1, Math.sin(a) * r1, Math.cos(a) * r2, Math.sin(a) * r2);
    if (v % 100 === 0) text(g, String(v), Math.cos(a) * (R - 38), Math.sin(a) * (R - 38), 12, 'center', MONO, COL.dim);
  }
  const na = at(kmh);
  style(g, COL.red, 3); line(g, 0, 0, Math.cos(na) * (R - 6), Math.sin(na) * (R - 6));
  text(g, String(Math.round(kmh)), 0, 30, 38, 'center', MONO, COL.white);
  text(g, 'KM/H', 0, 56, 12, 'center', FONT, COL.dim);
  text(g, d.reverse ? 'R' : `G${d.gear}`, 0, -36, 22, 'center', FONT, d.reverse ? COL.amber : COL.main);
  for (let i = 0; i < 12; i++) {
    const lit = i < Math.round(d.rpm * 12);
    g.fillStyle = lit ? (i >= 9 ? COL.red : i >= 6 ? COL.amber : COL.main) : COL.faint;
    g.fillRect(-150 + i * 25.5, -R - 40, 20, 9);
  }
  style(g, COL.amber, 2);
  g.strokeRect(160, -70, 18, 140);
  g.shadowBlur = 0;
  g.fillStyle = COL.amber; g.fillRect(160, 70 - 140 * d.nitro, 18, 140 * d.nitro);
  text(g, 'N2O', 169, 88, 12, 'center', FONT, COL.amber);
  if (d.boosting) text(g, 'NITRO', 169, -88, 16, 'center', FONT, COL.amber);
  style(g, COL.dim, 2); line(g, -14, -235, -5, -235); line(g, 5, -235, 14, -235);
}
// The jet in VR: speed and throttle left of the flight-path marker, altitude and climb right of it,
// warnings below (the tapes would crowd the readouts at the sides).
function jetCompact(g, d) {
  const box = (x, big, unit, small, smallColor) => {
    g.shadowBlur = 0; g.fillStyle = COL.panel; g.fillRect(x - 70, -24, 140, 48);
    text(g, big, x + 10, -6, 26, 'right', MONO, COL.white);
    text(g, unit, x + 16, -9, 11, 'left', FONT, COL.dim);
    text(g, small, x, 14, 13, 'center', MONO, smallColor);
  };
  const suit = d.mode === 'suit'; // the suit shows its palm jets' power and BOOST instead of throttle and AB
  box(-150, String(Math.round(d.speed * 3.6)), 'KM/H', `${suit ? 'JETS' : 'THR'} ${Math.round(d.throttle * 100)}%${d.afterburner ? (suit ? ' BOOST' : ' AB') : ''}`, d.afterburner ? COL.amber : COL.main);
  box(150, String(Math.round(d.alt)), 'M', `VS ${d.vy >= 0 ? '+' : ''}${Math.round(d.vy)}`, COL.main);
  const flash = Math.sin(d.time * 12) > 0;
  if (d.stall && flash) text(g, 'STALL', 0, 70, 30, 'center', FONT, COL.red);
  if (d.pullUp && flash) text(g, 'PULL UP', 0, 105, 34, 'center', FONT, COL.red);
}
// The car in VR: a compact digital readout kept above the hood line.
function carCompact(g, d) {
  const kmh = Math.abs(d.speed) * 3.6;
  g.shadowBlur = 0;
  g.fillStyle = COL.panel; g.fillRect(-95, -26, 190, 52);
  text(g, String(Math.round(kmh)), -10, 0, 30, 'right', MONO, kmh > 330 ? COL.amber : COL.white);
  text(g, 'KM/H', -4, -8, 10, 'left', FONT, COL.dim);
  text(g, d.reverse ? 'R' : `G${d.gear}`, -4, 9, 13, 'left', FONT, d.reverse ? COL.amber : COL.main);
  text(g, 'N2O', 44, -9, 10, 'left', FONT, COL.amber);
  bar(g, 44, 2, 44, 8, d.nitro, d.boosting ? COL.white : COL.amber);
}

function robotReticle(g, d, withFuel) {
  style(g, COL.main, 2);
  g.save(); g.rotate(d.time * 0.6);
  for (let i = 0; i < 4; i++) { g.rotate(Math.PI / 2); g.beginPath(); g.arc(0, 0, 34, -0.4, 0.4); g.stroke(); }
  g.restore();
  line(g, -14, 0, -5, 0); line(g, 5, 0, 14, 0); line(g, 0, -14, 0, -5); line(g, 0, 5, 0, 14);
  if (!withFuel) return;
  style(g, COL.faint, 5); g.beginPath(); g.arc(0, 0, 50, Math.PI * 0.6, Math.PI * 1.4); g.stroke();
  style(g, d.jets ? COL.amber : COL.main, 5); g.beginPath(); g.arc(0, 0, 50, Math.PI * 1.4 - Math.PI * 0.8 * d.fuel, Math.PI * 1.4); g.stroke();
  text(g, 'JETS', -66, 0, 11, 'right', FONT, COL.dim);
}
