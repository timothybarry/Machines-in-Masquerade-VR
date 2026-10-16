// The HUD: one drawing routine, shown as a screen overlay on the desktop and as a glass panel in VR.
// Things in the world (the horizon, enemies, where damage came from) are projected from the world,
// so they line up with what you see.
import * as THREE from 'three';
import { V, DEG, clamp } from './util.js';
import { MAX_HP, MAX_SHIELD, TTOTAL } from './state.js';
import { POWER } from './powerups.js';

const COL = { main: '#62f4ff', dim: 'rgba(98,244,255,0.45)', faint: 'rgba(98,244,255,0.18)', red: '#ff4057', amber: '#ffb238', white: '#e8feff', panel: 'rgba(0,18,28,0.55)', green: '#3aff7a', blue: '#4a8bff' };
const FONT = '"Orbitron", "Segoe UI", sans-serif', MONO = '"Share Tech Mono", Consolas, monospace';
const VR_W = 1024, VR_H = 768, VR_DIST = 2, VR_PW = 2.4, VR_PPM = VR_W / VR_PW;
const MODE_NAME = { robot: 'ROBOT', car: 'SUPERCAR', jet: 'FIGHTER JET' };
const hexColor = n => '#' + n.toString(16).padStart(6, '0');

export function createHud({ renderer, rig, camera }) {
  const overlay = document.createElement('canvas');
  overlay.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none';
  document.body.appendChild(overlay);
  const og = overlay.getContext('2d');

  const vr = document.createElement('canvas'); vr.width = VR_W; vr.height = VR_H;
  const vg = vr.getContext('2d');
  const tex = new THREE.CanvasTexture(vr);
  tex.colorSpace = THREE.SRGBColorSpace; tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter;
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(VR_PW, VR_PW * VR_H / VR_W),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false }));
  plane.position.set(0, 0, -VR_DIST); plane.renderOrder = 20; plane.visible = false;
  rig.add(plane);

  const tmp = V(), eye = V(), inv = new THREE.Matrix4();
  // Where a world point lands on the VR panel (after recentering, your head sits at the rig's origin).
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

  const st8 = { toasts: [], banner: null, hit: 0, kill: false, hurts: [], cash: 0 };
  let vrClock = 0;

  return {
    toast(text, color = COL.amber) { st8.toasts.unshift({ text, color, t: 2.6 }); st8.toasts.length = Math.min(st8.toasts.length, 4); },
    banner(title, sub = '') { st8.banner = { title, sub, t: 3.5 }; },
    hitMarker(kill) { st8.hit = kill ? 0.35 : 0.15; st8.kill = kill; },
    damageFrom(pos) { st8.hurts.push({ pos: pos.clone(), t: 1.2 }); if (st8.hurts.length > 6) st8.hurts.shift(); },
    update(dt, d) {
      st8.hit -= dt;
      for (const t of st8.toasts) t.t -= dt;
      st8.toasts = st8.toasts.filter(t => t.t > 0);
      if (st8.banner && (st8.banner.t -= dt) <= 0) st8.banner = null;
      for (const h of st8.hurts) h.t -= dt;
      st8.hurts = st8.hurts.filter(h => h.t > 0);
      st8.cash += (d.cash - st8.cash) * Math.min(1, dt * 4);
      if (Math.abs(d.cash - st8.cash) < 1) st8.cash = d.cash;

      const xr = renderer.xr.isPresenting;
      plane.visible = xr;
      overlay.style.display = xr ? 'none' : '';
      if (xr) {
        if ((vrClock -= dt) > 0) return;
        vrClock = 1 / 30;
        rig.getWorldPosition(eye);
        draw(vg, VR_W, VR_H, 1, projVR, viewVR, eye, d, st8);
        tex.needsUpdate = true;
      } else {
        const dpr = Math.min(devicePixelRatio, 2), W = Math.round(innerWidth * dpr), H = Math.round(innerHeight * dpr);
        if (overlay.width !== W || overlay.height !== H) { overlay.width = W; overlay.height = H; }
        camera.updateMatrixWorld();
        camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
        camera.getWorldPosition(eye);
        draw(og, W, H, Math.min(W / 1024, H / 768), projDesk, viewDesk, eye, d, st8);
      }
    },
  };
}

// ---------- drawing, in a 1024 x 768 layout with the origin at the centre ----------
function style(g, color = COL.main, width = 2, glow = 6) { g.strokeStyle = color; g.lineWidth = width; g.shadowColor = color; g.shadowBlur = glow; }
function text(g, s, x, y, size, align = 'center', font = FONT, color = COL.main) {
  g.fillStyle = color; g.font = `${size}px ${font}`; g.textAlign = align; g.textBaseline = 'middle'; g.fillText(s, x, y);
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
  g.fillStyle = back; g.fillRect(x, y, w, h);
  g.fillStyle = color; g.fillRect(x, y, w * clamp(frac, 0, 1), h);
  g.strokeStyle = 'rgba(255,255,255,0.25)'; g.lineWidth = 1; g.shadowBlur = 0; g.strokeRect(x, y, w, h);
}

const fwd = V(), right = V();
function draw(g, W, H, k, proj, view, eye, d, s8) {
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
  style(g);
  frame(g);
  if (!d.dead) {
    enemyMarks(g, P, view, d);
    if (d.mode === 'jet') jetHud(g, along, d);
    else if (d.mode === 'car') carHud(g, d);
    else robotHud(g, d);
    hurtArcs(g, view, s8);
    if (s8.hit > 0) { // hit marker
      style(g, s8.kill ? COL.red : COL.white, 3);
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) line(g, sx * 8, sy * 8, sx * 18, sy * 18);
    }
  }
  headingTape(g, d.heading);
  modePanel(g, d);
  vitals(g, d);
  scoreboard(g, d, s8);
  weaponPanel(g, d);
  powerTimers(g, d);
  minimap(g, d);

  if (s8.banner) {
    const a = Math.min(1, s8.banner.t, 3.5 - s8.banner.t + 0.2);
    g.globalAlpha = clamp(a, 0, 1);
    style(g, COL.red, 2, 12);
    text(g, s8.banner.title, 0, -255, 46, 'center', FONT, COL.red);
    text(g, s8.banner.sub, 0, -218, 16, 'center', FONT, COL.white);
    g.globalAlpha = 1;
  }
  s8.toasts.forEach((t, i) => {
    g.globalAlpha = clamp(t.t, 0, 1);
    style(g, t.color, 2, 10);
    text(g, t.text, 0, -168 + i * 26, i ? 16 : 22, 'center', FONT, t.color);
  });
  g.globalAlpha = 1;
  if (d.transform !== null && !d.dead) {
    style(g, COL.red);
    text(g, `TRANSFORMING  >  ${MODE_NAME[d.mode]}`, 0, -60, 16, 'center', FONT, COL.red);
    g.strokeRect(-110, -46, 220, 6);
    g.fillStyle = COL.red; g.fillRect(-110, -46, 220 * d.transform, 6);
  }
  if (d.msg) text(g, d.msg, 0, -120, 24, 'center', FONT, COL.amber);
  if (d.dead) {
    style(g, COL.red, 2, 16);
    text(g, 'SYSTEMS OFFLINE', 0, -20, 52, 'center', FONT, COL.red);
    text(g, `REBOOTING IN ${Math.ceil(d.respawnT)}`, 0, 34, 20, 'center', FONT, COL.white);
  }
  text(g, d.hint, 0, 362, 13, 'center', FONT, COL.dim);
  g.restore();
}

function frame(g) {
  style(g, COL.faint, 2);
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    g.beginPath(); g.moveTo(sx * 505, sy * 330); g.lineTo(sx * 505, sy * 378); g.lineTo(sx * 455, sy * 378); g.stroke();
  }
}

function headingTape(g, hdg) {
  const y = -335, half = 170, ppd = 6;
  style(g);
  g.save(); g.beginPath(); g.rect(-half, y - 30, half * 2, 50); g.clip();
  for (let a = Math.ceil((hdg - 30) / 5) * 5; a <= hdg + 30; a += 5) {
    const x = (a - hdg) * ppd, n = ((a % 360) + 360) % 360;
    line(g, x, y + 12, x, y + (n % 15 === 0 ? 0 : 6));
    if (n % 30 === 0) text(g, { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[n] ?? String(n / 10).padStart(2, '0'), x, y - 10, 16, 'center', MONO);
  }
  g.restore();
  g.fillStyle = COL.main;
  g.beginPath(); g.moveTo(0, y + 16); g.lineTo(-7, y + 26); g.lineTo(7, y + 26); g.closePath(); g.fill();
  g.fillStyle = COL.panel; g.fillRect(-32, y + 30, 64, 24); g.strokeRect(-32, y + 30, 64, 24);
  text(g, String(Math.round(hdg) % 360).padStart(3, '0'), 0, y + 42, 18, 'center', MONO, COL.white);
}

function modePanel(g, d) {
  const x0 = -470, y = -338;
  ['robot', 'car', 'jet'].forEach((m, i) => {
    const x = x0 + i * 50, on = m === d.mode;
    style(g, on ? COL.red : COL.dim, on ? 3 : 2);
    hexagon(g, x, y, 20);
    if (on) { g.fillStyle = 'rgba(255,64,87,0.25)'; g.fill(); }
    g.stroke();
    text(g, 'RCJ'[i], x, y + 1, 16, 'center', FONT, on ? COL.white : COL.dim);
  });
  style(g);
  text(g, MODE_NAME[d.mode], x0 + 140, y, 16, 'left');
}

function vitals(g, d) {
  const x = -492, y = -298, w = 230;
  const low = d.hpFrac < 0.3 && Math.sin(d.time * 8) > 0;
  text(g, 'ENERCORE', x, y, 11, 'left', FONT, low ? COL.red : COL.dim);
  text(g, `${Math.ceil(d.hp)}`, x + w, y, 13, 'right', MONO, low ? COL.red : COL.white);
  bar(g, x, y + 9, w, 10, d.hpFrac, d.hpFrac < 0.3 ? COL.red : d.hpFrac < 0.6 ? COL.amber : COL.main);
  if (d.shield > 0) {
    text(g, 'SHIELD', x, y + 32, 11, 'left', FONT, COL.dim);
    text(g, `${Math.ceil(d.shield)}`, x + w, y + 32, 13, 'right', MONO, COL.white);
    bar(g, x, y + 41, w, 7, d.shield / MAX_SHIELD, COL.blue);
  }
}

function scoreboard(g, d, s8) {
  style(g);
  text(g, `WAVE ${d.wave}`, 492, -352, 20, 'right');
  text(g, `HOSTILES ${d.enemiesLeft}   KILLS ${d.kills}`, 492, -328, 13, 'right', FONT, COL.white);
  text(g, `$${Math.round(s8.cash).toLocaleString()}`, 492, -304, 18, 'right', MONO, COL.amber);
  text(g, 'COLLATERAL DAMAGE', 492, -286, 10, 'right', FONT, COL.dim);
  text(g, d.music ? 'MUSIC ON' : 'MUSIC OFF', 492, -268, 10, 'right', FONT, COL.faint);
}

function weaponPanel(g, d) {
  const x = 400, y = 150;
  g.fillStyle = COL.panel; g.fillRect(x, y, 105, 62);
  style(g, COL.dim, 1); g.strokeRect(x, y, 105, 62);
  text(g, 'BLASTER', x + 8, y + 13, 12, 'left', FONT, COL.main);
  const tags = [d.power.over > 0 && ['x2', COL.red], d.power.rapid > 0 && ['RAPID', COL.amber], d.power.triple > 0 && ['x3', '#b455ff']].filter(Boolean);
  tags.forEach(([t, c], i) => text(g, t, x + 8 + i * 34, y + 30, 11, 'left', FONT, c));
  text(g, `MISSILES ${d.missiles}`, x + 8, y + 48, 12, 'left', MONO, d.missiles > 0 ? COL.white : COL.red);
}

function powerTimers(g, d) {
  const active = Object.entries(d.power).filter(([, t]) => t > 0);
  const key = { rapid: 'rapid', over: 'over', triple: 'triple', turbo: 'turbo' };
  active.forEach(([k, t], i) => {
    const P = POWER[key[k]], x = 480 - i * 56, y = 262, c = hexColor(P.color);
    style(g, COL.faint, 4, 0); g.beginPath(); g.arc(x, y, 20, 0, Math.PI * 2); g.stroke();
    style(g, c, 4, 8); g.beginPath(); g.arc(x, y, 20, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * t / 20); g.stroke();
    text(g, Math.ceil(t), x, y, 14, 'center', MONO, COL.white);
    text(g, P.label.split(' ')[0], x, y + 32, 9, 'center', FONT, c);
  });
}

// GTA-style radar: the real city map turning with you, with hostiles and power-ups on it.
function minimap(g, d) {
  const map = d.map;
  if (!map) return;
  const cx = -410, cy = 265, R = 88, scale = 0.19; // layout px per metre
  const h = d.viewYaw, c = Math.cos(h), s = Math.sin(h);
  const toMap = (x, z) => { const dx = (x - d.pos.x) * scale, dz = (z - d.pos.z) * scale; return [dx * c - dz * s, dx * s + dz * c]; };
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
    g.fillStyle = p.color; g.beginPath(); g.arc(cx + x, cy + y, 3.5, 0, Math.PI * 2); g.fill();
  }
  for (const e of d.enemies) {
    let [x, y] = toMap(e.pos.x, e.pos.z);
    const L = Math.hypot(x, y), edge = L > R - 6;
    if (edge) { x *= (R - 6) / L; y *= (R - 6) / L; }
    g.fillStyle = COL.red;
    g.beginPath();
    if (e.type === 'jet') { g.moveTo(cx + x, cy + y - 6); g.lineTo(cx + x - 5, cy + y + 4); g.lineTo(cx + x + 5, cy + y + 4); }
    else g.rect(cx + x - (edge ? 3 : 4), cy + y - (edge ? 3 : 4), edge ? 6 : 8, edge ? 6 : 8);
    g.fill();
  }
  style(g, COL.dim, 2);
  g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
  g.fillStyle = COL.white; g.beginPath(); g.moveTo(cx, cy - 8); g.lineTo(cx - 6, cy + 6); g.lineTo(cx, cy + 3); g.lineTo(cx + 6, cy + 6); g.closePath(); g.fill();
  const nx = s, ny = -c; // north on the rim
  text(g, 'N', cx + nx * (R + 11), cy + ny * (R + 11), 12, 'center', FONT, COL.main);
  text(g, `${Math.round(d.speed * 3.6)} KM/H   ALT ${Math.round(d.alt)} M`, cx, cy - R - 16, 11, 'center', MONO, COL.dim);
}

function enemyMarks(g, P, view, d) {
  for (const e of d.enemies) {
    if (e.dist > 2200) continue;
    const s = P(e.pos);
    if (s && Math.abs(s.x) < 480 && Math.abs(s.y) < 350) {
      const r = clamp(3000 / e.dist, 10, 40);
      style(g, COL.red, 2);
      brackets(g, s.x, s.y, r, r * 0.5);
      bar(g, s.x - r, s.y - r - 9, r * 2, 4, e.hp, COL.red);
      text(g, `${Math.round(e.dist)}m`, s.x, s.y + r + 11, 11, 'center', MONO, COL.red);
    } else { // off screen: an arrow near the edge pointing the way (things behind you point down)
      const v = view(e.pos);
      let ux = v.x, uy = -v.y;
      if (v.z > 0) uy = Math.abs(uy) + v.z * 0.5;
      const len = Math.hypot(ux, uy) || 1;
      ux /= len; uy /= len;
      g.save(); g.translate(ux * 300, uy * 250); g.rotate(Math.atan2(uy, ux) + Math.PI / 2);
      g.fillStyle = COL.red; g.beginPath(); g.moveTo(0, -12); g.lineTo(-8, 6); g.lineTo(8, 6); g.closePath(); g.fill();
      g.restore();
    }
  }
}

function hurtArcs(g, view, s8) {
  for (const h of s8.hurts) {
    const v = view(h.pos);
    const a = Math.atan2(v.x, -v.z) - Math.PI / 2; // 0 = straight ahead is up
    style(g, `rgba(255,40,60,${clamp(h.t, 0, 1).toFixed(2)})`, 7, 12);
    g.beginPath(); g.arc(0, 0, 130, a - 0.35, a + 0.35); g.stroke();
  }
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
  g.fillStyle = 'rgba(0,18,28,0.85)'; g.fillRect(bx, -16, 90, 32); g.strokeRect(bx, -16, 90, 32);
  text(g, String(Math.round(value)), bx + 45, 0, 22, 'center', MONO, COL.white);
  text(g, title, x + side * 45, -h / 2 - 16, 13);
}

function jetHud(g, along, d) {
  const hv = d.viewYaw;
  fwd.set(-Math.sin(hv), 0, -Math.cos(hv)); right.set(-fwd.z, 0, fwd.x);
  const dir = V();
  g.save(); g.beginPath(); g.arc(0, 0, 235, 0, Math.PI * 2); g.clip();
  for (let a = -80; a <= 80; a += 10) {
    const c = Math.cos(a * DEG), s = Math.sin(a * DEG);
    const pt = lat => along(dir.set(fwd.x * c + right.x * lat, s, fwd.z * c + right.z * lat));
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
  const nose = along(d.bodyFwd);
  if (nose) { g.beginPath(); g.moveTo(nose.x - 22, nose.y); g.lineTo(nose.x - 11, nose.y); g.lineTo(nose.x - 5, nose.y + 8); g.lineTo(nose.x, nose.y); g.lineTo(nose.x + 5, nose.y + 8); g.lineTo(nose.x + 11, nose.y); g.lineTo(nose.x + 22, nose.y); g.stroke(); }
  tape(g, -300, -1, d.speed * 3.6, 1.2, 10, 50, 'KM/H');
  tape(g, 300, 1, d.alt, 1.6, 10, 50, 'ALT M');
  text(g, `VS ${d.vy >= 0 ? '+' : ''}${Math.round(d.vy)}`, 330, 150, 14, 'center', MONO);
  style(g);
  g.strokeRect(-420, -80, 18, 160);
  g.fillStyle = d.afterburner ? COL.amber : COL.main; g.fillRect(-420, 80 - 160 * clamp(d.throttle, 0, 1), 18, 160 * clamp(d.throttle, 0, 1));
  text(g, 'THR', -411, 98, 12);
  text(g, `${Math.round(d.throttle * 100)}%`, -411, -96, 13, 'center', MONO);
  if (d.afterburner) text(g, 'AB', -411, -118, 16, 'center', FONT, COL.amber);
  text(g, d.gearDown ? 'GEAR DN' : 'GEAR UP', -360, 140, 12, 'center', FONT, d.gearDown ? COL.amber : COL.dim);
  const flash = Math.sin(d.time * 12) > 0;
  if (d.stall && flash) text(g, 'STALL', 0, 125, 34, 'center', FONT, COL.red);
  if (d.pullUp && flash) text(g, 'PULL UP', 0, 170, 40, 'center', FONT, COL.red);
}

function carHud(g, d) {
  const kmh = Math.abs(d.speed) * 3.6, max = 450, R = 110, y0 = 235;
  const a0 = Math.PI * 0.8, a1 = Math.PI * 2.2, at = v => a0 + (a1 - a0) * clamp(v / max, 0, 1);
  g.fillStyle = COL.panel; g.beginPath(); g.arc(0, y0, R + 14, 0, Math.PI * 2); g.fill();
  style(g, COL.faint, 10); g.beginPath(); g.arc(0, y0, R, a0, a1); g.stroke();
  style(g, kmh > 330 ? COL.amber : COL.main, 10); g.beginPath(); g.arc(0, y0, R, a0, at(kmh)); g.stroke();
  style(g, COL.dim, 2);
  for (let v = 0; v <= max; v += 25) {
    const a = at(v), big = v % 50 === 0, r1 = R - 12, r2 = R - (big ? 24 : 18);
    line(g, Math.cos(a) * r1, y0 + Math.sin(a) * r1, Math.cos(a) * r2, y0 + Math.sin(a) * r2);
    if (v % 100 === 0) text(g, String(v), Math.cos(a) * (R - 38), y0 + Math.sin(a) * (R - 38), 12, 'center', MONO, COL.dim);
  }
  const na = at(kmh);
  style(g, COL.red, 3); line(g, 0, y0, Math.cos(na) * (R - 6), y0 + Math.sin(na) * (R - 6));
  text(g, String(Math.round(kmh)), 0, y0 + 30, 38, 'center', MONO, COL.white);
  text(g, 'KM/H', 0, y0 + 56, 12, 'center', FONT, COL.dim);
  text(g, d.reverse ? 'R' : `G${d.gear}`, 0, y0 - 36, 22, 'center', FONT, d.reverse ? COL.amber : COL.main);
  for (let i = 0; i < 12; i++) {
    const lit = i < Math.round(d.rpm * 12);
    g.fillStyle = lit ? (i >= 9 ? COL.red : i >= 6 ? COL.amber : COL.main) : COL.faint;
    g.fillRect(-150 + i * 25.5, y0 - R - 40, 20, 9);
  }
  style(g, COL.amber, 2);
  g.strokeRect(160, y0 - 70, 18, 140);
  g.fillStyle = COL.amber; g.fillRect(160, y0 + 70 - 140 * d.nitro, 18, 140 * d.nitro);
  text(g, 'N2O', 169, y0 + 88, 12, 'center', FONT, COL.amber);
  if (d.boosting) text(g, 'NITRO', 169, y0 - 88, 16, 'center', FONT, COL.amber);
  style(g, COL.dim, 2); line(g, -14, 0, -5, 0); line(g, 5, 0, 14, 0);
}

function robotHud(g, d) {
  style(g, COL.main, 2);
  g.save(); g.rotate(d.time * 0.6);
  for (let i = 0; i < 4; i++) { g.rotate(Math.PI / 2); g.beginPath(); g.arc(0, 0, 34, -0.4, 0.4); g.stroke(); }
  g.restore();
  line(g, -14, 0, -5, 0); line(g, 5, 0, 14, 0); line(g, 0, -14, 0, -5); line(g, 0, 5, 0, 14);
  style(g, COL.faint, 5); g.beginPath(); g.arc(0, 0, 50, Math.PI * 0.6, Math.PI * 1.4); g.stroke();
  style(g, d.jets ? COL.amber : COL.main, 5); g.beginPath(); g.arc(0, 0, 50, Math.PI * 1.4 - Math.PI * 0.8 * d.fuel, Math.PI * 1.4); g.stroke();
  text(g, 'JETS', -66, 0, 11, 'right', FONT, COL.dim);
}
