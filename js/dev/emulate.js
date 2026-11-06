// Testing without a headset: open the game as http://localhost:8322/?emulate and this fakes an
// Oculus Rift S (a stereo headset plus two Touch controllers) in the browser, using Meta's
// Immersive Web Emulation Runtime. Normal play never loads this file.
//
// Scripts drive it through window.MIM_XR, for example from the browser console:
//   await MIM_XR.enter()                     press ENTER VR
//   MIM_XR.press('right', 'a-button')        tap A (robot)    'x-button' car, 'y-button' jet
//   MIM_XR.hold('right', 'trigger', 1)       hold a trigger   (0 to release)
//   MIM_XR.stick('left', 0, -1)              push the left stick forward
//   MIM_XR.head({ x: 0, y: 1.2, z: 0 }, { yaw: 30 })   move and turn your head (degrees)
//   MIM_XR.hand('right', { x: 0.2, y: 1.0, z: -0.4 }, { pitch: -20, roll: 10 })
import { XRDevice, metaQuest2, oculusTouchV2 } from 'https://cdn.jsdelivr.net/npm/iwer@2.8.0/build/iwer.module.js';

const riftS = {
  ...metaQuest2,
  name: 'Oculus Rift S (emulated)',
  controllerConfig: oculusTouchV2,              // the Rift S Touch controllers
  supportedSessionModes: ['inline', 'immersive-vr'],
  supportedFeatures: ['viewer', 'local', 'local-floor', 'bounded-floor'],
  supportedFrameRates: [80],
  internalNominalFrameRate: 80,
  userAgent: navigator.userAgent,
};
const device = new XRDevice(riftS, { stereoEnabled: true, ipd: 0.063 });
device.installRuntime({ forceInstall: true });

// a seated player: head at 1.2 m, hands resting in front
device.position.set(0, 1.2, 0);
device.controllers.left.position.set(-0.2, 0.95, -0.35);
device.controllers.right.position.set(0.2, 0.95, -0.35);

const D = Math.PI / 180;
const quat = (target, { yaw = 0, pitch = 0, roll = 0 } = {}) => {
  // yaw about y, then pitch about x, then roll about z (the same order three.js calls 'YXZ')
  const cy = Math.cos(yaw * D / 2), sy = Math.sin(yaw * D / 2), cp = Math.cos(pitch * D / 2), sp = Math.sin(pitch * D / 2), cr = Math.cos(roll * D / 2), sr = Math.sin(roll * D / 2);
  target.set(cy * sp * cr + sy * cp * sr, sy * cp * cr - cy * sp * sr, cy * cp * sr - sy * sp * cr, cy * cp * cr + sy * sp * sr);
};
const nextFrames = (n = 2) => new Promise(res => { let k = 0; const f = () => (++k >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });

window.MIM_XR = {
  device,
  async enter() {
    for (let i = 0; i < 200 && !document.getElementById('VRButton'); i++) await new Promise(r => setTimeout(r, 100));
    document.getElementById('VRButton').click();
    for (let i = 0; i < 100 && !device.activeSession; i++) await new Promise(r => setTimeout(r, 50));
    return !!device.activeSession;
  },
  async exit() { await device.activeSession?.end(); },
  hold(hand, button, value = 1) { device.controllers[hand].updateButtonValue(button, value); },
  async press(hand, button, frames = 3) { this.hold(hand, button, 1); await nextFrames(frames); this.hold(hand, button, 0); await nextFrames(2); },
  stick(hand, x, y) { device.controllers[hand].updateAxes('thumbstick', x, y); },
  head(pos, rot) { if (pos) device.position.set(pos.x, pos.y, pos.z); if (rot) quat(device.quaternion, rot); },
  hand(hand, pos, rot) { const c = device.controllers[hand]; if (pos) c.position.set(pos.x, pos.y, pos.z); if (rot) quat(c.quaternion, rot); },
  frames: nextFrames,
};
console.info('[emulate] Rift S emulation installed: MIM_XR.enter() to go into VR');
