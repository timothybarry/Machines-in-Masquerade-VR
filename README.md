# Machines in Masquerade VR

A WebXR game where you are a transforming robot in a city you can wreck. Your one body switches
between a robot, a supercar and a fighter jet, and keeps its speed and heading through each change.
Hold off waves of hostile machines while walls hole, buildings collapse and cars go flying.

Built with [three.js](https://threejs.org/) 0.170 and [Rapier](https://rapier.rs/) physics, both
loaded from a CDN through the page's import map, so there is nothing to install or build.

**Status:** prototype. It plays on desktop with a keyboard or an Xbox controller; the Oculus Rift S
controls are written but not yet tested in a headset.

## Run it

You need Python 3 and a WebXR browser (Edge or Chrome). WebXR only works on pages served from
localhost, so the game comes with a tiny no-cache server.

- **Windows:** double-click `Play in VR.bat`. It starts the server and opens Edge at
  http://localhost:8322/.
- **Anywhere:** run `python serve.py 8322` in this folder, then open http://localhost:8322/.

For the Rift S, make the Meta Quest Link PC app the active OpenXR runtime, then press **ENTER VR**.

## Controls

| | |
|---|---|
| **Keyboard** | 1 robot · 2 car · 3 jet · Space jump / nitro / afterburner · F fire · G missile · C camera · M music · H help |
| robot | WASD + arrows |
| car | W gas · S brake · A/D steer |
| jet | W/S pitch · A/D roll · Q/E yaw · Shift throttle · Ctrl airbrake |
| **Xbox** | A robot · X car · Y jet · B jump / nitro / afterburner · L-stick move / steer / fly · R-stick turn / yaw · RT gas / throttle (robot: fire) · LT brake · RB fire · LB missile · View camera · Menu music |
| **Rift S** | A robot · X car · Y jet · B jump / nitro / afterburner · R-stick up missile · L-stick click: tap camera, hold recenter · both sticks music |
| robot | L-stick walk · R-stick snap turn · triggers fire each hand |
| car | grips hold the wheel, turn your hands to steer (or L-stick) · R-trigger gas · L-trigger brake · R-stick click fire |
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
| `hud.js`, `audio.js` | one HUD drawn as a screen overlay or a VR glass panel; all sound synthesised in the browser |
| `state.js`, `util.js` | shared game state and helpers |

For debugging, the page exposes `window.MIM = { G, st, frame }`: call `MIM.frame()` from the
console to step the game one frame at a time.

## Author

Tim Barry · [portfolio](https://claude.ai/artifact/RwLFSsn1Jq3sxfSiUR4GAB)
