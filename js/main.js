// Machines in Masquerade: sets the world up, then runs the loop that drives the player and everything else.
import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { V, DEG, UP, clamp, ease, yq, headingOf } from './util.js';
import { st, G, settings, savePref, say, TTOTAL, MAX_HP, SPAWN } from './state.js';
import { initPhysics, initDebris, kinematic, stepPhysics } from './physics.js';
import { groundAt } from './collision.js';
import { buildWorld } from './world.js';
import { createTransformers } from './transformer.js';
import { bodyQuat, transformTo, stepRobot, stepCar, stepJet, hitSphere, kinShape } from './vehicle.js';
import { createFx } from './fx.js';
import { createWeapons } from './weapons.js';
import { createTraffic } from './traffic.js';
import { createEnemies } from './enemies.js';
import { createPowerups, POWER } from './powerups.js';
import { initInput, readInput, activeDevice, hands, rumble, buzz } from './input.js';
import { createHud } from './hud.js';
import { audioInit, engineSound, sfx, audio, toggleMusic } from './audio.js';

// Where your eyes sit (cockpit) or the camera floats (chase), in the body's frame; forward is -z.
const EYE = { robot: V(0, 5.45, -0.1), car: V(0, 0.92, 0.6), jet: V(0, 1.95, -2.1) };
const CHASE = { robot: V(0, 8, 13), car: V(0, 3.2, 8.5), jet: V(0, 6, 22) };
const MUZZLE = { car: V(0.7, 0.5, -2.5), jet: V(0.55, 0.75, -4.0) };
const HINTS = {
  vr: {
    robot: 'L-stick walk · R-stick turn · B jump/jets · triggers fire · R-stick up missile · X car · Y jet',
    car: 'grips hold the wheel · R-trigger gas · L-trigger brake · B nitro · R-stick click fire · R-stick up missile',
    jet: 'R-grip flight stick (trigger fires) · L-grip throttle · B afterburner · R-stick up missile',
  },
  pad: {
    robot: 'L-stick walk · R-stick turn · B jump/jets · RT fire · LB missile · X car · Y jet',
    car: 'RT gas · LT brake · L-stick steer · B nitro · RB fire · LB missile · A robot · Y jet',
    jet: 'L-stick fly · R-stick yaw · RT throttle · B afterburner · RB fire · LB missile · A robot',
  },
  keys: {
    robot: 'WASD walk · arrows turn · Space jump/jets · F fire · G missile · 2 car · 3 jet · H help',
    car: 'W gas · S brake · A/D steer · Space nitro · F fire · G missile · 1 robot · 3 jet',
    jet: 'W/S pitch · A/D roll · Q/E yaw · Shift throttle · Space afterburner · F fire · G missile',
  },
};

// ---------- renderer, scene, player rig ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false; // shadows are redrawn every other frame (see the loop): half the cost
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
G.hud = createHud({ renderer, rig, camera });
initInput({ renderer, rig, rigInner, onGesture: audioInit });
G.player = { sphere: () => hitSphere(st, V()), damage: damagePlayer };
let unit = tf.spawn('player', 1);
window.MIM = { G, st }; // for poking at the game from the browser console
const kin = kinematic();
await renderer.compileAsync(scene, camera); // compile every shader now, not mid-fight
document.getElementById('loading')?.remove();
document.body.appendChild(VRButton.createButton(renderer));

const helpEl = document.getElementById('help');
const showHelp = () => { helpEl.style.display = settings.help && !renderer.xr.isPresenting ? '' : 'none'; };
showHelp();

// ---------- the player ----------
function doTransform(m) {
  if (st.dead || !transformTo(st, m)) return;
  unit.startTransform();
  sfx.transform(); rumble(0.3, 0.6, 350);
}
// A bad landing or a wall: the jet bails out into the robot and lands on its feet.
function emergencyTransform() {
  st.vel.multiplyScalar(0.3); st.vel.y = Math.max(st.vel.y, 4);
  G.fx.explosion(st.pos.clone().add(V(0, 1, 0)), 1.2); audio.explosion(st.pos, 10); rumble(1, 1, 450);
  doTransform('robot');
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
  const c = hitSphere(st, V()).c;
  G.weapons.explode(c, { radius: 12, damage: 40, bld: 80, hole: 2, scale: 2.2, owner: 'player' });
  unit.breakApart(c.clone().add(V(0, -1, 0)), 18, st.vel.clone().multiplyScalar(0.5));
  unit = null;
  rumble(1, 1, 700);
}
function respawn() {
  Object.assign(st, { dead: false, hp: MAX_HP, shield: 0, invuln: 3, mode: 'robot', prevMode: 'robot', T: 9, speed: 0, steer: 0, yaw: 0, grounded: true });
  st.pos.copy(SPAWN); st.vel.set(0, 0, 0); st.quat.identity(); st.tilt.identity();
  unit = tf.spawn('player', 1);
  kin.teleport(st.pos);
  say('SYSTEMS ONLINE', 2);
}

// ---------- weapons ----------
const cool = { left: 0, right: 0, gun: 0, missile: 0 };
function shoot(origin, dir, inherit) {
  const dmgMul = st.power.over > 0 ? 2 : 1;
  for (const a of st.power.triple > 0 ? [-0.06, 0, 0.06] : [0])
    G.weapons.fire('bolt', origin, a ? dir.clone().applyAxisAngle(UP, a) : dir, { owner: 'player', inherit, dmgMul });
}
// Where the robot aims: where your head points in VR; straight ahead of the body on a screen
// (the chase camera looks down a little, which would send shots into the road).
function lookDir(out = V()) {
  if (renderer.xr.isPresenting) return camera.getWorldDirection(out);
  return out.set(0, 0, -1).applyQuaternion(yq(st.yaw + st.lookYawS));
}
function aimDir() {
  if (st.mode === 'robot') return lookDir();
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
const o3 = V(), d3 = V();
function updateGuns(dt, inp) {
  for (const k in cool) cool[k] -= dt;
  if (st.dead || st.T < TTOTAL) return; // no shooting mid-transform
  const rate = st.power.rapid > 0 ? 0.45 : 1;
  if (st.mode === 'robot') {
    for (const side of ['left', 'right']) {
      const h = hands[side];
      if (h && (side === 'left' ? inp.trigL : inp.trigR) > 0.5 && cool[side] <= 0) {
        cool[side] = 0.14 * rate;
        h.ctrl.getWorldPosition(o3); d3.set(0, 0, -1).transformDirection(h.ctrl.matrixWorld);
        shoot(o3, d3, null); buzz(side, 0.4, 25);
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
    shoot(o3, V(0, 0, -1).applyQuaternion(bodyQuat(st)), st.vel);
    rumble(0, 0.25, 40); buzz('right', 0.3, 20);
  }
}

// ---------- camera rig ----------
function updateRig() {
  const chase = settings.view === 'chase' || st.dead;
  const table = chase ? CHASE : EYE;
  const local = V().lerpVectors(table[st.prevMode], table[st.mode], ease(clamp(st.T / TTOTAL, 0, 1)));
  const q = chase ? yq(st.mode === 'jet' ? headingOf(st.quat) : st.yaw)
    : st.mode === 'jet' ? st.quat.clone() : yq(st.yaw).multiply(st.tilt);
  rig.quaternion.copy(q);
  rig.position.copy(st.pos).add(local.applyQuaternion(q));
  if (!renderer.xr.isPresenting) {
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
}
let recenterIn = -1;
renderer.xr.addEventListener('sessionstart', () => { recenterIn = 0.4; audioInit(); showHelp(); });
renderer.xr.addEventListener('sessionend', () => {
  rigInner.position.set(0, 0, 0); rigInner.rotation.set(0, 0, 0);
  camera.position.set(0, 0, 0); camera.quaternion.identity();
  showHelp();
});

function handlePress(p) {
  if (p === 'camera') settings.view = settings.view === 'cockpit' ? 'chase' : 'cockpit';
  else if (p === 'recenter') { recenter(); say('RECENTERED', 1.2); }
  else if (p === 'music') { audioInit(); say(toggleMusic() ? 'MUSIC ON' : 'MUSIC OFF', 1.2); sfx.click(); }
  else if (p === 'help') { settings.help = !settings.help; savePref('help', settings.help); showHelp(); }
  else if (p === 'missile') fireMissile();
  else doTransform(p);
}

// ---------- main loop ----------
const clock = new THREE.Clock();
const lookQ = new THREE.Quaternion(), tmpE = new THREE.Euler(), eye = V();
let frameNo = 0;
const NO_INPUT = { mx: 0, my: 0, rx: 0, trigL: 0, trigR: 0, throttle: 0, action: false, fire: false };
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
  if (recenterIn > 0 && (recenterIn -= dt) <= 0) recenter();
  const raw = readInput(dt);
  raw.presses.forEach(handlePress);
  const inp = st.dead ? { ...NO_INPUT } : raw;
  st.lookYaw = renderer.xr.isPresenting ? tmpE.setFromQuaternion(lookQ.multiplyQuaternions(rigInner.quaternion, camera.quaternion), 'YXZ').y : 0;
  st.lookYawS += ((st.mode === 'robot' ? st.lookYaw : 0) - st.lookYawS) * (1 - Math.exp(-6 * dt));
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
    const knocked = G.props.knock(ahead, 1.8, st.vel, 8000, st.mode === 'robot' ? 6 : 2) + G.traffic.collide(ahead, 2, st.vel, 8000);
    if (knocked && st.mode === 'car') st.speed *= 1 - clamp(knocked / 40000, 0, 0.35);
    if (st.mode === 'robot') {
      const ev = stepRobot(st, dt, inp, { snapTurn: renderer.xr.isPresenting, turbo });
      if (ev.jumped) sfx.jump();
      if (ev.landed > 10) { sfx.thud(); rumble(0.7, 0.3, 160); G.fx.dust(st.pos, 3, 8, 0.6); }
    } else if (st.mode === 'car') {
      const ev = stepCar(st, dt, inp, { turbo });
      if (ev.wallSpeed > 15) { sfx.thud(); rumble(0.8, 0.5, 200); G.fx.sparks(st.pos.clone().add(V(0, 0.8, 0)), null, [2.5, 1.6, 0.6], 20, 10); damagePlayer(ev.wallSpeed * 0.15, null); }
      if (ev.landed > 10) { sfx.thud(); rumble(0.5, 0.3, 120); }
    } else {
      const ev = stepJet(st, dt, { ...inp, action: inp.action || (turbo && inp.throttle > 0.5) }, { turbo });
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
  unit?.update(dt, st, bq, { throttle: st.throttle, afterburner: st.mode === 'jet' && st.boosting, nitro: st.mode === 'car' && st.boosting, jets: st.jets, gearDown }, settings.view === 'cockpit');

  G.enemies.update(dt);
  G.traffic.update(dt, st.pos);
  G.props.update(dt);
  tf.render();
  updateRig();
  rig.getWorldPosition(eye);
  G.listener.copy(eye);
  world.update(eye, st.pos, t, dt);
  updateGuns(dt, inp);
  G.weapons.update(dt);
  G.powerups.update(dt, t);
  stepPhysics(dt);
  G.fx.update(dt, eye, scene.fog);

  const bodyFwd = V(0, 0, -1).applyQuaternion(bq);
  const speed = st.mode === 'jet' ? st.vel.length() : Math.hypot(st.vel.x, st.vel.z) * (st.mode === 'car' && st.speed < 0 ? -1 : 1);
  G.hud.update(dt, {
    mode: st.mode, time: t, pos: st.pos, heading: ((-headingOf(bq) / DEG) % 360 + 360) % 360, viewYaw: headingOf(rig.quaternion),
    speed: Math.abs(speed), reverse: speed < -0.5, alt, vy: st.vel.y,
    throttle: st.throttle, afterburner: st.mode === 'jet' && st.boosting, gearDown,
    stall: st.mode === 'jet' && !st.grounded && st.speed < 45, pullUp: st.mode === 'jet' && st.vel.y < -5 && alt / -st.vel.y < 3.5,
    velDir: st.vel.clone().normalize(), bodyFwd,
    gear: Math.min(7, Math.floor(Math.abs(st.speed) / 22) + 1), rpm: (Math.abs(st.speed) % 22) / 22, nitro: st.nitro, boosting: st.mode === 'car' && st.boosting,
    fuel: st.fuel / 2.5, jets: st.jets,
    hp: st.hp, hpFrac: st.hp / MAX_HP, shield: st.shield, missiles: st.missiles, power: st.power, hurt: st.hurtT,
    kills: st.kills, cash: st.cash, wave: G.enemies.wave, enemiesLeft: G.enemies.alive, dead: st.dead, respawnT: st.respawnT,
    msg: st.msg, music: settings.music, hint: HINTS[activeDevice(renderer.xr.isPresenting)][st.mode],
    transform: st.T < TTOTAL ? st.T / TTOTAL : null, map: G.city.map,
    enemies: G.enemies.list.filter(e => e.alive).map(e => { const c = G.enemies.center(e); return { pos: c, hp: e.hp / e.T.hp, type: e.type, dist: c.distanceTo(st.pos) }; }),
    pickups: G.powerups.items.filter(i => i.down <= 0).map(i => ({ pos: i.pos, color: '#' + POWER[i.kind].color.toString(16).padStart(6, '0') })),
  });
  engineSound(st.dead ? 'robot' : st.mode, st.mode === 'robot' ? 0 : st.speed, st.mode === 'jet' ? st.throttle + (st.boosting ? 1 : 0) : Math.max(inp.trigR, st.boosting ? 1 : 0), Math.hypot(st.vel.x, st.vel.z) > 1);
  renderer.shadowMap.needsUpdate = (frameNo++ & 1) === 0;
  renderer.render(scene, camera);
}
renderer.setAnimationLoop(frame);
window.MIM.frame = frame; // lets the console step the game while the window is hidden
