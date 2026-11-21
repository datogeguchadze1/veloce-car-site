# CLAUDE.md

Guidance for Claude when working in this repository.

## Project
VELOCE Garage: a 3D car catalog with a test-drive mode, in Georgian, plus a C# backend
(`backend/`: ASP.NET Core 10 Web API + EF Core + Microsoft SQL Server) for accounts, the global
leaderboard, "My garage" and the admin panel. The front end works without the backend.
- Plain ES modules, no build step, no package.json. Three.js r187 is vendored in `vendor/three/`
  (importmap: `three`, `three/addons/` → `vendor/three/jsm/`). Add any extra addon you need by
  copying it from the same Three.js release into `vendor/three/jsm/`.
- Hosted on GitHub Pages from `main`: https://datogeguchadze1.github.io/veloce-car-site/ (static only).
  Vercel: two projects from this repo — the static site (repo root, `vercel.json` rewrites `/api/*` to the API
  project; the destination is a `.invalid` placeholder until the owner fills it in) and the API (Root Directory
  `backend`, built from `backend/Dockerfile` with the Container runtime; listens on `PORT`). Models are too big
  for function responses (4.5 MB), so never serve the site from the container.
- Secrets (connection string, `Jwt:Key`) never go into the repository (it is public): User Secrets
  locally, environment variables (`ConnectionStrings__Veloce`, `Jwt__Key`, `Admin__Emails__0`) on the host.

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
| `js/api.js` | API client: `api.init()` probes `/api/health` (skipped on github.io), JWT in `localStorage` (`veloce-token`), `api.get/post/put/del` throw `Error` with the server's Georgian `error` text |
| `js/account.js` | `createAccount(ctx)`: header menu + sign-in modal, garage tab (`#tab-garage`), favourites, leaderboard (`#acctInfo`), tuning save (`#acctTune`), `submitResult()` (sends only personal bests), `worldBest()`, `catalog()` |
| `admin.html`, `js/admin.js` | admin panel (cars / users / records); seeds `Cars` from `MODELS` |
| `backend/Veloce.Api/` | `Program.cs` (DI, JWT, rate limit, CORS, Swagger, serves the repo root as the site in Development, migrates on start), `Controllers/` (Auth, Records, Garage, Cars, Admin, Health), `Models/`, `Dtos/`, `Services/` (`TokenService`, `GameRules`, `AdminOnlyAttribute`), `Migrations/` |
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

## Backend
- Build: `dotnet build backend/Veloce.sln` (SDK 10). Schema change: edit `Models/` + `VeloceDbContext`, then
  `dotnet ef migrations add <Name>` in `backend/Veloce.Api` (commit the migration).
- Hooks from the front end: `createDrive({ onResult, worldBest })` (`drive.js` calls `report({ lap })` per lap and
  `report({ drift })` per drift); `main.js` `applyCatalog()` lays `/api/cars` over `MODELS` and drops hidden cars.
- `/api/health` returns `db:false` with `error` + Georgian `hint` in Development (`DbHints` in `HealthController.cs`);
  the front end then shows "⚠ ბაზა არ არის დაკავშირებული" with that text. Migration runs in the background after start.
- Records: one row per (user, car, track) with the best `LapMs` and `Drift`; tracks are listed in `GameRules.Tracks`
  (keep in sync with `TRACKS` in `drive.js`).
- Local test DB: `docker run -d --name mssql -e ACCEPT_EULA=Y -e MSSQL_SA_PASSWORD=<pw> -p 1433:1433 mcr.microsoft.com/mssql/server:2022-latest`
  (start `dockerd` first in the cloud sandbox), run the API with `ConnectionStrings__Veloce=...` and `Admin__Emails__0=boss@test.ge`,
  then `node backend/tests/api-smoke.mjs` (cleans up after itself; login is rate-limited, wait a minute between runs).

## Testing (there is no front-end test suite: test in a real browser)
- Serve: `python3 -m http.server 8765` from the repo root (static, no accounts), or run the API
  (`dotnet run` in `backend/Veloce.Api`): it serves the site at `http://localhost:5080` with `/api`.
- Drive Chromium with Playwright (`require('playwright')`, `chromium.launch()` needs no options). Load
  `http://localhost:8765/#<car id>`, wait for `window.__garage.state.car` and `#loading.off`.
- Test-drive hooks: `window.__garage.drive.debug` gives `st` (state), `keys` (inputs: `gas`, `brake`, `left`, `right`, `hand`),
  `track`, `env`, `setEnv`, `rp` / `rec` / `startReplay` / `stopReplay`. Call `drive.update(1/60)` in a loop for a
  deterministic automated lap (steer towards `track.center[(st.idx + 14) % N]`, target speed from the bend ahead).
- Before merging, check:
  - an automated lap completes without barrier hits;
  - backend changes: `dotnet build` is clean and `node backend/tests/api-smoke.mjs` passes against a real SQL Server;
  - screenshots of the changed views look right (outside, cockpit, all three tracks, day / night);
  - no `pageerror` / console errors;
  - the phone layout (`devices['iPhone 13']`: the stage is rotated to landscape with the `forced-landscape` class).
- New car: regenerate thumbnails with `?thumbs` (`window.__garage.thumbs` holds data URLs), commit only the new
  `thumbs/<id>.jpg` and add the model to `CREDITS.md` (table row + "This work is based on …" line).
