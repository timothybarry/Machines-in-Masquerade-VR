// Machines in Masquerade: sets the world up, then runs the loop that drives the player and everything else.
import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { V, DEG, UP, clamp, ease, yq, headingOf, angleDiff } from './util.js';
import { st, G, settings, savePref, say, TTOTAL, MAX_HP, SPAWN } from './state.js';
import { initPhysics, initDebris, kinematic, stepPhysics } from './physics.js';
import { groundAt } from './collision.js';
import { buildWorld } from './world.js';
import { createTransformers } from './transformer.js';
import { bodyQuat, transformTo, stepRobot, stepCar, stepJet, stepSuit, SUIT, hitSphere, kinShape } from './vehicle.js';
import { createFx, TILE } from './fx.js';
import { createWeapons } from './weapons.js';
import { createTraffic } from './traffic.js';
import { createEnemies } from './enemies.js';
import { createPowerups, POWER } from './powerups.js';
import { initInput, readInput, activeDevice, hands, rumble, buzz, releaseGrabs, GUN_TIP } from './input.js';
import { createHud } from './hud.js';
import { createComfort } from './comfort.js';
import { audioInit, engineSound, sfx, audio, toggleMusic, setPaused } from './audio.js';

// Where your eyes sit (cockpit) or the camera floats (chase), in the body's frame; forward is -z.
const EYE = { robot: V(0, 5.45, -0.1), car: V(0, 0.92, 0.6), jet: V(0, 1.95, -2.1) };
EYE.suit = EYE.robot.clone().multiplyScalar(SUIT.scale); // the suit is the robot at human size
const CHASE = { robot: V(0, 8, 13), car: V(0, 3.2, 8.5), jet: V(0, 6, 22), suit: V(0, 2.6, 5.5) };
const humanoid = m => m === 'robot' || m === 'suit';
const MUZZLE = { car: V(0.7, 0.5, -2.5), jet: V(0.55, 0.75, -4.0) };
const HINTS = {
  vr: {
    robot: 'L-stick walk · R-stick turn · triggers fire · B jump/jets · R-stick up missile · X car · Y jet · hold L-stick: recenter',
    car: 'grips hold the wheel · R-trigger gas · L-trigger brake · B nitro · R-stick click fire · R-stick up missile · A robot · Y jet · hold L-stick: recenter',
    jet: 'R-grip flight stick (trigger fires) · L-grip throttle · B afterburner · R-stick up missile · A robot · X car · hold L-stick: recenter',
    suit: 'triggers: palm jets (palms back: forward, palms down: up) · double-tap a trigger: boost · B boost · grips: repulsors · A robot',
  },
  pad: {
    robot: 'L-stick walk · R-stick turn · B jump/jets · RT fire · LB missile · X car · Y jet',
    car: 'RT gas · LT brake · L-stick steer · B nitro · RB fire · LB missile · A robot · Y jet',
    jet: 'L-stick fly · R-stick yaw · RT throttle · B afterburner · RB fire · LB missile · A robot',
    suit: 'L-stick thrust · R-stick turn · B up · LT down · RT boost · RB repulsors · LB missile · A robot',
  },
  keys: {
    robot: 'WASD walk · arrows turn · Space jump/jets · F fire · G missile · 2 car · 3 jet · H help',
    car: 'W gas · S brake · A/D steer · Space nitro · F fire · G missile · 1 robot · 3 jet',
    jet: 'W/S pitch · A/D roll · Q/E yaw · Shift throttle · Space afterburner · F fire · G missile',
    suit: 'WASD thrust · arrows turn · Space up · Ctrl down · Shift boost · F repulsors · G missile · 1 robot',
  },
};
// The card shown in the headset when you first put it on.
const vrHelp = () => ['A ROBOT · X CAR · Y JET', 'A AGAIN AS THE ROBOT: FLIGHT SUIT', 'SUIT: TRIGGERS ARE PALM JETS', 'TRIGGERS FIRE · B JUMP / BOOST', 'R-STICK UP: MISSILE', 'CAR: GRIP THE WHEEL · R-TRIGGER GAS',
  'JET: R-GRIP STICK · L-GRIP THROTTLE', 'HOLD L-STICK: RECENTER', `COMFORT: VIGNETTE ${settings.vignette.toUpperCase()} · SNAP ${settings.snap}°`];
// In a headset, a transform blacks the view out and the eye jumps to the new seat once it is dark.
const VR_CUT = 0.1;

// ---------- renderer, scene, player rig ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false; // on a screen, shadows are redrawn every other frame (see the loop): half the cost
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local'); // seated or standing: your head starts at the seat
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 8000);
const rig = new THREE.Group();      // rides the body: the seat, or the chase point
const rigInner = new THREE.Group(); // the recenter offset for the headset
rig.add(rigInner); rigInner.add(camera); scene.add(rig);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- getting into the headset ----------
const noteEl = document.getElementById('vrnote');
let noteTimer = 0;
function vrNote(text, seconds = 0) {
  noteEl.textContent = text; noteEl.style.display = text ? '' : 'none';
  clearTimeout(noteTimer);
  if (text && seconds) noteTimer = setTimeout(() => vrNote(''), seconds * 1000);
}
if (navigator.xr) {
  // Chrome and Edge 147+ draw WebXR through 'layers' by default, and on many PC headsets that path shows
  // only black. Unless the address has ?xrlayers, hide layers so three.js uses the older XRWebGLLayer path.
  const layersOff = !new URLSearchParams(location.search).has('xrlayers');
  if (layersOff && globalThis.XRRenderState && 'layers' in XRRenderState.prototype) delete XRRenderState.prototype.layers;
  const strip = init => layersOff ? { ...init, optionalFeatures: (init?.optionalFeatures ?? []).filter(f => f !== 'layers') } : init;
  const xr = navigator.xr, request = xr.requestSession.bind(xr), offer = xr.offerSession?.bind(xr);
  xr.requestSession = (mode, init) => {
    vrNote('STARTING VR... put the headset on. The first start can take up to a minute.');
    const session = request(mode, strip(init));
    session.then(() => vrNote(''), e => vrNote(`VR DID NOT START: ${e.message}`, 15));
    return session;
  };
  if (offer) xr.offerSession = (mode, init) => offer(mode, strip(init));
}

// ---------- build everything ----------
await initPhysics();
Object.assign(G, { scene, camera, rig, renderer, groundAt, audio, listener: V() });
G.fx = createFx(scene, camera);
initDebris(scene);
const world = buildWorld(scene, renderer);
G.city = world.city; G.props = world.props;
G.traffic = createTraffic(scene, G.props);
G.weapons = createWeapons(scene);
const tf = createTransformers(scene, 12);
G.enemies = createEnemies(tf);
G.powerups = createPowerups(scene);
{ // an even spread of about 45 fixed power-up spots across the map
  const every = Math.max(1, Math.ceil(G.city.spawns.length / 45));
  G.city.spawns.forEach((p, i) => { if (i % every === 0) G.powerups.addSpawn(p); });
}
G.hud = createHud({ renderer, rig, camera, scene });
const comfort = G.comfort = createComfort(camera);
initInput({ renderer, rig, rigInner, onGesture: audioInit });
G.player = { sphere: () => hitSphere(st, V()), damage: damagePlayer };
let unit = tf.spawn('player', 1);
window.MIM = { G, st }; // for poking at the game from the browser console
const kin = kinematic();
await renderer.compileAsync(scene, camera); // compile every shader now, not mid-fight
document.getElementById('loading')?.remove();
// The ENTER VR button. With no headset ready it reads VR NOT SUPPORTED: a note then says how to get a Rift S
// going, and once a headset turns up (Link started, headset plugged in) the button becomes ENTER VR, no reload.
let vrButton = document.body.appendChild(VRButton.createButton(renderer));
async function checkHeadset() {
  if (!navigator.xr || renderer.xr.isPresenting) return;
  const ok = await navigator.xr.isSessionSupported('immersive-vr').catch(() => false);
  if (ok && vrButton.textContent === 'VR NOT SUPPORTED') { vrButton.replaceWith(vrButton = VRButton.createButton(renderer)); vrNote(''); }
  else if (!ok) vrNote('NO VR HEADSET FOUND: playing on the screen. For a Rift S, start the Meta Horizon Link app, make it the active OpenXR runtime (Settings → General) and plug the headset in.', 15);
}
checkHeadset();
navigator.xr?.addEventListener?.('devicechange', checkHeadset);

const helpEl = document.getElementById('help');
const showHelp = () => { helpEl.style.display = settings.help && !renderer.xr.isPresenting ? '' : 'none'; };
showHelp();
// the headset comfort buttons on the help panel: each click steps to the next choice
const COMFORT = {
  vignette: { key: 'vr.vignette', next: v => ({ off: 'low', low: 'high' })[v] ?? 'off', label: v => v.toUpperCase() },
  snap: { key: 'vr.snap', next: v => v === 30 ? 45 : 30, label: v => `${v}°` },
  gentleRoll: { key: 'vr.gentleRoll', next: v => !v, label: v => v ? 'GENTLE' : 'FULL' },
};
for (const btn of helpEl.querySelectorAll('button[data-set]')) {
  const name = btn.dataset.set, c = COMFORT[name];
  btn.textContent = c.label(settings[name]);
  btn.addEventListener('click', () => { settings[name] = c.next(settings[name]); savePref(c.key, settings[name]); btn.textContent = c.label(settings[name]); btn.blur(); });
}

// ---------- the player ----------
function doTransform(m) {
  if (st.dead || m === st.mode) return;
  const vr = renderer.xr.isPresenting;
  // In a headset, drive or fly off the way you are looking: the body turns to your head now; the seat you
  // see turns with it at the cut, in the dark, and the recenter there faces you forward again.
  if (vr && humanoid(st.mode) && !humanoid(m)) { st.yaw += st.lookYaw; st.lookYawS = 0; }
  if (!transformTo(st, m)) return;
  if (m === 'jet') st.lever = 0; // the throttle starts at idle, wherever you last left it
  setBodyScale(m === 'suit' ? SUIT.scale : 1);
  unit.startTransform();
  sfx.transform(); rumble(0.3, 0.6, 350);
  // dark by the time the eye jumps, VR_CUT from now (if it's already dark, it stays dark that long); recenter on the new seat
  if (vr) { comfort.blink(false, 0.05 + VR_CUT * comfort.fade); recenterIn = VR_CUT; }
}
// The suit is the robot at human size: changing size rebuilds the body (its parts then swing into the new form).
function setBodyScale(k) {
  if (st.scale === k) return;
  st.scale = k;
  unit.release(); unit = tf.spawn('player', k);
  G.fx.sparks(hitSphere(st, V()).c, null, [0.6, 1.6, 2.4], 24, 8);
}
// A bad landing or a wall: the jet bails out into the robot and lands on its feet.
function emergencyTransform() {
  const vr = renderer.xr.isPresenting;
  st.vel.multiplyScalar(0.3); st.vel.y = Math.max(st.vel.y, 4);
  G.fx.explosion(st.pos.clone().add(V(0, 1, 0)), 1.2); audio.explosion(st.pos, 10); rumble(1, 1, 450);
  if (vr) comfort.blink(true, 0.3); // in a headset: black at once, and the bail-out happens out of sight
  doTransform('robot');
  if (vr) { // land on the ground below, level, instead of tumbling and falling
    st.tilt.identity(); st.vel.set(0, 0, 0);
    st.pos.y = groundAt(st.pos.x, st.pos.z, st.pos.y);
    kin.teleport(st.pos);
  }
  damagePlayer(10, null);
  say('EMERGENCY TRANSFORM');
}
function damagePlayer(amount, from) {
  if (st.dead || st.invuln > 0 || !(amount > 0)) return;
  let a = amount;
  if (st.shield > 0) { const s = Math.min(st.shield, a); st.shield -= s; a -= s; audio.shieldHit(); }
  if (a > 0) { st.hp -= a; st.hurtT = Math.min(1, st.hurtT + a / 25); audio.hurt(); rumble(0.6, 0.4, 150); }
  if (from) G.hud.damageFrom(from);
  if (st.hp <= 0) die();
}
function die() {
  st.hp = 0; st.dead = true; st.respawnT = 5;
  comfort.blink(true, 0.4); // the frame drawn from inside the blast is already dark
  const c = hitSphere(st, V()).c;
  G.weapons.explode(c, { radius: 12, damage: 40, bld: 80, hole: 2, scale: 2.2, owner: 'player' });
  unit.breakApart(c.clone().add(V(0, -1, 0)), 18, st.vel.clone().multiplyScalar(0.5));
  unit = null;
  rumble(1, 1, 700);
}
function respawn() {
  Object.assign(st, { dead: false, hp: MAX_HP, shield: 0, invuln: 3, mode: 'robot', prevMode: 'robot', T: 9, speed: 0, steer: 0, yaw: 0, grounded: true, eyeDrop: 0, scale: 1 });
  st.pos.copy(SPAWN); st.vel.set(0, 0, 0); st.quat.identity(); st.tilt.identity();
  unit = tf.spawn('player', 1);
  kin.teleport(st.pos);
  comfort.blink(true, 0.2);
  say('SYSTEMS ONLINE', 2);
}

// ---------- weapons ----------
const cool = { left: 0, right: 0, gun: 0, missile: 0 };
function shoot(origin, dir, inherit, muzzle = 1) {
  const dmgMul = st.power.over > 0 ? 2 : 1;
  for (const a of st.power.triple > 0 ? [-0.06, 0, 0.06] : [0])
    G.weapons.fire('bolt', origin, a ? dir.clone().applyAxisAngle(UP, a) : dir, { owner: 'player', inherit, dmgMul, muzzle });
}
// Where the robot aims: where your head points in VR; straight ahead of the body on a screen
// (the chase camera looks down a little, which would send shots into the road).
function lookDir(out = V()) {
  if (renderer.xr.isPresenting) return camera.getWorldDirection(out);
  return out.set(0, 0, -1).applyQuaternion(yq(st.yaw + st.lookYawS));
}
function aimDir() {
  if (humanoid(st.mode)) return lookDir();
  return V(0, 0, -1).applyQuaternion(bodyQuat(st));
}
function fireMissile() {
  if (st.dead || cool.missile > 0 || st.T < TTOTAL) return;
  if (st.missiles <= 0) { say('NO MISSILES', 1); return; }
  const dir = aimDir(), from = unit.partWorld(st.mode === 'jet' ? 'missile' : 'missileL', V());
  // lock onto the enemy closest to where you aim, within 35 degrees
  let target = null, best = Math.cos(35 * DEG);
  for (const e of G.enemies.list) {
    if (!e.alive) continue;
    const to = G.enemies.center(e).sub(from);
    if (to.length() > 1600) continue;
    const c = to.normalize().dot(dir);
    if (c > best) { best = c; target = e; }
  }
  G.weapons.fire('missile', from, dir.clone().add(V(0, st.mode === 'robot' ? 0.15 : 0.02, 0)), { owner: 'player', target, inherit: st.vel.clone().multiplyScalar(0.6) });
  st.missiles--; cool.missile = 0.35;
  if (target) audio.missileLock();
  rumble(0.2, 0.5, 120);
}
const o3 = V(), d3 = V(), g3 = V();
function updateGuns(dt, inp) {
  for (const k in cool) cool[k] -= dt;
  if (st.dead || st.T < TTOTAL) return; // no shooting mid-transform
  const rate = st.power.rapid > 0 ? 0.45 : 1, vr = renderer.xr.isPresenting;
  if (st.mode === 'suit') {
    // In a headset each grip fires a repulsor out of that palm, the way the palm faces (so aim with an open hand).
    for (const j of jets) {
      if ((j.side === 'left' ? inp.gripL : inp.gripR) < 0.6 || cool[j.side] > 0) continue;
      cool[j.side] = 0.2 * rate;
      d3.copy(j.dirW).negate();
      if (settings.view === 'chase') { // from the suit's fist, toward the point 80 m out from your palm
        unit.partWorld(j.side === 'left' ? 'fistL' : 'fist', g3);
        shoot(g3, d3.multiplyScalar(80).add(rig.localToWorld(j.posR.clone())).sub(g3).normalize(), st.vel);
      } else shoot(rig.localToWorld(o3.copy(j.posR)).addScaledVector(d3, 0.08), d3, st.vel, 0.1);
      buzz(j.side, 0.4, 25);
    }
    if (inp.fire && cool.right <= 0) { // the fire button: both fists, alternately, where you look
      cool.right = 0.16 * rate;
      shoot(unit.partWorld(st.gunSide > 0 ? 'fist' : 'fistL', o3), lookDir(d3), st.vel);
      st.gunSide = -st.gunSide; rumble(0, 0.3, 40);
    }
    return;
  }
  if (st.mode === 'robot') {
    for (const side of ['left', 'right']) {
      const h = hands[side];
      if (h && (side === 'left' ? inp.trigL : inp.trigR) > 0.5 && cool[side] <= 0) {
        cool[side] = 0.14 * rate;
        h.ctrl.getWorldPosition(o3); d3.set(0, 0, -1).transformDirection(h.ctrl.matrixWorld);
        if (settings.view === 'chase') { // from the robot's own gun, toward the point 80 m along your hand
          unit.partWorld(side === 'left' ? 'gunL' : 'gun', g3);
          shoot(g3, d3.multiplyScalar(80).add(o3).sub(g3).normalize(), null);
        } else shoot(o3.addScaledVector(d3, GUN_TIP), d3, null, 0.1); // from the hand gun's muzzle, a small flash
        buzz(side, 0.4, 25);
      }
    }
    if (inp.fire && cool.right <= 0) {
      cool.right = 0.14 * rate;
      shoot(unit.partWorld(st.gunSide > 0 ? 'gun' : 'gunL', o3), lookDir(d3), null);
      st.gunSide = -st.gunSide; rumble(0, 0.3, 40);
    }
  } else if (inp.fire && cool.gun <= 0) {
    cool.gun = 0.08 * rate; st.gunSide = -st.gunSide;
    const m = MUZZLE[st.mode];
    o3.set(m.x * st.gunSide, m.y, m.z).applyQuaternion(bodyQuat(st)).add(st.pos);
    shoot(o3, V(0, 0, -1).applyQuaternion(bodyQuat(st)), st.vel, vr ? 0.5 : 1);
    rumble(0, 0.25, 40); buzz('right', 0.3, 20);
  }
}

// ---------- the flight suit ----------
// The palm jets this frame: { side, power, dirW (the way it pushes you, world), posR (the palm, rig frame) }.
const jets = [], thrustW = V(), jetQ = new THREE.Quaternion();
let jetsRig = []; // the same, as read from the controllers (rig frame), kept for the boost presses
function suitThrust(inp, vr, dt) {
  thrustW.set(0, 0, 0); jets.length = 0;
  // boost: B in a headset, Shift / RT on a screen; it runs on the nitro meter (or freely with TURBO)
  const want = vr ? inp.action : inp.trigR > 0.5, turbo = st.power.turbo > 0;
  st.boosting = want && (st.nitro > 0.02 || turbo);
  if (!turbo) st.nitro = st.boosting ? Math.max(0, st.nitro - dt * 0.25) : Math.min(1, st.nitro + dt * 0.08);
  const gain = SUIT.thrust * (st.boosting ? 1.8 : 1);
  let power = 0;
  if (vr && inp.jets) {
    jetsRig = inp.jets;
    jetQ.copy(rig.quaternion); // the rig turns only about the vertical in the suit
    for (const j of inp.jets) {
      const dirW = j.dir.clone().applyQuaternion(jetQ);
      thrustW.addScaledVector(dirW, gain * j.power);
      jets.push({ side: j.side, power: j.power, dirW, posR: j.pos }); // posR: the palm in the rig's frame (the rig moves before it's used)
      power = Math.max(power, j.power);
    }
  } else if (!vr) {
    // on a screen: the stick or WASD pushes you the way you face, Space lifts, Ctrl sinks; in the air
    // with nothing pressed the suit holds its height
    const yaw = st.yaw + st.lookYawS, f = V(-Math.sin(yaw), 0, -Math.cos(yaw)), r = V(-f.z, 0, f.x);
    thrustW.addScaledVector(f, -inp.my * gain * 1.4).addScaledVector(r, inp.mx * gain * 1.4);
    thrustW.y += inp.action ? SUIT.grav * 1.8 : inp.trigL > 0.1 ? SUIT.grav * 0.3 : st.grounded ? 0 : SUIT.grav;
    power = Math.min(1, thrustW.length() / (2 * SUIT.thrust));
  }
  st.throttle = power;
  return thrustW;
}
// A double pull of a trigger: a burst from that hand, on the boost meter.
function suitBoost(side) {
  if (st.mode !== 'suit' || st.dead || (st.nitro < 0.15 && st.power.turbo <= 0)) return;
  const j = jetsRig.find(x => x.side === side);
  if (!j) return;
  const dirW = j.dir.clone().applyQuaternion(rig.quaternion);
  st.vel.addScaledVector(dirW, 12);
  if (st.power.turbo <= 0) st.nitro -= 0.15;
  G.fx.glow(rig.localToWorld(j.pos.clone()).addScaledVector(dirW, -0.3), 0.4, [1.5, 2.2, 2.8, 1], 0.12);
  buzz(side, 0.8, 60); sfx.jump();
}
// Exhaust out of each palm (in the cockpit) or each fist (seen from the chase camera).
const exhaust = V();
function suitFlames(vr) {
  const cockpit = vr && settings.view === 'cockpit';
  const list = vr ? jets : [{ side: 'left', power: st.throttle, dirW: thrustW.clone().normalize() }, { side: 'right', power: st.throttle, dirW: thrustW.clone().normalize() }];
  for (const j of list) {
    if (!(j.power > 0.02) || !(j.dirW.lengthSq() > 0.5)) continue;
    const at = cockpit ? rig.localToWorld(j.posR.clone()) : unit.partWorld(j.side === 'left' ? 'fistL' : 'fist', V());
    exhaust.copy(j.dirW).multiplyScalar(-(18 + 22 * j.power)).add(st.vel); // out of the palm, away from the push
    const size = (cockpit ? 0.05 : 0.35) * (0.6 + j.power) * (st.boosting ? 1.4 : 1);
    for (let i = 0; i < 2; i++) {
      G.fx.add.spawn({ pos: at.clone().addScaledVector(j.dirW, -0.03 - Math.random() * 0.05), vel: exhaust, size, size1: size * 0.25, life: 0.1 + Math.random() * 0.06,
        color: st.boosting ? [2.4, 1.6, 0.8, 1] : [1.2, 2.0, 2.6, 0.9], tile: TILE.GLOW });
    }
  }
}

// ---------- camera rig ----------
// The jet's compass heading, held while the nose is near vertical (where it means nothing and would
// flip the chase camera and the HUD's pitch ladder round), and an eased copy for the chase view on a screen.
let heldYaw = 0, chaseYaw = 0, steepBefore = false;
const shown = { q: new THREE.Quaternion(), local: V() }; // the seat the headset shows, held from a transform until the cut
const fwd = V();
function updateRig(dt) {
  const vr = renderer.xr.isPresenting, chase = settings.view === 'chase' || st.dead;
  if (st.mode === 'jet') {
    fwd.set(0, 0, -1).applyQuaternion(st.quat);
    const steep = Math.hypot(fwd.x, fwd.z) <= 0.35;
    if (!steep) {
      const h = headingOf(st.quat), jump = Math.abs(angleDiff(heldYaw, h));
      // out of a steep climb or dive the heading may have moved a long way: in a headset's chase view, cut, don't swing
      if (vr && chase && jump > 5 * DEG && (steepBefore || jump > Math.PI / 2)) comfort.blink(true);
      heldYaw = h;
    }
    steepBefore = steep;
  } else { heldYaw = st.yaw; steepBefore = false; }
  chaseYaw = vr || st.mode !== 'jet' ? heldYaw : chaseYaw + angleDiff(chaseYaw, heldYaw) * (1 - Math.exp(-8 * dt));

  const table = chase ? CHASE : EYE;
  let local, q;
  if (vr && st.T < VR_CUT) { // the seat you see rides the body unchanged until the blink is dark
    local = shown.local.clone(); q = shown.q.clone();
  } else if (vr) {
    // In a headset nothing turns or slides you that you didn't steer: the eye cuts to the new seat while
    // the blink is dark, and on the ground the seat only turns (the body's tilt stays out of the view).
    local = table[st.mode].clone();
    q = chase ? yq(st.mode === 'jet' ? chaseYaw : st.yaw) : st.mode === 'jet' ? st.quat.clone() : yq(st.yaw);
    shown.local.copy(local); shown.q.copy(q);
  } else {
    local = V().lerpVectors(table[st.prevMode], table[st.mode], ease(clamp(st.T / TTOTAL, 0, 1)));
    q = chase ? yq(st.mode === 'jet' ? chaseYaw : st.yaw) : st.mode === 'jet' ? st.quat.clone() : yq(st.yaw).multiply(st.tilt);
  }
  rig.quaternion.copy(q);
  rig.position.copy(st.pos).add(local.applyQuaternion(q));
  st.eyeDrop *= Math.exp(-12 * dt); // a step up lifts the body at once; the eye follows over a moment
  rig.position.y += st.eyeDrop;
  if (!vr) {
    camera.rotation.x = chase ? -0.18 : 0;
    const sh = G.fx.shake * 0.35; // camera shake, desktop only (in a headset it would make you ill)
    camera.position.set((Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh, 0);
  }
  rig.updateMatrixWorld(true);
}
function recenter() { // puts your head at the seat, facing forward
  const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
  rigInner.rotation.set(0, -e.y, 0);
  rigInner.position.copy(camera.position).applyAxisAngle(UP, -e.y).negate();
  releaseGrabs(); // the wheel, stick and lever were measured from the old seat
}
// Recentering happens half a second after the headset first shows the game and whenever it comes back
// (headset back on), after a system recenter (the Oculus button; browsers don't report that, so it is
// spotted as a jump of the head that no real head could make in one frame), and on a long L-stick click.
let recenterIn = -1, xrState = '', seenVR = false;
const lastHead = { p: V(), q: new THREE.Quaternion(), t: 0, ok: false }, headE = new THREE.Euler();
renderer.xr.addEventListener('sessionstart', () => {
  const session = renderer.xr.getSession();
  xrState = ''; lastHead.ok = false;
  audioInit(); showHelp(); vrNote('');
  renderer.xr.getReferenceSpace()?.addEventListener?.('reset', () => { recenterIn = 0.05; });
  session.addEventListener('visibilitychange', () => setPaused(session.visibilityState !== 'visible'));
});
renderer.xr.addEventListener('sessionend', () => {
  rigInner.position.set(0, 0, 0); rigInner.rotation.set(0, 0, 0);
  camera.position.set(0, 0, 0); camera.quaternion.identity();
  // the headset left its own projection on the camera; put the screen's back
  camera.fov = 75; camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  setPaused(false);
  showHelp();
});
// Returns false while the headset isn't showing the game (headset off, the Oculus menu open).
function watchHeadset() {
  const xs = renderer.xr.getSession();
  if (!xs) return true;
  const vis = xs.visibilityState ?? 'visible';
  if (vis !== xrState) {
    if (vis === 'visible') {
      recenterIn = 0.5;
      if (!seenVR) { seenVR = true; G.hud.card('MACHINES IN MASQUERADE', vrHelp(), 15); }
    }
    xrState = vis;
  }
  setPaused(vis !== 'visible');
  if (vis !== 'visible') { lastHead.ok = false; return false; }
  const now = performance.now(), gap = (now - lastHead.t) / 1000, p = camera.position;
  if (lastHead.ok) {
    const jumped = p.distanceTo(lastHead.p) > Math.max(0.25, 3 * gap) || camera.quaternion.angleTo(lastHead.q) > Math.max(25 * DEG, 600 * DEG * gap);
    const atOrigin = Math.hypot(p.x, p.z) < 0.15 && Math.abs(headE.setFromQuaternion(camera.quaternion, 'YXZ').y) < 10 * DEG;
    if (jumped && atOrigin) recenterIn = 0.1;
  }
  lastHead.p.copy(p); lastHead.q.copy(camera.quaternion); lastHead.t = now; lastHead.ok = true;
  return true;
}

function handlePress(p) {
  if (p === 'camera') {
    settings.view = settings.view === 'cockpit' ? 'chase' : 'cockpit';
    if (renderer.xr.isPresenting) comfort.blink(true);
  } else if (p === 'recenter') { recenter(); say('RECENTERED', 1.2); }
  else if (p === 'music') { audioInit(); say(toggleMusic() ? 'MUSIC ON' : 'MUSIC OFF', 1.2); sfx.click(); }
  else if (p === 'help') { settings.help = !settings.help; savePref('help', settings.help); showHelp(); }
  else if (p === 'missile') fireMissile();
  else if (p === 'boostL' || p === 'boostR') suitBoost(p === 'boostL' ? 'left' : 'right');
  else if (p === 'humanoid') doTransform(st.mode === 'robot' ? 'suit' : 'robot'); // A: the robot, and again for the suit
  else doTransform(p);
}

// Points in the body's frame that its parts must keep clear of: your head, and your hands in a headset.
const avoid = [], bodyInv = new THREE.Quaternion(), wp = V(), avoidPts = [V(), V(), V()];
function keepClear(bq, vr) {
  avoid.length = 0;
  if (settings.view !== 'cockpit' || st.dead) return null;
  const transforming = st.T < TTOTAL;
  bodyInv.copy(bq).invert();
  const local = (o, i) => avoidPts[i].copy(o.getWorldPosition(wp)).sub(st.pos).applyQuaternion(bodyInv);
  if (vr || transforming) avoid.push([local(camera, 0), transforming ? 0.6 : 0.12]);
  if (vr) ['left', 'right'].forEach((side, i) => { const h = hands[side]; if (h?.grip.visible) avoid.push([local(h.grip, i + 1), 0.08]); });
  return avoid.length ? avoid : null;
}

// ---------- main loop ----------
const clock = new THREE.Clock();
const lookQ = new THREE.Quaternion(), tmpE = new THREE.Euler(), eye = V();
let frameNo = 0;
const NO_INPUT = { mx: 0, my: 0, rx: 0, trigL: 0, trigR: 0, throttle: 0, action: false, fire: false };
function frame() {
  if (!watchHeadset()) { clock.getDelta(); renderer.render(scene, camera); return; } // paused, but still drawn
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
  const vr = renderer.xr.isPresenting;
  if (recenterIn > 0 && (recenterIn -= dt) <= 0) recenter();
  const raw = readInput(dt);
  raw.presses.forEach(handlePress);
  const inp = st.dead ? { ...NO_INPUT } : raw;
  st.lookYaw = vr ? tmpE.setFromQuaternion(lookQ.multiplyQuaternions(rigInner.quaternion, camera.quaternion), 'YXZ').y : 0;
  st.lookYawS += angleDiff(st.lookYawS, humanoid(st.mode) ? st.lookYaw : 0) * (1 - Math.exp(-6 * dt)); // the short way round
  for (const k in st.power) st.power[k] = Math.max(0, st.power[k] - dt);
  st.invuln = Math.max(0, st.invuln - dt);
  st.hurtT = Math.max(0, st.hurtT - dt * 1.5);
  if ((st.msgT -= dt) <= 0) st.msg = '';

  if (st.dead) {
    if ((st.respawnT -= dt) <= 0) respawn();
  } else {
    const turbo = st.power.turbo > 0;
    // plough through props and traffic: knock them clear before moving into them; heavy things slow the car
    const ahead = st.pos.clone().addScaledVector(st.vel, dt * 2);
    const knocked = G.props.knock(ahead, st.mode === 'suit' ? 0.8 : 1.8, st.vel, 8000, st.mode === 'robot' ? 6 : 2) + G.traffic.collide(ahead, 2, st.vel, 8000);
    if (knocked && st.mode === 'car') st.speed *= 1 - clamp(knocked / 40000, 0, 0.35);
    if (st.mode === 'robot') {
      const ev = stepRobot(st, dt, inp, { snapTurn: vr ? settings.snap * DEG : 0, turbo });
      if (ev.jumped) sfx.jump();
      if (ev.landed > 10) { sfx.thud(); rumble(0.7, 0.3, 160); G.fx.dust(st.pos, 3, 8, 0.6); }
    } else if (st.mode === 'suit') {
      const ev = stepSuit(st, dt, { ...inp, thrust: suitThrust(inp, vr, dt) }, { snapTurn: vr ? settings.snap * DEG : 0 });
      st.jets = ev.thrusting;
      if (ev.landed > 8) { sfx.thud(); rumble(0.5, 0.3, 120); G.fx.dust(st.pos, 1.2, 6, 0.6); }
    } else if (st.mode === 'car') {
      const ev = stepCar(st, dt, inp, { turbo });
      if (ev.wallSpeed > 15) { sfx.thud(); rumble(0.8, 0.5, 200); G.fx.sparks(st.pos.clone().add(V(0, 0.8, 0)), null, [2.5, 1.6, 0.6], 20, 10); damagePlayer(ev.wallSpeed * 0.15, null); }
      if (ev.landed > 10) { sfx.thud(); rumble(0.5, 0.3, 120); }
    } else {
      const ev = stepJet(st, dt, { ...inp, action: inp.action || (turbo && inp.throttle > 0.5) }, { turbo, rollRate: vr && settings.gentleRoll ? 90 * DEG : undefined });
      if (ev.crash) emergencyTransform();
      else if (ev.landed) { sfx.thud(); rumble(0.4, 0.2, 120); }
    }
    st.actionHeld = inp.action;
    const [hx, hy, hz] = kinShape(st);
    kin.setShape(hx, hy, hz);
    kin.move(st.pos, bodyQuat(st));
  }
  st.T += dt;
  const alt = st.pos.y - groundAt(st.pos.x, st.pos.z, st.pos.y);
  const gearDown = st.grounded || alt < 40;
  const bq = bodyQuat(st);
  updateRig(dt); // first, so your head and hands are measured from where the seat is now
  unit?.update(dt, st, bq, { throttle: st.throttle, afterburner: st.mode === 'jet' && st.boosting, nitro: st.mode === 'car' && st.boosting, jets: st.jets, gearDown },
    settings.view === 'cockpit', keepClear(bq, vr));

  if (st.mode === 'suit' && !st.dead) suitFlames(vr);
  G.enemies.update(dt);
  G.traffic.update(dt, st.pos);
  G.props.update(dt);
  tf.render();
  rig.getWorldPosition(eye);
  G.listener.copy(eye);
  world.update(eye, st.pos, t, dt);
  updateGuns(dt, inp);
  G.weapons.update(dt);
  G.powerups.update(dt, t);
  stepPhysics(dt);
  G.fx.update(dt, eye, scene.fog);

  const hpFrac = st.hp / MAX_HP;
  comfort.update(dt, rig, {
    vr, vignette: settings.vignette,
    hurt: st.dead ? 0.5 : Math.max(st.hurtT * 0.6, hpFrac < 0.3 ? (0.25 + 0.15 * Math.sin(t * 6)) * (1 - hpFrac / 0.3) : 0),
  });
  const bodyFwd = V(0, 0, -1).applyQuaternion(bq);
  const speed = st.mode === 'jet' || st.mode === 'suit' ? st.vel.length() : Math.hypot(st.vel.x, st.vel.z) * (st.mode === 'car' && st.speed < 0 ? -1 : 1);
  const viewYaw = st.mode === 'jet' ? heldYaw : st.yaw; // which way the HUD and minimap face
  G.hud.update(dt, {
    mode: st.mode, time: t, pos: st.pos, heading: ((-viewYaw / DEG) % 360 + 360) % 360, viewYaw,
    speed: Math.abs(speed), reverse: speed < -0.5, alt, vy: st.vel.y,
    throttle: st.throttle, afterburner: (st.mode === 'jet' || st.mode === 'suit') && st.boosting, gearDown,
    stall: st.mode === 'jet' && !st.grounded && st.speed < 45, pullUp: st.mode === 'jet' && st.vel.y < -5 && alt / -st.vel.y < 3.5,
    velDir: st.vel.clone().normalize(), bodyFwd,
    gear: Math.min(7, Math.floor(Math.abs(st.speed) / 22) + 1), rpm: (Math.abs(st.speed) % 22) / 22, nitro: st.nitro, boosting: st.mode === 'car' && st.boosting,
    fuel: st.mode === 'suit' ? st.nitro : st.fuel / 2.5, jets: st.mode === 'suit' ? st.boosting : st.jets,
    hp: st.hp, hpFrac, shield: st.shield, missiles: st.missiles, power: st.power, hurt: st.hurtT,
    kills: st.kills, cash: st.cash, wave: G.enemies.wave, enemiesLeft: G.enemies.alive, dead: st.dead, respawnT: st.respawnT,
    msg: st.msg, music: settings.music, hint: HINTS[activeDevice(vr)][st.mode],
    transform: st.T < TTOTAL ? st.T / TTOTAL : null, map: G.city.map,
    enemies: G.enemies.list.filter(e => e.alive).map(e => { const c = G.enemies.center(e); return { pos: c, hp: e.hp / e.T.hp, type: e.type, dist: c.distanceTo(st.pos) }; }),
    pickups: G.powerups.items.filter(i => i.down <= 0).map(i => ({ pos: i.pos, color: '#' + POWER[i.kind].color.toString(16).padStart(6, '0') })),
  });
  engineSound(st.dead ? 'robot' : st.mode, st.mode === 'robot' ? 0 : st.mode === 'suit' ? st.vel.length() : st.speed,
    st.mode === 'jet' || st.mode === 'suit' ? st.throttle + (st.boosting ? 1 : 0) : Math.max(inp.trigR, st.boosting ? 1 : 0), Math.hypot(st.vel.x, st.vel.z) > 1);
  // every frame in a headset (its shadows would step at half its frame rate), every other frame on a screen
  renderer.shadowMap.needsUpdate = vr || (frameNo++ & 1) === 0;
  renderer.render(scene, camera);
}
renderer.setAnimationLoop(frame);
window.MIM.frame = frame; // lets the console step the game while the window is hidden
