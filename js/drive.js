// Test-drive mode: a small race circuit, arcade car physics, chase / cockpit
// cameras, HUD with speed and lap times, keyboard + touch controls and an
// optional engine sound. main.js owns the scene; this module adds the track
// while driving and removes it again on exit.
import * as THREE from 'three';

const ROAD_W = 14;

/* ---------- deterministic random (same scenery every visit) ---------- */
function rng(seed) {
  return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
}

function canvasTex(w, h, draw, repeat = [1, 1]) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.anisotropy = 8;
  return t;
}

function noise(g, w, h, base, spread, n, rand) {
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  for (let i = 0; i < n; i++) {
    const v = Math.floor((rand() - 0.5) * spread);
    g.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${Math.abs(v) / 255})`;
    g.fillRect(rand() * w, rand() * h, 2, 2);
  }
}

/* ---------- the circuit ---------- */
function buildTrack() {
  const group = new THREE.Group();
  group.name = 'track';
  const rand = rng(7);

  const pts = [[0, 0], [150, 0], [225, -18], [255, -80], [235, -150], [172, -182], [104, -160], [62, -112],
    [2, -118], [-78, -178], [-160, -170], [-205, -110], [-192, -40], [-124, 8], [-60, 10]];
  const curve = new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'centripetal');
  const N = 900;
  const center = curve.getSpacedPoints(N).slice(0, N);
  const tangents = center.map((_, i) => center[(i + 1) % N].clone().sub(center[(i - 1 + N) % N]).normalize());
  const length = curve.getLength();

  // road ribbon
  const asphalt = canvasTex(256, 512, (g, w, h) => {
    noise(g, w, h, '#3a3c41', 60, 9000, rand);
    g.fillStyle = '#f2f2f2';
    g.fillRect(w * 0.035, 0, w * 0.025, h);           // edge lines
    g.fillRect(w * 0.94, 0, w * 0.025, h);
    g.fillRect(w * 0.49, 0, w * 0.02, h * 0.45);       // dashed centre line
  });
  asphalt.repeat.set(1, 1);
  const pos = [], uv = [], idx = [];
  let dist = 0;
  for (let i = 0; i <= N; i++) {
    const k = i % N, p = center[k], t = tangents[k];
    const nx = -t.z, nz = t.x;
    if (i > 0) dist += center[k].distanceTo(center[(i - 1) % N]);
    pos.push(p.x + nx * ROAD_W / 2, 0.02, p.z + nz * ROAD_W / 2, p.x - nx * ROAD_W / 2, 0.02, p.z - nz * ROAD_W / 2);
    uv.push(0, dist / 14, 1, dist / 14);
    if (i < N) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const roadGeo = new THREE.BufferGeometry();
  roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  roadGeo.setIndex(idx); roadGeo.computeVertexNormals();
  const road = new THREE.Mesh(roadGeo, new THREE.MeshStandardMaterial({ map: asphalt, roughness: 0.85, metalness: 0 }));
  road.receiveShadow = true;
  group.add(road);

  // kerbs on the outside of every bend
  const kerbTex = canvasTex(64, 64, (g) => { g.fillStyle = '#d42a2a'; g.fillRect(0, 0, 64, 32); g.fillStyle = '#f4f4f4'; g.fillRect(0, 32, 64, 32); });
  const kp = [], ku = [], ki = [];
  let kd = 0;
  for (let i = 0; i < N; i++) {
    const t0 = tangents[i], t1 = tangents[(i + 4) % N];
    const turn = t0.x * t1.z - t0.z * t1.x;
    if (Math.abs(turn) < 0.012) continue;
    const side = turn > 0 ? 1 : -1;
    const p = center[i], q = center[(i + 1) % N], tq = tangents[(i + 1) % N];
    const e = [[p, t0], [q, tq]].map(([c, t]) => {
      const nx = -t.z * side, nz = t.x * side;
      return [c.x + nx * ROAD_W / 2, c.z + nz * ROAD_W / 2, c.x + nx * (ROAD_W / 2 + 1.4), c.z + nz * (ROAD_W / 2 + 1.4)];
    });
    const b = kp.length / 3;
    kp.push(e[0][0], 0.04, e[0][1], e[0][2], 0.06, e[0][3], e[1][0], 0.04, e[1][1], e[1][2], 0.06, e[1][3]);
    const seg = p.distanceTo(q);
    ku.push(0, kd, 1, kd, 0, kd + seg / 3, 1, kd + seg / 3);
    kd += seg / 3;
    ki.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
  }
  const kerbGeo = new THREE.BufferGeometry();
  kerbGeo.setAttribute('position', new THREE.Float32BufferAttribute(kp, 3));
  kerbGeo.setAttribute('uv', new THREE.Float32BufferAttribute(ku, 2));
  kerbGeo.setIndex(ki); kerbGeo.computeVertexNormals();
  const kerbs = new THREE.Mesh(kerbGeo, new THREE.MeshStandardMaterial({ map: kerbTex, roughness: 0.6, side: THREE.DoubleSide }));
  kerbs.receiveShadow = true;
  group.add(kerbs);

  // grass
  const grass = canvasTex(256, 256, (g, w, h) => noise(g, w, h, '#4d7a3a', 70, 7000, rand), [260, 260]);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(2600, 2600), new THREE.MeshStandardMaterial({ map: grass, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  // start / finish line + gantry
  const t0 = tangents[0], c0 = center[0];
  const heading0 = Math.atan2(-t0.z, t0.x);
  const checker = canvasTex(32, 128, (g) => { for (let x = 0; x < 4; x++) for (let y = 0; y < 16; y++) { g.fillStyle = (x + y) % 2 ? '#111' : '#fff'; g.fillRect(x * 8, y * 8, 8, 8); } });
  const line = new THREE.Mesh(new THREE.PlaneGeometry(3, ROAD_W), new THREE.MeshStandardMaterial({ map: checker, roughness: 0.7 }));
  line.rotation.set(-Math.PI / 2, 0, heading0); line.position.set(c0.x, 0.03, c0.z);
  group.add(line);
  const gantry = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0x2a2d33, metalness: 0.6, roughness: 0.4 });
  const accent = new THREE.MeshStandardMaterial({ color: 0x4fb3ff, emissive: 0x1a5f99, emissiveIntensity: 0.6 });
  for (const s of [1, -1]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.6, 7, 0.6), steel); post.position.set(0, 3.5, s * (ROAD_W / 2 + 1.5)); post.castShadow = true; gantry.add(post); }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(1, 1.4, ROAD_W + 4), accent); beam.position.y = 7; beam.castShadow = true;
  gantry.add(beam);
  gantry.position.set(c0.x, 0, c0.z); gantry.rotation.y = heading0;
  group.add(gantry);

  // grandstand beside the start
  const stand = new THREE.Group();
  const conc = new THREE.MeshStandardMaterial({ color: 0x9a9ea6, roughness: 0.9 });
  const seats = new THREE.MeshStandardMaterial({ color: 0x2f6fb3, roughness: 0.7 });
  for (let r = 0; r < 6; r++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(60, 0.8, 1.6), r % 2 ? seats : conc);
    step.position.set(0, 0.4 + r * 0.8, -r * 1.6); step.castShadow = step.receiveShadow = true;
    stand.add(step);
  }
  const roof = new THREE.Mesh(new THREE.BoxGeometry(62, 0.4, 12), steel); roof.position.set(0, 8.5, -4); roof.castShadow = true;
  stand.add(roof);
  const nx0 = -t0.z, nz0 = t0.x;
  stand.position.set(c0.x + nx0 * (ROAD_W / 2 + 10) + t0.x * 20, 0, c0.z + nz0 * (ROAD_W / 2 + 10) + t0.z * 20);
  stand.rotation.y = heading0 + Math.PI;
  group.add(stand);

  // trees (instanced), kept clear of the track
  const near = (x, z, min) => { for (let i = 0; i < N; i += 6) { const p = center[i]; if ((p.x - x) ** 2 + (p.z - z) ** 2 < min * min) return true; } return false; };
  const spots = [];
  for (let tries = 0; spots.length < 420 && tries < 6000; tries++) {
    const x = (rand() - 0.5) * 900 + 25, z = (rand() - 0.5) * 700 - 85;
    if (!near(x, z, ROAD_W / 2 + 12)) spots.push([x, z, 0.7 + rand() * 0.8]);
  }
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.25, 0.35, 3, 6), new THREE.MeshStandardMaterial({ color: 0x5b3b22, roughness: 1 }), spots.length);
  const crown = new THREE.InstancedMesh(new THREE.ConeGeometry(2.2, 6, 8), new THREE.MeshStandardMaterial({ color: 0x2f5a2c, roughness: 0.9 }), spots.length);
  const m4 = new THREE.Matrix4();
  spots.forEach(([x, z, s], i) => {
    trunk.setMatrixAt(i, m4.compose(new THREE.Vector3(x, 1.5 * s, z), new THREE.Quaternion(), new THREE.Vector3(s, s, s)));
    crown.setMatrixAt(i, m4.compose(new THREE.Vector3(x, 5.5 * s, z), new THREE.Quaternion(), new THREE.Vector3(s, s, s)));
  });
  trunk.castShadow = crown.castShadow = true;
  group.add(trunk, crown);

  group.add(new THREE.HemisphereLight(0xcfe4ff, 0x4d7a3a, 0.9));

  return { group, center, tangents, N, length, start: { x: c0.x, z: c0.z, heading: heading0 } };
}

/* ---------- engine sound ---------- */
function makeEngine() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx();
  const a = ctx.createOscillator(), b = ctx.createOscillator();
  a.type = 'sawtooth'; b.type = 'square';
  const filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 700;
  const gain = ctx.createGain(); gain.gain.value = 0;
  a.connect(filt); b.connect(filt); filt.connect(gain); gain.connect(ctx.destination);
  a.start(); b.start();
  return {
    set(rpm, load, on) {
      const f = 28 + rpm * 70;
      a.frequency.setTargetAtTime(f, ctx.currentTime, 0.05);
      b.frequency.setTargetAtTime(f * 0.5, ctx.currentTime, 0.05);
      filt.frequency.setTargetAtTime(500 + load * 1400, ctx.currentTime, 0.08);
      gain.gain.setTargetAtTime(on ? 0.05 + load * 0.05 : 0, ctx.currentTime, 0.08);
    },
    close() { ctx.close(); },
  };
}

/* ---------- HUD & input ---------- */
const fmt = t => (t == null ? '—' : `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`);

function buildHud(stage) {
  const el = document.createElement('div');
  el.className = 'drive-hud';
  el.innerHTML = `
    <div class="dh-top">
      <div class="dh-lap"><small>წრე</small><b id="dhLap">0:00.00</b><small>საუკეთესო <span id="dhBest">—</span></small></div>
      <div class="dh-btns">
        <button id="dhCam" title="კამერა (C)">🎥</button>
        <button id="dhSound" title="ხმა">🔇</button>
        <button id="dhReset" title="ტრასაზე დაბრუნება (R)">↺</button>
        <button id="dhExit" title="გასვლა (Esc)">✕ გასვლა</button>
      </div>
    </div>
    <div class="dh-speed"><b id="dhSpd">0</b><small>კმ/სთ</small><i id="dhOff">ბალახი</i></div>
    <p class="dh-help">W/↑ გაზი · S/↓ მუხრუჭი · A D / ← → საჭე · Space ხელის მუხრუჭი · C კამერა · Esc გასვლა</p>
    <div class="dh-touch">
      <div><button data-k="left">◀</button><button data-k="right">▶</button></div>
      <div><button data-k="brake">⏸</button><button data-k="gas">▲</button></div>
    </div>`;
  stage.appendChild(el);
  return el;
}

/* ---------- public API ---------- */
export function createDrive({ scene, camera, controls, keyLight, hide, stage, onExit }) {
  let track = null, hud = null, car = null, engine = null;
  const keys = { gas: 0, brake: 0, left: 0, right: 0, hand: 0 };
  const st = { active: false, x: 0, z: 0, heading: 0, v: 0, steer: 0, idx: 0, lapStart: 0, best: null, armed: false, cam: 'chase', sound: false, time: 0, roll: 0, pitch: 0, spin: 0 };
  let perf, wheelbase;
  const savedFog = { fog: null, bg: null };

  const keyMap = { KeyW: 'gas', ArrowUp: 'gas', KeyS: 'brake', ArrowDown: 'brake', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', Space: 'hand' };
  const onKey = down => e => {
    if (!st.active) return;
    if (keyMap[e.code]) { keys[keyMap[e.code]] = down ? 1 : 0; e.preventDefault(); return; }
    if (!down) return;
    if (e.code === 'Escape') stop();
    else if (e.code === 'KeyC') toggleCam();
    else if (e.code === 'KeyR') placeAtStart(nearestIdx());
  };
  addEventListener('keydown', onKey(true));
  addEventListener('keyup', onKey(false));
  addEventListener('blur', () => Object.keys(keys).forEach(k => (keys[k] = 0)));

  function toggleCam() { st.cam = st.cam === 'chase' ? 'cockpit' : 'chase'; }

  function nearestIdx() {
    let best = st.idx, bd = Infinity;
    for (let d = -40; d <= 40; d++) {
      const i = (st.idx + d + track.N) % track.N, p = track.center[i];
      const dd = (p.x - st.x) ** 2 + (p.z - st.z) ** 2;
      if (dd < bd) { bd = dd; best = i; }
    }
    return { i: best, dist: Math.sqrt(bd) };
  }

  function placeAtStart(at = { i: 0 }) {
    const i = typeof at === 'object' ? at.i : at;
    const p = track.center[i], t = track.tangents[i];
    st.x = p.x; st.z = p.z; st.heading = Math.atan2(-t.z, t.x);
    st.v = 0; st.steer = 0; st.idx = i;
  }

  function start(theCar, model) {
    if (st.active) stop();
    car = theCar;
    perf = model.perf || { vmax: 200, t100: 9 };
    wheelbase = Math.abs(model.wheel.x[0] - model.wheel.x[1]);
    track = buildTrack();
    scene.add(track.group);
    hide.forEach(o => (o.visible = false));
    savedFog.fog = scene.fog; savedFog.bg = scene.background;
    scene.background = new THREE.Color(0xa9cbe8);
    scene.fog = new THREE.Fog(0xa9cbe8, 160, 900);
    controls.enabled = false;
    camera.fov = 62; camera.near = 0.05; camera.far = 1500; camera.updateProjectionMatrix();
    Object.assign(keyLight.shadow.camera, { left: -18, right: 18, top: 18, bottom: -18, near: 1, far: 60 });
    keyLight.shadow.camera.updateProjectionMatrix();
    scene.add(keyLight.target);

    hud = buildHud(stage);
    hud.querySelector('#dhExit').onclick = () => stop();
    hud.querySelector('#dhCam').onclick = toggleCam;
    hud.querySelector('#dhReset').onclick = () => placeAtStart(nearestIdx());
    hud.querySelector('#dhSound').onclick = e => {
      st.sound = !st.sound;
      if (st.sound && !engine) engine = makeEngine();
      e.currentTarget.textContent = st.sound ? '🔊' : '🔇';
    };
    hud.querySelectorAll('.dh-touch button').forEach(b => {
      const k = b.dataset.k;
      const on = e => { e.preventDefault(); keys[k] = 1; b.classList.add('on'); };
      const off = () => { keys[k] = 0; b.classList.remove('on'); };
      b.addEventListener('pointerdown', on);
      b.addEventListener('pointerup', off);
      b.addEventListener('pointerleave', off);
      b.addEventListener('pointercancel', off);
    });

    placeAtStart(0);
    st.lapStart = st.time; st.armed = false; st.cam = 'chase';
    st.active = true;
    document.body.classList.add('driving');
    // put the camera behind the car straight away
    update(0, true);
  }

  function stop() {
    if (!st.active) return;
    st.active = false;
    document.body.classList.remove('driving');
    Object.keys(keys).forEach(k => (keys[k] = 0));
    scene.remove(track.group);
    track.group.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
    });
    track = null;
    hud.remove(); hud = null;
    if (engine) { engine.close(); engine = null; }
    st.sound = false;
    hide.forEach(o => (o.visible = true));
    scene.fog = savedFog.fog; scene.background = savedFog.bg;
    Object.assign(keyLight.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 1, far: 20 });
    keyLight.shadow.camera.updateProjectionMatrix();
    keyLight.position.set(4, 8, 5); keyLight.target.position.set(0, 0, 0);
    camera.near = 0.02; camera.far = 100;
    controls.enabled = true;
    if (car) {
      car.root.position.set(0, 0, 0); car.root.rotation.set(0, 0, 0);
      car.body.rotation.set(0, 0, 0);
      (car.wheels || []).forEach(w => { w.obj.rotation.set(0, w.baseY, 0); });
    }
    onExit && onExit();
  }

  const fwd = new THREE.Vector3(), tmp = new THREE.Vector3(), look = new THREE.Vector3();

  function update(dt, snap = false) {
    if (!st.active) return;
    st.time += dt;
    const vmax = perf.vmax / 3.6;
    const a0 = (100 / 3.6) / perf.t100 * 1.25;
    const near = nearestIdx();
    const off = near.dist > ROAD_W / 2 + 1.2;

    // longitudinal
    const throttle = keys.gas, brake = keys.brake;
    if (throttle && st.v >= -0.5) st.v += a0 * Math.max(0, 1 - st.v / vmax) * dt;
    if (brake) {
      if (st.v > 0.5) st.v -= 11 * dt;
      else st.v = Math.max(st.v - 4 * dt, -8);            // reverse
    }
    if (keys.hand) st.v -= Math.sign(st.v) * Math.min(Math.abs(st.v), 9 * dt);
    if (!throttle && !brake) st.v -= Math.sign(st.v) * Math.min(Math.abs(st.v), (1.2 + 0.0012 * st.v * st.v) * dt);
    if (off) {
      st.v -= Math.sign(st.v) * Math.min(Math.abs(st.v), (4 + 0.02 * st.v * st.v) * dt);
      st.v = Math.min(st.v, 75 / 3.6);
    }

    // steering (less lock at speed, more with handbrake)
    const want = (keys.left - keys.right) * (0.55 / (1 + Math.abs(st.v) / 22)) * (keys.hand ? 1.6 : 1);
    st.steer += (want - st.steer) * (1 - Math.exp(-dt * 8));
    const yaw = st.v / wheelbase * Math.tan(st.steer);
    st.heading += yaw * dt;
    fwd.set(Math.cos(st.heading), 0, -Math.sin(st.heading));
    st.x += fwd.x * st.v * dt; st.z += fwd.z * st.v * dt;

    // laps: crossing index 0 after passing the far side of the track
    const prev = st.idx;
    st.idx = near.i;
    if (st.idx > track.N * 0.4 && st.idx < track.N * 0.6) st.armed = true;
    if (prev > track.N * 0.9 && st.idx < track.N * 0.1) {      // crossed the line going forward
      if (st.armed) {
        const lap = st.time - st.lapStart;
        if (st.best == null || lap < st.best) st.best = lap;
      }
      st.lapStart = st.time; st.armed = false;
    }

    // car transform + cosmetic body roll / pitch
    car.root.position.set(st.x, 0, st.z);
    car.root.rotation.set(0, st.heading, 0);
    const lat = st.v * yaw, lon = throttle ? 1 : brake ? -1.6 : 0;
    st.roll += (THREE.MathUtils.clamp(-lat * 0.006, -0.06, 0.06) - st.roll) * (1 - Math.exp(-dt * 6));
    st.pitch += (lon * 0.012 - st.pitch) * (1 - Math.exp(-dt * 5));
    car.body.rotation.set(st.roll, 0, st.pitch);
    st.spin += st.v * dt / (car.model.wheel.r || 0.33);
    (car.wheels || []).forEach(w => {
      w.obj.rotation.set(0, w.baseY + (w.front ? st.steer : 0), -st.spin * w.s);
    });

    // shadows follow the car
    keyLight.position.set(st.x + 8, 16, st.z + 10);
    keyLight.target.position.set(st.x, 0, st.z);

    // camera
    if (st.cam === 'chase') {
      const back = car.size.x * 1.15 + 3.2, up = car.size.y + 1.25;
      tmp.set(st.x - fwd.x * back, up, st.z - fwd.z * back);
      if (snap) camera.position.copy(tmp);
      else camera.position.lerp(tmp, 1 - Math.exp(-dt * 5));
      look.set(st.x + fwd.x * 4, car.size.y * 0.6, st.z + fwd.z * 4);
      camera.lookAt(look);
    } else {
      const eye = car.driverEye.clone().add(car.body.position).applyEuler(car.root.rotation).add(car.root.position);
      camera.position.copy(eye);
      look.copy(eye).addScaledVector(fwd, 10); look.y -= 0.6;
      camera.lookAt(look);
    }

    // HUD + sound
    const kmh = Math.abs(st.v) * 3.6;
    hud.querySelector('#dhSpd').textContent = Math.round(kmh);
    hud.querySelector('#dhLap').textContent = fmt(st.time - st.lapStart);
    hud.querySelector('#dhBest').textContent = fmt(st.best);
    hud.querySelector('#dhOff').style.opacity = off ? 1 : 0;
    if (engine) {
      const gearSpan = vmax / 5;
      const rpm = 0.9 + ((Math.abs(st.v) % gearSpan) / gearSpan) * 4 + (Math.abs(st.v) / vmax) * 1.5;
      engine.set(rpm, throttle ? 1 : 0.2, st.sound);
    }
  }

  return { start, stop, update, get active() { return st.active; } };
}
