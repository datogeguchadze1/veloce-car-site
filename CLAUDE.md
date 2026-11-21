# CLAUDE.md

Guidance for Claude when working in this repository.

## Project
VELOCE Garage: a static 3D car catalog with a test-drive mode, in Georgian.
- Plain ES modules, no build step, no package.json. Three.js r187 is vendored in `vendor/three/`
  (importmap: `three`, `three/addons/` → `vendor/three/jsm/`). Add any extra addon you need by
  copying it from the same Three.js release into `vendor/three/jsm/`.
- Hosted on GitHub Pages from `main`: https://datogeguchadze1.github.io/veloce-car-site/

## Working rules (from the owner)
- **Push every finished change without asking:** commit → push to the working branch → open a PR →
  merge it into `main`. Only tested work goes to `main`.
- The owner writes in Georgian: reply in Georgian, and keep all user-facing text (UI, README,
  model descriptions) in Georgian. Code comments and commit messages are in English.
- Models come from Sketchfab (downloadable, CC BY / CC0). The owner downloads them and uploads the
  ZIP / GLB / USDZ to the repository root; move them into `models/<id>/` (compressed) and delete
  the uploaded originals.

## Map of the code
| File | What lives there |
|---|---|
| `js/main.js` | scene, lights, catalog UI, info / tuning panels, render loop (calls `drive.update(dt)` and `drive.afterRender(renderer)`), `window.__garage` debug object |
| `js/models.js` | `MODELS`: catalog data (`perf: { vmax, t100, drive }`, `specs`, `dims`, `wheel: { r, x: [front, rear] }`) and the `glb` loader config per car |
| `js/glbCar.js` | `loadGlbCar(model)`: loads, orients, scales and grounds the model; doors / hood / trunk; steering wheel pivot; gauge needles; road-wheel rigs (steer + roll); tuning; returns `car` (`root`, `body`, `driverEye`, `size`, `setSteer`, `setWheels`, `setGauges`, `wheelGrip`, …) |
| `js/cabinKit.js` | code-built cabins (`CABINS['300sl']`, `CABINS['930']`, `CABINS.r8`) and AMG GT dials, from a small kit (`seat`, `dial`, `wheel`, `profile`, …) |
| `js/drive.js` | test drive: `TRACKS` + `buildTrack()`, two-axle tyre physics, drift assist, gearbox, HUD, keyboard / touch / tilt input, records + ghost, replay recorder and cameras, night / rain |
| `js/scenery.js` | sky dome, clouds, horizon ring, asphalt / grass textures, per-track details (pit building, fences, crossings, traffic lights, chevrons, rocks) |
| `js/driver.js` | code-built driver: helmet, IK arms whose hands follow the steering wheel rim |
| `js/mirrors.js` | cockpit mirrors: render targets drawn over the screen after the main render |
| `js/engineSound.js` | synthesised engine / squeal / thud / pop / rain sounds (Web Audio) |
| `tools/` | `inspect-glb.mjs` (node tree / materials), `optimize_gltf.py` (quantise + shrink textures), `glb2gltf.py` (unpack .glb, dedupe images) |

### `glb` config options (see `js/glbCar.js`)
`file`, `rotY`, `scale`, `remove` (node patterns), `hideMaterials`, `fit` (materials that define size / centre),
`ground` (materials that define the floor, e.g. tyres), `mirror: { hide, source }` (replace a part with a mirror image),
`strip: [{ material, box, triangles? }]` (cut placeholder geometry; `triangles: true` cuts welded geometry),
`split`, `cabin` (a `CABINS` recipe), `doors` / `hood` / `trunk` (patterns; arrays group nodes), `doorHinge`, `gullwing`,
`steer` (node patterns) or `steerBox` (box in car coordinates; otherwise the wheel is auto-detected),
`gauges: { speedo, tacho: { node, max, sweep, zero, dir } }`, `eye: [x, y, z]`, `paint`, `glass`, `rimMaterials`,
`interior`, `lights`, `defaults` (starting tuning), `noWheels`, `credit`.

## Conventions and pitfalls
- **Car coordinates:** x forward, y up, z towards the passenger side; the driver sits at −z (left-hand drive).
  The AE86 is right-hand drive (eye z > 0). Road-wheel steer angle: + = left.
- **Split meshes share the full vertex buffer:** `Box3.setFromObject` then covers the whole car. Measure parts from
  the vertices their index uses (`samplePoints()` in `glbCar.js`) and call `updateMatrixWorld()` on newly added parts.
- `drive.update(0, true)` runs on start: guard divisions by `dt`.
- `drive.js` is large: check for name clashes before adding helpers (`record` is already the best-lap record).
- Road strips are layered with `polygonOffset` (road −2, run-off −1, kerbs −3, marks −4): keep new ground decals in that scheme.
- Phones matter: prefer `InstancedMesh` and merged geometry, low-res render targets, no per-frame allocations in hot loops.
- Records live in `localStorage` (`veloce-records`): key `<car id>` for the circuit, `<car id>@<track>` for the others.

## Testing (there is no test suite: test in a real browser)
- Serve: `python3 -m http.server 8765` from the repo root.
- Drive Chromium with Playwright (`require('playwright')`, `chromium.launch()` needs no options). Load
  `http://localhost:8765/#<car id>`, wait for `window.__garage.state.car` and `#loading.off`.
- Test-drive hooks: `window.__garage.drive.debug` gives `st` (state), `keys` (inputs: `gas`, `brake`, `left`, `right`, `hand`),
  `track`, `env`, `setEnv`, `rp` / `rec` / `startReplay` / `stopReplay`. Call `drive.update(1/60)` in a loop for a
  deterministic automated lap (steer towards `track.center[(st.idx + 14) % N]`, target speed from the bend ahead).
- Before merging, check:
  - an automated lap completes without barrier hits;
  - screenshots of the changed views look right (outside, cockpit, all three tracks, day / night);
  - no `pageerror` / console errors;
  - the phone layout (`devices['iPhone 13']`: the stage is rotated to landscape with the `forced-landscape` class).
- New car: regenerate thumbnails with `?thumbs` (`window.__garage.thumbs` holds data URLs), commit only the new
  `thumbs/<id>.jpg` and add the model to `CREDITS.md` (table row + "This work is based on …" line).
