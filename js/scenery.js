// Scenery for the test-drive tracks: sky dome with sun and stars, clouds, a
// ring of distant hills / peaks / skyline, and the track-side details of each
// track (pit building, fences, tyre stacks, crossings, traffic lights, street
// trees, shopfronts, chevron signs, rocks …). Everything is built from simple
// geometry and canvas textures, mostly instanced, so phones can draw it.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export function canvasTex(w, h, draw, repeat = [1, 1]) {
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

/* ---------- sky ---------- */
// A big sphere that follows the camera: zenith → horizon gradient, a sun with a glow, stars at night.
export function makeSky() {
  const uniforms = {
    top: { value: new THREE.Color(0x3d7fd6) }, horizon: { value: new THREE.Color(0xc5dcf0) }, below: { value: new THREE.Color(0x9fb3c4) },
    sunDir: { value: new THREE.Vector3(0.45, 0.55, 0.7).normalize() }, sunColor: { value: new THREE.Color(0xfff2d6) }, sunSize: { value: 1 },
    stars: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: `varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform vec3 top, horizon, below, sunColor, sunDir; uniform float sunSize, stars; varying vec3 vDir;
      float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      void main() {
        float h = vDir.y;
        vec3 col = h > 0.0 ? mix(horizon, top, pow(smoothstep(0.0, 0.62, h), 0.75)) : mix(horizon, below, smoothstep(0.0, -0.08, h));
        float d = max(dot(normalize(vDir), normalize(sunDir)), 0.0);
        col += sunColor * (pow(d, 900.0 / sunSize) * 2.2 + pow(d, 12.0) * 0.18 * sunSize);
        if (stars > 0.0 && h > 0.0) { vec3 q = floor(vDir * 420.0); float s = step(0.9965, hash(q)); col += vec3(s) * stars * smoothstep(0.02, 0.25, h); }
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1300, 32, 16), mat);
  mesh.frustumCulled = false; mesh.renderOrder = -10;
  return { mesh, uniforms };
}

// soft clouds: a few dozen sprites high above the track
export function makeClouds(centre, rand) {
  const tex = canvasTex(256, 128, (g, w, h) => {
    for (let i = 0; i < 26; i++) {
      const x = w * (0.18 + rand() * 0.64), y = h * (0.45 + rand() * 0.25), r = 18 + rand() * 34;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,0.85)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    }
  });
  const group = new THREE.Group();
  const mats = [];
  for (let i = 0; i < 34; i++) {
    const m = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, opacity: 0.9 });
    mats.push(m);
    const s = new THREE.Sprite(m);
    const a = rand() * Math.PI * 2, r = 250 + rand() * 850;
    s.position.set(centre.x + Math.cos(a) * r, 230 + rand() * 160, centre.z + Math.sin(a) * r);
    const k = 160 + rand() * 260; s.scale.set(k, k * 0.42, 1);
    group.add(s);
  }
  return { group, set(color, opacity) { mats.forEach(m => { m.color.set(color); m.opacity = opacity; }); } };
}

// ring of distant land around the track: rolling hills, snowy peaks or a city skyline
export function makeHorizon(kind, centre, rand) {
  const group = new THREE.Group();
  if (kind === 'city') {
    const n = 220, geo = new THREE.BoxGeometry(1, 1, 1); geo.translate(0, 0.5, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0x5d6878, roughness: 0.9, emissive: 0xffd9a0, emissiveIntensity: 0 });
    const tex = canvasTex(64, 128, (g, w, h) => { g.fillStyle = '#000'; g.fillRect(0, 0, w, h); for (let y = 4; y < h; y += 8) for (let x = 3; x < w; x += 8) if (rand() < 0.35) { g.fillStyle = '#fff'; g.fillRect(x, y, 4, 4); } });
    mat.emissiveMap = tex;
    const inst = new THREE.InstancedMesh(geo, mat, n), m4 = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rand() * 0.02, r = 520 + rand() * 420, w = 18 + rand() * 30;
      m4.compose(new THREE.Vector3(centre.x + Math.cos(a) * r, 0, centre.z + Math.sin(a) * r), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * 3), new THREE.Vector3(w, 30 + Math.pow(rand(), 2) * 150, w));
      inst.setMatrixAt(i, m4);
    }
    group.add(inst);
    return { group, nightMats: [mat] };
  }
  // a band of hills: heights from a few sine waves; peaks get snow
  const peaks = kind === 'mountain', seg = 360, R0 = 1050;
  const pos = [], col = [], idx = [];
  const ph = [rand() * 6, rand() * 6, rand() * 6, rand() * 6];
  const low = new THREE.Color(peaks ? 0x55705a : 0x6f8f6a), high = new THREE.Color(peaks ? 0x7d828c : 0x8aa58a), snow = new THREE.Color(0xf2f5f8), c = new THREE.Color();
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const hgt = peaks
      ? 120 + 110 * Math.pow(Math.abs(Math.sin(a * 3 + ph[0])), 1.5) + 70 * Math.sin(a * 7 + ph[1]) + 35 * Math.sin(a * 17 + ph[2]) + 15 * Math.sin(a * 41 + ph[3])
      : 45 + 35 * Math.sin(a * 4 + ph[0]) + 22 * Math.sin(a * 9 + ph[1]) + 10 * Math.sin(a * 23 + ph[2]);
    for (const [r, y] of [[R0 + 140, -20], [R0, Math.max(10, hgt)]]) {
      pos.push(centre.x + Math.cos(a) * r, y, centre.z + Math.sin(a) * r);
      const t = Math.max(0, y) / 300;
      c.copy(low).lerp(high, Math.min(1, t * 2.2));
      if (peaks && y > 190) c.lerp(snow, Math.min(1, (y - 190) / 40));
      col.push(c.r, c.g, c.b);
    }
    if (i < seg) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx); geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  group.add(mesh);
  return { group, nightMats: [] };
}

/* ---------- surfaces ---------- */
function speckle(g, w, h, base, n, spread, rand) {
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  for (let i = 0; i < n; i++) {
    const v = Math.floor((rand() - 0.5) * spread), k = v > 0 ? 255 : 0;
    g.fillStyle = `rgba(${k},${k},${k},${Math.abs(v) / 255})`;
    g.fillRect(rand() * w, rand() * h, 1 + rand() * 2, 1 + rand() * 2);
  }
}
// asphalt with fine aggregate, a darker rubbered line, repair patches and the road markings
export function asphaltTexture(kind, rand) {
  return canvasTex(512, 1024, (g, w, h) => {
    speckle(g, w, h, kind === 'mountain' ? '#43454a' : '#3b3d42', 36000, 70, rand);
    if (kind !== 'city') { const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0.2, 'rgba(0,0,0,0)'); gr.addColorStop(0.42, 'rgba(10,10,12,0.22)'); gr.addColorStop(0.58, 'rgba(10,10,12,0.22)'); gr.addColorStop(0.8, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }
    for (let i = 0; i < 5; i++) { g.fillStyle = `rgba(${rand() < 0.5 ? '20,20,24' : '90,92,96'},0.18)`; g.fillRect(rand() * w * 0.8, rand() * h, w * (0.08 + rand() * 0.2), h * (0.03 + rand() * 0.08)); }
    g.strokeStyle = 'rgba(15,15,18,0.35)'; g.lineWidth = 1.5;
    for (let i = 0; i < 6; i++) { g.beginPath(); let x = rand() * w, y = rand() * h; g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (rand() - 0.5) * 40; y += rand() * 30; g.lineTo(x, y); } g.stroke(); }
    g.fillStyle = '#f2f2f2';
    if (kind !== 'city') { g.fillRect(w * 0.035, 0, w * 0.025, h); g.fillRect(w * 0.94, 0, w * 0.025, h); }
    g.fillStyle = kind === 'city' ? '#e8d24a' : '#f2f2f2';
    g.fillRect(w * 0.49, 0, w * 0.02, h * 0.45);
  });
}
// mown grass: alternating light / dark bands with some noise
export function grassTexture(rand) {
  return canvasTex(512, 512, (g, w, h) => {
    speckle(g, w, h, '#4f7d3b', 30000, 60, rand);
    for (let y = 0; y < h; y += 128) { g.fillStyle = 'rgba(255,255,220,0.07)'; g.fillRect(0, y, w, 64); }
    for (let i = 0; i < 40; i++) { const x = rand() * w, y = rand() * h, r = 10 + rand() * 40, gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(${rand() < 0.5 ? '40,60,20' : '110,130,60'},0.25)`); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
  }, [140, 140]);
}

/* ---------- helpers for the details ---------- */
const UP = new THREE.Vector3(0, 1, 0);
const yawQ = a => new THREE.Quaternion().setFromAxisAngle(UP, a);
function instanced(geo, mat, list, shadow = true) {       // list of [pos, quat, scale]
  const m = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length)), m4 = new THREE.Matrix4();
  list.forEach(([p, q, s], i) => m.setMatrixAt(i, m4.compose(p, q || new THREE.Quaternion(), s || new THREE.Vector3(1, 1, 1))));
  m.count = list.length; m.castShadow = shadow; m.receiveShadow = true;
  return m;
}
// bends: [index range, side (+1 = turning left, outside is +nrm … see below)]
function bends(tangents, N, threshold, win = 6) {
  const out = []; let cur = null;
  for (let i = 0; i < N; i++) {
    const t0 = tangents[i], t1 = tangents[(i + win) % N], turn = t0.x * t1.z - t0.z * t1.x;
    if (Math.abs(turn) > threshold) { if (!cur || cur.end !== i - 1) { cur = { start: i, end: i, side: Math.sign(turn), peak: Math.abs(turn) }; out.push(cur); } else { cur.end = i; cur.peak = Math.max(cur.peak, Math.abs(turn)); } }
  }
  return out;
}

// broad-leaf trees and bushes (instanced, two greens), used by the circuit and the city
function roundTrees(spots, rand) {
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.28, 3, 6); trunkGeo.translate(0, 1.5, 0);
  const crownGeo = new THREE.IcosahedronGeometry(2.1, 1); crownGeo.translate(0, 4.2, 0);
  const trunk = instanced(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x5a3f2a, roughness: 1 }), spots.map(([p, s]) => [p, yawQ(rand() * 6), new THREE.Vector3(s, s, s)]));
  const crown = instanced(crownGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }), spots.map(([p, s]) => [p, yawQ(rand() * 6), new THREE.Vector3(s * (0.9 + rand() * 0.3), s * (0.85 + rand() * 0.4), s * (0.9 + rand() * 0.3))]));
  const c = new THREE.Color(), greens = [0x3f6e2f, 0x4d7f35, 0x5b8a3a, 0x355f2a, 0x6b8f3e];
  spots.forEach((_, i) => crown.setColorAt(i, c.setHex(greens[Math.floor(rand() * greens.length)])));
  return [trunk, crown];
}

/* ---------- circuit ---------- */
export function circuitDetails(ctx) {
  const { group, center, tangents, nrm, N, WALL, ROAD_W, rand, keepOut } = ctx;
  const out = {};
  // pit building and pit lane on the far side of the start straight
  const c0 = center[0], t0 = tangents[0], [nx0, nz0] = nrm[0], heading0 = Math.atan2(-t0.z, t0.x);
  const pitTex = canvasTex(512, 128, (g, w, h) => {
    g.fillStyle = '#d9dde3'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 8; i++) {                       // garages with roller doors and team colours
      const x = i * 64 + 6; g.fillStyle = '#5c6470'; g.fillRect(x, 54, 52, 70);
      for (let k = 58; k < 124; k += 6) { g.fillStyle = '#6f7884'; g.fillRect(x, k, 52, 2); }
      g.fillStyle = ['#e23a2e', '#2f6fb3', '#f2c200', '#1f9d55', '#7a3cc2', '#ff7a00', '#111', '#4fb3ff'][i]; g.fillRect(x, 44, 52, 8);
    }
    g.fillStyle = '#26313d'; g.fillRect(0, 6, w, 30);   // upper floor windows
    for (let x = 4; x < w; x += 32) { g.fillStyle = '#5b7fa6'; g.fillRect(x, 9, 26, 24); }
  });
  const pit = new THREE.Group();
  const len = 96, dep = 14, hgt = 8;
  const bodyMat = [new THREE.MeshStandardMaterial({ color: 0xd9dde3, roughness: 0.8 }), new THREE.MeshStandardMaterial({ color: 0xd9dde3, roughness: 0.8 }), new THREE.MeshStandardMaterial({ color: 0x8c939c, roughness: 0.7 }), new THREE.MeshStandardMaterial({ color: 0x8c939c }), new THREE.MeshStandardMaterial({ map: pitTex, roughness: 0.7 }), new THREE.MeshStandardMaterial({ color: 0xd9dde3 })];
  pitTex.repeat.set(len / 64, 1);
  const box = new THREE.Mesh(new THREE.BoxGeometry(len, hgt, dep), bodyMat); box.position.set(0, hgt / 2, 0); box.castShadow = box.receiveShadow = true; pit.add(box);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(len + 2, 0.5, dep + 5), new THREE.MeshStandardMaterial({ color: 0x2a2d33, metalness: 0.5, roughness: 0.4 })); roof.position.set(0, hgt + 0.25, 2); roof.castShadow = true; pit.add(roof);
  const tower = new THREE.Mesh(new THREE.BoxGeometry(10, 7, 10), new THREE.MeshStandardMaterial({ color: 0x26313d, roughness: 0.3, metalness: 0.4 })); tower.position.set(len * 0.32, hgt + 4, 0); tower.castShadow = true; pit.add(tower);
  const sign = canvasTex(256, 64, (g, w, h) => { g.fillStyle = '#0b0f14'; g.fillRect(0, 0, w, h); g.fillStyle = '#4fb3ff'; g.font = 'bold 40px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('VELOCE', w / 2, h / 2); });
  const signM = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.2), new THREE.MeshBasicMaterial({ map: sign })); signM.position.set(len * 0.32, hgt + 4, 5.05); pit.add(signM);
  const pitDist = WALL + 9 + dep / 2;
  pit.position.set(c0.x - nx0 * pitDist + t0.x * 10, c0.y, c0.z - nz0 * pitDist + t0.z * 10);
  pit.rotation.y = heading0;
  group.add(pit);
  const lane = new THREE.Mesh(new THREE.PlaneGeometry(len + 30, 8.5), new THREE.MeshStandardMaterial({ color: 0x3a3c41, roughness: 0.9 }));
  lane.rotation.set(-Math.PI / 2, 0, heading0); lane.position.set(c0.x - nx0 * (WALL + 5) + t0.x * 10, c0.y + 0.015, c0.z - nz0 * (WALL + 5) + t0.z * 10);
  lane.receiveShadow = true; group.add(lane);
  keepOut.push({ x: pit.position.x, z: pit.position.z, r: len * 0.62 });

  // tyre stacks behind the barrier and a catch fence on the outside of every bend
  const tyres = [], posts = [], fence = [];
  const fenceTex = canvasTex(64, 64, (g) => { g.clearRect(0, 0, 64, 64); g.strokeStyle = 'rgba(200,205,210,0.9)'; g.lineWidth = 2; for (let k = -64; k < 128; k += 12) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + 64, 64); g.stroke(); g.beginPath(); g.moveTo(k + 64, 0); g.lineTo(k, 64); g.stroke(); } });
  for (const b of bends(tangents, N, 0.02)) {
    for (let i = b.start; i <= b.end; i += 3) {
      const k = i % N, c = center[k], [nx, nz] = nrm[k], o = b.side * (WALL + 1.0);
      for (let lvl = 0; lvl < 4; lvl++) tyres.push([new THREE.Vector3(c.x + nx * o, c.y + 0.16 + lvl * 0.27, c.z + nz * o), null, null]);
    }
    for (let i = b.start; i <= b.end + 1; i += 2) {
      const k = i % N, c = center[k], [nx, nz] = nrm[k], o = b.side * (WALL + 0.35);
      fence.push([c.x + nx * o, c.y, c.z + nz * o]);
      if ((i - b.start) % 4 === 0) posts.push([new THREE.Vector3(c.x + nx * o, c.y + 2.0, c.z + nz * o), null, null]);
    }
    fence.push(null);
  }
  const tyreGeo = new THREE.TorusGeometry(0.29, 0.12, 6, 12); tyreGeo.rotateX(Math.PI / 2);
  const tyreMesh = instanced(tyreGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 }), tyres);
  const tc = new THREE.Color(); tyres.forEach((_, i) => tyreMesh.setColorAt(i, tc.setHex(i % 4 === 3 ? (Math.floor(i / 4) % 2 ? 0xd42a2a : 0xeeeeee) : 0x161618)));
  group.add(tyreMesh);
  group.add(instanced(new THREE.CylinderGeometry(0.05, 0.05, 4, 6), new THREE.MeshStandardMaterial({ color: 0x8c939c, metalness: 0.6, roughness: 0.4 }), posts));
  // fence strips: one ribbon per bend, from the barrier top up to 4 m
  const fp = [], fu = [], fi = [];
  let run = [];
  const flush = () => {
    if (run.length > 1) {
      let d = 0;
      run.forEach((p, j) => {
        if (j) d += Math.hypot(p[0] - run[j - 1][0], p[2] - run[j - 1][2]);
        const b0 = fp.length / 3; fp.push(p[0], p[1] + 0.95, p[2], p[0], p[1] + 4, p[2]); fu.push(d / 3, 0, d / 3, 1);
        if (j) fi.push(b0 - 2, b0, b0 - 1, b0 - 1, b0, b0 + 1);
      });
    }
    run = [];
  };
  fence.forEach(p => { if (p) run.push(p); else flush(); }); flush();
  const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3)); fg.setAttribute('uv', new THREE.Float32BufferAttribute(fu, 2)); fg.setIndex(fi);
  fenceTex.repeat.set(1, 3.05 / 0.9);
  group.add(new THREE.Mesh(fg, new THREE.MeshStandardMaterial({ map: fenceTex, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, metalness: 0.5, roughness: 0.5 })));

  // marshal posts every ~180 m on the outside
  const huts = [];
  for (let i = 40; i < N; i += 130) { const c = center[i], [nx, nz] = nrm[i], s = i % 260 < 130 ? 1 : -1; huts.push([new THREE.Vector3(c.x + nx * s * (WALL + 3.5), c.y + 1.3, c.z + nz * s * (WALL + 3.5)), yawQ(Math.atan2(-tangents[i].z, tangents[i].x)), null]); }
  group.add(instanced(new THREE.BoxGeometry(2.2, 2.6, 2.2), new THREE.MeshStandardMaterial({ color: 0xf2f2f0, roughness: 0.7 }), huts));
  group.add(instanced(new THREE.BoxGeometry(2.6, 0.25, 2.6), new THREE.MeshStandardMaterial({ color: 0xe8611f }), huts.map(([p, q]) => [p.clone().add(new THREE.Vector3(0, 1.4, 0)), q, null])));
  return out;
}

// the circuit's barrier texture: advertising panels above a red / white base
export function circuitWallTexture() {
  return canvasTex(1024, 128, (g, w, h) => {
    const ads = [['VELOCE', '#0b0f14', '#4fb3ff'], ['GARAGE', '#f2c200', '#111'], ['3D', '#e23a2e', '#fff'], ['TEST DRIVE', '#1f2a3a', '#fff'], ['KM/H', '#f2f2f0', '#e23a2e'], ['VELOCE', '#1f9d55', '#fff']];
    const pw = w / ads.length;
    ads.forEach(([txt, bg, fg], i) => {
      g.fillStyle = bg; g.fillRect(i * pw, 0, pw, h * 0.7); g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = 'bold 54px Arial'; const size = Math.min(54, 54 * pw * 0.82 / g.measureText(txt).width); g.font = `bold ${Math.floor(size)}px Arial`;
      g.fillText(txt, i * pw + pw / 2, h * 0.36);
    });
    for (let x = 0; x < w; x += 32) { g.fillStyle = (x / 32) % 2 ? '#eeeeee' : '#d42a2a'; g.fillRect(x, h * 0.7, 32, h * 0.3); }
  });
}

/* ---------- city ---------- */
export function cityDetails(ctx) {
  const { group, center, tangents, nrm, N, WALL, ROAD_W, rand, nearest, placed } = ctx;
  const out = { nightMats: [], lights: [] };
  // zebra crossings and traffic lights before every corner
  const zebra = [], poles = [], heads = [], lamps = [];
  for (const b of bends(tangents, N, 0.25, 10)) {
    const i = (b.start - 8 + N) % N, c = center[i], t = tangents[i], [nx, nz] = nrm[i], yaw = Math.atan2(-t.z, t.x);
    for (let k = -ROAD_W / 2 + 0.6; k < ROAD_W / 2 - 0.4; k += 1.0) zebra.push([new THREE.Vector3(c.x + nx * k, c.y + 0.055, c.z + nz * k), yawQ(yaw), null]);
    for (const s of [1, -1]) {
      const o = s * (WALL - 0.7), p = new THREE.Vector3(c.x + nx * o, c.y, c.z + nz * o);
      poles.push([p.clone().add(new THREE.Vector3(0, 1.8, 0)), null, null]);
      heads.push([p.clone().add(new THREE.Vector3(0, 3.7, 0)), yawQ(yaw), null]);
      lamps.push([p.clone().add(new THREE.Vector3(t.x * 0.2, 3.62, t.z * 0.2)), null, null]);
    }
  }
  const zg = new THREE.PlaneGeometry(2.8, 0.5); zg.rotateX(-Math.PI / 2);
  group.add(instanced(zg, new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }), zebra, false));
  group.add(instanced(new THREE.CylinderGeometry(0.07, 0.09, 3.6, 8), new THREE.MeshStandardMaterial({ color: 0x2a2d33, metalness: 0.5, roughness: 0.5 }), poles));
  group.add(instanced(new THREE.BoxGeometry(0.32, 0.9, 0.32), new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.6 }), heads));
  const green = new THREE.MeshStandardMaterial({ color: 0x1b5e20, emissive: 0x33ff66, emissiveIntensity: 1.6 });
  group.add(instanced(new THREE.SphereGeometry(0.09, 10, 8), green, lamps, false));

  // street trees in planters between the barrier and the buildings
  const spots = [];
  for (let i = 0, s = 1; i < N; i += 11, s = -s) {
    const c = center[i], [nx, nz] = nrm[i], o = s * (WALL + 1.7), x = c.x + nx * o, z = c.z + nz * o;
    if (nearest(x, z, 2).d < WALL + 1.2) continue;
    if (placed.some(([px, pz, pr]) => Math.hypot(px - x, pz - z) < pr * 0.75)) continue;
    spots.push([new THREE.Vector3(x, c.y, z), 0.55 + rand() * 0.2]);
  }
  roundTrees(spots, rand).forEach(m => group.add(m));
  return out;
}

// shopfronts along the bottom of a city block and a few boxes on its roof
export function cityBlockExtras(list, rand) {
  // list: [{ x, z, y, w, h, d, yaw }]
  const shop = canvasTex(256, 64, (g, w, h) => {
    g.fillStyle = '#20252c'; g.fillRect(0, 0, w, h);
    const aw = ['#c0392b', '#2f6fb3', '#1f9d55', '#e8a020', '#7a3cc2', '#f2f2f0'];
    for (let x = 0; x < w; x += 64) { g.fillStyle = '#6f8fae'; g.fillRect(x + 4, 22, 56, 38); g.fillStyle = aw[(x / 64) % aw.length]; g.fillRect(x + 2, 8, 60, 12); for (let k = 2; k < 62; k += 8) { g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(x + k, 8, 4, 12); } }
  });
  const lit = canvasTex(256, 64, (g, w, h) => { g.fillStyle = '#000'; g.fillRect(0, 0, w, h); for (let x = 0; x < w; x += 64) { g.fillStyle = rand() < 0.75 ? '#ffe2a8' : '#000'; g.fillRect(x + 4, 22, 56, 38); } });
  const shops = [], roofs = [];
  for (const b of list) {
    const g = new THREE.BoxGeometry(b.w + 0.3, 4.2, b.d + 0.3);
    const uv = g.attributes.uv;
    for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) { const k = f * 4 + v; if (f === 2 || f === 3) { uv.setXY(k, 0.01, 0.95); continue; } uv.setXY(k, uv.getX(k) * (f < 2 ? b.d : b.w) / 16, uv.getY(k)); }
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(b.x, b.y + 2.1, b.z), yawQ(b.yaw), new THREE.Vector3(1, 1, 1)));
    shops.push(g);
    for (let k = 0; k < 2 + Math.floor(rand() * 3); k++) {
      const r = new THREE.BoxGeometry(1.5 + rand() * 3, 1 + rand() * 2.2, 1.5 + rand() * 3);
      const lx = (rand() - 0.5) * (b.w - 4), lz = (rand() - 0.5) * (b.d - 4);
      const off = new THREE.Vector3(lx, 0, lz).applyQuaternion(yawQ(b.yaw));
      r.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(b.x + off.x, b.y + b.h + 0.8, b.z + off.z), yawQ(b.yaw), new THREE.Vector3(1, 1, 1)));
      roofs.push(r);
    }
  }
  const meshes = [], nightMats = [];
  if (shops.length) {
    const mat = new THREE.MeshStandardMaterial({ map: shop, emissiveMap: lit, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.6 });
    const m = new THREE.Mesh(mergeGeometries(shops), mat); m.receiveShadow = true; meshes.push(m); nightMats.push(mat);
    shops.forEach(g => g.dispose());
  }
  if (roofs.length) { const m = new THREE.Mesh(mergeGeometries(roofs), new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.8 })); m.castShadow = true; meshes.push(m); roofs.forEach(g => g.dispose()); }
  return { meshes, nightMats };
}

/* ---------- mountain ---------- */
export function mountainDetails(ctx) {
  const { group, center, tangents, nrm, N, WALL, rand, heightAt, near } = ctx;
  // white reflector posts on both sides
  const posts = [], caps = [];
  for (let i = 0; i < N; i += 9) for (const s of [1, -1]) {
    const c = center[i], [nx, nz] = nrm[i], o = s * (WALL + 0.6);
    posts.push([new THREE.Vector3(c.x + nx * o, c.y + 0.55, c.z + nz * o), null, null]);
    caps.push([new THREE.Vector3(c.x + nx * o, c.y + 0.9, c.z + nz * o), null, null]);
  }
  group.add(instanced(new THREE.BoxGeometry(0.1, 1.1, 0.1), new THREE.MeshStandardMaterial({ color: 0xf2f2f0, roughness: 0.6 }), posts));
  group.add(instanced(new THREE.BoxGeometry(0.11, 0.18, 0.11), new THREE.MeshStandardMaterial({ color: 0x15171a, emissive: 0xff8a00, emissiveIntensity: 0.25 }), caps, false));
  // chevron boards on the outside of the tight bends, facing the traffic
  const chev = canvasTex(128, 64, (g, w, h) => { g.fillStyle = '#f2c200'; g.fillRect(0, 0, w, h); g.fillStyle = '#111'; for (let x = 8; x < w; x += 40) { g.beginPath(); g.moveTo(x, 6); g.lineTo(x + 22, h / 2); g.lineTo(x, h - 6); g.lineTo(x + 12, h - 6); g.lineTo(x + 34, h / 2); g.lineTo(x + 12, 6); g.fill(); } });
  const boards = [], bposts = [];
  for (const b of bends(tangents, N, 0.06, 8)) {
    for (let i = b.start; i <= b.end; i += 7) {
      const k = i % N, c = center[k], [nx, nz] = nrm[k], t = tangents[k], o = b.side * (WALL + 1.2);
      const yaw = Math.atan2(-t.z, t.x) + Math.PI / 2 * 0;     // the board faces back along the road
      boards.push([new THREE.Vector3(c.x + nx * o, c.y + 1.15, c.z + nz * o), yawQ(yaw - Math.PI / 2), null]);
      bposts.push([new THREE.Vector3(c.x + nx * o, c.y + 0.5, c.z + nz * o), null, null]);
    }
  }
  const bg = new THREE.PlaneGeometry(1.4, 0.7);
  group.add(instanced(bg, new THREE.MeshStandardMaterial({ map: chev, side: THREE.DoubleSide, roughness: 0.5 }), boards));
  group.add(instanced(new THREE.CylinderGeometry(0.04, 0.04, 1, 6), new THREE.MeshStandardMaterial({ color: 0x8c939c, metalness: 0.6 }), bposts));
  // rocks scattered off the road
  const rocks = [];
  for (let tries = 0; rocks.length < 260 && tries < 3000; tries++) {
    const x = (rand() - 0.5) * 1100 + 40, z = (rand() - 0.5) * 900 - 140;
    if (near(x, z, WALL + 6)) continue;
    const s = 0.6 + Math.pow(rand(), 2) * 3.5;
    rocks.push([new THREE.Vector3(x, heightAt(x, z) + s * 0.25, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rand() * 3, rand() * 3, rand() * 3)), new THREE.Vector3(s, s * (0.5 + rand() * 0.4), s * (0.7 + rand() * 0.6))]);
  }
  const rockMesh = instanced(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true }), rocks);
  const rc = new THREE.Color(); rocks.forEach((_, i) => rockMesh.setColorAt(i, rc.setHSL(0.08, 0.06, 0.38 + rand() * 0.18)));
  group.add(rockMesh);
  return {};
}

export { roundTrees, bends };
