// Keyboard, a wired Xbox controller (standard gamepad) and the Touch controllers, merged into one input.
import * as THREE from 'three';
import { V, DEG, clamp } from './util.js';
import { st } from './state.js';

export const hands = {}; // 'left' | 'right' -> { ctrl, grip, src, prev, clickT, held, combo }
const keys = new Set(), keyPresses = [];
const KEY_PRESS = { Digit1: 'robot', Digit2: 'car', Digit3: 'jet', KeyC: 'camera', KeyM: 'music', KeyR: 'recenter', KeyH: 'help', KeyG: 'missile' };
let rig, rigInner, pad = null, padSeen = -1e9, keysSeen = 0;
const padPrev = [];

const handMat = {
  dark: new THREE.MeshStandardMaterial({ color: 0x2a2e35, metalness: 0.7, roughness: 0.4 }),
  red: new THREE.MeshStandardMaterial({ color: 0xc8102e, metalness: 0.4, roughness: 0.35 }),
  glow: new THREE.MeshBasicMaterial({ color: 0x40e0ff }),
};
const box = new THREE.BoxGeometry(1, 1, 1), cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 16);

export function initInput(opts) {
  ({ rig, rigInner } = opts);
  addEventListener('keydown', e => {
    opts.onGesture();
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    if (e.repeat) return;
    keys.add(e.code); keysSeen = performance.now();
    if (KEY_PRESS[e.code]) keyPresses.push(KEY_PRESS[e.code]);
  });
  addEventListener('keyup', e => keys.delete(e.code));
  addEventListener('blur', () => keys.clear()); // no stuck keys after alt-tab
  addEventListener('pointerdown', opts.onGesture);

  for (let i = 0; i < 2; i++) {
    const ctrl = opts.renderer.xr.getController(i), grip = opts.renderer.xr.getControllerGrip(i);
    rigInner.add(ctrl, grip);
    grip.add(makeHand());
    ctrl.addEventListener('connected', e => {
      ctrl.userData.side = e.data.handedness;
      hands[e.data.handedness] = { ctrl, grip, src: e.data, prev: [], clickT: 0, held: false, combo: false };
    });
    ctrl.addEventListener('disconnected', () => { if (hands[ctrl.userData.side]?.ctrl === ctrl) delete hands[ctrl.userData.side]; });
  }
  rig.add(wheelMesh, stickGroup);
}

function makeHand() {
  const g = new THREE.Group();
  const fist = new THREE.Mesh(box, handMat.dark); fist.scale.set(0.09, 0.1, 0.13); g.add(fist);
  const knuckles = new THREE.Mesh(box, handMat.red); knuckles.scale.set(0.095, 0.03, 0.08); knuckles.position.set(0, 0.055, -0.02); g.add(knuckles);
  const barrel = new THREE.Mesh(cyl, handMat.red); barrel.rotation.x = Math.PI / 2;
  barrel.scale.set(0.05, 0.22, 0.05); barrel.position.set(0, 0.04, -0.14); g.add(barrel);
  const tip = new THREE.Mesh(box, handMat.glow); tip.scale.set(0.03, 0.03, 0.02); tip.position.set(0, 0.04, -0.255); g.add(tip);
  return g;
}

// Which controls the on-screen hints should describe.
export function activeDevice(xr) {
  if (xr) return 'vr';
  return padSeen > keysSeen ? 'pad' : 'keys';
}

export function readInput(dt) {
  const inp = { mx: 0, my: 0, rx: 0, trigL: 0, trigR: 0, gripL: 0, gripR: 0, throttle: 0, action: false, fire: false, presses: keyPresses.splice(0) };
  readTouch(inp, dt);
  readPad(inp);
  readKeys(inp);
  inp.throttle = inp.trigR;
  motionControls(inp);
  return inp;
}
const bigger = (a, b) => Math.abs(b) > Math.abs(a) ? b : a;

// Touch (xr-standard): axes 2/3 stick, buttons 0 trigger, 1 grip, 3 stick click, 4 X/A, 5 Y/B.
function readTouch(inp, dt) {
  const dz = x => Math.abs(x) < 0.12 ? 0 : x;
  const clicked = side => !!hands[side]?.src.gamepad?.buttons[3]?.pressed;
  for (const side of ['left', 'right']) {
    const h = hands[side], gp = h?.src.gamepad;
    if (!gp) continue;
    const down = i => !!gp.buttons[i]?.pressed, val = i => gp.buttons[i]?.value ?? 0;
    const edge = (i, name) => { if (down(i) && !h.prev[i]) inp.presses.push(name); h.prev[i] = down(i); };
    if (side === 'left') {
      inp.mx = dz(gp.axes[2] ?? 0); inp.my = dz(gp.axes[3] ?? 0); inp.trigL = val(0); inp.gripL = val(1);
      edge(4, 'car'); edge(5, 'jet');
      // left stick click: tap = camera, hold = recenter; click both sticks together = music on/off
      if (down(3)) {
        if (!h.prev[3]) { h.clickT = 0; h.held = false; h.combo = false; }
        h.clickT += dt;
        if (clicked('right') && !h.combo) { h.combo = true; inp.presses.push('music'); }
        if (h.clickT >= 0.8 && !h.held && !h.combo) { h.held = true; inp.presses.push('recenter'); }
      } else if (h.prev[3] && !h.held && !h.combo) inp.presses.push('camera');
      h.prev[3] = down(3);
    } else {
      inp.rx = dz(gp.axes[2] ?? 0); inp.trigR = val(0); inp.gripR = val(1); inp.action = down(5);
      inp.fire = down(3) && !clicked('left');
      edge(4, 'robot');
      // push the right stick forward to fire a missile
      const up = (gp.axes[3] ?? 0) < -0.8;
      if (up && !h.stickUp) inp.presses.push('missile');
      h.stickUp = up;
    }
  }
}

// Xbox wired (standard mapping): 0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 6 LT, 7 RT, 8 View, 9 Menu, 10 LS, 11 RS.
// LB fires a missile.
// Several pads can be listed (Meta's software adds a virtual one); the one touched most recently wins.
function readPad(inp) {
  pad = null;
  for (const g of navigator.getGamepads?.() ?? []) if (g?.connected && g.mapping === 'standard' && (!pad || g.timestamp > pad.timestamp)) pad = g;
  if (!pad) return;
  const b = i => !!pad.buttons[i]?.pressed, v = i => pad.buttons[i]?.value ?? 0;
  const stick = (x, y) => { const m = Math.hypot(x, y); if (m < 0.18) return [0, 0]; const k = Math.min(1, (m - 0.18) / 0.82) / m; return [x * k, y * k]; };
  const [lx, ly] = stick(pad.axes[0] ?? 0, pad.axes[1] ?? 0), [rx] = stick(pad.axes[2] ?? 0, pad.axes[3] ?? 0);
  if (lx || ly || rx || pad.buttons.some(x => x.pressed)) padSeen = performance.now();
  inp.mx = bigger(inp.mx, lx); inp.my = bigger(inp.my, ly); inp.rx = bigger(inp.rx, rx);
  if (st.mode === 'robot') inp.fire ||= v(7) > 0.5 || b(5);
  else { inp.trigR = Math.max(inp.trigR, v(7)); inp.trigL = Math.max(inp.trigL, v(6)); inp.fire ||= b(5); }
  inp.action ||= b(1);
  for (const [i, name] of [[0, 'robot'], [2, 'car'], [3, 'jet'], [4, 'missile'], [8, 'camera'], [9, 'music'], [10, 'recenter']]) {
    if (b(i) && !padPrev[i]) inp.presses.push(name);
    padPrev[i] = b(i);
  }
}

function readKeys(inp) {
  const k = c => keys.has(c) ? 1 : 0;
  if (st.mode === 'car') { inp.trigR = Math.max(inp.trigR, k('KeyW') || k('ArrowUp')); inp.trigL = Math.max(inp.trigL, k('KeyS') || k('ArrowDown')); }
  else inp.my ||= k('KeyS') - k('KeyW');
  inp.mx ||= k('KeyD') - k('KeyA');
  if (st.mode === 'jet') {
    inp.trigR = Math.max(inp.trigR, k('ShiftLeft') || k('ShiftRight'));
    inp.trigL = Math.max(inp.trigL, k('ControlLeft'));
    inp.rx ||= k('KeyE') - k('KeyQ');
  } else inp.rx ||= k('ArrowRight') - k('ArrowLeft');
  inp.action ||= !!k('Space');
  inp.fire ||= !!k('KeyF');
}

// ---------- rumble: the Xbox pad's motors and the Touch controllers' haptics ----------
export function buzz(side, amount, ms) {
  try { hands[side]?.src.gamepad?.hapticActuators?.[0]?.pulse(amount, ms); } catch { /* no haptics */ }
}
export function rumble(strong, weak, ms) {
  try { pad?.vibrationActuator?.playEffect('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak })?.catch(() => {}); } catch { /* no motors */ }
  buzz('left', Math.max(strong, weak), ms); buzz('right', Math.max(strong, weak), ms);
}

// ---------- hand-motion controls: steering wheel, flight stick, throttle lever ----------
// Squeeze a grip to take hold. Everything is measured in the rig's frame (x right, y up, -z forward).
const wheelMesh = new THREE.Mesh(new THREE.TorusGeometry(1, 0.1, 8, 32), handMat.dark);
{
  const spoke = new THREE.Mesh(box, handMat.dark); spoke.scale.set(2, 0.12, 0.08);
  const mark = new THREE.Mesh(box, handMat.red); mark.position.set(0, 1, 0); mark.scale.setScalar(0.25);
  wheelMesh.add(spoke, mark);
}
const stickGroup = new THREE.Group(), stickShaft = new THREE.Group();
{
  const shaft = new THREE.Mesh(cyl, handMat.dark); shaft.scale.set(0.03, 0.15, 0.03); shaft.position.y = 0.075;
  const base = new THREE.Mesh(box, handMat.dark); base.scale.set(0.1, 0.03, 0.1);
  stickShaft.add(shaft); stickGroup.add(base, stickShaft);
}
wheelMesh.visible = stickGroup.visible = false;

const grab = { key: '', base: 0, angle0: 0, q0: new THREE.Quaternion(), stick: false, lever: false, lever0: 0, z0: 0 };
const pL = V(), pR = V(), qL = new THREE.Quaternion(), qR = new THREE.Quaternion(), qd = new THREE.Quaternion(), ed = new THREE.Euler();
function handPose(h, pos, quat) {
  pos.copy(h.grip.position).applyQuaternion(rigInner.quaternion).add(rigInner.position);
  quat.multiplyQuaternions(rigInner.quaternion, h.grip.quaternion);
}
const twistZ = q => { const a = 2 * Math.atan2(q.z, q.w); return a > Math.PI ? a - 2 * Math.PI : a < -Math.PI ? a + 2 * Math.PI : a; };
const axis = (a, max) => Math.abs(a) < 3 * DEG ? 0 : clamp(a / max, -1, 1);

function motionControls(inp) {
  const L = hands.left, R = hands.right;
  const holdL = !!L && inp.gripL > 0.5, holdR = !!R && inp.gripR > 0.5;
  if (L) handPose(L, pL, qL);
  if (R) handPose(R, pR, qR);
  wheelMesh.visible = stickGroup.visible = false;

  if (st.mode === 'car' && (holdL || holdR)) {
    // Both hands: the tilt of the line between them. One hand: how far it has rolled since grabbing.
    const two = holdL && holdR, q = holdL ? qL : qR, p = holdL ? pL : pR;
    const line = () => Math.atan2(pR.y - pL.y, pR.x - pL.x);
    const key = 'car' + holdL + holdR;
    if (grab.key !== key) { // new grip: the wheel appears in your hands, turned to where the car is steering
      grab.key = key; grab.base = st.steer * 90 * DEG; grab.q0.copy(q); grab.angle0 = two ? line() : 0;
      if (two) { wheelMesh.position.lerpVectors(pL, pR, 0.5); wheelMesh.scale.setScalar(clamp(pL.distanceTo(pR) / 2, 0.1, 0.3)); }
      else { const r = clamp(Math.abs(p.x), 0.12, 0.3); wheelMesh.position.set(p.x - Math.sign(p.x) * r, p.y, p.z); wheelMesh.scale.setScalar(r); }
      buzz(holdL ? 'left' : 'right', 0.3, 30);
    }
    const turned = two ? line() - grab.angle0 : twistZ(qd.copy(q).multiply(grab.q0.clone().invert()));
    const angle = clamp(grab.base + turned, -90 * DEG, 90 * DEG);
    inp.mx = -angle / (90 * DEG);
    wheelMesh.rotation.set(-0.3, 0, angle);
    wheelMesh.visible = true;
  } else grab.key = '';

  if (st.mode === 'jet' && holdR) { // flight stick: tilt your hand to pitch and roll, twist it to yaw
    if (!grab.stick) { grab.stick = true; grab.q0.copy(qR); stickGroup.position.copy(pR).y -= 0.15; buzz('right', 0.3, 30); }
    ed.setFromQuaternion(qd.copy(grab.q0).invert().multiply(qR), 'YXZ');
    inp.my = axis(ed.x, 30 * DEG); inp.mx = axis(-ed.z, 35 * DEG); inp.rx = axis(-ed.y, 30 * DEG);
    inp.fire ||= inp.trigR > 0.5; // the stick's trigger is the gun trigger
    stickShaft.rotation.set(inp.my * 0.4, 0, -inp.mx * 0.4);
    stickGroup.visible = true;
  } else grab.stick = false;

  if (st.mode === 'jet' && holdL) { // throttle lever: push forward for power; it stays where you leave it
    if (!grab.lever) { grab.lever = true; grab.z0 = pL.z; grab.lever0 = st.lever; buzz('left', 0.3, 30); }
    st.lever = clamp(grab.lever0 + (grab.z0 - pL.z) / 0.2, 0, 1);
  } else grab.lever = false;
  if (st.mode === 'jet') inp.throttle = holdR ? st.lever : Math.max(inp.trigR, st.lever);
}
