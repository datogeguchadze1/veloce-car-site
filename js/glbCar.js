// Loads a real car model (.glb) and wraps it with the same interface that
// carBuilder.js's buildCar() returns, so main.js treats both the same way:
//   root, body, doors, hood, trunk, driverEye, size, target, open,
//   tuning, baseTuning, caps, applyTuning(), update(dt), dispose()
//
// Per-model settings live in models.js under `glb` (see README, "Real models").
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { FINISHES, TINTS, LIGHTS, INTERIORS, RIM_COLORS, defaultTuning } from './carBuilder.js';

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
  holder.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(holder);
  const rawLen = box.max.x - box.min.x;
  const s = cfg.scale && cfg.scale !== 'auto' ? cfg.scale : m.dims.L / rawLen;
  holder.scale.setScalar(s);
  holder.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(holder);
  holder.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
  holder.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(holder);
  const size = box.getSize(new THREE.Vector3());

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
  const interiorMats = byName(cfg.interior);

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
  const steerNodes = findNodes(model, cfg.steer);
  if (steerNodes.length) {
    const pts = [], v = new THREE.Vector3();
    steerNodes.forEach(n => n.traverse(o => {
      if (!o.isMesh) return;
      const pos = o.geometry.attributes.position, step = Math.max(1, Math.floor(pos.count / 600));
      for (let i = 0; i < pos.count; i += step) pts.push(v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).applyMatrix4(toBody).clone());
    }));
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
    steer = { pivot: g, axis };
  }

  // Gauge needles (speedo / tacho) that are separate parts: each turns about
  // its hub around the dial's normal. 0 = the position it was modelled in.
  const gauges = {};
  for (const key of ['speedo', 'tacho']) {
    const gc = cfg.gauges && cfg.gauges[key];
    if (!gc) continue;
    const nodes = findNodes(model, gc.node);
    if (!nodes.length) continue;
    const pts = [], v = new THREE.Vector3();
    nodes.forEach(n => n.traverse(o => {
      if (!o.isMesh) return;
      const pos = o.geometry.attributes.position, step = Math.max(1, Math.floor(pos.count / 500));
      for (let i = 0; i < pos.count; i += step) pts.push(v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).applyMatrix4(toBody).clone());
    }));
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

  /* ---------- driver's eye ---------- */
  const eye = cfg.eye
    ? new THREE.Vector3(...cfg.eye)
    : new THREE.Vector3(-0.02 * size.x, size.y * 0.8, -size.z * 0.22);

  /* ---------- tuning ---------- */
  const caps = {
    color: paint.length > 0, finish: paint.length > 0,
    rims: false, rimColor: rimMats.length > 0,
    ride: true, spoiler: false, kit: false,
    tint: glass.length > 0, lights: lightMats.length > 0, interior: interiorMats.length > 0,
  };
  const origPaint = paint[0] ? orig.get(paint[0]).color.clone() : new THREE.Color(m.palette[0]);
  const baseTuning = {
    ...defaultTuning(m),
    color: '#' + origPaint.getHexString(),
    finish: 'orig', rimColor: 'orig', tint: 'orig', lights: 'orig', interior: 'orig',
    rims: 'orig', spoiler: 'none', kit: 'none',
    ...(cfg.defaults || {}),   // per-model starting tuning, e.g. clear glass
  };

  const car = {
    source: 'glb', root, body, doors, hood, trunk, model: m, caps, baseTuning, wheels: [],
    driverEye: eye, size, tuning: null,
    open: { doors: 0, hood: 0, trunk: 0 },
    target: { doors: 0, hood: 0, trunk: 0 },
    credit: cfg.credit || null,
    noInterior: !!cfg.noInterior,
    setSteer(a) { if (steer) steer.pivot.quaternion.setFromAxisAngle(steer.axis, -a); },
    setGauges(kmh, rpm) { turnGauge(gauges.speedo, Math.abs(kmh)); turnGauge(gauges.tacho, rpm); },
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
  console.info(`[glbCar] ${m.id}: ${meshes.length} meshes, ${doors.length} doors, hood ${!!hood}, trunk ${!!trunk}, wheels ${wheelNodes.length}, size ${size.x.toFixed(2)}×${size.y.toFixed(2)}×${size.z.toFixed(2)} m`);
  return car;
}
