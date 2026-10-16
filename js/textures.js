// Every texture is painted on a canvas at load time; nothing is downloaded.
import * as THREE from 'three';
import { makeRand } from './util.js';

const rand = makeRand(4242);

export function canvasTex(w, h, draw, rx = 1, ry = 1) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.repeat.set(rx, ry);
  return t;
}
export function specks(g, w, h, n, colors, size = 2) {
  for (let i = 0; i < n; i++) { g.fillStyle = colors[i % colors.length]; g.fillRect(rand() * w, rand() * h, 1 + rand() * size, 1 + rand() * size); }
}

export function grassTexture(repeat) {
  return canvasTex(512, 512, (g, s) => {
    g.fillStyle = '#62823f'; g.fillRect(0, 0, s, s);
    specks(g, s, s, 6000, ['#56753a', '#6e8f48', '#7a9a52', '#5c7b3c'], 3);
  }, repeat, repeat);
}

export function roadTexture(len) {
  return canvasTex(128, 256, (g, w, h) => {
    g.fillStyle = '#35383d'; g.fillRect(0, 0, w, h);
    specks(g, w, h, 500, ['#2f3237', '#40434a']);
    g.fillStyle = '#e8e8e8'; g.fillRect(3, 0, 2, h); g.fillRect(w - 5, 0, 2, h);
    g.fillRect(w / 4 - 1, 0, 2, h / 2); g.fillRect(3 * w / 4 - 1, 0, 2, h / 2);
    g.fillStyle = '#f2c230'; g.fillRect(w / 2 - 4, 0, 2, h); g.fillRect(w / 2 + 2, 0, 2, h);
  }, 1, len / 40);
}

// One tile per city block: street on every edge, sidewalk, then the lot.
export function cityTileTexture(cell, repeat) {
  const S = 512, M = S / cell, ST = 6 * M, SW = 3 * M;
  return canvasTex(S, S, g => {
    g.fillStyle = '#383b40'; g.fillRect(0, 0, S, S);
    specks(g, S, S, 3000, ['#303338', '#43464b']);
    for (let i = 0; i < 14; i++) { g.fillStyle = 'rgba(0,0,0,0.12)'; g.beginPath(); g.ellipse(rand() * S, rand() * ST, 6 + rand() * 20, 3 + rand() * 6, 0, 0, 7); g.fill(); } // oil stains
    g.fillStyle = '#a8a6a0'; g.fillRect(ST, ST, S - 2 * ST, S - 2 * ST);
    g.fillStyle = '#86888b'; g.fillRect(ST + SW, ST + SW, S - 2 * (ST + SW), S - 2 * (ST + SW));
    g.strokeStyle = 'rgba(0,0,0,0.12)'; g.lineWidth = 1;
    for (let x = ST + SW; x < S - ST - SW; x += 8 * M) {
      g.beginPath(); g.moveTo(x, ST + SW); g.lineTo(x, S - ST - SW); g.stroke();
      g.beginPath(); g.moveTo(ST + SW, x); g.lineTo(S - ST - SW, x); g.stroke();
    }
    for (let x = ST; x < S - ST; x += 1.5 * M) {
      g.beginPath(); g.moveTo(x, ST); g.lineTo(x, ST + SW); g.moveTo(x, S - ST - SW); g.lineTo(x, S - ST); g.stroke();
      g.beginPath(); g.moveTo(ST, x); g.lineTo(ST + SW, x); g.moveTo(S - ST - SW, x); g.lineTo(S - ST, x); g.stroke();
    }
    g.strokeStyle = '#d6d4ce'; g.lineWidth = 2; g.strokeRect(ST, ST, S - 2 * ST, S - 2 * ST);
    g.fillStyle = '#e9e9e9';
    for (let x = 0; x < S; x += 6 * M) { g.fillRect(x, 0, 3 * M, 1); g.fillRect(x, S - 1, 3 * M, 1); g.fillRect(0, x, 1, 3 * M); g.fillRect(S - 1, x, 1, 3 * M); }
    g.fillStyle = '#dcdcdc';
    for (const a of [ST + SW, S - ST - SW - 4 * M])
      for (let k = 0.5 * M; k < ST; k += 1.2 * M) {
        g.fillRect(a, k, 4 * M, 0.6 * M); g.fillRect(a, S - k - 0.6 * M, 4 * M, 0.6 * M);
        g.fillRect(k, a, 0.6 * M, 4 * M); g.fillRect(S - k - 0.6 * M, a, 0.6 * M, 4 * M);
      }
    g.fillStyle = '#2b2d31'; // manholes
    for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(ST * 0.5 + (i === 1 ? S - ST : 0), 80 + rand() * 300, 0.6 * M, 0, 7); g.fill(); }
  }, repeat, repeat);
}

export function runwayTexture(len, width) {
  const W = 256, H = 2048, mx = W / width, mz = H / len;
  return canvasTex(W, H, g => {
    g.fillStyle = '#2e3136'; g.fillRect(0, 0, W, H);
    specks(g, W, H, 6000, ['#282b30', '#3a3d42']);
    g.fillStyle = '#ececec';
    g.fillRect(1.5 * mx, 0, mx, H); g.fillRect(W - 2.5 * mx, 0, mx, H);
    for (let z = 120 * mz; z < H - 120 * mz; z += 50 * mz) g.fillRect(W / 2 - 0.5 * mx, z, mx, 30 * mz);
    for (const end of [0, 1]) {
      const z0 = end ? H - 36 * mz : 6 * mz;
      for (let i = 0; i < 8; i++) { g.fillRect(W / 2 + (3 + i * 3) * mx, z0, 1.8 * mx, 30 * mz); g.fillRect(W / 2 - (4.8 + i * 3) * mx, z0, 1.8 * mx, 30 * mz); }
      const aim = end ? H - 330 * mz : 300 * mz;
      g.fillRect(W / 2 + 6 * mx, aim, 9 * mx, 45 * mz); g.fillRect(W / 2 - 15 * mx, aim, 9 * mx, 45 * mz);
      g.save(); g.translate(W / 2, end ? H - 70 * mz : 70 * mz); g.rotate(end ? 0 : Math.PI);
      g.font = `bold ${Math.round(28 * mz)}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.scale(1, 1.6); g.fillText(end ? '36' : '18', 0, 0); g.restore();
    }
  });
}

// Shop signs, 4 x 2 tiles of 256 x 128.
export const SIGNS = ['PIZZA', 'DINER', 'MOTEL', 'CAFE', 'BAR', '24/7', 'AUTO', 'TACOS'];
export function signAtlas() {
  const colors = [['#c0392b', '#ffe08a'], ['#1f3a93', '#ffffff'], ['#6c1b6e', '#ff8ae6'], ['#2d2d2d', '#f5c16c'], ['#0b5345', '#7dffcf'], ['#b9770e', '#ffffff'], ['#212f3d', '#5dade2'], ['#117a65', '#ffe66b']];
  return canvasTex(1024, 256, g => {
    SIGNS.forEach((s, i) => {
      const x = (i % 4) * 256, y = (i < 4 ? 1 : 0) * 128; // tile 0 sits bottom-left once the texture is flipped
      const [bg, fg] = colors[i];
      g.fillStyle = bg; g.fillRect(x, y, 256, 128);
      g.strokeStyle = fg; g.lineWidth = 6; g.strokeRect(x + 8, y + 8, 240, 112);
      g.fillStyle = fg; g.shadowColor = fg; g.shadowBlur = 14;
      g.font = 'bold 64px Impact, "Arial Black", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(s, x + 128, y + 66); g.shadowBlur = 0;
    });
  });
}

// Billboard adverts, 2 x 2 tiles of 512 x 256; all brands made up.
export function billboardAtlas() {
  const ads = [
    ['ENERCORE', 'COLA', '#0a1a3a', '#39e1ff', '#ffffff'],
    ['SUNSET', 'MOTORS', '#ff7a2f', '#2a0a3a', '#fff3c4'],
    ['CYBER', 'BURGER', '#ffd23a', '#c0182b', '#3a1a00'],
    ['TRANSFORM', 'FITNESS', '#111111', '#ff3355', '#ffffff'],
  ];
  return canvasTex(1024, 512, g => {
    ads.forEach(([a, b, bg, c1, c2], i) => {
      const x = (i % 2) * 512, y = (i < 2 ? 1 : 0) * 256;
      const grad = g.createLinearGradient(x, y, x + 512, y + 256); grad.addColorStop(0, bg); grad.addColorStop(1, '#000000');
      g.fillStyle = grad; g.fillRect(x, y, 512, 256);
      g.fillStyle = c1; g.beginPath(); g.arc(x + 420, y + 128, 90, 0, 7); g.fill();
      g.font = 'bold 76px Impact, "Arial Black", sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle';
      g.fillStyle = c2; g.fillText(a, x + 26, y + 90);
      g.fillStyle = c1; g.fillText(b, x + 26, y + 170);
      g.strokeStyle = '#ffffff'; g.lineWidth = 8; g.strokeRect(x + 4, y + 4, 504, 248);
    });
  });
}

export function stripeTexture() {
  return canvasTex(64, 64, g => {
    for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#ffffff' : '#d8d8d8'; g.fillRect(i * 8, 0, 8, 64); }
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, 56, 64, 8);
  }, 3, 1);
}
export function containerTexture() {
  return canvasTex(256, 64, g => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 256, 64);
    for (let x = 0; x < 256; x += 6) { g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(x, 0, 2, 64); }
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(0, 0, 256, 3); g.fillRect(0, 61, 256, 3);
    specks(g, 256, 64, 200, ['rgba(90,50,20,0.35)']);
  });
}
export function crateTexture() {
  return canvasTex(128, 128, g => {
    g.fillStyle = '#9a6b3a'; g.fillRect(0, 0, 128, 128);
    for (let y = 0; y < 128; y += 21) { g.fillStyle = y % 42 ? '#8a5d30' : '#a87a45'; g.fillRect(0, y, 128, 19); }
    g.strokeStyle = '#5a3a1a'; g.lineWidth = 8; g.strokeRect(4, 4, 120, 120);
    g.beginPath(); g.moveTo(8, 8); g.lineTo(120, 120); g.stroke();
    specks(g, 128, 128, 300, ['#6e4a24', '#b88a55']);
  });
}
export function helipadTexture() {
  return canvasTex(256, 256, g => {
    g.fillStyle = '#3a3d42'; g.fillRect(0, 0, 256, 256);
    g.strokeStyle = '#f2c230'; g.lineWidth = 10; g.beginPath(); g.arc(128, 128, 110, 0, 7); g.stroke();
    g.fillStyle = '#ffffff'; g.font = 'bold 150px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('H', 128, 134);
  });
}
export function scorchTexture() {
  const t = canvasTex(128, 128, g => {
    const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    grad.addColorStop(0, 'rgba(10,8,6,0.95)'); grad.addColorStop(0.5, 'rgba(20,16,12,0.7)'); grad.addColorStop(1, 'rgba(20,16,12,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 40; i++) { const a = rand() * 7, r = 20 + rand() * 40; g.fillStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); g.arc(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, 2 + rand() * 6, 0, 7); g.fill(); }
  });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}
// A beam of light that fades out as it rises, for power-ups.
export function beamTexture() {
  const t = canvasTex(8, 256, g => {
    const grad = g.createLinearGradient(0, 256, 0, 0);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)'); grad.addColorStop(0.3, 'rgba(255,255,255,0.35)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 8, 256);
  });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// Particle sprites, 2 x 2 tiles of 128: 0 soft glow, 1 smoke puff, 2 shock ring, 3 spark star.
// Tile n sits at uv offset ((n % 2) / 2, floor(n / 2) / 2), which on the canvas is bottom row first.
export function particleAtlas() {
  const t = canvasTex(256, 256, g => {
    const tile = n => [(n % 2) * 128, (1 - Math.floor(n / 2)) * 128];
    { // glow
      const [x, y] = tile(0), gr = g.createRadialGradient(x + 64, y + 64, 0, x + 64, y + 64, 63);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(x, y, 128, 128);
    }
    { // smoke: a cluster of soft blobs
      const [x, y] = tile(1);
      for (let i = 0; i < 22; i++) {
        const a = rand() * 7, r = rand() * 30, cx = x + 64 + Math.cos(a) * r, cy = y + 64 + Math.sin(a) * r, rr = 18 + rand() * 22;
        const gr = g.createRadialGradient(cx, cy, 0, cx, cy, rr);
        gr.addColorStop(0, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr; g.fillRect(x, y, 128, 128);
      }
    }
    { // ring
      const [x, y] = tile(2), gr = g.createRadialGradient(x + 64, y + 64, 40, x + 64, y + 64, 63);
      gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(x, y, 128, 128);
    }
    { // spark star
      const [x, y] = tile(3), gr = g.createRadialGradient(x + 64, y + 64, 0, x + 64, y + 64, 30);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(x, y, 128, 128);
      g.fillStyle = 'rgba(255,255,255,0.8)';
      g.fillRect(x + 4, y + 62, 120, 4); g.fillRect(x + 62, y + 4, 4, 120);
    }
  });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 1;
  return t;
}
