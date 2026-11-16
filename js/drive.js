// Test-drive mode: a small race circuit, arcade car physics, chase / cockpit
// cameras, HUD with speed and lap times, keyboard + touch controls and an
// optional engine sound. main.js owns the scene; this module adds the track
// while driving and removes it again on exit.
import * as THREE from 'three';
import { createEngineSound, engineSpec } from './engineSound.js';

const ROAD_W = 14;
const WALL = ROAD_W / 2 + 6;      // concrete barriers this far from the centre line

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
    pos.push(p.x + nx * ROAD_W / 2, 0.04, p.z + nz * ROAD_W / 2, p.x - nx * ROAD_W / 2, 0.04, p.z - nz * ROAD_W / 2);
    uv.push(0, dist / 14, 1, dist / 14);
    if (i < N) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const roadGeo = new THREE.BufferGeometry();
  roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  roadGeo.setIndex(idx); roadGeo.computeVertexNormals();
  const road = new THREE.Mesh(roadGeo, new THREE.MeshStandardMaterial({ map: asphalt, roughness: 0.85, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  road.receiveShadow = true;
  group.add(road);

  // run-off: plain asphalt from the road edge to the barriers (no white lines)
  const runTex = canvasTex(128, 128, (g, w, h) => noise(g, w, h, '#2f3136', 50, 4000, rand), [1, 1]);
  const rp = [], ru = [], ri = [];
  let rd = 0;
  for (let i = 0; i <= N; i++) {
    const k = i % N, p = center[k], t = tangents[k];
    const nx = -t.z, nz = t.x;
    if (i > 0) rd += center[k].distanceTo(center[(i - 1) % N]);
    for (const [o, u] of [[WALL + 0.3, 0], [-(WALL + 0.3), 1]]) rp.push(p.x + nx * o, 0.02, p.z + nz * o), ru.push(u * 4, rd / 14);
    if (i < N) { const a = i * 2; ri.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const runGeo = new THREE.BufferGeometry();
  runGeo.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
  runGeo.setAttribute('uv', new THREE.Float32BufferAttribute(ru, 2));
  runGeo.setIndex(ri); runGeo.computeVertexNormals();
  const runoff = new THREE.Mesh(runGeo, new THREE.MeshStandardMaterial({ map: runTex, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  runoff.receiveShadow = true;
  group.add(runoff);

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
    kp.push(e[0][0], 0.06, e[0][1], e[0][2], 0.08, e[0][3], e[1][0], 0.06, e[1][1], e[1][2], 0.08, e[1][3]);
    const seg = p.distanceTo(q);
    ku.push(0, kd, 1, kd, 0, kd + seg / 3, 1, kd + seg / 3);
    kd += seg / 3;
    ki.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
  }
  const kerbGeo = new THREE.BufferGeometry();
  kerbGeo.setAttribute('position', new THREE.Float32BufferAttribute(kp, 3));
  kerbGeo.setAttribute('uv', new THREE.Float32BufferAttribute(ku, 2));
  kerbGeo.setIndex(ki); kerbGeo.computeVertexNormals();
  const kerbs = new THREE.Mesh(kerbGeo, new THREE.MeshStandardMaterial({ map: kerbTex, roughness: 0.6, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
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
  const line = new THREE.Mesh(new THREE.PlaneGeometry(3, ROAD_W), new THREE.MeshStandardMaterial({ map: checker, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
  line.rotation.set(-Math.PI / 2, 0, heading0); line.position.set(c0.x, 0.06, c0.z);
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
  stand.position.set(c0.x + nx0 * (WALL + 6) + t0.x * 20, 0, c0.z + nz0 * (WALL + 6) + t0.z * 20);
  stand.rotation.y = heading0 + Math.PI;
  group.add(stand);

  // trees (instanced), kept clear of the track
  const near = (x, z, min) => { for (let i = 0; i < N; i += 6) { const p = center[i]; if ((p.x - x) ** 2 + (p.z - z) ** 2 < min * min) return true; } return false; };
  const spots = [];
  for (let tries = 0; spots.length < 420 && tries < 6000; tries++) {
    const x = (rand() - 0.5) * 900 + 25, z = (rand() - 0.5) * 700 - 85;
    if (!near(x, z, WALL + 6)) spots.push([x, z, 0.7 + rand() * 0.8]);
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

  const hemi = new THREE.HemisphereLight(0xcfe4ff, 0x4d7a3a, 0.9);
  group.add(hemi);

  // street lamps for night driving: poles, glowing heads and pools of light on the road
  const lamps = new THREE.Group(); lamps.visible = false; group.add(lamps);
  const lampSpots = [];
  for (let i = 0, s = 1; i < N; i += 24, s = -s) {
    const c = center[i], t = tangents[i];
    lampSpots.push({ x: c.x - t.z * s * (WALL - 0.6), z: c.z + t.x * s * (WALL - 0.6), lx: c.x - t.z * s * (WALL - 4), lz: c.z + t.x * s * (WALL - 4) });
  }
  const poleM = new THREE.MeshStandardMaterial({ color: 0x3a3d42, metalness: 0.6, roughness: 0.5 });
  const headM = new THREE.MeshBasicMaterial({ color: 0xfff1c8 });
  const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.12, 8, 8), poleM, lampSpots.length);
  const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(1.1, 0.18, 0.45), headM, lampSpots.length);
  const poolTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,226,170,0.85)'); gr.addColorStop(1, 'rgba(255,226,170,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(14, 14).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 }), lampSpots.length);
  const lm4 = new THREE.Matrix4(), q = new THREE.Quaternion();
  lampSpots.forEach((p, i) => {
    poles.setMatrixAt(i, lm4.compose(new THREE.Vector3(p.x, 4, p.z), q, new THREE.Vector3(1, 1, 1)));
    const yaw = Math.atan2(p.lx - p.x, p.lz - p.z);
    heads.setMatrixAt(i, lm4.compose(new THREE.Vector3((p.x + p.lx) / 2, 7.95, (p.z + p.lz) / 2), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw + Math.PI / 2), new THREE.Vector3(3, 1, 1)));
    pools.setMatrixAt(i, lm4.compose(new THREE.Vector3(p.lx, 0.09, p.lz), q, new THREE.Vector3(1, 1, 1)));
  });
  lamps.add(poles, heads, pools);

  // concrete barriers with red / white blocks on both sides
  const wallTex = canvasTex(128, 16, (g) => { g.fillStyle = '#d42a2a'; g.fillRect(0, 0, 64, 16); g.fillStyle = '#eeeeee'; g.fillRect(64, 0, 64, 16); });
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.8, side: THREE.DoubleSide });
  for (const side of [1, -1]) {
    const wp = [], wu = [], wi = [];
    let wd = 0;
    for (let i = 0; i <= N; i++) {
      const k = i % N, c = center[k], t = tangents[k];
      const nx = -t.z * side, nz = t.x * side;
      const x0 = c.x + nx * WALL, z0 = c.z + nz * WALL, x1 = c.x + nx * (WALL + 0.6), z1 = c.z + nz * (WALL + 0.6);
      if (i > 0) wd += c.distanceTo(center[(i - 1) % N]);
      // inner face (2 verts) + top (2 verts)
      wp.push(x0, 0, z0, x0, 0.95, z0, x1, 0.95, z1, x1, 0.95, z1);
      const u = wd / 6;
      wu.push(u, 0, u, 1, u, 1, u, 1);
      if (i < N) {
        const a = i * 4, b = a + 4;
        wi.push(a, b, a + 1, a + 1, b, b + 1);          // face
        wi.push(a + 1, b + 1, a + 2, a + 2, b + 1, b + 2); // top
      }
    }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3));
    wg.setAttribute('uv', new THREE.Float32BufferAttribute(wu, 2));
    wg.setIndex(wi); wg.computeVertexNormals();
    const wall = new THREE.Mesh(wg, wallMat);
    wall.castShadow = true; wall.receiveShadow = true;
    group.add(wall);
  }

  return { group, center, tangents, N, length, start: { x: c0.x, z: c0.z, heading: heading0 }, road, runoff, hemi, lamps };
}

/* ---------- skid marks & tyre smoke ---------- */
function makeSkids(group) {
  const MAX = 1600;                                   // quads in the ring buffer
  const pos = new Float32Array(MAX * 4 * 3), idx = [];
  for (let q = 0; q < MAX; q++) { const a = q * 4; idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setIndex(idx);
  const mat = new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  group.add(mesh);
  let next = 0, used = 0;
  const last = new Map();
  return {
    // id: which tyre; (x, z) its contact point; (dx, dz) its across direction; on: leaving a mark
    mark(id, x, z, dx, dz, on) {
      const prev = last.get(id);
      if (on && prev) {
        const w = 0.14, a = next * 12;
        const v = [prev.x - dx * w, 0.07, prev.z - dz * w, prev.x + dx * w, 0.07, prev.z + dz * w,
          x - dx * w, 0.07, z - dz * w, x + dx * w, 0.07, z + dz * w];
        pos.set(v, a);
        next = (next + 1) % MAX; used = Math.min(MAX, used + 1);
        geo.attributes.position.needsUpdate = true;
        geo.setDrawRange(0, used * 6);
      }
      last.set(id, on ? { x, z } : null);
    },
  };
}

function makeSmoke(group) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(235,235,235,0.9)'); gr.addColorStop(1, 'rgba(235,235,235,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  const pool = [];
  for (let i = 0; i < 70; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 }));
    s.visible = false; group.add(s); pool.push({ s, life: 0, max: 1 });
  }
  let k = 0;
  return {
    puff(x, z, strength) {
      const p = pool[k = (k + 1) % pool.length];
      p.s.position.set(x + (Math.random() - 0.5) * 0.3, 0.35, z + (Math.random() - 0.5) * 0.3);
      p.life = 0; p.max = 0.9 + strength * 0.8; p.s.visible = true;
    },
    update(dt) {
      for (const p of pool) {
        if (!p.s.visible) continue;
        p.life += dt;
        const f = p.life / p.max;
        if (f >= 1) { p.s.visible = false; continue; }
        p.s.position.y += dt * 0.7;
        p.s.scale.setScalar(0.8 + f * 3.2);
        p.s.material.opacity = 0.45 * (1 - f);
      }
    },
  };
}

function makeFlames(group) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,220,1)'); gr.addColorStop(0.35, 'rgba(255,170,40,0.9)'); gr.addColorStop(1, 'rgba(255,60,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  const pool = [];
  for (let i = 0; i < 16; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    s.visible = false; group.add(s); pool.push({ s, life: 0 });
  }
  let k = 0;
  return {
    burst(x, y, z, dx, dz) {
      for (let i = 0; i < 2; i++) {
        const p = pool[k = (k + 1) % pool.length];
        p.s.position.set(x - dx * (0.1 + i * 0.15), y, z - dz * (0.1 + i * 0.15));
        p.life = 0; p.s.visible = true; p.s.scale.setScalar(0.35 - i * 0.1);
      }
    },
    update(dt) {
      for (const p of pool) {
        if (!p.s.visible) continue;
        p.life += dt;
        if (p.life > 0.12) { p.s.visible = false; continue; }
        p.s.material.opacity = 1 - p.life / 0.12;
      }
    },
  };
}

function makeRain(group) {
  const COUNT = 2600, R = 26, H = 16;
  const pos = new Float32Array(COUNT * 6), drops = [];
  for (let i = 0; i < COUNT; i++) drops.push({ x: (Math.random() - 0.5) * 2 * R, y: Math.random() * H, z: (Math.random() - 0.5) * 2 * R });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xc8d6e6, transparent: true, opacity: 0.45, depthWrite: false }));
  lines.frustumCulled = false; lines.visible = false;
  group.add(lines);
  return {
    get visible() { return lines.visible; },
    set visible(v) { lines.visible = v; },
    update(dt, cam, vx, vz) {
      if (!lines.visible) return;
      for (let i = 0; i < COUNT; i++) {
        const d = drops[i];
        d.y -= 22 * dt; d.x -= vx * dt * 0.15; d.z -= vz * dt * 0.15;
        if (d.y < 0) { d.y += H; d.x = (Math.random() - 0.5) * 2 * R; d.z = (Math.random() - 0.5) * 2 * R; }
        if (d.x > R) d.x -= 2 * R; else if (d.x < -R) d.x += 2 * R;
        if (d.z > R) d.z -= 2 * R; else if (d.z < -R) d.z += 2 * R;
        const x = cam.x + d.x, y = d.y, z = cam.z + d.z, o = i * 6;
        pos[o] = x; pos[o + 1] = y; pos[o + 2] = z;
        pos[o + 3] = x + vx * 0.012; pos[o + 4] = y + 0.55; pos[o + 5] = z + vz * 0.012;
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}

/* ---------- records & ghost car ---------- */
const REC_KEY = 'veloce-records';
export function loadRecords() {
  try { return JSON.parse(localStorage.getItem(REC_KEY)) || {}; } catch { return {}; }
}
function saveRecord(id, patch) {
  const all = loadRecords();
  all[id] = { ...(all[id] || {}), ...patch };
  try { localStorage.setItem(REC_KEY, JSON.stringify(all)); } catch { /* full or private mode */ }
}

// A see-through copy of the car that replays the best lap.
function makeGhost(car) {
  const g = car.root.clone(true);
  const mat = new THREE.MeshBasicMaterial({ color: 0x7fd0ff, transparent: true, opacity: 0.28, depthWrite: false });
  g.traverse(o => { if (o.isMesh) { o.material = mat; o.castShadow = false; o.receiveShadow = false; } if (o.isLight) o.visible = false; });
  g.visible = false;
  return g;
}

/* ---------- HUD & input ---------- */
const fmt = t => (t == null ? '—' : `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`);

function buildHud(stage) {
  const el = document.createElement('div');
  el.className = 'drive-hud';
  el.innerHTML = `
    <div class="dh-top">
      <div class="dh-lap"><small>წრე</small><b id="dhLap">0:00.00</b><small>საუკეთესო <span id="dhBest">—</span></small><small>დრიფტის ქულა <span id="dhScore">0</span> · რეკორდი <span id="dhDriftBest">0</span></small></div>
      <div class="dh-btns">
        <button id="dhTilt" class="touch-only" title="დახრით მართვა">📱</button>
        <button id="dhMode" title="გადაცემათა კოლოფი: ავტომატი / მექანიკა (M)">A</button>
        <button id="dhGhost" title="მოჩვენება: საუკეთესო წრე (G)">👻</button>
        <button id="dhNight" title="დღე / ღამე (N)">🌙</button>
        <button id="dhRain" title="მშრალი / წვიმა (B)">🌧</button>
        <button id="dhCam" title="კამერა (C)">🎥</button>
        <button id="dhSound" title="ხმა">🔊</button>
        <button id="dhReset" title="ტრასაზე დაბრუნება (R)">↺</button>
        <button id="dhExit" title="გასვლა (Esc)">✕ გასვლა</button>
      </div>
    </div>
    <div class="dh-speedfx" id="dhFx"></div>
    <div class="dh-delta" id="dhDelta"></div>
    <div class="dh-input"><span>გაზი<i><b id="dhInGas"></b></i></span><span>მუხრუჭი<i><b id="dhInBrake"></b></i></span><em id="dhInHand">ხელის<br>მუხრუჭი</em></div>
    <div class="dh-drift" id="dhDrift"><b id="dhDriftPts">0</b><small id="dhDriftLbl">დრიფტი</small></div>
    <div class="dh-speed">
      <div class="dh-rpm"><i id="dhRpm"></i></div>
      <span class="dh-gear" id="dhGear">1</span><b id="dhSpd">0</b><small>კმ/სთ</small><i id="dhOff">ბალახი</i>
    </div>
    <p class="dh-help">W/↑ გაზი · S/↓ მუხრუჭი · A D / ← → საჭე · Space ხელის მუხრუჭი (დრიფტი) · M მექანიკა (E ▲ / Q ▼) · C კამერა · G მოჩვენება · N ღამე · B წვიმა · R ტრასაზე · Esc გასვლა</p>
    <div class="dh-touch">
      <div class="dh-steer"><button data-k="left" aria-label="მარცხნივ">◀</button><button data-k="right" aria-label="მარჯვნივ">▶</button></div>
      <div class="dh-shift"><button data-shift="1">＋</button><button data-shift="-1">－</button></div>
      <div class="dh-feet">
        <button class="dh-hb" data-k="hand" aria-label="ხელის მუხრუჭი"><span class="dh-hb-lever"><i></i></span><small>ხელის მუხრუჭი</small></button>
        <div class="pedal brake" data-pedal="brake" role="button" aria-label="მუხრუჭი"><span class="pad"></span><small>მუხრუჭი</small></div>
        <div class="pedal gas" data-pedal="gas" role="button" aria-label="გაზი"><span class="pad"></span><small>გაზი</small></div>
      </div>
    </div>`;
  stage.appendChild(el);
  return el;
}

/* ---------- public API ---------- */
export function createDrive({ scene, camera, controls, keyLight, hide, stage, onExit }) {
  let track = null, hud = null, car = null, engine = null;
  const keys = { gas: 0, brake: 0, left: 0, right: 0, hand: 0 };   // gas / brake are 0 … 1 (analog pedals)
  const isTouch = matchMedia('(pointer: coarse)').matches;
  const buzz = ms => { if (isTouch && navigator.vibrate) { try { navigator.vibrate(ms); } catch { /* not allowed */ } } };
  // tilt steering: angle of gravity in the screen plane, relative to when it was switched on
  const tilt = { on: false, base: null, raw: 0, value: 0 };
  const onMotion = e => {
    const g = e.accelerationIncludingGravity;
    if (!g || g.x == null) return;
    const ang = Math.atan2(g.x, g.y);
    if (tilt.base === null) tilt.base = ang;
    let d = ang - tilt.base; d = Math.atan2(Math.sin(d), Math.cos(d));
    const deg = d * 180 / Math.PI, dead = 2, full = 25;
    tilt.raw = Math.max(-1, Math.min(1, Math.sign(deg) * Math.max(0, Math.abs(deg) - dead) / (full - dead)));
  };
  async function setTilt(on) {
    if (on && typeof DeviceMotionEvent !== 'undefined' && DeviceMotionEvent.requestPermission) {
      try { if (await DeviceMotionEvent.requestPermission() !== 'granted') on = false; } catch { on = false; }
    }
    tilt.on = on; tilt.base = null; tilt.raw = 0;
    if (on) addEventListener('devicemotion', onMotion); else removeEventListener('devicemotion', onMotion);
    try { localStorage.setItem('veloce-tilt', on ? '1' : '0'); } catch { /* private mode */ }
    if (hud) { hud.classList.toggle('tilt', on); hud.querySelector('#dhTilt').classList.toggle('on', on); }
  }

  // phones: full screen + landscape; where the browser cannot rotate, the stage is turned with CSS
  const applyOrientation = () => {
    const force = st.active && isTouch && innerHeight > innerWidth;
    document.body.classList.toggle('forced-landscape', force);
  };
  addEventListener('resize', applyOrientation);
  document.addEventListener('fullscreenchange', applyOrientation);
  addEventListener('orientationchange', () => setTimeout(applyOrientation, 200));
  async function goLandscape() {
    if (!isTouch) return;
    try { if (!document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); } catch { /* not allowed */ }
    try { if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape'); } catch { /* not supported (iPhone) */ }
    applyOrientation();
  }
  function leaveLandscape() {
    try { if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); } catch { /* ignore */ }
    try { if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen(); } catch { /* ignore */ }
    document.body.classList.remove('forced-landscape');
  }
  const st = { popT: 0, handWas: 0, fxK: 0, manual: false, vl: 0, yaw: 0, shake: 0, drift: 0, driftIdle: 0, score: 0, driftBest: 0, smokeT: 0, gear: 1, rpm: 900, shift: 0, active: false, x: 0, z: 0, heading: 0, v: 0, steer: 0, idx: 0, lapStart: 0, best: null, armed: false, cam: 'chase', sound: false, time: 0, roll: 0, pitch: 0 };
  let perf, wheelbase, redline, spec;
  const IDLE = 850;
  const RATIOS = [0.25, 0.41, 0.57, 0.72, 0.86, 1.0];   // share of top speed reached at the redline, per gear
  const savedFog = { fog: null, bg: null };

  const keyMap = { KeyW: 'gas', ArrowUp: 'gas', KeyS: 'brake', ArrowDown: 'brake', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', Space: 'hand' };
  const onKey = down => e => {
    if (!st.active) return;
    if (keyMap[e.code]) { keys[keyMap[e.code]] = down ? 1 : 0; e.preventDefault(); return; }
    if (!down) return;
    if (e.code === 'Escape') stop();
    else if (e.code === 'KeyC') toggleCam();
    else if (e.code === 'KeyG') setGhost(!env.ghost);
    else if (e.code === 'KeyN') setEnv({ night: !env.night });
    else if (e.code === 'KeyB') setEnv({ rain: !env.rain });
    else if (e.code === 'KeyM') setManual(!st.manual);
    else if (e.code === 'KeyE') shift(1);
    else if (e.code === 'KeyQ') shift(-1);
    else if (e.code === 'KeyR') placeAtStart(nearestIdx());
  };
  addEventListener('keydown', onKey(true));
  addEventListener('keyup', onKey(false));
  addEventListener('blur', () => Object.keys(keys).forEach(k => (keys[k] = 0)));

  let flashT = null;
  function flash(text) {
    if (!hud) return;
    const el = hud.querySelector('#dhDrift');
    hud.querySelector('#dhDriftPts').textContent = text;
    hud.querySelector('#dhDriftLbl').textContent = text.startsWith('+') ? 'ქულა' : text === 'ბრუნები!' ? 'ძალიან მაღალია' : text === 'რეკორდი!' ? 'ახალი საუკეთესო წრე' : 'დაჯახება';
    el.classList.add('on'); el.dataset.flash = '1';
    clearTimeout(flashT);
    flashT = setTimeout(() => { if (hud) { delete el.dataset.flash; el.classList.remove('on'); } }, 1300);
  }

  function setManual(on) {
    st.manual = on;
    try { localStorage.setItem('veloce-manual', on ? '1' : '0'); } catch { /* private mode */ }
    if (!on && st.gear < 1) st.gear = 1;
    if (hud) { hud.querySelector('#dhMode').textContent = on ? 'M' : 'A'; hud.classList.toggle('manual', on); }
  }
  // manual shifts: R ← 1 … 6. Down-shifts that would over-rev the engine are refused.
  function shift(dir) {
    if (!st.manual || !st.active) return;
    const vmax = perf.vmax / 3.6, speed = Math.abs(st.v);
    if (dir > 0) {
      if (st.gear === -1) { if (speed < 2) st.gear = 1; }
      else if (st.gear < RATIOS.length) { st.gear++; st.shift = 0.15; buzz(10); }
    } else if (st.gear > 1) {
      if (speed / (RATIOS[st.gear - 2] * vmax) > 1.1) { flash('ბრუნები!'); return; }
      st.gear--; st.shift = 0.1; buzz(10);
    } else if (st.gear === 1 && speed < 2) st.gear = -1;
  }

  const pref = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v === '1'; } catch { return d; } };
  const savePref = (k, v) => { try { localStorage.setItem(k, v ? '1' : '0'); } catch { /* private mode */ } };
  const env = { night: pref('veloce-night', false), rain: pref('veloce-rain', false), ghost: pref('veloce-ghost', true) };
  let sceneLights = [];      // the showroom's own lights, dimmed at night / in the rain
  let modelId = null, ghost = null, record = null, trace = [], traceT = 0, sectors = [], headLights = null;
  const SECTORS = [0.25, 0.5, 0.75];

  function setEnv(patch) {
    Object.assign(env, patch);
    savePref('veloce-night', env.night); savePref('veloce-rain', env.rain);
    if (!track) return;
    const n = env.night, r = env.rain;
    const sky = n ? (r ? 0x0b0f16 : 0x070b14) : (r ? 0x8e99a6 : 0xa9cbe8);
    scene.background = new THREE.Color(sky);
    scene.fog = new THREE.Fog(sky, n ? 40 : r ? 60 : 160, n ? 330 : r ? 420 : 900);
    scene.environmentIntensity = n ? 0.12 : r ? 0.6 : 1;
    for (const [l, base] of sceneLights) l.intensity = base * (n ? 0.08 : r ? 0.6 : 1);
    keyLight.intensity = n ? 0.25 : r ? 0.9 : 2.2;
    keyLight.color.setHex(n ? 0x9fb8ff : 0xffffff);
    track.hemi.intensity = n ? 0.12 : r ? 0.55 : 0.9;
    track.lamps.visible = n;
    // a wet road is darker and shinier
    for (const m of [track.road.material, track.runoff.material]) {
      m.roughness = r ? 0.32 : (m === track.road.material ? 0.85 : 0.95);
      m.metalness = r ? 0.12 : 0;
      m.color.setHex(r ? 0xb0b4ba : 0xffffff);
    }
    track.rain.visible = r;
    if (engine) engine.rain(r && st.sound);
    if (headLights) headLights.visible = n || r;
    if (hud) { hud.querySelector('#dhNight').classList.toggle('on', n); hud.querySelector('#dhRain').classList.toggle('on', r); }
  }
  function setGhost(on) {
    env.ghost = on; savePref('veloce-ghost', on);
    if (ghost) ghost.visible = on && !!(record && record.trace);
    if (hud) hud.querySelector('#dhGhost').classList.toggle('on', on);
  }
  // two spotlights in front of the car, used at night and in the rain
  function makeHeadLights() {
    const g = new THREE.Group();
    const L = car.size.x / 2, z = car.size.z * 0.3;
    for (const s of [1, -1]) {
      const l = new THREE.SpotLight(0xfff2dc, 260, 70, 0.42, 0.55, 1.4);
      l.position.set(L - 0.2, 0.65, s * z);
      l.target.position.set(L + 18, -0.6, s * z * 0.6);
      g.add(l, l.target);
    }
    const glowM = new THREE.MeshBasicMaterial({ color: 0xfff6e0 });
    for (const s of [1, -1]) { const d = new THREE.Mesh(new THREE.CircleGeometry(0.09, 16), glowM); d.rotation.y = Math.PI / 2; d.position.set(L + 0.02, 0.62, s * z); g.add(d); }
    g.visible = false;
    car.root.add(g);
    return g;
  }
  // replay position for the ghost at time t of the lap (trace sampled every 0.1 s)
  function ghostAt(t) {
    const tr = record.trace, n = tr.length / 3;
    const f = Math.min(n - 1.001, Math.max(0, t * 10)), i = Math.floor(f), a = f - i;
    const lerp = (k) => tr[i * 3 + k] + (tr[(i + 1) * 3 + k] - tr[i * 3 + k]) * a;
    let h0 = tr[i * 3 + 2], h1 = tr[(i + 1) * 3 + 2]; h1 = h0 + Math.atan2(Math.sin(h1 - h0), Math.cos(h1 - h0));
    return { x: lerp(0), z: lerp(1), h: h0 + (h1 - h0) * a };
  }
  function showDelta(d) {
    if (!hud) return;
    const el = hud.querySelector('#dhDelta');
    el.textContent = `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(2)}`;
    el.className = 'dh-delta on ' + (d > 0 ? 'slow' : 'fast');
    clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('on'), 2200);
  }

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
    st.v = 0; st.vl = 0; st.yaw = 0; st.steer = 0; st.idx = i; st.drift = 0;
  }

  function start(theCar, model) {
    if (st.active) stop();
    car = theCar;
    perf = model.perf || { vmax: 200, t100: 9 };
    modelId = model.id;
    record = loadRecords()[modelId] || null;
    st.best = record && record.lap ? record.lap : null;
    st.driftBest = record && record.drift ? record.drift : 0;
    spec = engineSpec(model);
    redline = perf.redline || (model.era === 'classic' ? 5800 : 6800);
    st.gear = 1; st.rpm = IDLE; st.shift = 0;
    wheelbase = Math.abs(model.wheel.x[0] - model.wheel.x[1]);
    track = buildTrack();
    track.skids = makeSkids(track.group);
    track.smoke = makeSmoke(track.group);
    track.flames = makeFlames(track.group);
    track.rain = makeRain(track.group);
    ghost = makeGhost(car); track.group.add(ghost);
    sceneLights = scene.children.filter(o => o.isLight && o !== keyLight).map(l => [l, l.intensity]);
    headLights = makeHeadLights();
    goLandscape();
    scene.add(track.group);
    st.score = 0;
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
    hud.querySelector('#dhMode').onclick = () => setManual(!st.manual);
    hud.querySelectorAll('[data-shift]').forEach(b => b.addEventListener('pointerdown', e => { e.preventDefault(); shift(+b.dataset.shift); }));
    let saved = '0';
    try { saved = localStorage.getItem('veloce-manual') || '0'; } catch { /* private mode */ }
    setManual(saved === '1');
    hud.querySelector('#dhReset').onclick = () => placeAtStart(nearestIdx());
    // sound starts on: we are inside the click that opened drive mode, so audio may play
    st.sound = true;
    engine = createEngineSound(spec);
    hud.querySelector('#dhSound').onclick = e => {
      st.sound = !st.sound;
      if (st.sound && !engine) engine = createEngineSound(spec);
      if (engine && engine.ctx.state === 'suspended') engine.ctx.resume();
      e.currentTarget.textContent = st.sound ? '🔊' : '🔇';
    };
    hud.querySelector('#dhTilt').onclick = () => setTilt(!tilt.on);
    let tiltSaved = '0';
    try { tiltSaved = localStorage.getItem('veloce-tilt') || '0'; } catch { /* private mode */ }
    if (tiltSaved === '1' && isTouch && !(typeof DeviceMotionEvent !== 'undefined' && DeviceMotionEvent.requestPermission)) setTilt(true);
    // analog pedals: the lower on the pedal you press (or the further you slide down), the harder
    hud.querySelectorAll('[data-pedal]').forEach(p => {
      const k = p.dataset.pedal;
      const set = e => {
        const h = p.offsetHeight || 1;
        const f = Math.max(0, Math.min(1, e.offsetY / h));
        keys[k] = 0.35 + 0.65 * f;
        p.style.setProperty('--press', keys[k].toFixed(2));
      };
      p.addEventListener('pointerdown', e => { e.preventDefault(); try { p.setPointerCapture(e.pointerId); } catch { /* old browsers */ } p.classList.add('on'); set(e); });
      p.addEventListener('pointermove', e => { if (p.classList.contains('on')) set(e); });
      const off = () => { keys[k] = 0; p.classList.remove('on'); p.style.setProperty('--press', 0); };
      p.addEventListener('pointerup', off);
      p.addEventListener('pointercancel', off);
      p.addEventListener('lostpointercapture', off);
    });
    hud.querySelectorAll('.dh-touch button[data-k]').forEach(b => {
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
    trace = []; traceT = 0; sectors = [];
    hud.querySelector('#dhGhost').onclick = () => setGhost(!env.ghost);
    hud.querySelector('#dhNight').onclick = () => setEnv({ night: !env.night });
    hud.querySelector('#dhRain').onclick = () => setEnv({ rain: !env.rain });
    setGhost(env.ghost);
    setEnv({});
    st.active = true;
    document.body.classList.add('driving');
    applyOrientation();
    // put the camera behind the car straight away
    update(0, true);
  }

  function stop() {
    if (!st.active) return;
    st.active = false;
    document.body.classList.remove('driving');
    leaveLandscape();
    removeEventListener('devicemotion', onMotion); tilt.on = false;
    Object.keys(keys).forEach(k => (keys[k] = 0));
    if (ghost) track.group.remove(ghost);
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
    scene.environmentIntensity = 1; keyLight.intensity = 2.2; keyLight.color.setHex(0xffffff);
    for (const [l, base] of sceneLights) l.intensity = base;
    sceneLights = [];
    if (headLights) { car.root.remove(headLights); headLights.traverse(o => { if (o.dispose) o.dispose(); }); headLights = null; }
    ghost = null;
    Object.assign(keyLight.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 1, far: 20 });
    keyLight.shadow.camera.updateProjectionMatrix();
    keyLight.position.set(4, 8, 5); keyLight.target.position.set(0, 0, 0);
    camera.near = 0.02; camera.far = 100;
    controls.enabled = true;
    if (car) {
      car.root.position.set(0, 0, 0); car.root.rotation.set(0, 0, 0);
      car.body.rotation.set(0, 0, 0);
      if (car.setSteer) car.setSteer(0);
      if (car.setGauges) car.setGauges(0, 0);
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
    const off = near.dist > WALL + 1;                      // only if something pushed the car past the barriers

    // ---- longitudinal (st.v = speed along the car, st.vl = sideways) ----
    const throttle = keys.gas, brake = keys.brake;
    if (!st.manual) {
      if (throttle && st.v >= -0.5) st.v += throttle * a0 * Math.max(0, 1 - st.v / vmax) * dt;
      if (brake) {
        if (st.v > 0.5) st.v -= (env.rain ? 8.2 : 11) * brake * dt;
        else st.v = Math.max(st.v - 4 * dt, -8);            // reverse
      }
    } else {
      // manual: the chosen gear decides how hard the engine can pull
      const g = st.gear;
      if (g === -1) { if (throttle) st.v = Math.max(st.v - 4 * dt, -8); }
      else {
        const top = RATIOS[g - 1] * vmax, r = Math.abs(st.v) / top;   // r = share of the redline
        if (throttle && st.shift <= 0 && r < 1 && st.v > -0.5) {
          const lug = g === 1 ? 1 : Math.min(1, 0.25 + r * 2.2);        // too high a gear bogs down
          st.v += throttle * a0 * (1.22 - 0.06 * g) * lug * Math.max(0, 1 - st.v / vmax) * dt;
        }
        if (st.v > top) st.v -= Math.min(st.v - top, 7 * dt);          // rev limiter / engine braking
      }
      if (brake) st.v -= Math.sign(st.v) * Math.min(Math.abs(st.v), (env.rain ? 8.2 : 11) * brake * dt);
    }
    if (keys.hand) st.v -= Math.sign(st.v) * Math.min(Math.abs(st.v), 4 * dt);
    if (!throttle && !brake) st.v -= Math.sign(st.v) * Math.min(Math.abs(st.v), (1.2 + 0.0012 * st.v * st.v) * dt);
    if (off) {
      st.v -= Math.sign(st.v) * Math.min(Math.abs(st.v), (4 + 0.02 * st.v * st.v) * dt);
      st.v = Math.min(st.v, 75 / 3.6);
    }

    // ---- steering: less lock at speed, more while sliding or on the handbrake ----
    const slip = Math.atan2(st.vl, Math.max(Math.abs(st.v), 1));
    const sliding = Math.abs(slip) > 0.12 && Math.abs(st.v) > 6;
    const lock = 0.55 / (1 + Math.abs(st.v) / 22) * (keys.hand || sliding ? 1.7 : 1);
    if (tilt.on) tilt.value += (tilt.raw - tilt.value) * (1 - Math.exp(-dt * 14));
    const steerIn = tilt.on && !keys.left && !keys.right ? tilt.value : keys.left - keys.right;
    const want = steerIn * lock;
    st.steer += (want - st.steer) * (1 - Math.exp(-dt * 8));

    // ---- grip: the rear lets go on the handbrake, or under power once sliding ----
    const strong = a0 > 3;                                  // weak cars cannot hold a power slide
    const rearLoose = keys.hand || (throttle && sliding && strong && Math.abs(slip) < 1.2);
    const spun = Math.abs(slip) > 1.2;                       // facing well away from the travel direction
    const grip = (off ? 2.5 : rearLoose ? (keys.hand ? 0.8 : 1.4) : spun ? 3.5 : 9) * (env.rain ? 0.7 : 1);
    // yaw rate is limited by how much sideways force the tyres can make (~1.3 g)
    const A_LAT = env.rain ? 9.5 : 13, sp0 = Math.max(Math.abs(st.v), 4);
    let yawWant = st.v / wheelbase * Math.tan(st.steer);
    const yawCap = rearLoose ? Math.min(2.3, 2.6 * A_LAT / sp0) : A_LAT / sp0;
    if (rearLoose) yawWant *= 1.35;
    yawWant = THREE.MathUtils.clamp(yawWant, -yawCap, yawCap);
    st.yaw += (yawWant - st.yaw) * (1 - Math.exp(-dt * (rearLoose ? 3 : 10)));
    const yaw = st.yaw;

    // world velocity keeps its direction while the car rotates underneath it
    const oldF = new THREE.Vector3(Math.cos(st.heading), 0, -Math.sin(st.heading));
    const oldR = new THREE.Vector3(Math.sin(st.heading), 0, Math.cos(st.heading));
    const vel = oldF.multiplyScalar(st.v).addScaledVector(oldR, st.vl);
    st.heading += yaw * dt;
    fwd.set(Math.cos(st.heading), 0, -Math.sin(st.heading));
    const right = new THREE.Vector3(Math.sin(st.heading), 0, Math.cos(st.heading));
    st.v = vel.dot(fwd); st.vl = vel.dot(right);
    const lost = st.vl * (1 - Math.exp(-grip * dt));      // sideways speed the tyres scrub off
    st.vl -= lost;
    st.v -= Math.sign(st.v) * Math.min(Math.abs(st.v), Math.abs(lost) * 0.15);
    st.x += (fwd.x * st.v + right.x * st.vl) * dt;
    st.z += (fwd.z * st.v + right.z * st.vl) * dt;

    // ---- barriers ----
    let impact = 0;
    {
      const c = track.center[near.i], t = track.tangents[near.i];
      const nx = -t.z, nz = t.x;
      const d = (st.x - c.x) * nx + (st.z - c.z) * nz;
      const limit = WALL - car.size.z * 0.45;
      if (Math.abs(d) > limit) {
        const s = Math.sign(d);
        st.x -= nx * (d - s * limit); st.z -= nz * (d - s * limit);
        const wx = fwd.x * st.v + right.x * st.vl, wz = fwd.z * st.v + right.z * st.vl;
        const into = (wx * nx + wz * nz) * s;              // speed towards the wall
        if (into > 0) {
          const bx = wx - nx * s * into * 1.35, bz = wz - nz * s * into * 1.35;   // bounce, 35 % restitution
          st.v = (bx * fwd.x + bz * fwd.z) * 0.8;
          st.vl = (bx * right.x + bz * right.z) * 0.8;
          st.yaw *= 0.4;
          impact = into;
        }
      }
    }
    if (impact > 2) {
      st.hits = (st.hits || 0) + 1;
      st.shake = Math.min(1, impact / 15);
      if (engine && st.sound) engine.thud(impact / 15);
      buzz(Math.round(30 + Math.min(1, impact / 15) * 90));
      if (st.drift > 0) { st.drift = 0; flash('დაიკარგა!'); }
    }
    // laps: crossing index 0 after passing the far side of the track
    const prev = st.idx;
    st.idx = near.i;
    if (st.idx > track.N * 0.4 && st.idx < track.N * 0.6) st.armed = true;
    if (prev > track.N * 0.9 && st.idx < track.N * 0.1) {      // crossed the line going forward
      if (st.armed) {
        const lap = st.time - st.lapStart;
        if (record && record.lap) showDelta(lap - record.lap);
        if (st.best == null || lap < st.best) st.best = lap;
        if (!record || !record.lap || lap < record.lap) {
          // new best lap for this car: keep it, with its path for the ghost
          record = { ...(record || {}), lap, sectors: sectors.slice(), trace: trace.map(v => Math.round(v * 100) / 100) };
          saveRecord(modelId, { lap, sectors: record.sectors, trace: record.trace });
          flash('რეკორდი!');
        }
      }
      st.lapStart = st.time; st.armed = false;
      trace = []; traceT = 0; sectors = [];
    }

    // car transform + cosmetic body roll / pitch
    car.root.position.set(st.x, 0, st.z);
    car.root.rotation.set(0, st.heading, 0);
    const lat = st.v * st.yaw, lon = throttle ? 1 : brake ? -1.6 : 0;
    st.roll += (THREE.MathUtils.clamp(-lat * 0.006, -0.06, 0.06) - st.roll) * (1 - Math.exp(-dt * 6));
    st.pitch += (lon * 0.012 - st.pitch) * (1 - Math.exp(-dt * 5));
    car.body.rotation.set(st.roll, 0, st.pitch);
    if (car.setSteer) car.setSteer(st.steer * 7);            // steering wheel: ~7x the road-wheel angle

    // ---- drifting: points, skid marks, smoke, squeal ----
    const slipNow = Math.atan2(st.vl, Math.max(Math.abs(st.v), 1));
    const drifting = !off && Math.abs(slipNow) > 0.22 && st.v > 8;
    if (drifting) {
      st.drift += Math.abs(slipNow) * st.v * dt * 6;
      st.driftIdle = 0;
    } else if (st.drift > 0 && (st.driftIdle += dt) > 0.7) {
      const pts = Math.round(st.drift);
      st.score += pts;
      if (pts > st.driftBest) { st.driftBest = pts; saveRecord(modelId, { drift: pts }); }
      flash(`+${pts}`);
      st.drift = 0;
    }
    const skidding = (drifting || (keys.hand && Math.abs(st.v) > 4) || (brake && st.v > 14)) && !off;
    const rx = car.model.wheel.x[1], hw = car.size.z * 0.38;
    for (const s of [1, -1]) {
      const wx = st.x + fwd.x * rx + right.x * hw * s, wz = st.z + fwd.z * rx + right.z * hw * s;
      track.skids.mark(s, wx, wz, right.x, right.z, skidding);
      if (drifting && (st.smokeT += dt) > 0.035) track.smoke.puff(wx, wz, Math.min(1, Math.abs(slipNow)));
    }
    if (st.smokeT > 0.035) st.smokeT = 0;
    track.smoke.update(dt);
    if (engine) engine.squeal(st.sound && skidding ? Math.min(1, Math.abs(slipNow) * 1.6 + (keys.hand ? 0.3 : 0)) : 0);
    const dEl = hud.querySelector('#dhDrift');
    if (st.drift > 0) { hud.querySelector('#dhDriftPts').textContent = Math.round(st.drift); hud.querySelector('#dhDriftLbl').textContent = 'დრიფტი'; dEl.classList.add('on'); }
    else if (!dEl.dataset.flash) dEl.classList.remove('on');
    hud.querySelector('#dhScore').textContent = st.score;
    hud.querySelector('#dhDriftBest').textContent = st.driftBest;

    // lap path for the ghost (10 samples a second) and sector splits
    const lapT = st.time - st.lapStart;
    if ((traceT -= dt) <= 0 && trace.length < 3 * 1800) { trace.push(st.x, st.z, st.heading); traceT += 0.1; }
    for (let k = 0; k < SECTORS.length; k++) {
      if (sectors[k] === undefined && st.armed !== undefined && st.idx >= track.N * SECTORS[k] && st.idx < track.N * SECTORS[k] + 40) {
        sectors[k] = lapT;
        if (record && record.sectors && record.sectors[k] !== undefined) showDelta(lapT - record.sectors[k]);
      }
    }
    if (ghost) {
      const show = env.ghost && record && record.trace && record.trace.length > 6 && lapT * 10 < record.trace.length / 3 - 1;
      ghost.visible = !!show;
      if (show) { const gp = ghostAt(lapT); ghost.position.set(gp.x, 0, gp.z); ghost.rotation.set(0, gp.h, 0); }
    }
    track.rain.update(dt, camera.position, fwd.x * st.v, fwd.z * st.v);

    // shadows follow the car
    keyLight.position.set(st.x + 8, 16, st.z + 10);
    keyLight.target.position.set(st.x, 0, st.z);

    // camera
    if (st.cam === 'chase') {
      const back = car.size.x * 1.15 + 3.2, up = car.size.y + 1.25;
      const sp = Math.hypot(st.v, st.vl);
      const dir = sp > 4 ? new THREE.Vector3(fwd.x * st.v + right.x * st.vl, 0, fwd.z * st.v + right.z * st.vl).normalize().lerp(fwd, 0.6).normalize() : fwd;
      tmp.set(st.x - dir.x * back, up, st.z - dir.z * back);
      if (snap) camera.position.copy(tmp);
      else camera.position.lerp(tmp, 1 - Math.exp(-dt * 5));
      look.set(st.x + fwd.x * 4, car.size.y * 0.6, st.z + fwd.z * 4);
      camera.lookAt(look);
      const baseFov = camera.aspect < 1 ? 75 : 62, fov = baseFov + 8 * st.fxK;
      if (Math.abs(camera.fov - fov) > 0.05) { camera.fov = fov; camera.updateProjectionMatrix(); }
      if (st.shake > 0) {
        camera.position.x += (Math.random() - 0.5) * st.shake * 0.5;
        camera.position.y += (Math.random() - 0.5) * st.shake * 0.3;
        st.shake = Math.max(0, st.shake - dt * 2.5);
      }
    } else {
      const coFov = camera.aspect < 1 ? 75 : 62;
      if (camera.fov !== coFov) { camera.fov = coFov; camera.updateProjectionMatrix(); }
      const eye = car.driverEye.clone().add(car.body.position).applyEuler(car.root.rotation).add(car.root.position);
      camera.position.copy(eye);
      look.copy(eye).addScaledVector(fwd, 10); look.y -= 0.6;
      camera.lookAt(look);
    }

    // HUD + sound
    const kmh = Math.abs(st.v) * 3.6;
    hud.querySelector('#dhInGas').style.height = `${Math.round(throttle * 100)}%`;
    hud.querySelector('#dhInBrake').style.height = `${Math.round(brake * 100)}%`;
    hud.querySelector('#dhInHand').classList.toggle('on', !!keys.hand);
    if (keys.hand && !st.handWas) buzz(15);
    st.handWas = keys.hand;
    st.fxK += (Math.max(0, Math.min(1, (kmh - 150) / 130)) - st.fxK) * (1 - Math.exp(-dt * 3));
    hud.querySelector('#dhFx').style.opacity = (st.fxK * 0.85).toFixed(2);
    hud.querySelector('#dhSpd').textContent = Math.round(kmh);
    hud.querySelector('#dhLap').textContent = fmt(st.time - st.lapStart);
    hud.querySelector('#dhBest').textContent = fmt(st.best);
    hud.querySelector('#dhOff').style.opacity = off ? 1 : 0;
    // gearbox (sound + HUD only): automatic shifts at the redline
    const speed = Math.abs(st.v);
    let target, gearLabel;
    if (st.manual) {
      if (st.shift > 0) st.shift -= dt;
      if (st.gear === -1) { gearLabel = 'R'; target = IDLE + speed / (vmax * 0.18) * (redline - IDLE); }
      else {
        gearLabel = String(st.gear);
        target = Math.max(IDLE, speed / (RATIOS[st.gear - 1] * vmax) * redline);
        if (st.gear === 1 && speed < 3 && throttle) target = Math.max(target, IDLE + 2400);
        if (target >= redline * 0.99 && throttle) target = redline * (0.965 + 0.035 * Math.sin(st.time * 45));   // bouncing off the limiter
      }
    } else if (st.v < -0.3) {
      gearLabel = 'R';
      target = IDLE + speed / (vmax * 0.18) * (redline - IDLE);
    } else {
      if (st.shift > 0) st.shift -= dt;
      const rpmIn = g => speed / (RATIOS[g - 1] * vmax) * redline;
      if (throttle && st.gear < RATIOS.length && rpmIn(st.gear) > redline * 0.97) { st.gear++; st.shift = 0.2; buzz(10); }
      else if (st.gear > 1 && rpmIn(st.gear - 1) < redline * (throttle ? 0.62 : 0.5)) st.gear--;
      target = Math.max(IDLE, rpmIn(st.gear));
      if (speed < 3 && throttle) target = Math.max(target, IDLE + 2400);   // clutch slipping off the line
      if (speed < 0.3 && !throttle) st.gear = 1;
      gearLabel = speed < 0.3 && !throttle ? 'N' : String(st.gear);
    }
    target = Math.min(target, redline * 1.02);
    st.rpm += (target - st.rpm) * (1 - Math.exp(-dt * (st.shift > 0 ? 18 : 9)));
    const load = st.shift > 0 ? 0.15 : Math.max(0.15, throttle, st.v < 0 ? brake : 0);
    hud.querySelector('#dhGear').textContent = gearLabel;
    const bar = hud.querySelector('#dhRpm');
    bar.style.width = `${Math.min(100, st.rpm / redline * 100)}%`;
    bar.classList.toggle('red', st.rpm > redline * 0.9);
    if (car.setGauges) car.setGauges(kmh, st.rpm);
    if (engine) engine.set(st.rpm, load, st.sound);
    // backfire: lifting off at high revs, or bouncing off the limiter
    const lifted = !throttle && st.rpm > redline * 0.7 && speed > 8;
    const limiter = throttle && st.rpm > redline * 0.97;
    if ((lifted || limiter) && (st.popT -= dt) <= 0) {
      st.popT = 0.06 + Math.random() * (lifted ? 0.16 : 0.3);
      if (Math.random() < (lifted ? 0.55 : 0.35)) {
        if (engine && st.sound) engine.pop(0.5 + Math.random() * 0.5);
        const ex = car.size.x / 2 + 0.05;
        track.flames.burst(st.x - fwd.x * ex, 0.32, st.z - fwd.z * ex, fwd.x, fwd.z);
      }
    }
    track.flames.update(dt);
  }

  // debug hook used by the automated test driver
  return { start, stop, update, get active() { return st.active; }, get debug() { return { st, track, keys, env, setEnv }; } };
}
