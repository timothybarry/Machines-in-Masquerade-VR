# Machines in Masquerade VR

A WebXR game where you are a transforming robot in a city you can wreck. Your one body switches
between a robot, a supercar and a fighter jet, and keeps its speed and heading through each change.
Hold off waves of hostile machines while walls hole, buildings collapse and cars go flying.

Built with [three.js](https://threejs.org/) 0.170 and [Rapier](https://rapier.rs/) physics, both
loaded from a CDN through the page's import map, so there is nothing to install or build.

**Status:** prototype. It plays on desktop with a keyboard or an Xbox controller. The Oculus Rift S
version has been tested in Meta's headset emulator (see below) but not yet in a real headset.

## Play it

**Online:** open https://timothybarry.github.io/Machines-in-Masquerade-VR/ in Edge or Chrome. It plays on
a flat screen with a keyboard or an Xbox controller; with a headset ready, press **ENTER VR**.

**From this folder:** you need Python 3 and a WebXR browser (Edge or Chrome). WebXR only works on HTTPS
pages or on localhost, so the game comes with a tiny no-cache server.

- **Windows:** double-click `Play in VR.bat`. It starts the server and opens Edge at
  http://localhost:8322/.
- **Anywhere:** run `python serve.py 8322` in this folder, then open http://localhost:8322/.

### In the Rift S

1. In the Meta Horizon Link PC app (once called Oculus, then Meta Quest Link), open Settings → General
   and make it the **active OpenXR runtime** (the button is greyed out if it already is). If the headset
   says it can't show content from unknown sources, turn on **Unknown Sources** on the same page.
2. Open the game (online, or from this folder as above) and press **ENTER VR**, then put the headset on. The first start can take
   up to a minute; the page says so while it waits.
3. Your view recentres on the seat by itself. To recentre again, hold the left stick click.

If the headset stays black, add `?xrlayers` to the address (for example http://localhost:8322/?xrlayers) and try again. Recent Chrome and Edge
draw WebXR through 'layers', which shows only black on many PC headsets, so the game turns that path
off by default; `?xrlayers` turns it back on. Chrome and Edge don't support controller rumble in VR, so grabbing the wheel, stick or throttle clicks instead.

### Comfort

In the headset, nothing turns or moves your view that you didn't steer: transforming blacks the view
out for a moment and moves you to the new seat while it's dark, and on the ground the seat only turns.
The help panel on the screen (H) has three headset settings, saved between visits:

- **edge darkening** (off / low / high, default low): darkens the edge of your view while the game turns
  or jolts you, which cuts motion sickness;
- **snap turn** angle for the robot (30° or 45°);
- **jet roll** full (160°/s) or gentle (90°/s).

## Controls

| | |
|---|---|
| **Keyboard** | 1 robot · 2 car · 3 jet · 4 flight suit (WASD thrust, Space up, Ctrl down, Shift boost) · Space jump / nitro / afterburner · F fire · G missile · C camera · M music · H help |
| robot | WASD + arrows |
| car | W gas · S brake · A/D steer |
| jet | W/S pitch · A/D roll · Q/E yaw · Shift throttle · Ctrl airbrake |
| **Xbox** | A robot · X car · Y jet · B jump / nitro / afterburner · L-stick move / steer / fly · R-stick turn / yaw · RT gas / throttle (robot: fire) · LT brake · RB fire · LB missile · View camera · Menu music |
| **Rift S** | A robot · X car · Y jet · B jump / nitro / afterburner · R-stick up missile · L-stick click: tap camera, hold recenter · both sticks music |
| robot | L-stick walk · R-stick snap turn · triggers fire each hand |
| car | grips hold the wheel, turn your hands to steer (or L-stick) · R-trigger gas · L-trigger brake · R-stick click fire |
| suit | A again as the robot · triggers fire the palm jets: palms back fly forward, palms down lift, ease off to hover · double-tap a trigger: boost from that hand · B boost · grips: repulsors from your palms |
| jet | R-grip holds the flight stick: tilt to pitch / roll, twist to yaw, trigger fires · L-grip holds the throttle, push forward |

## How it's put together

`index.html` loads `js/main.js`, which builds the world and runs the loop. The rest of `js/` is one
module per system:

| Module | What it does |
|---|---|
| `transformer.js` | every body part has a pose per form and swings between them; the player and all enemies share one instanced renderer |
| `vehicle.js` | how any body walks, drives or flies, whether the player or an enemy AI is at the controls |
| `input.js` | keyboard, an Xbox controller and the Touch controllers merged into one input |
| `world.js`, `terrain.js`, `city.js` | sky, sun and shadows, hills, roads, the airport and lake; the destructible city districts |
| `physics.js` | Rapier rigid bodies for everything that breaks loose: debris, props, wrecks |
| `collision.js` | gameplay collision: solid boxes filed by grid cell, plus the terrain |
| `props.js`, `batch.js` | street clutter and decor, drawn instanced until hit, then handed to the physics engine |
| `traffic.js` | civilian cars driving the street grid; hit one and it becomes a wreck |
| `enemies.js`, `weapons.js`, `powerups.js` | enemy waves (troopers, jets, heavies), projectiles and blasts, pick-ups |
| `fx.js`, `shaders.js`, `textures.js` | particles and flashes, shared GLSL, textures painted on canvases at load (nothing downloaded) |
| `hud.js` | the HUD: a screen overlay, or in VR a near glass panel for readouts and a far one for the marks on things in the world |
| `comfort.js` | headset comfort: the edge darkening, the blink that hides camera jumps, the red edge when hurt |
| `audio.js` | all sound, synthesised in the browser |
| `state.js`, `util.js` | shared game state and helpers |

For debugging, the page exposes `window.MIM = { G, st, frame }`: call `MIM.frame()` from the
console to step the game one frame at a time.

### Testing without a headset

Open http://localhost:8322/?emulate to fake a Rift S in the browser with Meta's
[Immersive Web Emulation Runtime](https://github.com/meta-quest/immersive-web-emulation-runtime)
(`js/dev/emulate.js`; normal play never loads it). It is silent unless the address also has `&sound`.
Drive it from the console through `window.MIM_XR`: `await MIM_XR.enter()`, `MIM_XR.press('left', 'x-button')`,
`MIM_XR.hold('right', 'trigger', 1)`, `MIM_XR.stick('left', 0, -1)`, `MIM_XR.head(pos, { yaw })`,
`MIM_XR.hand('right', pos, { pitch, roll })`.

## Author

Tim Barry · [portfolio](https://claude.ai/artifact/RwLFSsn1Jq3sxfSiUR4GAB)
