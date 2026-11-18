// Test-drive mode: three tracks (race circuit, city streets, mountain road),
// arcade car physics with slopes, chase / cockpit cameras, HUD with speed and
// lap times, keyboard + touch controls and an engine sound. main.js owns the
// scene; this module adds the track while driving and removes it on exit.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createEngineSound, engineSpec } from './engineSound.js';
import { createDriver } from './driver.js';
import { makeSky, makeClouds, makeHorizon, asphaltTexture, grassTexture, circuitDetails, circuitWallTexture, cityDetails, cityBlockExtras, mountainDetails, roundTrees } from './scenery.js';

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

/* ---------- tracks ---------- */
// Rounded-corner polyline for city blocks: corners [x, z], fillet radius r.
function rounded(corners, r) {
  const out = [], n = corners.length;
  for (let i = 0; i < n; i++) {
    const p0 = corners[(i - 1 + n) % n], p1 = corners[i], p2 = corners[(i + 1) % n];
    const la = Math.hypot(p0[0] - p1[0], p0[1] - p1[1]), lb = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const s = [p1[0] + (p0[0] - p1[0]) / la * r, p1[1] + (p0[1] - p1[1]) / la * r];
    const e = [p1[0] + (p2[0] - p1[0]) / lb * r, p1[1] + (p2[1] - p1[1]) / lb * r];
    for (let k = 0; k <= 6; k++) {
      const t = k / 6, a = [s[0] + (p1[0] - s[0]) * t, s[1] + (p1[1] - s[1]) * t], b = [p1[0] + (e[0] - p1[0]) * t, p1[1] + (e[1] - p1[1]) * t];
      out.push([a[0] + (b[0] - a[0]) * t, 0, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out.slice(3).concat(out.slice(0, 3));     // start in the middle of the first street
}

// roadW: asphalt width; margin: run-off between the road edge and the barrier (m)
export const TRACKS = {
  circuit: {
    name: 'რბოლის ტრასა', icon: '🏁', desc: 'ფართო გზა, ბორდიურები და ტრიბუნა', roadW: 14, margin: 6, lampEvery: 24,
    pts: [[0, 0], [150, 0], [225, -18], [255, -80], [235, -150], [172, -182], [104, -160], [62, -112],
      [2, -118], [-78, -178], [-160, -170], [-205, -110], [-192, -40], [-124, 8], [-60, 10]].map(([x, z]) => [x, 0, z]),
  },
  city: {
    name: 'ქალაქის ქუჩები', icon: '🏙', desc: '90° კუთხეები, ტროტუარი და შენობები', roadW: 16, margin: 5, lampEvery: 16,
    pts: rounded([[110, 0], [220, 0], [220, -140], [100, -140], [100, -260], [-120, -260], [-120, -120], [-40, -120], [-40, 0]], 24),
  },
  mountain: {
    name: 'მთის სერპანტინი', icon: '⛰', desc: 'ვიწრო გზა, აღმართი, დაღმართი და მოაჯირები', roadW: 10, margin: 2.5, lampEvery: 30,
    pts: [[0, 0, 0], [110, 2, 0], [190, 7, -25], [215, 12, -75], [185, 17, -110], [120, 21, -105], [75, 24, -125], [80, 27, -165],
      [140, 31, -180], [215, 35, -190], [250, 38, -235], [220, 41, -280], [150, 43, -290], [70, 42, -270], [0, 38, -250],
      [-70, 33, -265], [-140, 27, -240], [-175, 20, -185], [-160, 13, -125], [-110, 7, -70], [-60, 2, -20]],
  },
};
const trackLengths = {};
export function trackLength(id) {
  if (!trackLengths[id]) trackLengths[id] = new THREE.CatmullRomCurve3(TRACKS[id].pts.map(p => new THREE.Vector3(...p)), true, 'centripetal').getLength();
  return trackLengths[id];
}

// window grid for the city blocks: 8 × 8 bays (4 m × 3.5 m each); lit windows go in the emissive map
function facadeTextures(rand) {
  const draw = lit => canvasTex(512, 512, (g, w) => {
    const c = w / 8;
    g.fillStyle = lit ? '#000' : '#d9d4ca'; g.fillRect(0, 0, w, w);
    for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) {
      const on = rand() < 0.38;
      if (lit && !on) continue;
      g.fillStyle = lit ? (rand() < 0.3 ? '#ffd9a0' : '#ffe9bf') : '#3b4652';
      g.fillRect(x * c + c * 0.18, y * c + c * 0.2, c * 0.64, c * 0.55);
      if (!lit) { g.fillStyle = '#5d6b78'; g.fillRect(x * c + c * 0.18, y * c + c * 0.2, c * 0.64, c * 0.08); }
    }
  });
  return { map: draw(false), lit: draw(true) };
}

function buildTrack(id = 'circuit') {
  const def = TRACKS[id] || TRACKS.circuit;
  const ROAD_W = def.roadW, WALL = ROAD_W / 2 + def.margin;
  const city = id === 'city', mountain = id === 'mountain', circuit = !city && !mountain;
  const group = new THREE.Group();
  group.name = 'track';
  const rand = rng(7);

  const curve = new THREE.CatmullRomCurve3(def.pts.map(p => new THREE.Vector3(...p)), true, 'centripetal');
  const N = 900;
  const center = curve.getSpacedPoints(N).slice(0, N);
  const tangents = center.map((_, i) => center[(i + 1) % N].clone().sub(center[(i - 1 + N) % N]).normalize());
  const nrm = tangents.map(t => { const l = Math.hypot(t.x, t.z) || 1; return [-t.z / l, t.x / l]; });   // horizontal side vector
  const length = curve.getLength();
  const flatDist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

  // a strip along the track between side offsets a > b, dy above the centre line
  function ribbon(a, b, dy, uScale, vLen, mat) {
    const pos = [], uv = [], idx = [];
    let dist = 0;
    for (let i = 0; i <= N; i++) {
      const k = i % N, p = center[k], [nx, nz] = nrm[k];
      if (i > 0) dist += flatDist(p, center[(i - 1) % N]);
      pos.push(p.x + nx * a, p.y + dy, p.z + nz * a, p.x + nx * b, p.y + dy, p.z + nz * b);
      uv.push(0, dist / vLen, uScale, dist / vLen);
      if (i < N) { const q = i * 2; idx.push(q, q + 2, q + 1, q + 1, q + 2, q + 3); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx); geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = true;
    group.add(m);
    return m;
  }

  // road
  const asphalt = asphaltTexture(id, rand);
  const road = ribbon(ROAD_W / 2, -ROAD_W / 2, 0.04, 1, 14, new THREE.MeshStandardMaterial({ map: asphalt, bumpMap: asphalt, bumpScale: 0.35, roughness: 0.88, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));

  // run-off: plain asphalt (circuit), pavement (city) or gravel shoulder (mountain)
  const runTex = city
    ? canvasTex(128, 128, (g, w, h) => { noise(g, w, h, '#8d8f93', 40, 3000, rand); g.fillStyle = '#6f7277'; for (let k = 0; k < 4; k++) { g.fillRect(0, k * 32, w, 2); g.fillRect(k * 32, 0, 2, h); } })
    : mountain ? canvasTex(128, 128, (g, w, h) => noise(g, w, h, '#6d6458', 90, 6000, rand))
      : canvasTex(128, 128, (g, w, h) => noise(g, w, h, '#2f3136', 50, 4000, rand));
  const runW = mountain ? WALL + 3 : WALL + 0.3;
  const runoff = ribbon(runW, -runW, 0.02, city ? 2 * runW / 2.4 : 4, city ? 2.4 : 14, new THREE.MeshStandardMaterial({ map: runTex, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  if (city) {   // kerb stones along both road edges
    const curbM = new THREE.MeshStandardMaterial({ color: 0xb9bbbe, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    ribbon(ROAD_W / 2 + 0.4, ROAD_W / 2, 0.06, 1, 1, curbM); ribbon(-ROAD_W / 2, -ROAD_W / 2 - 0.4, 0.06, 1, 1, curbM);
  }

  // kerbs on the outside of every bend (circuit only)
  if (circuit) {
    const kerbTex = canvasTex(64, 64, (g) => { g.fillStyle = '#d42a2a'; g.fillRect(0, 0, 64, 32); g.fillStyle = '#f4f4f4'; g.fillRect(0, 32, 64, 32); });
    const kp = [], ku = [], ki = [];
    let kd = 0;
    for (let i = 0; i < N; i++) {
      const t0 = tangents[i], t1 = tangents[(i + 4) % N];
      const turn = t0.x * t1.z - t0.z * t1.x;
      if (Math.abs(turn) < 0.012) continue;
      const side = turn > 0 ? 1 : -1;
      const p = center[i], q = center[(i + 1) % N];
      const e = [[p, nrm[i]], [q, nrm[(i + 1) % N]]].map(([c, [nx, nz]]) => [c.x + nx * side * ROAD_W / 2, c.z + nz * side * ROAD_W / 2, c.x + nx * side * (ROAD_W / 2 + 1.4), c.z + nz * side * (ROAD_W / 2 + 1.4), c.y]);
      const b = kp.length / 3;
      kp.push(e[0][0], e[0][4] + 0.06, e[0][1], e[0][2], e[0][4] + 0.08, e[0][3], e[1][0], e[1][4] + 0.06, e[1][1], e[1][2], e[1][4] + 0.08, e[1][3]);
      const seg = flatDist(p, q);
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
  }

  // distance to the nearest point of the centre line (every `step`-th sample)
  const nearest = (x, z, step = 3) => {
    let bd = Infinity, bi = 0;
    for (let i = 0; i < N; i += step) { const p = center[i], d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < bd) { bd = d; bi = i; } }
    return { d: Math.sqrt(bd), i: bi };
  };
  const near = (x, z, min) => nearest(x, z, 3).d < min;
  const keepOut = [];                                   // round areas where nothing may grow (pit building …)
  const blocked = (x, z) => keepOut.some(k => Math.hypot(k.x - x, k.z - z) < k.r);
  if (circuit) circuitDetails({ group, center, tangents, nrm, N, WALL, ROAD_W, rand, keepOut });

  // ground: grass (circuit), concrete (city) or a mountain heightfield the road is cut into
  let heightAt = () => 0;
  if (mountain) {
    const SHELF = WALL + 14;
    heightAt = (x, z) => {
      let bd = Infinity, by = 0, lo = Infinity;
      for (let i = 0; i < N; i += 3) {
        const p = center[i], d = Math.hypot(p.x - x, p.z - z);
        if (d < bd) { bd = d; by = p.y; }
        lo = Math.min(lo, p.y + 0.5 * Math.max(0, d - SHELF));
      }
      if (bd < SHELF) return by - 0.45;
      const far = THREE.MathUtils.smoothstep(bd, SHELF, SHELF + 50);
      const hills = 9 * Math.sin(x * 0.019 + 1.3) * Math.cos(z * 0.023) + 5 * Math.sin((x + z) * 0.041) + 4;
      return lo - 0.45 + far * hills + Math.max(0, bd - 110) * 0.55;
    };
    const S = 7, x0 = -600, x1 = 680, z0 = -720, z1 = 430;
    const nx = Math.round((x1 - x0) / S), nz = Math.round((z1 - z0) / S);
    const geo = new THREE.PlaneGeometry(x1 - x0, z1 - z0, nx, nz);
    geo.rotateX(-Math.PI / 2);
    geo.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
    const P = geo.attributes.position;
    for (let i = 0; i < P.count; i++) P.setY(i, heightAt(P.getX(i), P.getZ(i)));
    geo.computeVertexNormals();
    const col = new Float32Array(P.count * 3), Nm = geo.attributes.normal;
    const grassC = new THREE.Color(0x5f8a45), rockC = new THREE.Color(0x8a8378), c = new THREE.Color();
    for (let i = 0; i < P.count; i++) {
      const k = THREE.MathUtils.smoothstep(Nm.getY(i), 0.62, 0.86);
      c.copy(rockC).lerp(grassC, k).multiplyScalar(0.92 + rand() * 0.16);
      col.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const groundTex = canvasTex(256, 256, (g, w, h) => noise(g, w, h, '#c8c8c8', 90, 8000, rand), [120, 120]);
    const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: groundTex, vertexColors: true, roughness: 1 }));
    ground.receiveShadow = true;
    group.add(ground);
  } else {
    const groundTex = city
      ? canvasTex(256, 256, (g, w, h) => noise(g, w, h, '#55585d', 50, 6000, rand), [300, 300])
      : grassTexture(rand);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(2600, 2600), new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    group.add(ground);
  }

  // start / finish line + gantry
  const t0 = tangents[0], c0 = center[0];
  const heading0 = Math.atan2(-t0.z, t0.x);
  const checker = canvasTex(32, 128, (g) => { for (let x = 0; x < 4; x++) for (let y = 0; y < 16; y++) { g.fillStyle = (x + y) % 2 ? '#111' : '#fff'; g.fillRect(x * 8, y * 8, 8, 8); } });
  const line = new THREE.Mesh(new THREE.PlaneGeometry(3, ROAD_W), new THREE.MeshStandardMaterial({ map: checker, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
  line.rotation.set(-Math.PI / 2, 0, heading0); line.position.set(c0.x, c0.y + 0.06, c0.z);
  group.add(line);
  const gantry = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0x2a2d33, metalness: 0.6, roughness: 0.4 });
  const accent = new THREE.MeshStandardMaterial({ color: 0x4fb3ff, emissive: 0x1a5f99, emissiveIntensity: 0.6 });
  for (const s of [1, -1]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.6, 7, 0.6), steel); post.position.set(0, 3.5, s * (ROAD_W / 2 + 1.5)); post.castShadow = true; gantry.add(post); }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(1, 1.4, ROAD_W + 4), accent); beam.position.y = 7; beam.castShadow = true;
  gantry.add(beam);
  gantry.position.set(c0.x, c0.y, c0.z); gantry.rotation.y = heading0;
  group.add(gantry);
  const [nx0, nz0] = nrm[0];

  // grandstand beside the start (circuit)
  if (circuit) {
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
    stand.position.set(c0.x + nx0 * (WALL + 6) + t0.x * 20, 0, c0.z + nz0 * (WALL + 6) + t0.z * 20);
    stand.rotation.y = heading0 + Math.PI;
    group.add(stand);
  }

  // trees (instanced), kept clear of the track
  if (!city) {
    const spots = [];
    const count = mountain ? 650 : 240;
    for (let tries = 0; spots.length < count && tries < 9000; tries++) {
      const x = mountain ? (rand() - 0.5) * 1100 + 40 : (rand() - 0.5) * 900 + 25;
      const z = mountain ? (rand() - 0.5) * 900 - 140 : (rand() - 0.5) * 700 - 85;
      if (near(x, z, WALL + (mountain ? 5 : 6)) || blocked(x, z)) continue;
      spots.push([x, heightAt(x, z), z, 0.7 + rand() * 0.8]);
    }
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.25, 0.35, 3, 6), new THREE.MeshStandardMaterial({ color: 0x5b3b22, roughness: 1 }), spots.length);
    const crown = new THREE.InstancedMesh(new THREE.ConeGeometry(2.2, 6, 8), new THREE.MeshStandardMaterial({ color: mountain ? 0x24482a : 0x2f5a2c, roughness: 0.9 }), spots.length);
    const m4 = new THREE.Matrix4();
    spots.forEach(([x, y, z, s], i) => {
      trunk.setMatrixAt(i, m4.compose(new THREE.Vector3(x, y + 1.5 * s, z), new THREE.Quaternion(), new THREE.Vector3(s, s, s)));
      crown.setMatrixAt(i, m4.compose(new THREE.Vector3(x, y + 5.5 * s, z), new THREE.Quaternion(), new THREE.Vector3(s, s * (mountain ? 1.3 : 1), s)));
    });
    trunk.castShadow = crown.castShadow = true;
    group.add(trunk, crown);
    if (circuit) {              // broad-leaf trees and bushes between the conifers
      const round = [];
      for (let tries = 0; round.length < 260 && tries < 6000; tries++) {
        const x = (rand() - 0.5) * 900 + 25, z = (rand() - 0.5) * 700 - 85;
        if (near(x, z, WALL + 5) || blocked(x, z)) continue;
        round.push([new THREE.Vector3(x, 0, z), 0.55 + rand() * 0.9]);
      }
      roundTrees(round, rand).forEach(m => group.add(m));
    }
  }

  // city blocks: boxes along both sides of every street, with windows that light up at night
  let windows = [];
  const placed = [];
  if (city) {
    const tex = facadeTextures(rand);
    const tints = [0xffffff, 0xe6d3bd, 0xc9d4de, 0xd8c4c0];
    const parts = tints.map(() => []);
    const blockList = [];
    for (let i = 0; i < N; i += 7) {
      for (const s of [1, -1]) {
        const c = center[i], [nx, nz] = nrm[i], t = tangents[i];
        const w = 12 + rand() * 14, h = 9 + rand() * 30;
        let ok = false, d, x, z;
        for (d of [10 + rand() * 12, 8]) {
          const off = WALL + 3 + d / 2;
          x = c.x + nx * s * off; z = c.z + nz * s * off;
          const r = Math.hypot(w, d) / 2, ux = t.x / Math.hypot(t.x, t.z), uz = t.z / Math.hypot(t.x, t.z);
          // every corner and edge midpoint must stay clear of all streets
          let clear = true;
          for (const [a1, b1] of [[1, 1], [1, -1], [-1, 1], [-1, -1], [0, 1], [0, -1], [1, 0], [-1, 0]]) {
            const px = x + ux * a1 * w / 2 - uz * b1 * d / 2, pz = z + uz * a1 * w / 2 + ux * b1 * d / 2;
            if (nearest(px, pz, 2).d < WALL + 1.5) { clear = false; break; }
          }
          if (!clear) continue;
          if (placed.some(([px, pz, pr]) => Math.hypot(px - x, pz - z) < (pr + r) * 0.72)) continue;
          ok = true; break;
        }
        if (!ok) continue;
        placed.push([x, z, Math.hypot(w, d) / 2]);
        const g = new THREE.BoxGeometry(w, h, d);
        const uv = g.attributes.uv;
        for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) {
          const k = f * 4 + v;
          if (f === 2 || f === 3) { uv.setXY(k, 0.01, 0.01); continue; }               // roof / floor: plain wall colour
          const span = f < 2 ? d : w;
          uv.setXY(k, uv.getX(k) * span / 32, uv.getY(k) * h / 28);
        }
        g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, c.y + h / 2, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-t.z, t.x)), new THREE.Vector3(1, 1, 1)));
        parts[Math.floor(rand() * tints.length)].push(g);
        blockList.push({ x, z, y: c.y, w, h, d, yaw: Math.atan2(-t.z, t.x) });
      }
    }
    parts.forEach((list, k) => {
      if (!list.length) return;
      const mat = new THREE.MeshStandardMaterial({ map: tex.map, color: tints[k], emissiveMap: tex.lit, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.85 });
      const mesh = new THREE.Mesh(mergeGeometries(list), mat);
      list.forEach(g => g.dispose());
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
      windows.push(mat);
    });
    const extra = cityBlockExtras(blockList, rand);
    extra.meshes.forEach(m => group.add(m));
    windows.push(...extra.nightMats);
    cityDetails({ group, center, tangents, nrm, N, WALL, ROAD_W, rand, nearest, placed });
  }

  const hemi = new THREE.HemisphereLight(0xcfe4ff, city ? 0x6a6d72 : mountain ? 0x56704a : 0x4d7a3a, 0.9);
  group.add(hemi);

  // street lamps: poles and heads (always in the city, at night elsewhere), pools of light at night
  const poles = new THREE.Group(); poles.visible = city; group.add(poles);
  const lamps = new THREE.Group(); lamps.visible = false; group.add(lamps);
  const lampSpots = [];
  for (let i = 0, s = 1; i < N; i += def.lampEvery, s = -s) {
    const c = center[i], [nx, nz] = nrm[i];
    lampSpots.push({ y: c.y, x: c.x + nx * s * (WALL - 0.6), z: c.z + nz * s * (WALL - 0.6), lx: c.x + nx * s * (WALL - 4), lz: c.z + nz * s * (WALL - 4) });
  }
  const poleM = new THREE.MeshStandardMaterial({ color: 0x3a3d42, metalness: 0.6, roughness: 0.5 });
  const headM = new THREE.MeshBasicMaterial({ color: 0xfff1c8 });
  const poleMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.12, 8, 8), poleM, lampSpots.length);
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
    poleMesh.setMatrixAt(i, lm4.compose(new THREE.Vector3(p.x, p.y + 4, p.z), q, new THREE.Vector3(1, 1, 1)));
    const yaw = Math.atan2(p.lx - p.x, p.lz - p.z);
    heads.setMatrixAt(i, lm4.compose(new THREE.Vector3((p.x + p.lx) / 2, p.y + 7.95, (p.z + p.lz) / 2), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw + Math.PI / 2), new THREE.Vector3(3, 1, 1)));
    pools.setMatrixAt(i, lm4.compose(new THREE.Vector3(p.lx, p.y + 0.09, p.lz), q, new THREE.Vector3(1, 1, 1)));
  });
  poles.add(poleMesh, heads);
  lamps.add(pools);

  // barriers: red / white concrete (circuit), grey concrete with blue bands (city), steel guard rail (mountain)
  const wallTex = city
    ? canvasTex(128, 32, (g) => { g.fillStyle = '#c4c6c9'; g.fillRect(0, 0, 128, 32); g.fillStyle = '#2f6fb3'; g.fillRect(0, 9, 128, 7); g.fillStyle = '#ffffff'; g.fillRect(0, 16, 128, 3); })
    : mountain ? canvasTex(64, 16, (g) => { g.fillStyle = '#b9bfc6'; g.fillRect(0, 0, 64, 16); g.fillStyle = '#d8dde2'; g.fillRect(0, 4, 64, 3); g.fillStyle = '#8d939a'; g.fillRect(0, 11, 64, 2); })
      : circuitWallTexture();
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: mountain ? 0.35 : 0.8, metalness: mountain ? 0.7 : 0, side: THREE.DoubleSide });
  const [wy0, wy1, wt] = mountain ? [0.32, 0.78, 0.15] : city ? [0, 1.1, 0.6] : [0, 0.95, 0.6];
  for (const side of [1, -1]) {
    const wp = [], wu = [], wi = [];
    let wd = 0;
    for (let i = 0; i <= N; i++) {
      const k = i % N, c = center[k], [nx0s, nz0s] = nrm[k], nx = nx0s * side, nz = nz0s * side;
      const x0 = c.x + nx * WALL, z0 = c.z + nz * WALL, x1 = c.x + nx * (WALL + wt), z1 = c.z + nz * (WALL + wt);
      if (i > 0) wd += flatDist(c, center[(i - 1) % N]);
      // inner face (2 verts) + top (2 verts)
      wp.push(x0, c.y + wy0, z0, x0, c.y + wy1, z0, x1, c.y + wy1, z1, x1, c.y + wy1, z1);
      const u = wd / (circuit ? 24 : 6) * (circuit ? -side : 1);   // flip on one side so the boards read the right way round
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
  if (mountain) {   // guard-rail posts every ~5 m
    const count = Math.floor(N / 3) * 2;
    const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.9, 0.12), new THREE.MeshStandardMaterial({ color: 0x6c7279, metalness: 0.6, roughness: 0.5 }), count);
    const pm = new THREE.Matrix4();
    let k = 0;
    for (let i = 0; i < N; i += 3) for (const side of [1, -1]) {
      const c = center[i], [nx, nz] = nrm[i], o = (WALL + 0.2) * side;
      posts.setMatrixAt(k++, pm.makeTranslation(c.x + nx * o, c.y + 0.45, c.z + nz * o));
    }
    posts.castShadow = true;
    group.add(posts);
  }

  if (mountain) mountainDetails({ group, center, tangents, nrm, N, WALL, rand, heightAt, near });
  const mid = center.reduce((m, p) => m.add(p), new THREE.Vector3()).multiplyScalar(1 / N);
  const sky = makeSky(); group.add(sky.mesh);
  const clouds = makeClouds(mid, rand); group.add(clouds.group);
  const horizon = makeHorizon(id, mid, rand); group.add(horizon.group);
  windows.push(...horizon.nightMats);
  return { id, group, center, tangents, nrm, N, length, wall: WALL, roadW: ROAD_W, start: { x: c0.x, y: c0.y, z: c0.z, heading: heading0 }, road, runoff, hemi, lamps, poles, windows, sky, clouds };
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
    // id: which tyre; (x, y, z) its contact point; (dx, dz) its across direction; on: leaving a mark
    mark(id, x, y, z, dx, dz, on) {
      const prev = last.get(id);
      if (on && prev) {
        const w = 0.14, a = next * 12, y0 = prev.y + 0.07, y1 = y + 0.07;
        const v = [prev.x - dx * w, y0, prev.z - dz * w, prev.x + dx * w, y0, prev.z + dz * w,
          x - dx * w, y1, z - dz * w, x + dx * w, y1, z + dz * w];
        pos.set(v, a);
        next = (next + 1) % MAX; used = Math.min(MAX, used + 1);
        geo.attributes.position.needsUpdate = true;
        geo.setDrawRange(0, used * 6);
      }
      last.set(id, on ? { x, y, z } : null);
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
    puff(x, y, z, strength) {
      const p = pool[k = (k + 1) % pool.length];
      p.s.position.set(x + (Math.random() - 0.5) * 0.3, y + 0.35, z + (Math.random() - 0.5) * 0.3);
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
        const x = cam.x + d.x, y = cam.y - 5 + d.y, z = cam.z + d.z, o = i * 6;
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
        <button id="dhTrack" title="ტრასის შეცვლა (T)">🗺</button>
        <button id="dhTilt" class="touch-only" title="დახრით მართვა">📱</button>
        <button id="dhMode" title="გადაცემათა კოლოფი: ავტომატი / მექანიკა (M)">A</button>
        <button id="dhAssist" title="დრიფტის დამხმარე: კონტრ-საჭე თავისით (H)">🅳</button>
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
    <p class="dh-help">W/↑ გაზი · S/↓ მუხრუჭი · A D / ← → საჭე · Space ხელის მუხრუჭი (დრიფტი) · M მექანიკა (E ▲ / Q ▼) · C კამერა · T ტრასა · H დრიფტის დამხმარე · G მოჩვენება · N ღამე · B წვიმა · R ტრასაზე · Esc გასვლა</p>
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

// Overlay with one card per track; resolves through onPick(id) or onCancel().
function trackPicker(stage, { current, recFor, onPick, onCancel }) {
  const el = document.createElement('div');
  el.className = 'track-pick';
  el.innerHTML = `<div class="tp-box"><h3>აირჩიე ტრასა</h3><div class="tp-cards">${Object.entries(TRACKS).map(([id, t]) => {
    const r = recFor(id);
    return `<button data-track="${id}" class="${id === current ? 'cur' : ''}"><span class="tp-ico">${t.icon}</span><b>${t.name}</b>
      <small>${t.desc}</small><small>${(trackLength(id) / 1000).toFixed(2)} კმ · გზის სიგანე ${t.roadW} მ</small>
      <em>🏁 ${fmt(r.lap)} · 💨 ${r.drift || '—'}</em></button>`;
  }).join('')}</div><button class="tp-cancel">გაუქმება</button></div>`;
  const close = () => el.remove();
  el.querySelectorAll('[data-track]').forEach(b => (b.onclick = () => { close(); onPick(b.dataset.track); }));
  el.querySelector('.tp-cancel').onclick = () => { close(); onCancel && onCancel(); };
  el.addEventListener('pointerdown', e => e.stopPropagation());
  stage.appendChild(el);
  return { el, close };
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
  let perf, wheelbase, redline, spec, phys, driver = null;
  // weight distribution (share on the rear axle) for cars whose engine sits behind the driver or far back
  const REAR_SHARE = { f40: 0.58, huracan: 0.58, r8: 0.58, gt3rs: 0.61, p930: 0.6, p911ts: 0.61, sls: 0.53, amggt: 0.53, golf1: 0.38, gtr: 0.46 };
  // chassis numbers for the tyre model: mass, axle distances, grip, centre of gravity height, yaw inertia
  function chassis(model) {
    const w = parseFloat(String((model.specs && model.specs.weight) || '').replace(/[^\d]/g, ''));
    const m = w > 500 && w < 4000 ? w : 1400;
    const L = Math.abs(model.wheel.x[0] - model.wheel.x[1]) || 2.6;
    const rear = REAR_SHARE[model.id] ?? (model.perf && model.perf.drive === 'fwd' ? 0.4 : 0.5);
    const a = L * rear, b = L - a;                    // CG → front axle, CG → rear axle
    const mu = model.id === 'dtm' ? 1.3 : model.era === 'classic' ? 0.95 : model.era === 'eighties' ? 1.0 : 1.1;
    const h = model.body === 'ჯიპი' ? 0.68 : model.dims && model.dims.L && model.era === 'modern' ? 0.46 : 0.52;
    return { m, a, b, L, mu, h, Iz: m * a * b * 1.05, drive: (model.perf && model.perf.drive) || 'rwd', r: model.wheel.r || 0.32 };
  }

  const IDLE = 850;
  const RATIOS = [0.25, 0.41, 0.57, 0.72, 0.86, 1.0];   // share of top speed reached at the redline, per gear
  const savedFog = { fog: null, bg: null };

  const keyMap = { KeyW: 'gas', ArrowUp: 'gas', KeyS: 'brake', ArrowDown: 'brake', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', Space: 'hand' };
  const onKey = down => e => {
    if (!st.active) return;
    if (picker) { if (down && e.code === 'Escape') { picker.close(); picker = null; st.paused = false; } return; }
    if (keyMap[e.code]) { keys[keyMap[e.code]] = down ? 1 : 0; e.preventDefault(); return; }
    if (!down) return;
    if (e.code === 'Escape') stop();
    else if (e.code === 'KeyC') toggleCam();
    else if (e.code === 'KeyT') choose(car, curModel);
    else if (e.code === 'KeyG') setGhost(!env.ghost);
    else if (e.code === 'KeyH') setAssist(!env.assist);
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
  const env = { night: pref('veloce-night', false), rain: pref('veloce-rain', false), ghost: pref('veloce-ghost', true), assist: pref('veloce-assist', true) };
  let sceneLights = [];      // the showroom's own lights, dimmed at night / in the rain
  let modelId = null, ghost = null, record = null, trace = [], traceT = 0, sectors = [], headLights = null;
  let trackId = 'circuit', curModel = null, picker = null;
  try { const t = localStorage.getItem('veloce-track'); if (TRACKS[t]) trackId = t; } catch { /* private mode */ }
  // records: the circuit keeps the plain car id (older saves), other tracks add @track
  const recKey = (id, t) => (t === 'circuit' ? id : `${id}@${t}`);
  const SECTORS = [0.25, 0.5, 0.75];

  function setEnv(patch) {
    Object.assign(env, patch);
    savePref('veloce-night', env.night); savePref('veloce-rain', env.rain);
    if (!track) return;
    const n = env.night, r = env.rain;
    const sky = n ? (r ? 0x0b0f16 : 0x0a1222) : (r ? 0x939ea9 : 0xc5dcf0);
    scene.background = new THREE.Color(sky);
    scene.fog = new THREE.Fog(sky, n ? 40 : r ? 60 : 260, n ? 330 : r ? 480 : 1750);
    const U = track.sky.uniforms;
    U.top.value.setHex(n ? (r ? 0x05070b : 0x02050d) : (r ? 0x5f6a76 : 0x3a7bd5));
    U.horizon.value.setHex(sky);
    U.below.value.setHex(n ? 0x05080e : r ? 0x7d8792 : 0x9fb3c4);
    U.sunColor.value.setHex(n ? 0xb9c8e8 : r ? 0x000000 : 0xfff2d6);
    U.sunSize.value = n ? 0.35 : 1;                          // at night the "sun" is a small moon
    U.stars.value = n && !r ? 0.9 : 0;
    track.clouds.set(n ? 0x2a3242 : r ? 0x7c848e : 0xffffff, n ? 0.25 : r ? 0.95 : 0.85);
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
    track.poles.visible = n || track.id === 'city';
    for (const m of track.windows) m.emissiveIntensity = n ? 1.1 : r ? 0.15 : 0;
    if (hud) { hud.querySelector('#dhNight').classList.toggle('on', n); hud.querySelector('#dhRain').classList.toggle('on', r); }
  }
  function setAssist(on) {
    env.assist = on; savePref('veloce-assist', on);
    if (hud) hud.querySelector('#dhAssist').classList.toggle('on', on);
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
  // road height and slope under (x, z), near centre-line sample i
  function groundAt(i, x, z) {
    const c = track.center[i], t = track.tangents[i], th = Math.hypot(t.x, t.z) || 1;
    const along = ((x - c.x) * t.x + (z - c.z) * t.z) / th;
    return { y: c.y + along * t.y / th, grade: t.y / th, tx: t.x / th, tz: t.z / th };
  }
  function showDelta(d) {
    if (!hud) return;
    const el = hud.querySelector('#dhDelta');
    el.textContent = `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(2)}`;
    el.className = 'dh-delta on ' + (d > 0 ? 'slow' : 'fast');
    clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('on'), 2200);
  }

  function toggleCam() { st.cam = st.cam === 'chase' ? 'cockpit' : 'chase'; }

  function nearestIdx(x = st.x, z = st.z, from = st.idx) {
    let best = from, bd = Infinity;
    for (let d = -40; d <= 40; d++) {
      const i = (from + d + track.N) % track.N, p = track.center[i];
      const dd = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (dd < bd) { bd = dd; best = i; }
    }
    return { i: best, dist: Math.sqrt(bd) };
  }

  function placeAtStart(at = { i: 0 }) {
    const i = typeof at === 'object' ? at.i : at;
    const p = track.center[i], t = track.tangents[i];
    st.x = p.x; st.y = p.y; st.z = p.z; st.heading = Math.atan2(-t.z, t.x); st.grade = 0;
    st.v = 0; st.vl = 0; st.yaw = 0; st.steer = 0; st.idx = i; st.drift = 0;
  }

  // shows the track cards; picking one starts (or restarts) the drive. The click on a card
  // is the user gesture that lets the page go full screen and play sound.
  function choose(theCar, model) {
    if (picker) return;
    const wasActive = st.active;
    st.paused = wasActive;
    Object.keys(keys).forEach(k => (keys[k] = 0));
    picker = trackPicker(stage, {
      current: trackId,
      recFor: id => loadRecords()[recKey(model.id, id)] || {},
      onPick: id => { picker = null; st.paused = false; if (wasActive) stop({ keep: true }); start(theCar, model, id); },
      onCancel: () => { picker = null; st.paused = false; },
    });
  }

  function start(theCar, model, id = trackId) {
    if (st.active) stop({ keep: true });
    car = theCar; curModel = model;
    trackId = TRACKS[id] ? id : 'circuit';
    try { localStorage.setItem('veloce-track', trackId); } catch { /* private mode */ }
    perf = model.perf || { vmax: 200, t100: 9 };
    modelId = model.id;
    record = loadRecords()[recKey(modelId, trackId)] || null;
    st.best = record && record.lap ? record.lap : null;
    st.driftBest = record && record.drift ? record.drift : 0;
    spec = engineSpec(model);
    redline = perf.redline || (model.era === 'classic' ? 5800 : 6800);
    st.gear = 1; st.rpm = IDLE; st.shift = 0;
    wheelbase = Math.abs(model.wheel.x[0] - model.wheel.x[1]);
    phys = chassis(model);
    st.ax = 0; st.ay = 0; st.wheelF = 0; st.wheelR = 0; st.spinR = 0; st.driftT = 0;
    track = buildTrack(trackId);
    car.root.rotation.order = 'YZX';                     // heading, then pitch on slopes
    track.skids = makeSkids(track.group);
    track.smoke = makeSmoke(track.group);
    track.flames = makeFlames(track.group);
    track.rain = makeRain(track.group);
    ghost = makeGhost(car); ghost.rotation.order = 'YZX'; ghost.userData.idx = 0; track.group.add(ghost);
    sceneLights = scene.children.filter(o => o.isLight && o !== keyLight).map(l => [l, l.intensity]);
    headLights = makeHeadLights();
    driver = createDriver(car);                              // after the ghost: the ghost car stays empty
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
    hud.querySelector('#dhTrack').onclick = () => choose(car, curModel);
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
    hud.querySelector('#dhAssist').onclick = () => setAssist(!env.assist);
    setAssist(env.assist);
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

  function stop({ keep = false } = {}) {
    if (!st.active) return;
    st.active = false; st.paused = false;
    if (picker) { picker.close(); picker = null; }
    if (!keep) { document.body.classList.remove('driving'); leaveLandscape(); }
    removeEventListener('devicemotion', onMotion); tilt.on = false;
    Object.keys(keys).forEach(k => (keys[k] = 0));
    if (ghost) track.group.remove(ghost);
    scene.remove(track.group);
    track.group.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m.map) m.map.dispose(); if (m.emissiveMap) m.emissiveMap.dispose(); m.dispose(); });
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
    if (driver) { driver.dispose(); driver = null; }
    if (headLights) { car.root.remove(headLights); headLights.traverse(o => { if (o.dispose) o.dispose(); }); headLights = null; }
    ghost = null;
    Object.assign(keyLight.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 1, far: 20 });
    keyLight.shadow.camera.updateProjectionMatrix();
    keyLight.position.set(4, 8, 5); keyLight.target.position.set(0, 0, 0);
    camera.near = 0.02; camera.far = 100;
    controls.enabled = true;
    if (car) {
      car.root.position.set(0, 0, 0); car.root.rotation.set(0, 0, 0); car.root.rotation.order = 'XYZ';
      car.body.rotation.set(0, 0, 0);
      if (car.setSteer) car.setSteer(0);
      if (car.setWheels) car.setWheels(0, 0, 0);
      if (car.setGauges) car.setGauges(0, 0);
    }
    if (!keep) onExit && onExit();
  }

  const fwd = new THREE.Vector3(), tmp = new THREE.Vector3(), look = new THREE.Vector3();

  function update(dt, snap = false) {
    if (!st.active || st.paused) return;
    dt = Math.max(dt, 1e-4);                                 // the snap call on start passes 0
    st.time += dt;
    const WALL = track.wall;
    const vmax = perf.vmax / 3.6;
    const a0 = (100 / 3.6) / perf.t100 * 1.25;
    const near = nearestIdx();
    const off = near.dist > WALL + 1;                      // only if something pushed the car past the barriers

    // ---- longitudinal (st.v = speed along the car, st.vl = sideways) ----
    // drift assist also works the throttle: past ~40° of slide it eases off so the car does not spin
    const beta0 = Math.atan2(-st.vl, Math.max(Math.abs(st.v), 1));
    const ease = env.assist && Math.abs(st.v) > 6 ? THREE.MathUtils.clamp((0.85 - Math.abs(beta0)) / 0.35, 0.2, 1) : 1;
    const throttle = keys.gas * ease, brake = keys.brake;
    const v0 = st.v;
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
    // slopes: gravity along the car (the handbrake holds it still)
    if (st.grade && !(keys.hand && Math.abs(st.v) < 1)) st.v -= 9.81 * st.grade * dt;
    if (off) {
      st.v -= Math.sign(st.v) * Math.min(Math.abs(st.v), (4 + 0.02 * st.v * st.v) * dt);
      st.v = Math.min(st.v, 75 / 3.6);
    }

    // ---- tyre loads: braking puts weight on the nose, acceleration on the tail ----
    const G = 9.81, M = phys.m, L = phys.L, A = phys.a, B = phys.b;
    const mu = phys.mu * (env.rain ? 0.7 : 1) * (off ? 0.5 : 1);
    const Fzf = Math.max(0.2 * M * G, M * G * B / L - M * st.ax * phys.h / L);
    const Fzr = Math.max(0.2 * M * G, M * G * A / L + M * st.ax * phys.h / L);

    // ---- traction: the driven tyres can only push so hard; the rest is wheelspin ----
    const aReq = (st.v - v0) / dt;                          // what engine / brakes / drag / slope asked for
    const shareF = phys.drive === 'fwd' ? 1 : phys.drive === 'awd' ? 0.4 : 0, shareR = 1 - shareF;
    let spin = 0;
    if (throttle && aReq > 0 && st.v > -0.5) {
      const cap = mu * (shareF * Fzf + shareR * Fzr) / M * (phys.drive === 'awd' ? 1 : 1.05);
      if (aReq > cap) { spin = Math.min(1, (aReq - cap) / Math.max(cap, 1)); st.v = v0 + cap * dt; }
    }
    const aLong = (st.v - v0) / dt;                         // what the tyres really transmit along the car
    // friction circle: force used to drive or brake is not available for cornering
    const brakeF = brake && st.v > 0.5 ? Math.max(0, -aReq) * M : 0;
    const latLeft = (Fx, Fz) => { const rho = Math.min(1, Math.abs(Fx) / (mu * Fz)); return Math.max(0.55, Math.sqrt(1 - rho * rho)); };
    const driveF = throttle && aLong > 0 ? aLong * M : 0;
    let kf = latLeft(driveF * shareF + brakeF * 0.65, Fzf) * (1 - 0.25 * spin * shareF);
    let kr = latLeft(driveF * shareR + brakeF * 0.35, Fzr) * (1 - 0.35 * spin * shareR);
    if (keys.hand) kr *= 0.45;                              // locked rear wheels hold much less sideways

    // ---- steering: digital keys turn the wheel at a limited rate; the assist adds counter-steer ----
    if (tilt.on) tilt.value += (tilt.raw - tilt.value) * (1 - Math.exp(-dt * 14));
    const steerIn = tilt.on && !keys.left && !keys.right ? tilt.value : keys.left - keys.right;
    const speed0 = Math.abs(st.v);
    const beta = Math.atan2(-st.vl, Math.max(speed0, 1));  // body slip angle, + = travelling to the left of the nose
    const slideK = THREE.MathUtils.clamp((Math.abs(beta) - 0.06) / 0.25, 0, 1) * THREE.MathUtils.clamp((speed0 - 4) / 4, 0, 1);
    // full lock asks for about what the tyres can give (≈ 1 g); counter-steer may use more
    const lock = Math.min(0.6, L * mu * G / Math.max(speed0 * speed0, 1) + 0.11);
    const counter = steerIn * beta > 0 ? 0.35 * slideK : 0;
    let want = steerIn * Math.min(0.62, lock + counter);
    if (env.assist && slideK > 0) want = THREE.MathUtils.clamp(want * 0.8 + beta * 0.9 * slideK, -0.65, 0.65);
    const rate = (tilt.on ? 6 : 2.6) * dt;
    st.steer += THREE.MathUtils.clamp(want - st.steer, -rate, rate);

    // ---- lateral dynamics: two axles, each tyre with a peak and a fall-off (x forward, y left) ----
    const tyre = al => Math.sin(1.3 * Math.atan(16 * al));  // peak near 9°, ~0.9 when fully sliding
    const steps = Math.max(1, Math.ceil(dt / (1 / 120))), h = dt / steps;
    let vx = st.v, vy = -st.vl, r = st.yaw, ay = 0;
    const delta = st.steer, cd = Math.cos(delta), sd = Math.sin(delta);
    for (let i = 0; i < steps; i++) {
      const sp = Math.abs(vx), vxs = Math.max(sp, 3), dir = vx < 0 ? -1 : 1;
      const af = Math.atan2(vy + A * r, vxs) - delta * dir;
      const ar = Math.atan2(vy - B * r, vxs);
      const Fyf = -mu * Fzf * kf * tyre(af), Fyr = -mu * Fzr * kr * tyre(ar);
      ay = (Fyf * cd + Fyr) / M;
      vy += (ay - vx * r) * h;
      r += (A * Fyf * cd - B * Fyr) / phys.Iz * h;
      // drift assist: like stability control, it will not let the car rotate faster than it can be caught
      if (env.assist && sp > 5) { const rSafe = 1.25 * mu * G / sp + 0.25; if (Math.abs(r) > rSafe) r -= (r - Math.sign(r) * rSafe) * Math.min(1, 4 * h); }
      vx += (vy * r - Fyf * sd / M) * h;
      // walking pace: the car simply follows its wheels
      if (sp < 4) {
        const k = THREE.MathUtils.clamp((sp - 1) / 3, 0, 1);
        r = k * r + (1 - k) * vx * Math.tan(delta) / L;
        vy *= 0.5 + 0.5 * k;
      }
    }
    if (off) vy *= 1 - Math.min(1, 1.5 * dt);              // grass digs in sideways
    st.v = vx; st.vl = -vy; st.yaw = r;
    st.ay += (ay - st.ay) * (1 - Math.exp(-dt * 8));
    st.ax += (aLong - st.ax) * (1 - Math.exp(-dt * 6));
    st.spinR = spin;
    const yaw = st.yaw;

    st.heading += yaw * dt;
    fwd.set(Math.cos(st.heading), 0, -Math.sin(st.heading));
    const right = new THREE.Vector3(Math.sin(st.heading), 0, Math.cos(st.heading));
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
      if (st.drift > 0) { st.drift = 0; st.driftT = 0; flash('დაიკარგა!'); }
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
          saveRecord(recKey(modelId, trackId), { lap, sectors: record.sectors, trace: record.trace });
          flash('რეკორდი!');
        }
      }
      st.lapStart = st.time; st.armed = false;
      trace = []; traceT = 0; sectors = [];
    }

    // road height under the car, and the slope along the car's heading
    const gr = groundAt(st.idx, st.x, st.z);
    st.y = gr.y;
    st.grade = gr.grade * (fwd.x * gr.tx + fwd.z * gr.tz);
    const pitch = Math.atan(st.grade), sPitch = Math.sin(pitch);

    // car transform + cosmetic body roll / pitch
    car.root.position.set(st.x, st.y, st.z);
    car.root.rotation.set(0, st.heading, pitch);
    st.roll += (THREE.MathUtils.clamp(-st.ay * 0.0055, -0.06, 0.06) - st.roll) * (1 - Math.exp(-dt * 6));
    st.pitch += (THREE.MathUtils.clamp(st.ax * 0.0024, -0.035, 0.025) - st.pitch) * (1 - Math.exp(-dt * 5));
    // road wheels: the front ones steer, all of them roll; spinning driven wheels turn faster
    st.wheelF += st.v * dt / phys.r * (phys.drive !== 'rwd' ? 1 + st.spinR * 2.5 : 1);
    st.wheelR += st.v * dt / phys.r * (phys.drive !== 'fwd' ? 1 + st.spinR * 2.5 : 1) * (keys.hand ? 0 : 1) + (keys.hand ? 0 : st.spinR * 14 * dt * (phys.drive !== 'fwd' ? 1 : 0));
    if (car.setWheels) car.setWheels(st.steer, st.wheelF, st.wheelR);
    car.body.rotation.set(st.roll, 0, st.pitch);
    if (car.setSteer) car.setSteer(st.steer * 7);            // steering wheel: ~7x the road-wheel angle
    if (driver) { driver.update(st.steer * 7); driver.setCockpit(st.cam === 'cockpit'); }

    // ---- drifting: points, skid marks, smoke, squeal ----
    const slipNow = Math.atan2(st.vl, Math.max(Math.abs(st.v), 1));
    const drifting = !off && Math.abs(slipNow) > 0.22 && st.v > 8;
    if (drifting) {
      st.driftT += dt;
      const mult = 1 + Math.min(1, st.driftT / 4);          // long, clean slides score up to double
      st.drift += Math.abs(slipNow) * st.v * dt * 6 * mult;
      st.driftIdle = 0;
    } else if (st.drift > 0 && (st.driftIdle += dt) > 0.7) {
      const pts = Math.round(st.drift);
      st.score += pts;
      if (pts > st.driftBest) { st.driftBest = pts; saveRecord(recKey(modelId, trackId), { drift: pts }); }
      flash(`+${pts}`);
      st.drift = 0; st.driftT = 0;
    }
    const burnout = st.spinR > 0.15 && phys.drive !== 'fwd';
    const skidding = (drifting || burnout || (keys.hand && Math.abs(st.v) > 4) || (brake && st.v > 14 && Math.abs(st.ax) > mu * 8.5)) && !off;
    const rx = car.model.wheel.x[1], hw = car.size.z * 0.38;
    for (const s of [1, -1]) {
      const wx = st.x + fwd.x * rx + right.x * hw * s, wz = st.z + fwd.z * rx + right.z * hw * s;
      const wy = st.y + sPitch * rx;
      track.skids.mark(s, wx, wy, wz, right.x, right.z, skidding);
      if ((drifting || burnout) && (st.smokeT += dt) > 0.035) track.smoke.puff(wx, wy, wz, Math.min(1, Math.abs(slipNow) + st.spinR));
    }
    if (st.smokeT > 0.035) st.smokeT = 0;
    track.smoke.update(dt);
    if (engine) engine.squeal(st.sound && skidding ? Math.min(1, Math.abs(slipNow) * 1.6 + (keys.hand ? 0.3 : 0)) : 0);
    const dEl = hud.querySelector('#dhDrift');
    if (st.drift > 0) { hud.querySelector('#dhDriftPts').textContent = Math.round(st.drift); hud.querySelector('#dhDriftLbl').textContent = `დრიფტი ${Math.round(Math.abs(slipNow) * 57.3)}° ×${(1 + Math.min(1, st.driftT / 4)).toFixed(1)}`; dEl.classList.add('on'); }
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
      if (show) {
        const gp = ghostAt(lapT), gi = nearestIdx(gp.x, gp.z, ghost.userData.idx).i, gg = groundAt(gi, gp.x, gp.z);
        ghost.userData.idx = gi;
        ghost.position.set(gp.x, gg.y, gp.z);
        ghost.rotation.set(0, gp.h, Math.atan(gg.grade * (Math.cos(gp.h) * gg.tx - Math.sin(gp.h) * gg.tz)));
      }
    }
    track.rain.update(dt, camera.position, fwd.x * st.v, fwd.z * st.v);
    track.sky.mesh.position.copy(camera.position);

    // shadows follow the car
    keyLight.position.set(st.x + 8, st.y + 16, st.z + 10);
    keyLight.target.position.set(st.x, st.y, st.z);

    // camera
    if (st.cam === 'chase') {
      const back = car.size.x * 1.15 + 3.2, up = car.size.y + 1.25;
      const sp = Math.hypot(st.v, st.vl);
      const dir = sp > 4 ? new THREE.Vector3(fwd.x * st.v + right.x * st.vl, 0, fwd.z * st.v + right.z * st.vl).normalize().lerp(fwd, 0.6).normalize() : fwd;
      tmp.set(st.x - dir.x * back, st.y - sPitch * back + up, st.z - dir.z * back);
      if (snap) camera.position.copy(tmp);
      else camera.position.lerp(tmp, 1 - Math.exp(-dt * 5));
      look.set(st.x + fwd.x * 4, st.y + sPitch * 4 + car.size.y * 0.6, st.z + fwd.z * 4);
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
      look.copy(eye).addScaledVector(fwd, 10 * Math.cos(pitch)); look.y += 10 * sPitch - 0.6;
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
        track.flames.burst(st.x - fwd.x * ex, st.y - sPitch * ex + 0.32, st.z - fwd.z * ex, fwd.x, fwd.z);
      }
    }
    track.flames.update(dt);
  }

  // debug hook used by the automated test driver
  return { start, stop, update, choose, get active() { return st.active; }, get track() { return trackId; }, get debug() { return { st, track, keys, env, setEnv }; } };
}
