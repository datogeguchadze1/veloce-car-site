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

let loader;
function getLoader() {
  if (loader) return loader;
  const draco = new DRACOLoader().setDecoderPath('./vendor/three/jsm/libs/draco/gltf/');
  loader = new GLTFLoader().setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder);
  return loader;
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

export async function loadGlbCar(m) {
  const cfg = m.glb;
  const gltf = await getLoader().loadAsync(cfg.file);
  const model = gltf.scene;

  /* ---------- clean up ---------- */
  const doomed = findNodes(model, cfg.remove);
  doomed.forEach(o => o.parent && o.parent.remove(o));

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const holder = new THREE.Group();
  holder.add(model);
  holder.rotation.y = cfg.rotY || 0;
  body.add(holder);

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

  const makePart = (node, kind, over = {}) => {
    const b = bboxIn(node);
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
    g.name = `pivot:${node.name}`;
    g.position.copy(pivot);
    body.add(g);
    g.attach(node);
    return { pivot: g, axis, max, side };
  };

  const doorKind = cfg.gullwing ? 'gullwing' : 'door';
  const doors = findNodes(model, cfg.doors).map(n => makePart(n, doorKind, cfg.doorHinge));
  const hoodNode = findNodes(model, cfg.hood)[0];
  const trunkNode = findNodes(model, cfg.trunk)[0];
  const hood = hoodNode ? makePart(hoodNode, 'hood', cfg.hoodHinge) : null;
  const trunk = trunkNode ? makePart(trunkNode, 'trunk', cfg.trunkHinge) : null;

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
  };

  const car = {
    source: 'glb', root, body, doors, hood, trunk, model: m, caps, baseTuning,
    driverEye: eye, size, tuning: null,
    open: { doors: 0, hood: 0, trunk: 0 },
    target: { doors: 0, hood: 0, trunk: 0 },
    credit: cfg.credit || null,
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
  console.info(`[glbCar] ${m.id}: ${meshes.length} meshes, ${doors.length} doors, hood ${!!hood}, trunk ${!!trunk}, wheels ${wheelNodes.length}, size ${size.x.toFixed(2)}×${size.y.toFixed(2)}×${size.z.toFixed(2)} m`);
  return car;
}
