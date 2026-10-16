// All sound is synthesised in the browser: engines, weapons, explosions, collapses and a synthwave loop.
// Sounds out in the world fade with distance from you.
import { G, settings, savePref } from './state.js';

const BPM = 104, STEP = 60 / BPM / 4;          // one sixteenth note
const ROOTS = [45, 41, 36, 43];                // bass notes (midi): A, F, C, G
const CHORDS = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
const MUSIC_VOL = 0.26;
const mtof = m => 440 * 2 ** ((m - 69) / 12);

let actx = null, sfxBus, musicBus, echo, eOsc, eGain, nFilter, nGain, noiseBuf, comp;
let step = 0, nextT = 0;

export function audioInit() {
  if (actx) { if (!document.hidden) actx.resume(); return; }
  actx = new AudioContext();
  comp = actx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 6; // big explosions don't clip
  const out = actx.createGain(); out.gain.value = 0.75;
  comp.connect(out).connect(actx.destination);
  sfxBus = actx.createGain(); sfxBus.connect(comp);
  musicBus = actx.createGain(); musicBus.gain.value = settings.music ? MUSIC_VOL : 0; musicBus.connect(comp);
  echo = actx.createDelay(1); echo.delayTime.value = STEP * 3;
  const feedback = actx.createGain(); feedback.gain.value = 0.35;
  const dull = actx.createBiquadFilter(); dull.type = 'lowpass'; dull.frequency.value = 2200;
  echo.connect(feedback).connect(echo);
  echo.connect(dull).connect(musicBus);

  noiseBuf = actx.createBuffer(1, actx.sampleRate * 2, actx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

  eOsc = actx.createOscillator(); eOsc.type = 'sawtooth';
  const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
  eGain = actx.createGain(); eGain.gain.value = 0;
  eOsc.connect(lp).connect(eGain).connect(sfxBus); eOsc.start();
  const n = actx.createBufferSource(); n.buffer = noiseBuf; n.loop = true;
  nFilter = actx.createBiquadFilter(); nFilter.type = 'lowpass';
  nGain = actx.createGain(); nGain.gain.value = 0;
  n.connect(nFilter).connect(nGain).connect(sfxBus); n.start();

  // A hidden tab stops animating, so the engine would hold its last note forever: go quiet instead.
  document.addEventListener('visibilitychange', () => document.hidden ? actx.suspend() : actx.resume());
  setInterval(schedule, 25);
}

export function toggleMusic() {
  settings.music = !settings.music;
  savePref('music', settings.music);
  if (actx) musicBus.gain.setTargetAtTime(settings.music ? MUSIC_VOL : 0, actx.currentTime, 0.2);
  return settings.music;
}

// ---------- music: schedules a little ahead of the clock so timing never drifts ----------
function schedule() {
  if (actx.state !== 'running' || !settings.music) { nextT = 0; return; }
  if (nextT < actx.currentTime) nextT = actx.currentTime + 0.05;
  while (nextT < actx.currentTime + 0.15) { playStep(step++, nextT); nextT += STEP; }
}
function playStep(s, t) {
  const i = s % 16, bar = Math.floor(s / 16) % 4;
  const part = Math.floor(s / 64) % 4; // 4-bar phrases: pads, + bass and hats, then the full kit twice
  const chord = CHORDS[bar];
  if (i === 0) chord.forEach(n => pad(n, t, STEP * 16));
  arp(chord[[0, 1, 2, 1][i % 4]] + (i >= 8 ? 24 : 12), t);
  if (part === 0) return;
  if (i % 2 === 0) { bass(ROOTS[bar] + (i % 4 === 2 ? 12 : 0), t); hat(t, i % 4 === 2 ? 0.06 : 0.03); }
  if (part === 1) return;
  if (i % 4 === 0) kick(t);
  if (i === 4 || i === 12) snare(t);
}
function tone(type, freq, t, dur, vol, cutoff, attack = 0.005, dest = musicBus, endFreq = freq) {
  const o = actx.createOscillator(), f = actx.createBiquadFilter(), g = actx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t); if (endFreq !== freq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
  f.frequency.value = cutoff;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(vol, 0.0002), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(f).connect(g).connect(dest); o.start(t); o.stop(t + dur + 0.02);
  return g;
}
function noise(t, dur, type, freq, vol, dest, endFreq = freq) {
  const s = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain();
  s.buffer = noiseBuf; f.type = type; f.frequency.setValueAtTime(freq, t); if (endFreq !== freq) f.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
  g.gain.setValueAtTime(Math.max(vol, 0.0002), t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(dest); s.start(t, Math.random() * 1.5); s.stop(t + dur);
}
const pad = (n, t, dur) => { for (const d of [-0.004, 0.004]) tone('sawtooth', mtof(n) * (1 + d), t, dur, 0.03, 1200, 0.8); };
const arp = (n, t) => tone('square', mtof(n), t, STEP * 0.9, 0.035, 2600).connect(echo);
const bass = (n, t) => tone('sawtooth', mtof(n), t, STEP * 1.8, 0.16, 480);
const hat = (t, v) => noise(t, 0.04, 'highpass', 7000, v, musicBus);
const snare = t => { noise(t, 0.18, 'bandpass', 1800, 0.3, musicBus); tone('triangle', 190, t, 0.1, 0.15, 3000); };
function kick(t) {
  const o = actx.createOscillator(), g = actx.createGain();
  o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
  g.gain.setValueAtTime(0.8, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
  o.connect(g).connect(musicBus); o.start(t); o.stop(t + 0.32);
}

// ---------- engine and effects ----------
export function engineSound(mode, speed, throttle, moving) {
  if (!actx) return;
  const t = actx.currentTime, v = Math.abs(speed);
  let f = 30, g = 0, nf = 200, ng = 0;
  if (mode === 'car') { f = 55 + (v % 22) / 22 * 110 + v * 0.6; g = 0.05 + throttle * 0.06; nf = 300; ng = 0.02; } // gears
  else if (mode === 'jet') { f = 38 + v * 0.1; g = 0.03; nf = 300 + throttle * 1800; ng = 0.05 + throttle * 0.08; }
  else if (moving) g = 0.02;
  eOsc.frequency.setTargetAtTime(f, t, 0.05); eGain.gain.setTargetAtTime(g, t, 0.1);
  nFilter.frequency.setTargetAtTime(nf, t, 0.1); nGain.gain.setTargetAtTime(ng, t, 0.1);
}
// how loud something at pos is from where you are
function near(pos, range = 70) {
  if (!actx) return 0;
  if (!pos || !G.listener) return 1;
  return 1 / (1 + G.listener.distanceTo(pos) / range);
}
const now = () => actx.currentTime;
function blip(freq, dur, type = 'square', vol = 0.08, when = 0, endFreq = freq) {
  if (!actx || vol < 0.003) return;
  tone(type, freq, now() + when, dur, vol, 8000, 0.003, sfxBus, endFreq);
}
const crack = (dur, cutoff, vol, when = 0, endCut = cutoff) => actx && vol > 0.003 && noise(now() + when, dur, 'lowpass', cutoff, vol, sfxBus, endCut);

export const sfx = {
  transform() { // the ch-ch-chk of gears
    for (let i = 0; i < 9; i++) { blip(300 + Math.random() * 700, 0.05, 'square', 0.05, i * 0.1); crack(0.04, 4000, 0.2, i * 0.1 + 0.03); }
    blip(110, 0.35, 'sine', 0.35, 0.95, 45);
  },
  thud: () => blip(90, 0.25, 'sine', 0.4, 0, 40),
  jump: () => blip(180, 0.15, 'triangle', 0.15, 0, 90),
  click: () => blip(900, 0.04, 'square', 0.04),
};
export const audio = {
  shot(type, pos) {
    const v = near(pos, 60);
    if (type === 'bolt') blip(1500, 0.11, 'square', 0.045 * v, 0, 240);
    else if (type === 'missile' || type === 'eMissile') { crack(0.7, 3000, 0.25 * v, 0, 400); blip(300, 0.5, 'sawtooth', 0.05 * v, 0, 900); }
    else if (type === 'plasma') { blip(700, 0.22, 'sawtooth', 0.07 * v, 0, 160); blip(1400, 0.15, 'sine', 0.04 * v, 0.02, 300); }
    else if (type === 'jetBolt') blip(900, 0.08, 'square', 0.05 * v, 0, 200);
    else if (type === 'orb') { blip(120, 0.8, 'sawtooth', 0.14 * v, 0, 60); blip(1800, 0.5, 'sine', 0.06 * v, 0, 200); crack(0.6, 1200, 0.2 * v); }
  },
  explosion(pos, r) {
    const v = near(pos, 90 + r * 6), big = Math.min(1, r / 20);
    crack(0.6 + big * 1.6, 1400 + big * 1200, 0.5 * v, 0, 120);
    blip(70 - big * 25, 0.4 + big * 0.8, 'sine', 0.6 * v, 0, 25);
    if (big > 0.4) crack(2.5, 400, 0.35 * v, 0.1, 60); // rolling rumble for the big ones
  },
  collapse(pos, size) {
    const v = near(pos, 200);
    crack(4 + size / 40, 500, 0.5 * v, 0, 80);
    for (let i = 0; i < 8; i++) crack(0.15, 2500, 0.2 * v, 0.3 + i * 0.35 + Math.random() * 0.2);
    blip(45, 3, 'sine', 0.4 * v, 0, 25);
  },
  crunch(pos) { const v = near(pos?.x !== undefined ? pos : null, 40); crack(0.25, 2200, 0.35 * v); blip(120, 0.2, 'square', 0.08 * v, 0, 60); },
  honk(pos) { const v = near(pos, 40); blip(420, 0.35, 'square', 0.05 * v); blip(530, 0.35, 'square', 0.04 * v); },
  powerup() { [0, 4, 7, 12].forEach((s, i) => blip(mtof(72 + s), 0.18, 'triangle', 0.12, i * 0.06)); },
  hurt() { blip(90, 0.25, 'sawtooth', 0.2, 0, 50); crack(0.2, 900, 0.3); },
  shieldHit() { blip(2200, 0.18, 'sine', 0.1, 0, 800); },
  alarm() { for (let i = 0; i < 3; i++) { blip(660, 0.25, 'square', 0.07, i * 0.5, 880); blip(880, 0.2, 'square', 0.05, i * 0.5 + 0.25, 660); } },
  transformFar(pos) { const v = near(pos, 50); for (let i = 0; i < 5; i++) crack(0.04, 4000, 0.15 * v, i * 0.12); },
  missileLock() { blip(1200, 0.06, 'square', 0.06); },
};
