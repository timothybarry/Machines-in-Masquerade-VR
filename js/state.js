import * as THREE from 'three';
import { V } from './util.js';

export const MODES = ['robot', 'car', 'jet'];
export const GRAV = 25;               // a little heavier than Earth so the robot lands with weight
export const ROBOT_SPEED = 12;        // m/s, a giant's stride
export const TDUR = 0.6, TTOTAL = 1.05; // one part's move, and the whole transformation
export const MAX_HP = 100, MAX_SHIELD = 100, MAX_MISSILES = 20;
export const SPAWN = V(0, 0, 300);

// The game's systems, filled in by main.js so modules can reach each other without import cycles:
// scene, camera, rig, renderer, fx, city, props, traffic, weapons, enemies, powerups, hud, player.
export const G = {};

// Saved under 'mim.'; 'rid.' is the prefix from before the rename, still read so old settings survive.
function pref(name, fallback) {
  try { const v = localStorage.getItem('mim.' + name) ?? localStorage.getItem('rid.' + name); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
}
export function savePref(name, value) {
  try { localStorage.setItem('mim.' + name, JSON.stringify(value)); } catch { /* private window: settings just don't stick */ }
}
export const settings = { view: 'cockpit', music: pref('music', true), help: pref('help', true) };

// A body that can be a robot, car or jet. The player's is `st`; each enemy has its own.
export function newBody(pos, yaw = 0) {
  return {
    mode: 'robot', prevMode: 'robot', T: 9,
    pos: pos.clone(), vel: V(), yaw, quat: new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), yaw), tilt: new THREE.Quaternion(),
    speed: 0, steer: 0, lever: 0, throttle: 0, grounded: true,
    fuel: 2.5, nitro: 1, jets: false, boosting: false, actionHeld: false,
    lookYaw: 0, lookYawS: 0, snapped: false, scale: 1,
  };
}

export const st = Object.assign(newBody(SPAWN), {
  hp: MAX_HP, shield: 0, missiles: 6, dead: false, respawnT: 0, invuln: 0, hurtT: 0,
  power: { rapid: 0, over: 0, triple: 0, turbo: 0 },
  kills: 0, cash: 0, score: 0, gunSide: 1, msg: '', msgT: 0,
});
export const say = (m, t = 2.5) => { st.msg = m; st.msgT = t; };
