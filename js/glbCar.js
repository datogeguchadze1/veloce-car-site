// Loads a real car model (.gltf / .glb) and wraps it in the interface main.js
// and drive.js use:
//   root, body, doors, hood, trunk, driverEye, size, target, open,
//   tuning, baseTuning, caps, applyTuning(), update(dt), dispose()
//
// Per-model settings live in models.js under `glb` (see README, "Real models").
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { FINISHES, TINTS, LIGHTS, INTERIORS, RIM_COLORS, defaultTuning } from './tuning.js';
import { buildCabin } from './cabinKit.js';

let draco;
// A fresh loader per model so its LoadingManager can report progress
// (files done / files total: the .gltf, the .bin and every texture).
function makeLoader(onProgress) {
  if (!draco) draco = new DRACOLoader().setDecoderPath('./vendor/three/jsm/libs/draco/gltf/');
  const manager = new THREE.LoadingManager();
  if (onProgress) manager.onProgress = (_url, done, total) => onProgress(total ? done / total : 0);
  return new GLTFLoader(manager).setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder);
}

const ease = v => v * v * (3 - 2 * v);
const toList = v => (v == null ? [] : Array.isArray(v) ? v : [v]);
const matches = (name, pat) => {
  if (!name) return false;
  if (pat instanceof RegExp) return pat.test(name);
  return name === pat || name.toLowerCase().includes(String(pat).toLowerCase());
};

const GLASS_RE = /glass|window|windscreen|windshield/i;
const NOT_PAINT_RE = /glass|window|tire|tyre|rubber|chrome|interior|light|lamp|rim|wheel|brake|caliper|plastic|black|trim|logo|badge|seat|leather|carbon|grille|exhaust|engine|metal/i;

function findNodes(root, pats) {
  const out = [];
  const list = toList(pats);
  if (!list.length) return out;
  root.traverse(o => { if (list.some(p => matches(o.name, p))) out.push(o); });
  // keep only outermost matches (a door's child meshes must not become doors)
  return out.filter(o => !out.some(p => p !== o && isAncestor(p, o)));
}
function isAncestor(a, b) { for (let p = b.parent; p; p = p.parent) if (p === a) return true; return false; }

// Connected pieces of a mesh, with their bounding boxes in car coordinates.
function pieces(mesh, toBody) {
  const geo = mesh.geometry, pos = geo.attributes.position, idx = geo.index;
  const M = new THREE.Matrix4().multiplyMatrices(toBody, mesh.matrixWorld), v = new THREE.Vector3();
  const P = [], key = new Map(), rep = new Int32Array(pos.count), parent = [];
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(M);
    const k = `${Math.round(v.x * 500)},${Math.round(v.y * 500)},${Math.round(v.z * 500)}`;
    if (!key.has(k)) { key.set(k, P.length); P.push(v.clone()); parent.push(P.length - 1); }
    rep[i] = key.get(k);
  }
  const find = a => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const tris = (idx ? idx.count : pos.count) / 3, at = i => (idx ? idx.getX(i) : i);
  for (let t = 0; t < tris; t++) { const a = find(rep[at(t * 3)]); parent[find(rep[at(t * 3 + 1)])] = a; parent[find(rep[at(t * 3 + 2)])] = a; }
  const info = new Map();     // root → { box, tris }
  for (let i = 0; i < P.length; i++) { const r = find(i); if (!info.has(r)) info.set(r, { box: new THREE.Box3(), tris: 0 }); info.get(r).box.expandByPoint(P[i]); }
  const rootOf = t => find(rep[at(t * 3)]);
  for (let t = 0; t < tris; t++) info.get(rootOf(t)).tris++;
  return { info, tris, at, rootOf };
}
const box6 = b => new THREE.Box3(new THREE.Vector3(b[0], b[1], b[2]), new THREE.Vector3(b[3], b[4], b[5]));

// Removes whole pieces of a mesh that lie inside `box` (car coordinates).
// Used to cut placeholder interiors out of a merged mesh.
function stripPieces(mesh, toBody, box) {
  const { info, tris, at, rootOf } = pieces(mesh, toBody);
  const gone = new Set([...info].filter(([, c]) => box.containsBox(c.box)).map(([r]) => r));
  if (!gone.size) return;
  const keep = [];
  for (let t = 0; t < tris; t++) if (!gone.has(rootOf(t))) keep.push(at(t * 3), at(t * 3 + 1), at(t * 3 + 2));
  mesh.geometry.setIndex(keep);
}

// Removes every triangle whose three corners lie inside `box` (car coordinates).
// For placeholder geometry that is welded to the body, where whole pieces cannot go.
function stripTriangles(mesh, toBody, box) {
  const geo = mesh.geometry, pos = geo.attributes.position, idx = geo.index;
  const M = new THREE.Matrix4().multiplyMatrices(toBody, mesh.matrixWorld), v = new THREE.Vector3();
  const inside = new Uint8Array(pos.count);
  for (let i = 0; i < pos.count; i++) inside[i] = box.containsPoint(v.fromBufferAttribute(pos, i).applyMatrix4(M)) ? 1 : 0;
  const n = idx ? idx.count : pos.count, at = i => (idx ? idx.getX(i) : i), keep = [];
  let cut = 0;
  for (let t = 0; t < n; t += 3) {
    const a = at(t), b = at(t + 1), c = at(t + 2);
    if (inside[a] && inside[b] && inside[c]) { cut++; continue; }
    keep.push(a, b, c);
  }
  if (cut) geo.setIndex(keep);
}

// Splits pieces of a merged mesh into meshes of their own, one per rule, so
// they can have their own material or move. A rule takes every piece whose
// bounding box lies inside one of its boxes (first matching rule wins).
function splitPieces(mesh, toBody, rules) {
  const { info, tris, at, rootOf } = pieces(mesh, toBody);
  const owner = new Map();
  for (const [r, c] of info) {
    const i = rules.findIndex(rule => (rule.minTris === undefined || c.tris >= rule.minTris) && (rule.maxTris === undefined || c.tris <= rule.maxTris)
      && rule.boxes.some(b => box6(b).containsBox(c.box)));
    if (i >= 0) owner.set(r, i);
  }
  const lists = rules.map(() => []), rest = [];
  for (let t = 0; t < tris; t++) { const i = owner.get(rootOf(t)); (i === undefined ? rest : lists[i]).push(at(t * 3), at(t * 3 + 1), at(t * 3 + 2)); }
  const out = [];
  lists.forEach((list, i) => {
    if (!list.length) return;
    const g = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(mesh.geometry.attributes)) g.setAttribute(name, attr);
    g.setIndex(list);
    const part = new THREE.Mesh(g, mesh.material);
    part.name = rules[i].name;
    part.position.copy(mesh.position); part.quaternion.copy(mesh.quaternion); part.scale.copy(mesh.scale);
    part.castShadow = mesh.castShadow; part.receiveShadow = true;
    mesh.parent.add(part);
    out.push({ rule: rules[i], mesh: part });
  });
  mesh.geometry.setIndex(rest);
  return out;
}

// Up to ~n vertices actually used by the nodes' triangles, in car coordinates.
function samplePoints(nodes, toBody, n) {
  const pts = [], v = new THREE.Vector3();
  nodes.forEach(node => node.traverse(o => {
    if (!o.isMesh) return;
    const pos = o.geometry.attributes.position, idx = o.geometry.index, count = idx ? idx.count : pos.count;
    const step = Math.max(1, Math.floor(count / n));
    for (let i = 0; i < count; i += step) pts.push(v.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(o.matrixWorld).applyMatrix4(toBody).clone());
  }));
  return pts;
}

// Finds the steering wheel in a file that has it merged into the cabin: a ring-shaped piece
// (about 0.3–0.45 m across, thin along the car) in front of the driver's eye. Every piece that
// fits inside it (spokes, hub, badge) comes along. Returns new meshes cut out of the originals.
function findSteeringWheel(meshes, toBody, eye, hint) {
  const near = hint || new THREE.Box3(new THREE.Vector3(eye.x + 0.2, eye.y - 0.55, eye.z - 0.25), new THREE.Vector3(eye.x + 1.0, eye.y + 0.05, eye.z + 0.25));
  const found = [];
  let best = null;
  for (const mesh of meshes) {
    const mb = new THREE.Box3().setFromObject(mesh).applyMatrix4(toBody);
    if (!mb.intersectsBox(near)) continue;
    const pc = pieces(mesh, toBody);
    found.push({ mesh, pc });
    for (const [rk, c] of hint ? [] : pc.info) {
      const s = c.box.getSize(new THREE.Vector3()), ctr = c.box.getCenter(new THREE.Vector3());
      if (!near.containsPoint(ctr) || s.y < 0.26 || s.y > 0.46 || s.z < 0.26 || s.z > 0.46 || s.x > 0.22 || Math.abs(s.y - s.z) > 0.08) continue;
      const score = Math.abs(ctr.z - eye.z) + Math.abs(s.z - 0.37) * 0.5;
      if (!best || score < best.score) best = { score, box: c.box.clone().expandByScalar(0.015) };
    }
  }
  if (hint) best = { box: hint };              // a box given in the config: everything inside it is the wheel
  if (!best) return [];
  const out = [];
  for (const { mesh, pc } of found) {
    const keep = new Set([...pc.info].filter(([, c]) => best.box.containsBox(c.box)).map(([r]) => r));
    if (!keep.size) continue;
    const mine = [], rest = [];
    for (let t = 0; t < pc.tris; t++) (keep.has(pc.rootOf(t)) ? mine : rest).push(pc.at(t * 3), pc.at(t * 3 + 1), pc.at(t * 3 + 2));
    const g = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(mesh.geometry.attributes)) g.setAttribute(name, attr);
    g.setIndex(mine);
    const part = new THREE.Mesh(g, mesh.material);
    part.name = `${mesh.name}:steeringwheel`;
    part.position.copy(mesh.position); part.quaternion.copy(mesh.quaternion); part.scale.copy(mesh.scale);
    mesh.parent.add(part); part.updateMatrixWorld(true);
    mesh.geometry = mesh.geometry.clone(); mesh.geometry.setIndex(rest);
    out.push(part);
  }
  return out;
}

function triCount(mesh) {
  const g = mesh.geometry;
  return g.index ? g.index.count / 3 : g.attributes.position.count / 3;
}

export async function loadGlbCar(m, onProgress) {
  const cfg = m.glb;
  const gltf = await makeLoader(onProgress).loadAsync(cfg.file);
  const model = gltf.scene;

  /* ---------- clean up ---------- */
  const doomed = findNodes(model, cfg.remove);
  doomed.forEach(o => o.parent && o.parent.remove(o));
  // hide overlay meshes (motion-blur wheels, cracked glass …) by material name
  const hidePats = toList(cfg.hideMaterials);
  if (hidePats.length) {
    const gone = [];
    model.traverse(o => { if (o.isMesh && toList(o.material).some(mt => hidePats.some(p => matches(mt.name, p)))) gone.push(o); });
    gone.forEach(o => o.parent && o.parent.remove(o));
  }

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const holder = new THREE.Group();
  holder.add(model);
  body.add(holder);
  if (cfg.rotY === undefined) {
    // most downloads have the car along Z; turn it so the length runs along X
    const b0 = new THREE.Box3().setFromObject(model);
    holder.rotation.y = (b0.max.z - b0.min.z) > (b0.max.x - b0.min.x) ? Math.PI / 2 : 0;
  } else holder.rotation.y = cfg.rotY;

  /* ---------- scale, centre, put wheels on the ground ---------- */
  // boxOf(pats): box of the meshes using those materials (all meshes when no pattern is given)
  const boxOf = pats => {
    const list = toList(pats), b = new THREE.Box3();
    if (!list.length) return b.setFromObject(holder);
    model.traverse(o => { if (o.isMesh && toList(o.material).some(mt => list.some(p => matches(mt.name, p)))) b.union(new THREE.Box3().setFromObject(o)); });
    return b.isEmpty() ? b.setFromObject(holder) : b;
  };
  // fit: materials that outline the car (helper objects in some files make the whole-file box too big)
  holder.updateMatrixWorld(true);
  let box = boxOf(cfg.fit);
  const rawLen = box.max.x - box.min.x;
  const s = cfg.scale && cfg.scale !== 'auto' ? cfg.scale : m.dims.L / rawLen;
  holder.scale.setScalar(s);
  holder.updateMatrixWorld(true);
  box = boxOf(cfg.fit);
  // ground: the tyres decide where the floor is (parts hanging lower, like a long exhaust, must not lift the car)
  const floorY = cfg.ground ? boxOf(cfg.ground).min.y : box.min.y;
  holder.position.set(-(box.min.x + box.max.x) / 2, -floorY, -(box.min.z + box.max.z) / 2);
  holder.updateMatrixWorld(true);
  box = boxOf(cfg.fit);
  const size = box.getSize(new THREE.Vector3());

  // mirror: replace a part that is modelled wrongly (e.g. a door left open in the file) with a
  // mirror image of its counterpart across the car's centre plane. The copy is named "<source>_mirror".
  for (const md of toList(cfg.mirror)) {
    findNodes(model, md.hide).forEach(o => o.parent && o.parent.remove(o));
    body.updateMatrixWorld(true);
    const flip = new THREE.Matrix4().makeScale(1, 1, -1), toBody = body.matrixWorld.clone().invert();
    findNodes(model, md.source).forEach(src => {
      const c = src.clone(true); c.name = src.name + '_mirror';
      const W = body.matrixWorld.clone().multiply(flip).multiply(toBody).multiply(src.matrixWorld);
      src.parent.add(c);
      c.matrix.copy(src.parent.matrixWorld.clone().invert().multiply(W));
      c.matrix.decompose(c.position, c.quaternion, c.scale);
    });
    holder.updateMatrixWorld(true);
  }

  /* ---------- meshes, materials ---------- */
  const meshes = [];
  const materials = new Set();
  model.traverse(o => {
    if (!o.isMesh) return;
    meshes.push(o);
    o.castShadow = true; o.receiveShadow = true;
    toList(o.material).forEach(mt => materials.add(mt));
  });
  materials.forEach(mt => { if ('envMapIntensity' in mt) mt.envMapIntensity = 1; });

  // Split merged meshes into parts with materials of their own (see splitPieces).
  const splitInterior = [];
  if (cfg.split) {
    body.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(body.matrixWorld).invert();
    const made = new Map();
    const look = (base, name, look) => {
      if (!made.has(name)) {
        const mt = base.clone(); mt.name = name; mt.map = null;
        if (look.color !== undefined) mt.color.setHex(look.color);
        if (look.roughness !== undefined) mt.roughness = look.roughness;
        if (look.metalness !== undefined) mt.metalness = look.metalness;
        made.set(name, mt); materials.add(mt);
        if (look.interior) splitInterior.push(mt);
      }
      return made.get(name);
    };
    for (const sp of toList(cfg.split)) {
      for (const o of [...meshes]) {
        if (!toList(o.material).some(mt => matches(mt.name, sp.material))) continue;
        for (const { rule, mesh: part } of splitPieces(o, inv, sp.parts)) {
          if (rule.look) part.material = look(o.material, `${rule.name}_mat`, rule.look);
          meshes.push(part);
        }
        if (sp.rest) o.material = look(o.material, `${o.material.name}_rest`, sp.rest);
      }
    }
  }

  // MeshStandardMaterial → MeshPhysicalMaterial, so clear-coat works on paint.
  const upgrade = mt => {
    if (mt.isMeshPhysicalMaterial || !mt.isMeshStandardMaterial) return mt;
    const p = new THREE.MeshPhysicalMaterial();
    THREE.MeshStandardMaterial.prototype.copy.call(p, mt);
    p.name = mt.name;
    return p;
  };
  const swap = (from, to) => meshes.forEach(o => {
    if (Array.isArray(o.material)) o.material = o.material.map(x => (x === from ? to : x));
    else if (o.material === from) o.material = to;
  });

  const byName = pats => {
    const list = toList(pats);
    return [...materials].filter(mt => list.some(p => matches(mt.name, p)));
  };

  let paint = byName(cfg.paint);
  if (!paint.length) {
    // Guess: the biggest material that does not look like glass / tyre / trim.
    const weight = new Map();
    meshes.forEach(o => toList(o.material).forEach(mt => weight.set(mt, (weight.get(mt) || 0) + triCount(o))));
    const guess = [...weight.entries()]
      .filter(([mt]) => !NOT_PAINT_RE.test(mt.name) && !mt.transparent)
      .sort((a, b) => b[1] - a[1])[0];
    if (guess) { paint = [guess[0]]; console.info(`[glbCar] ${m.id}: paint material guessed = "${guess[0].name}"`); }
  }
  paint = paint.map(mt => { const p = upgrade(mt); if (p !== mt) swap(mt, p); materials.delete(mt); materials.add(p); return p; });

  const glass = cfg.glass ? byName(cfg.glass) : [...materials].filter(mt => GLASS_RE.test(mt.name) || (mt.transparent && mt.opacity < 0.95));
  const rimMats = byName(cfg.rimMaterials);
  const lightMats = byName(cfg.lights);
  const interiorMats = [...byName(cfg.interior), ...splitInterior];

  // Code-built cabin (cabinKit.js) for files without a usable interior:
  // first cut the placeholder pieces out, then build the real thing.
  let cabin = null;
  if (cfg.strip || cfg.cabin) {
    body.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(body.matrixWorld).invert();
    for (const st of toList(cfg.strip)) {
      meshes.forEach(o => { if (toList(o.material).some(mt => matches(mt.name, st.material))) (st.triangles ? stripTriangles : stripPieces)(o, inv, box6(st.box)); });
    }
    if (cfg.cabin) {
      cabin = buildCabin(cfg.cabin, body, paint[0]);
      if (cabin) interiorMats.push(...cabin.interiorMats);
    }
  }

  const snap = mt => ({
    color: mt.color ? mt.color.clone() : null,
    metalness: mt.metalness, roughness: mt.roughness, clearcoat: mt.clearcoat,
    opacity: mt.opacity, transparent: mt.transparent, depthWrite: mt.depthWrite,
    emissive: mt.emissive ? mt.emissive.clone() : null, map: mt.map,
  });
  const orig = new Map();
  [...paint, ...glass, ...rimMats, ...lightMats, ...interiorMats].forEach(mt => orig.set(mt, snap(mt)));
  const restore = mt => {
    const o = orig.get(mt);
    if (o.color) mt.color.copy(o.color);
    if (o.emissive) mt.emissive.copy(o.emissive);
    Object.assign(mt, { metalness: o.metalness, roughness: o.roughness, opacity: o.opacity, transparent: o.transparent, depthWrite: o.depthWrite, map: o.map });
    if (o.clearcoat !== undefined) mt.clearcoat = o.clearcoat;
    mt.needsUpdate = true;
  };

  /* ---------- openable parts ---------- */
  body.updateMatrixWorld(true);
  const toBody = new THREE.Matrix4().copy(body.matrixWorld).invert();
  const bboxIn = node => new THREE.Box3().setFromObject(node).applyMatrix4(toBody);

  const makePart = (nodes, kind, over = {}) => {
    nodes = toList(nodes);
    const b = new THREE.Box3();
    nodes.forEach(n => b.union(bboxIn(n)));
    const c = b.getCenter(new THREE.Vector3());
    const side = c.z >= 0 ? 1 : -1;
    let pivot, axis, max;
    if (kind === 'door') {
      pivot = new THREE.Vector3(b.max.x, c.y, side > 0 ? b.max.z : b.min.z); axis = 'y'; max = side * 1.1;
    } else if (kind === 'gullwing') {
      pivot = new THREE.Vector3(c.x, b.max.y, side > 0 ? b.min.z : b.max.z); axis = 'x'; max = -side * 1.15;
    } else if (kind === 'hood') {
      pivot = new THREE.Vector3(b.min.x, c.y, 0); axis = 'z'; max = 0.8;
    } else {
      pivot = new THREE.Vector3(b.max.x, c.y, 0); axis = 'z'; max = -0.95;
    }
    if (over.pivot) pivot.set(...over.pivot);
    if (over.axis) axis = over.axis;
    if (over.angle !== undefined) max = over.angle;
    const g = new THREE.Group();
    g.name = `pivot:${nodes[0].name}`;
    g.position.copy(pivot);
    body.add(g);
    nodes.forEach(n => g.attach(n));
    return { pivot: g, axis, max, side };
  };

  // doors: a string pattern makes every matching node its own door;
  // an array of patterns makes all its matches one door (panel + glass + mirror …)
  const doorKind = cfg.gullwing ? 'gullwing' : 'door';
  const doors = [];
  toList(cfg.doors).forEach(entry => {
    if (Array.isArray(entry)) { const ns = findNodes(model, entry); if (ns.length) doors.push(makePart(ns, doorKind, cfg.doorHinge)); }
    else findNodes(model, entry).forEach(n => doors.push(makePart(n, doorKind, cfg.doorHinge)));
  });
  const hoodNodes = findNodes(model, cfg.hood);
  const trunkNodes = findNodes(model, cfg.trunk);
  const hood = hoodNodes.length ? makePart(hoodNodes, 'hood', cfg.hoodHinge) : null;
  const trunk = trunkNodes.length ? makePart(trunkNodes, 'trunk', cfg.trunkHinge) : null;

  // Steering wheel: pivot at its centre, axis = the direction (in the
  // car's vertical plane) along which the wheel is thinnest, i.e. the column.
  let steer = null;
  // no steering wheel named in the config: look for one (not for code-built cabins, which turn their own)
  const defaultEye = cfg.eye ? new THREE.Vector3(...cfg.eye) : new THREE.Vector3(-0.02 * size.x, size.y * 0.8, -size.z * 0.22);
  const steerNodes = cfg.steer ? findNodes(model, cfg.steer) : (!cfg.cabin && cfg.autoSteer !== false ? findSteeringWheel(meshes, toBody, defaultEye, cfg.steerBox ? box6(cfg.steerBox) : null) : []);
  if (steerNodes.length) {
    const pts = samplePoints(steerNodes, toBody, 600);
    const box = new THREE.Box3().setFromPoints(pts), c = box.getCenter(new THREE.Vector3());
    let axis = new THREE.Vector3(1, 0, 0), best = Infinity;
    for (let deg = -75; deg <= 75; deg += 1) {
      const d = new THREE.Vector3(Math.cos(deg * Math.PI / 180), Math.sin(deg * Math.PI / 180), 0);
      let lo = Infinity, hi = -Infinity;
      for (const p of pts) { const t = (p.x - c.x) * d.x + (p.y - c.y) * d.y; if (t < lo) lo = t; if (t > hi) hi = t; }
      if (hi - lo < best) { best = hi - lo; axis = d; }
    }
    const g = new THREE.Group(); g.name = 'pivot:steer'; g.position.copy(c); body.add(g);
    steerNodes.forEach(n => g.attach(n));
    if (axis.x < 0) axis.negate();                         // the column points forward
    let rad = 0; const v = new THREE.Vector3();
    for (const p of pts) { v.copy(p).sub(c); rad = Math.max(rad, v.sub(axis.clone().multiplyScalar(v.dot(axis))).length()); }
    steer = { pivot: g, axis, wheel: { center: c.clone(), axis: axis.clone(), radius: rad * 0.94 } };
  }

  // Gauge needles (speedo / tacho) that are separate parts: each turns about
  // its hub around the dial's normal. 0 = the position it was modelled in.
  const gauges = {};
  for (const key of ['speedo', 'tacho']) {
    const gc = cfg.gauges && cfg.gauges[key];
    if (!gc) continue;
    const nodes = findNodes(model, gc.node);
    if (!nodes.length) continue;
    const pts = samplePoints(nodes, toBody, 500);
    const box = new THREE.Box3().setFromPoints(pts), c = box.getCenter(new THREE.Vector3());
    const len = box.getSize(new THREE.Vector3()).length();
    // dial normal: explicit, else the thinnest direction of the needle in the vertical plane
    let axis;
    if (gc.axisDeg !== undefined) axis = new THREE.Vector3(Math.cos(gc.axisDeg * Math.PI / 180), Math.sin(gc.axisDeg * Math.PI / 180), 0);
    else {
      let best = Infinity, worst = 0;
      for (let deg = -75; deg <= 75; deg += 1) {
        const d = new THREE.Vector3(Math.cos(deg * Math.PI / 180), Math.sin(deg * Math.PI / 180), 0);
        let lo = Infinity, hi = -Infinity;
        for (const p of pts) { const t = (p.x - c.x) * d.x + (p.y - c.y) * d.y; if (t < lo) lo = t; if (t > hi) hi = t; }
        if (hi - lo < best) { best = hi - lo; axis = d; }
        worst = Math.max(worst, hi - lo);
      }
      if (worst < len * 0.2) axis = steer ? steer.axis.clone() : new THREE.Vector3(Math.cos(-0.35), Math.sin(-0.35), 0);
    }
    // hub: the node's own origin when it sits on the needle, else the end with more geometry
    let hub = nodes[0].getWorldPosition(new THREE.Vector3()).applyMatrix4(toBody);
    if (!box.clone().expandByScalar(len * 0.15).containsPoint(hub)) {
      let p0 = pts[0]; for (const p of pts) if (p.distanceTo(c) > p0.distanceTo(c)) p0 = p;
      let p1 = pts[0]; for (const p of pts) if (p.distanceTo(p0) > p1.distanceTo(p0)) p1 = p;
      const nearEnd = e => pts.filter(p => p.distanceTo(e) < len * 0.25);
      const a = nearEnd(p0), b = nearEnd(p1);
      let pick = a.length >= b.length ? a : b;
      if (gc.flipHub) pick = pick === a ? b : a;
      hub = pick.reduce((s, p) => s.add(p), new THREE.Vector3()).multiplyScalar(1 / pick.length);
    }
    const g = new THREE.Group(); g.name = `pivot:${key}`; g.position.copy(hub); body.add(g);
    nodes.forEach(n => g.attach(n));
    // zero: angle of the 0 mark relative to the modelled needle position (degrees, clockwise)
    gauges[key] = { pivot: g, axis, max: gc.max, sweep: (gc.sweep || 240) * Math.PI / 180, zero: (gc.zero || 0) * Math.PI / 180, dir: gc.dir || 1 };
  }
  const turnGauge = (gd, value) => { if (gd) gd.pivot.quaternion.setFromAxisAngle(gd.axis, gd.dir * (gd.zero + gd.sweep * Math.min(1, Math.max(0, value / gd.max)))); };

  // Wheels stay on the ground when the body is raised or lowered.
  const wheelNodes = findNodes(model, cfg.wheels);
  wheelNodes.forEach(n => root.attach(n));

  /* ---------- road wheels: front ones steer, all of them roll ----------
     Every connected piece of geometry that fits inside a wheel-sized box at one
     of the four corners (from m.wheel) is moved into that corner's rig:
     rig (steers about Y, front only) → spin (rolls about Z) → pieces.
     Brake callipers steer with the wheel but do not roll. */
  const rigs = [];
  if (!cfg.noWheels && m.wheel && m.wheel.x) {
    root.updateMatrixWorld(true);
    const toRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const R = m.wheel.r || 0.32, half = size.z / 2;
    const corners = [];
    m.wheel.x.forEach((x, i) => [-1, 1].forEach(s => corners.push({
      front: i === 0, s,
      box: new THREE.Box3(new THREE.Vector3(x - R * 1.7, -0.08, s < 0 ? -half - 0.15 : half * 0.3), new THREE.Vector3(x + R * 1.7, R * 2.6 + 0.08, s < 0 ? -half * 0.3 : half + 0.15)),
      parts: [], hubBox: new THREE.Box3(),
    })));
    const anyBox = corners.reduce((b, c) => b.union(c.box), new THREE.Box3());
    const isCaliper = mt => /calip|brake_?cal|suport|suspen/i.test(mt.name || '');
    const inCabin = o => { for (let p = o; p; p = p.parent) if (p.name === 'cabin') return true; return false; };
    const meshList = [];
    if (!wheelNodes.length) root.traverse(o => { if (o.isMesh && !inCabin(o)) meshList.push(o); });
    // pass 1: candidate pieces (whole meshes or connected pieces) lying inside a corner box
    const cands = [];       // { mesh, ci, box, piece (root key) | null }
    const split = new Map();
    for (const mesh of meshList) {
      const mb = new THREE.Box3().setFromObject(mesh).applyMatrix4(toRoot);
      if (!mb.intersectsBox(anyBox)) continue;
      const whole = corners.findIndex(c => c.box.containsBox(mb));
      if (whole >= 0) { cands.push({ mesh, ci: whole, box: mb, piece: null }); continue; }
      const pc = pieces(mesh, toRoot);
      split.set(mesh, pc);
      for (const [rk, c] of pc.info) { const ci = corners.findIndex(cn => cn.box.containsBox(c.box)); if (ci >= 0) cands.push({ mesh, ci, box: c.box, piece: rk }); }
    }
    // the tyre: the tallest piece in the corner that reaches the ground; the wheel is whatever fits inside it
    corners.forEach((c, ci) => {
      let best = null;
      for (const k of cands) {
        if (k.ci !== ci || k.box.min.y > 0.15) continue;
        const hgt = k.box.max.y - k.box.min.y, len = k.box.max.x - k.box.min.x;
        if (hgt < R * 1.2 || hgt > R * 2.7 || Math.abs(len - hgt) > hgt * 0.25) continue;   // round: as long as it is tall
        if (!best || hgt > best.box.max.y - best.box.min.y) best = k;
      }
      c.region = best ? best.box.clone().expandByVector(new THREE.Vector3(0.05, 0.05, 0)) : null;
      if (c.region) { c.hub = best.box.getCenter(new THREE.Vector3()); c.region.min.z = c.box.min.z; c.region.max.z = c.box.max.z; }
    });
    const keep = k => corners[k.ci].region && corners[k.ci].region.containsBox(k.box);
    // pass 2: move the pieces into per-corner meshes
    for (const k of cands) if (!k.piece && keep(k)) corners[k.ci].parts.push({ mesh: k.mesh, caliper: toList(k.mesh.material).some(isCaliper) });
    for (const [mesh, pc] of split) {
      const owner = new Map();
      for (const k of cands) if (k.mesh === mesh && k.piece !== null && keep(k)) owner.set(k.piece, k.ci);
      if (!owner.size) continue;
      const { tris, at, rootOf } = pc;
      const lists = corners.map(() => []), rest = [];
      for (let t = 0; t < tris; t++) { const ci = owner.get(rootOf(t)); (ci === undefined ? rest : lists[ci]).push(at(t * 3), at(t * 3 + 1), at(t * 3 + 2)); }
      lists.forEach((list, ci) => {
        if (!list.length) return;
        const g = new THREE.BufferGeometry();
        for (const [name, attr] of Object.entries(mesh.geometry.attributes)) g.setAttribute(name, attr);
        g.setIndex(list);
        const part = new THREE.Mesh(g, mesh.material);
        part.name = `${mesh.name}:wheel${ci}`;
        part.position.copy(mesh.position); part.quaternion.copy(mesh.quaternion); part.scale.copy(mesh.scale);
        part.castShadow = mesh.castShadow; part.receiveShadow = true;
        mesh.parent.add(part); part.updateMatrixWorld(true);
        corners[ci].parts.push({ mesh: part, caliper: toList(mesh.material).some(isCaliper) });
      });
      mesh.geometry = mesh.geometry.clone();
      mesh.geometry.setIndex(rest);
    }
    for (const c of corners) {
      if (!c.parts.length) continue;
      // hub: the centre of the tyre found in pass 1
      if (!c.region) continue;
      const hub = c.hub.clone();
      c.parts.forEach(p => c.hubBox.union(new THREE.Box3().setFromPoints(samplePoints([p.mesh], toRoot, 1500))));
      const rig = new THREE.Group(); rig.name = 'wheel-rig'; rig.position.copy(hub); root.add(rig);
      const spinG = new THREE.Group(); rig.add(spinG);
      rig.updateMatrixWorld(true);
      c.parts.forEach(p => (p.caliper ? rig : spinG).attach(p.mesh));
      rigs.push({ rig, spin: spinG, front: c.front, parts: c.parts.length, radius: +(c.hubBox.max.y - c.hubBox.min.y).toFixed(2) / 2 });
    }
  }

  /* ---------- driver's eye ---------- */
  const eye = cabin && cabin.eye ? new THREE.Vector3(...cabin.eye) : cfg.eye
    ? new THREE.Vector3(...cfg.eye)
    : new THREE.Vector3(-0.02 * size.x, size.y * 0.8, -size.z * 0.22);

  /* ---------- tuning ---------- */
  const caps = {
    color: paint.length > 0, finish: paint.length > 0,
    rimColor: rimMats.length > 0, ride: true,
    tint: glass.length > 0, lights: lightMats.length > 0, interior: interiorMats.length > 0,
  };
  const origPaint = paint[0] ? orig.get(paint[0]).color.clone() : new THREE.Color(m.palette[0]);
  const baseTuning = {
    ...defaultTuning(m),
    color: '#' + origPaint.getHexString(),
    finish: 'orig', rimColor: 'orig', tint: 'orig', lights: 'orig', interior: 'orig',
    ...(cfg.defaults || {}),   // per-model starting tuning, e.g. clear glass
  };

  const car = {
    source: 'glb', root, body, doors, hood, trunk, model: m, caps, baseTuning, wheels: [],
    driverEye: eye, size, tuning: null,
    open: { doors: 0, hood: 0, trunk: 0 },
    target: { doors: 0, hood: 0, trunk: 0 },
    credit: cfg.credit || null,
    noInterior: !!cfg.noInterior,
    // steer: road-wheel angle (rad, + = left); spinF / spinR: how far the front / rear wheels have rolled (rad)
    setWheels(steer, spinF, spinR = spinF) { for (const w of rigs) { w.rig.rotation.y = w.front ? steer : 0; w.spin.rotation.z = -(w.front ? spinF : spinR); } },
    wheelRigs: rigs.length,
    // steering wheel centre / column direction (forward) / rim radius, in body coordinates: where the driver's hands go
    wheelGrip: steer ? steer.wheel : cabin && cabin.wheel ? cabin.wheel : null,
    setSteer(a) { if (steer) steer.pivot.quaternion.setFromAxisAngle(steer.axis, -a); if (cabin) cabin.setSteer(a); },
    setGauges(kmh, rpm) { turnGauge(gauges.speedo, Math.abs(kmh)); turnGauge(gauges.tacho, rpm); if (cabin) cabin.setGauges(kmh, rpm); },
    hasGauges: Object.keys(gauges).length > 0, gauges,
    applyTuning(tu) {
      this.tuning = { ...tu };
      const origColor = '#' + origPaint.getHexString();
      paint.forEach(mt => {
        const o = orig.get(mt);
        const f = FINISHES[tu.finish];
        if (tu.color.toLowerCase() === origColor.toLowerCase() && tu.finish === 'orig') { restore(mt); return; }
        mt.map = null;                       // a baked colour texture would hide the new colour
        mt.color.set(tu.color);
        mt.metalness = f ? f.metalness : o.metalness;
        mt.roughness = f ? f.roughness : o.roughness;
        if ('clearcoat' in mt) mt.clearcoat = f ? f.clearcoat : (o.clearcoat ?? 1);
        mt.needsUpdate = true;
      });
      glass.forEach(mt => {
        if (tu.tint === 'orig' || !TINTS[tu.tint]) { restore(mt); return; }
        const [, op, col] = TINTS[tu.tint];
        mt.transparent = true; mt.depthWrite = false;
        mt.opacity = Math.max(op, 0.15);
        mt.color.setHex(col); mt.needsUpdate = true;
      });
      rimMats.forEach(mt => {
        const rc = RIM_COLORS[tu.rimColor];
        if (!rc) { restore(mt); return; }
        mt.color.setHex(rc[1]); mt.metalness = rc[2]; mt.roughness = rc[3]; mt.needsUpdate = true;
      });
      lightMats.forEach(mt => {
        const l = LIGHTS[tu.lights];
        if (!l) { restore(mt); return; }
        mt.emissive.setHex(l[1]); mt.needsUpdate = true;
      });
      interiorMats.forEach(mt => {
        const i = INTERIORS[tu.interior];
        if (!i) { restore(mt); return; }
        mt.color.setHex(i[1]); mt.needsUpdate = true;
      });
      body.position.y = (tu.ride || 0) / 100;
    },
    update(dt) {
      const k = 1 - Math.exp(-dt * 5);
      for (const key of ['doors', 'hood', 'trunk']) this.open[key] += (this.target[key] - this.open[key]) * k;
      for (const d of doors) d.pivot.rotation[d.axis] = d.max * ease(this.open.doors);
      if (hood) hood.pivot.rotation[hood.axis] = hood.max * ease(this.open.hood);
      if (trunk) trunk.pivot.rotation[trunk.axis] = trunk.max * ease(this.open.trunk);
    },
    dispose() {
      root.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) toList(o.material).forEach(mt => {
          Object.values(mt).forEach(v => { if (v && v.isTexture) v.dispose(); });
          mt.dispose();
        });
      });
    },
  };
  car.applyTuning(baseTuning);
  car.setGauges(0, 0);
  console.info(`[glbCar] ${m.id}: ${meshes.length} meshes, ${doors.length} doors, hood ${!!hood}, trunk ${!!trunk}, wheels ${wheelNodes.length}, wheel rigs ${rigs.length}, steering wheel ${steer ? (cfg.steer ? 'named' : 'found') : cabin && cabin.wheel ? 'cabin' : 'none'}, size ${size.x.toFixed(2)}×${size.y.toFixed(2)}×${size.z.toFixed(2)} m`);
  return car;
}
