// Procedural car builder: turns a profile from models.js into a Three.js
// group with opening doors, hood and trunk, an interior and tunable parts.
import * as THREE from 'three';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';

const CREASE = Math.PI / 5;

/* ---------- curve helpers ---------- */

function smoothLine(pts, mode, n = 260) {
  if (mode === false) return densify(pts, 0.02);
  const v = pts.map(p => new THREE.Vector3(p[0], p[1], 0));
  const c = new THREE.CatmullRomCurve3(v, false, 'centripetal', mode === 'light' ? 0.1 : 0.5);
  return c.getSpacedPoints(n).map(p => [p.x, p.y]);
}

function densify(pts, step) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
    for (let k = 0; k < n; k++) out.push([ax + (bx - ax) * k / n, ay + (by - ay) * k / n]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// y = f(x) lookup on a line running front (+x) to rear (−x).
// For near-vertical stretches the highest y at that x wins.
function fnOf(line) {
  const L = [];
  for (const p of line) {
    const last = L[L.length - 1];
    if (!last || p[0] < last[0] - 1e-5) L.push([p[0], p[1]]);
    else if (Math.abs(p[0] - last[0]) <= 1e-5) last[1] = Math.max(last[1], p[1]);
  }
  return x => {
    if (x >= L[0][0]) return L[0][1];
    if (x <= L[L.length - 1][0]) return L[L.length - 1][1];
    let lo = 0, hi = L.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (L[m][0] > x) lo = m; else hi = m; }
    const a = L[lo], b = L[hi], t = (x - a[0]) / (b[0] - a[0]);
    return a[1] + (b[1] - a[1]) * t;
  };
}

function xs(a, b, extras = [], step = 0.015) {
  const n = Math.max(2, Math.ceil((a - b) / step));
  const out = [];
  for (let i = 0; i <= n; i++) out.push(a - (a - b) * i / n);
  for (const e of extras) if (e < a && e > b) out.push(e);
  return [...new Set(out)].sort((p, q) => q - p);
}

function sideShape(a, b, topF, botF, extras) {
  const X = xs(a, b, extras);
  const s = new THREE.Shape();
  X.forEach((x, i) => (i ? s.lineTo(x, topF(x)) : s.moveTo(x, topF(x))));
  for (let i = X.length - 1; i >= 0; i--) s.lineTo(X[i], botF(X[i]));
  return s;
}

function extrude(shape, z0, z1, bevel) {
  const b = Math.min(bevel, (z1 - z0) / 2.2);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.001, z1 - z0 - 2 * b), steps: 1, curveSegments: 4,
    bevelEnabled: b > 0, bevelThickness: b, bevelSize: b * 0.8, bevelSegments: 3,
  });
  g.translate(0, 0, z0 + b);
  return toCreasedNormals(g, CREASE);
}

function polyShape(pts) {
  const s = new THREE.Shape();
  pts.forEach((p, i) => (i ? s.lineTo(p[0], p[1]) : s.moveTo(p[0], p[1])));
  return s;
}

const mesh = (g, m, shadow = true) => {
  const o = new THREE.Mesh(g, m);
  o.castShadow = shadow; o.receiveShadow = true;
  return o;
};

/* ---------- materials ---------- */

export function createMaterials() {
  return {
    paint: new THREE.MeshPhysicalMaterial({ color: 0xc9ccd1, metalness: 0.5, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.05, side: THREE.DoubleSide }),
    trim: new THREE.MeshStandardMaterial({ color: 0x121315, roughness: 0.65, metalness: 0.2 }),
    carbon: new THREE.MeshStandardMaterial({ color: 0x1a1b1e, roughness: 0.35, metalness: 0.5 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.07 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x9fb2c4, metalness: 0, roughness: 0.02, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 1.6 }),
    interior: new THREE.MeshStandardMaterial({ color: 0x1c1c1e, roughness: 0.8 }),
    interiorDark: new THREE.MeshStandardMaterial({ color: 0x0d0d0e, roughness: 0.9 }),
    tire: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.92 }),
    rim: new THREE.MeshStandardMaterial({ color: 0xd0d4da, metalness: 1, roughness: 0.18 }),
    brake: new THREE.MeshStandardMaterial({ color: 0x55575c, metalness: 0.9, roughness: 0.45 }),
    caliper: new THREE.MeshStandardMaterial({ color: 0x2a2b2e, roughness: 0.4, metalness: 0.3 }),
    head: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4dc, emissiveIntensity: 1.4, metalness: 0.2, roughness: 0.1 }),
    tail: new THREE.MeshStandardMaterial({ color: 0x400005, emissive: 0xff1426, emissiveIntensity: 0.9, roughness: 0.25 }),
    engine: new THREE.MeshStandardMaterial({ color: 0x3b3c40, metalness: 0.75, roughness: 0.38 }),
    engineCover: new THREE.MeshStandardMaterial({ color: 0xb8bbc1, metalness: 0.9, roughness: 0.25 }),
    grille: new THREE.MeshStandardMaterial({ color: 0x08090a, roughness: 0.5, metalness: 0.4 }),
    gauge: new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0x9fdcff, emissiveIntensity: 0.25 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x5a3018, roughness: 0.35, metalness: 0.1 }),
  };
}

/* ---------- tuning catalogue ---------- */

export const FINISHES = {
  gloss: { label: 'გლუვი', metalness: 0.1, roughness: 0.22, clearcoat: 1 },
  metallic: { label: 'მეტალიკი', metalness: 0.6, roughness: 0.3, clearcoat: 1 },
  matte: { label: 'მქრქალი', metalness: 0.15, roughness: 0.78, clearcoat: 0 },
  chrome: { label: 'ქრომი', metalness: 1, roughness: 0.06, clearcoat: 0.6 },
};
export const RIMS = { classic: 'კლასიკური', five: '5-სხივიანი', multi: 'მრავალსხივიანი', mono: 'მონობლოკი' };
export const RIM_COLORS = { silver: ['ვერცხლი', 0xd0d4da, 1, 0.18], black: ['შავი', 0x18191b, 0.6, 0.35], gold: ['ოქრო', 0xc9a24a, 1, 0.22], graphite: ['გრაფიტი', 0x4a4d52, 0.9, 0.3] };
export const SPOILERS = { none: 'არა', lip: 'ლიპი', duck: 'დაკტეილი', wing: 'GT ფრთა' };
export const TINTS = { clear: ['გამჭვირვალე', 0.22, 0x9fb2c4], mid: ['საშუალო', 0.5, 0x2b3644], dark: ['მუქი', 0.82, 0x07090c] };
export const LIGHTS = { white: ['თეთრი', 0xfff4dc], yellow: ['ყვითელი', 0xffc844], blue: ['ცისფერი', 0x9fd0ff] };
export const INTERIORS = { black: ['შავი', 0x1c1c1e], tan: ['ყავისფერი', 0x8a5a33], red: ['წითელი', 0x7d1418], cream: ['კრემისფერი', 0xd9cdb4] };
export const KITS = { none: 'სტანდარტული', sport: 'სპორტული' };

export function defaultTuning(m) {
  return {
    color: m.palette[0], finish: m.finish || 'gloss', rims: m.wheel.style, rimColor: 'silver',
    ride: 0, spoiler: 'none', tint: 'clear', lights: 'white', interior: 'black', kit: 'none',
  };
}

/* ---------- wheel ---------- */

function buildWheel(m, style, mats) {
  const { r, w } = m.wheel;
  const rr = r * m.wheel.rim;
  const g = new THREE.Group();
  const prof = [[rr, -w / 2 + 0.012], [r - 0.045, -w / 2], [r - 0.012, -w / 2 + 0.018], [r, -w / 2 + 0.05],
    [r, w / 2 - 0.05], [r - 0.012, w / 2 - 0.018], [r - 0.045, w / 2], [rr, w / 2 - 0.012]];
  const tire = new THREE.LatheGeometry(prof.map(p => new THREE.Vector2(p[0], p[1])), 48);
  tire.rotateX(Math.PI / 2);
  g.add(mesh(tire, mats.tire));

  const barrel = new THREE.CylinderGeometry(rr, rr, w - 0.03, 40, 1, true);
  barrel.rotateX(Math.PI / 2);
  g.add(mesh(barrel, mats.rim, false));

  const disc = new THREE.CylinderGeometry(rr * 0.82, rr * 0.82, 0.02, 32);
  disc.rotateX(Math.PI / 2); disc.translate(0, 0, -0.01);
  g.add(mesh(disc, mats.brake, false));
  const cal = new THREE.BoxGeometry(0.07, rr * 0.55, 0.06);
  cal.translate(-rr * 0.62, rr * 0.25, 0.0);
  g.add(mesh(cal, mats.caliper, false));

  const face = w / 2 - 0.025;
  const add = (geo, mat) => { geo.translate(0, 0, face); g.add(mesh(geo, mat, false)); };
  const lip = new THREE.TorusGeometry(rr * 0.98, 0.012, 8, 48);
  add(lip, mats.rim);

  if (style === 'classic') {
    const cap = new THREE.CylinderGeometry(rr * 0.9, rr * 0.95, 0.025, 40);
    cap.rotateX(Math.PI / 2); add(cap, mats.chrome);
    const dome = new THREE.SphereGeometry(rr * 0.45, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    dome.rotateX(Math.PI / 2); dome.scale(1, 1, 0.35); dome.translate(0, 0, 0.012); add(dome, mats.chrome);
    const ring = new THREE.TorusGeometry(rr * 0.68, 0.01, 8, 40); ring.translate(0, 0, 0.014); add(ring, mats.trim);
  } else if (style === 'mono') {
    const d = new THREE.CylinderGeometry(rr * 0.96, rr * 0.96, 0.03, 40);
    d.rotateX(Math.PI / 2); add(d, mats.rim);
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2;
      const h = new THREE.CylinderGeometry(rr * 0.15, rr * 0.15, 0.034, 16);
      h.rotateX(Math.PI / 2); h.translate(Math.cos(a) * rr * 0.62, Math.sin(a) * rr * 0.62, 0.002);
      add(h, mats.interiorDark);
    }
  } else {
    const n = style === 'five' ? 5 : 10;
    const sw = style === 'five' ? 0.055 : 0.022;
    for (let i = 0; i < n; i++) {
      const sp = new THREE.BoxGeometry(rr * 0.95, sw, 0.03);
      sp.translate(rr * 0.5, 0, 0);
      if (style === 'multi') sp.rotateZ(0.12);
      sp.rotateZ(i / n * Math.PI * 2);
      add(sp, mats.rim);
    }
  }
  const hub = new THREE.CylinderGeometry(rr * 0.2, rr * 0.22, 0.04, 24);
  hub.rotateX(Math.PI / 2); add(hub, style === 'classic' ? mats.chrome : mats.rim);
  return g;
}

/* ---------- main builder ---------- */

export function buildCar(m, tuning, mats = createMaterials()) {
  const { L, W, clr } = m.dims;
  const { r } = m.wheel;
  const t = 0.075;                 // door skin thickness
  const bevel = m.bevel ?? 0.04;
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const topLine = smoothLine(m.top, m.smooth === undefined ? true : m.smooth);
  const top = fnOf(topLine);
  const archR = r + 0.045;
  const noseLen = 0.4, tailLen = 0.4;
  const extras = [];
  for (const wx of m.wheel.x) extras.push(wx + archR - 1e-4, wx - archR + 1e-4, wx + archR + 1e-4, wx - archR - 1e-4);

  const bottom = x => {
    let y = clr;
    const dF = x - (L / 2 - noseLen); if (dF > 0) y += m.noseLift * (dF / noseLen) ** 2;
    const dR = (-L / 2 + tailLen) - x; if (dR > 0) y += m.tailLift * (dR / tailLen) ** 2;
    for (const wx of m.wheel.x) {
      const dx = x - wx;
      if (Math.abs(dx) < archR) y = Math.max(y, r + Math.sqrt(archR * archR - dx * dx));
    }
    return Math.min(y, top(x) - 0.06);
  };

  const inR = (x, rg) => rg && x <= rg[0] && x >= rg[1];
  const bay = 0.13;
  const recessTop = x => {
    if (inR(x, m.hood) || inR(x, m.trunk)) return Math.max(top(x) - bay, bottom(x) + 0.03);
    return top(x);
  };
  for (const rg of [m.hood, m.trunk]) if (rg) extras.push(rg[0] + 1e-4, rg[0] - 1e-4, rg[1] + 1e-4, rg[1] - 1e-4);

  const dFront = m.doors[0][0];
  const dRear = m.doors[m.doors.length - 1][1];
  const ckR = m.cockpitRear ?? dRear;   // where the rear structure starts

  // Front and rear structural blocks (with engine / luggage bays).
  body.add(mesh(extrude(sideShape(L / 2, dFront, recessTop, bottom, extras), -W / 2, W / 2, bevel), mats.paint));
  body.add(mesh(extrude(sideShape(ckR, -L / 2, recessTop, bottom, extras), -W / 2, W / 2, bevel), mats.paint));
  // Fixed rear-quarter skins between the last door and the rear structure.
  if (dRear - ckR > 0.02) {
    const ext = [];
    for (const wx of m.wheel.x) ext.push(wx + archR - 1e-4, wx - archR + 1e-4);
    const q = sideShape(dRear - 0.006, ckR, top, x => bottom(x) + 0.02, ext);
    const qi = sideShape(dRear - 0.04, ckR, x => top(x) - 0.03, x => bottom(x) + 0.08, ext);
    for (const s of [1, -1]) {
      body.add(mesh(extrude(q, s > 0 ? W / 2 - t : -W / 2, s > 0 ? W / 2 : -W / 2 + t, Math.min(bevel, 0.03)), mats.paint));
      body.add(mesh(extrude(qi, s > 0 ? W / 2 - t - 0.03 : -W / 2 + t, s > 0 ? W / 2 - t : -W / 2 + t + 0.03, 0.01), mats.interior, false));
    }
  }

  // Fenders flanking the bays.
  const fw = 0.13;
  for (const rg of [m.hood, m.trunk]) {
    if (!rg) continue;
    const s = sideShape(rg[0], rg[1], top, x => recessTop(x) - 0.01, []);
    body.add(mesh(extrude(s, W / 2 - fw, W / 2, bevel * 0.6), mats.paint));
    body.add(mesh(extrude(s, -W / 2, -W / 2 + fw, bevel * 0.6), mats.paint));
  }

  // Engine.
  if (m.hood) {
    const hx0 = m.hood[0], hx1 = m.hood[1], len = (hx0 - hx1);
    const cx = hx1 + len * 0.45;
    const xsE = [];
    for (let i = 0; i <= 10; i++) xsE.push(cx - len * 0.27 + len * 0.54 * i / 10);
    const floor = Math.min(...xsE.map(top)) - 0.145;
    const eng = new THREE.Group();
    const blk = new THREE.BoxGeometry(len * 0.5, 0.1, W * 0.32); blk.translate(cx, floor + 0.02, 0);
    eng.add(mesh(blk, mats.engine, false));
    const cover = new THREE.BoxGeometry(len * 0.45, 0.035, W * 0.22); cover.translate(cx, floor + 0.085, 0);
    eng.add(mesh(cover, mats.engineCover, false));
    const air = new THREE.CylinderGeometry(0.11, 0.11, 0.05, 28); air.translate(cx + len * 0.28, floor + 0.07, W * 0.2);
    eng.add(mesh(air, mats.trim, false));
    const res = new THREE.CylinderGeometry(0.04, 0.04, 0.08, 16); res.translate(cx - len * 0.3, floor + 0.06, -W * 0.28);
    eng.add(mesh(res, mats.chrome, false));
    body.add(eng);
  }

  /* --- hood & trunk panels --- */
  const panel = (rg, isHood) => {
    const s = sideShape(rg[0], rg[1], x => top(x) + 0.004, x => top(x) - 0.035, []);
    const geo = extrude(s, -W / 2 + fw + 0.006, W / 2 - fw - 0.006, 0.012);
    const hingeX = isHood ? rg[1] : rg[0];
    const pivot = new THREE.Group();
    pivot.position.set(hingeX, top(hingeX), 0);
    const meshP = mesh(geo, mats.paint);
    meshP.position.set(-hingeX, -top(hingeX), 0);
    pivot.add(meshP);
    body.add(pivot);
    return { pivot, axis: 'z', max: isHood ? 0.8 : -0.95 };
  };
  const hood = m.hood ? panel(m.hood, true) : null;
  const trunk = m.trunk ? panel(m.trunk, false) : null;

  /* --- greenhouse --- */
  const cabin = smoothLine(m.cabin, m.smooth === false ? false : 'light', 160);
  const belt = Math.min(...m.cabin.map(p => p[1]));
  const roofH = Math.max(...m.cabin.map(p => p[1]));
  const hwF = y => W / 2 - 0.035 - (m.tumble || 0) * THREE.MathUtils.clamp((y - belt) / Math.max(0.01, roofH - belt), 0, 1);
  const cabinF = fnOf(cabin);
  const roofOn = m.roof !== false;

  const ribbon = (pts, mat, crown) => {
    if (pts.length < 2) return;
    const cols = 24, pos = [], idx = [];
    pts.forEach(([x, y]) => {
      const hw = hwF(y);
      for (let j = 0; j <= cols; j++) { const u = j / cols * 2 - 1; pos.push(x, y + crown * (1 - u * u), u * hw); }
    });
    for (let i = 0; i < pts.length - 1; i++) for (let j = 0; j < cols; j++) {
      const a = i * (cols + 1) + j, b = a + cols + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx); g.computeVertexNormals();
    const o = mesh(g, mat, mat !== mats.glass);
    if (mat === mats.glass) o.renderOrder = 2;
    body.add(o);
  };
  const seg = (a, b) => {
    const out = [];
    cabin.forEach(p => { if (p[0] <= a + 1e-6 && p[0] >= b - 1e-6) out.push(p); });
    return out;
  };
  const cFront = cabin[0][0], cRear = cabin[cabin.length - 1][0];
  ribbon(seg(cFront, m.roofFrom), mats.glass, 0);
  if (roofOn) {
    ribbon(seg(m.roofFrom, m.roofTo), mats.paint, m.crown || 0);
    ribbon(seg(m.roofTo, cRear - 1), mats.glass, 0);
  }

  // Frame tubes along the greenhouse edges.
  const frameMat = m.trimChrome ? mats.chrome : mats.trim;
  const tube = (pts, rad, mat, parent = body) => {
    if (pts.length < 2) return;
    const c = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p)));
    parent.add(mesh(new THREE.TubeGeometry(c, Math.max(8, pts.length * 2), rad, 8), mat));
  };
  const edgePts = roofOn ? cabin : seg(cFront, m.roofFrom);
  for (const s of [1, -1]) {
    const pts = edgePts.filter((_, i) => i % 3 === 0 || i === edgePts.length - 1).map(([x, y]) => [x, y, s * hwF(y)]);
    tube(pts, 0.022, roofOn ? mats.paint : frameMat);
  }
  if (!roofOn) {
    const y = cabin[cabin.length - 1][1], x = cabin[cabin.length - 1][0];
    tube([[x, y, -hwF(y)], [x + 0.01, y + 0.012, 0], [x, y, hwF(y)]], 0.02, frameMat);
  }

  // Side glass polygons between x=a and x=b, warped onto the tumblehome.
  const sidePoly = (a, b, s, inset = 0.03) => {
    a = Math.min(a, cFront); b = Math.max(b, cRear);
    if (a - b < 0.05) return null;
    const pts = [[a, cabinF(a) - inset]];
    cabin.forEach(([x, y]) => { if (x < a && x > b) pts.push([x, y - inset]); });
    pts.push([b, cabinF(b) - inset], [b, top(b) + 0.01], [a, top(a) + 0.01]);
    const valid = pts.some(p => p[1] - top(p[0]) > 0.05);
    if (!valid) return null;
    const g = new THREE.ShapeGeometry(polyShape(pts));
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setZ(i, s * (hwF(p.getY(i)) + 0.004));
    g.computeVertexNormals();
    return g;
  };

  /* --- doors --- */
  const doors = [];
  m.doors.forEach(([d0, d1], di) => {
    for (const s of [1, -1]) {
      const pivot = new THREE.Group();
      const inner = new THREE.Group();
      pivot.add(inner);
      let px, py, pz;
      if (m.gullwing) { px = 0; py = roofH; pz = s * hwF(roofH) * 0.35; }
      else { px = d0; py = 0; pz = s * W / 2; }
      pivot.position.set(px, py, pz);
      inner.position.set(-px, -py, -pz);

      const ext = [];
      for (const wx of m.wheel.x) ext.push(wx + archR - 1e-4, wx - archR + 1e-4);
      const gap = 0.006;
      const shape = sideShape(d0 - gap, d1 + gap, top, x => bottom(x) + 0.02, ext);
      const z0 = s > 0 ? W / 2 - t : -W / 2, z1 = s > 0 ? W / 2 : -W / 2 + t;
      inner.add(mesh(extrude(shape, z0, z1, Math.min(bevel, 0.03)), mats.paint));
      // inner trim panel
      const ti0 = s > 0 ? W / 2 - t - 0.03 : -W / 2 + t, ti1 = s > 0 ? W / 2 - t : -W / 2 + t + 0.03;
      const trimShape = sideShape(d0 - 0.04, d1 + 0.04, x => top(x) - 0.03, x => bottom(x) + 0.08, ext);
      inner.add(mesh(extrude(trimShape, ti0, ti1, 0.01), mats.interior, false));

      if (roofOn) {
        const g = sidePoly(d0 - 0.02, d1 + 0.02, s);
        if (g) { const o = mesh(g, mats.glass, false); o.renderOrder = 2; inner.add(o); }
      }
      // handle
      const hx = d1 + 0.16, hy = top(hx) - 0.09;
      const h = new THREE.BoxGeometry(0.13, 0.025, 0.02); h.translate(hx, hy, s * (W / 2 + 0.008));
      inner.add(mesh(h, mats.chrome, false));
      // mirror on the front doors
      if (di === 0) {
        const mx = d0 - 0.12, my = top(mx) + 0.07;
        const mg = new THREE.Group();
        const arm = new THREE.BoxGeometry(0.06, 0.03, 0.08); arm.translate(mx, my - 0.02, s * (W / 2 + 0.03));
        const cup = new THREE.SphereGeometry(0.07, 16, 10); cup.scale(0.8, 0.6, 1); cup.translate(mx, my + 0.02, s * (W / 2 + 0.1));
        mg.add(mesh(arm, mats.trim, false), mesh(cup, m.trimChrome ? mats.chrome : mats.paint));
        (m.gullwing ? body : inner).add(mg);
      }
      body.add(pivot);
      doors.push({ pivot, axis: m.gullwing ? 'x' : 'y', max: m.gullwing ? -s * 1.15 : s * 1.1 });
    }
  });

  // Fixed side glass / pillars outside the door ranges.
  if (roofOn) {
    const ranges = [[cFront, dFront], [dRear, cRear]];
    for (const [a, b] of ranges) for (const s of [1, -1]) {
      const g = sidePoly(a, b, s);
      if (!g) continue;
      const wide = a - b > 0.25;
      const o = mesh(g, wide ? mats.glass : mats.paint, false);
      if (wide) o.renderOrder = 2;
      body.add(o);
    }
    // vertical pillars at door seams
    const seams = new Set();
    m.doors.forEach(([a, b]) => { seams.add(a); seams.add(b); });
    for (const x of seams) {
      if (x > cFront - 0.02 || x < cRear + 0.02) continue;
      const y0 = top(x), y1 = cabinF(x);
      if (y1 - y0 < 0.1) continue;
      for (const s of [1, -1]) tube([[x, y0, s * hwF(y0)], [x, (y0 + y1) / 2, s * hwF((y0 + y1) / 2)], [x, y1, s * hwF(y1)]], 0.03, m.gullwing ? mats.paint : mats.trim);
    }
  }

  /* --- interior --- */
  const intr = new THREE.Group();
  body.add(intr);
  const wIn = W - 2 * t - 0.02;
  const floorY = clr + 0.08;
  const fl = new THREE.BoxGeometry(dFront - ckR, 0.06, wIn); fl.translate((dFront + ckR) / 2, floorY, 0);
  intr.add(mesh(fl, mats.interiorDark, false));
  const fw2 = new THREE.BoxGeometry(0.02, top(dFront) - floorY, wIn); fw2.translate(dFront - 0.01, (top(dFront) + floorY) / 2, 0);
  intr.add(mesh(fw2, mats.interiorDark, false));
  const bw = new THREE.BoxGeometry(0.02, top(ckR) - floorY, wIn); bw.translate(ckR + 0.01, (top(ckR) + floorY) / 2, 0);
  intr.add(mesh(bw, mats.interior, false));

  const w0 = Math.min(cFront, dFront);
  const beltY = top(w0 - 0.2);
  const dash = new THREE.BoxGeometry(0.38, 0.24, wIn); dash.translate(w0 - 0.31, beltY - 0.1, 0);
  intr.add(mesh(dash, mats.interior, false));
  if (m.era !== 'modern') {
    const wd = new THREE.BoxGeometry(0.02, 0.05, wIn * 0.9); wd.translate(w0 - 0.5, beltY - 0.06, 0);
    intr.add(mesh(wd, mats.wood, false));
  }
  const drvZ = -W * 0.22;
  for (const gz of [-0.08, 0.08]) {
    const gg = new THREE.CylinderGeometry(0.04, 0.04, 0.012, 24);
    gg.rotateZ(Math.PI / 2); gg.translate(w0 - 0.505, beltY - 0.04, drvZ + gz);
    intr.add(mesh(gg, mats.gauge, false));
  }

  const seatX = w0 - 1.08;
  const cushY = floorY + 0.2;
  const seat = (x, z, wdt) => {
    const g = new THREE.Group();
    const c = new THREE.BoxGeometry(0.5, 0.12, wdt); c.translate(x, cushY, z);
    const backH = Math.min(0.62, cabinF(x - 0.2) - cushY - 0.12);
    const b = new THREE.BoxGeometry(0.12, backH, wdt); b.rotateZ(0.18); b.translate(x - 0.27, cushY + backH / 2, z);
    g.add(mesh(c, mats.interior, false), mesh(b, mats.interior, false));
    if (wdt < 0.7) { const hr = new THREE.BoxGeometry(0.1, 0.16, wdt * 0.6); hr.translate(x - 0.35, cushY + backH + 0.07, z); g.add(mesh(hr, mats.interior, false)); }
    intr.add(g);
  };
  seat(seatX, drvZ, 0.48);
  seat(seatX, -drvZ, 0.48);
  const rearX = m.doors.length > 1 ? (m.doors[1][0] + m.doors[1][1]) / 2 - 0.05 : m.rearSeat;
  if (rearX !== undefined) seat(rearX, 0, wIn * 0.9);
  const cons = new THREE.BoxGeometry(0.75, 0.16, 0.2); cons.translate(seatX + 0.3, floorY + 0.1, 0);
  intr.add(mesh(cons, mats.interiorDark, false));

  const sw = new THREE.Group();
  const ring = new THREE.TorusGeometry(0.18, 0.017, 10, 40); ring.rotateY(Math.PI / 2);
  const hubg = new THREE.CylinderGeometry(0.05, 0.05, 0.04, 16); hubg.rotateZ(Math.PI / 2);
  const spoke = new THREE.BoxGeometry(0.01, 0.02, 0.34);
  sw.add(mesh(ring, m.era === 'classic' ? mats.wood : mats.interiorDark, false), mesh(hubg, mats.interiorDark, false), mesh(spoke, mats.chrome, false));
  sw.rotation.z = 0.45;
  sw.position.set(seatX + 0.5, beltY + 0.02, drvZ);
  intr.add(sw);
  const col = new THREE.CylinderGeometry(0.02, 0.02, 0.35, 8); col.rotateZ(Math.PI / 2 + 0.45);
  col.translate(seatX + 0.64, beltY - 0.05, drvZ); intr.add(mesh(col, mats.interiorDark, false));
  const driverEye = new THREE.Vector3(seatX - 0.2, Math.min(cushY + 0.66, roofH - 0.1), drvZ);

  /* --- lights, grille, bumpers --- */
  const frontAt = y => { for (const [x, ty] of topLine) if (ty >= y) return x; return L / 2; };
  const rearAt = y => { for (let i = topLine.length - 1; i >= 0; i--) if (topLine[i][1] >= y) return topLine[i][0]; return -L / 2; };
  const hd = m.head;
  for (const s of [1, -1]) {
    const x = frontAt(hd.y) + 0.01, z = s * W / 2 * hd.z;
    let g;
    if (hd.type === 'round') {
      g = new THREE.CylinderGeometry(hd.s, hd.s, 0.06, 28); g.rotateZ(Math.PI / 2); g.translate(x - 0.02, hd.y, z);
      const rim = new THREE.TorusGeometry(hd.s + 0.008, 0.01, 8, 28); rim.rotateY(Math.PI / 2); rim.translate(x + 0.01, hd.y, z);
      body.add(mesh(rim, m.trimChrome ? mats.chrome : mats.trim, false));
    } else {
      g = new THREE.BoxGeometry(0.06, hd.h, hd.w); g.translate(x - 0.02, hd.y, z);
    }
    body.add(mesh(g, mats.head, false));
    const tl = m.tail, tx = rearAt(tl.y) - 0.005;
    const tg = new THREE.BoxGeometry(0.05, tl.h, tl.w); tg.translate(tx + 0.015, tl.y, s * W / 2 * tl.z);
    body.add(mesh(tg, mats.tail, false));
  }
  const gr = m.grille, gx = frontAt(gr.y) + 0.005;
  if (gr.type === 'wide') {
    const g = new THREE.CylinderGeometry(0.5, 0.5, 0.05, 40); g.rotateZ(Math.PI / 2); g.scale(1, gr.h, gr.w); g.translate(gx - 0.01, gr.y, 0);
    body.add(mesh(g, mats.grille, false));
    const bar = new THREE.BoxGeometry(0.02, 0.02, gr.w * 0.95); bar.translate(gx + 0.02, gr.y, 0); body.add(mesh(bar, mats.chrome, false));
    const star = new THREE.CylinderGeometry(0.05, 0.05, 0.02, 24); star.rotateZ(Math.PI / 2); star.translate(gx + 0.03, gr.y, 0); body.add(mesh(star, mats.chrome, false));
  } else if (gr.type === 'upright') {
    const g = new THREE.BoxGeometry(0.05, gr.h, gr.w); g.translate(gx, gr.y, 0); body.add(mesh(g, mats.grille, false));
    const fr = new THREE.BoxGeometry(0.035, gr.h + 0.04, gr.w + 0.04); fr.translate(gx - 0.01, gr.y, 0); body.add(mesh(fr, mats.chrome, false));
    for (let i = -3; i <= 3; i++) { const sl = new THREE.BoxGeometry(0.02, gr.h * 0.92, 0.008); sl.translate(gx + 0.03, gr.y, i * gr.w / 8); body.add(mesh(sl, mats.chrome, false)); }
  } else if (gr.type === 'slats') {
    const g = new THREE.BoxGeometry(0.04, gr.h, gr.w); g.translate(gx, gr.y, 0); body.add(mesh(g, mats.grille, false));
    for (let i = 0; i < 5; i++) { const sl = new THREE.BoxGeometry(0.02, 0.02, gr.w); sl.translate(gx + 0.025, gr.y - gr.h / 2 + (i + 0.5) * gr.h / 5, 0); body.add(mesh(sl, mats.paint, false)); }
  } else {
    const g = new THREE.BoxGeometry(0.05, gr.h, gr.w); g.translate(gx, gr.y, 0); body.add(mesh(g, mats.grille, false));
    const bar = new THREE.BoxGeometry(0.02, 0.025, gr.w); bar.translate(gx + 0.03, gr.y, 0); body.add(mesh(bar, mats.chrome, false));
    const star = new THREE.CylinderGeometry(0.06, 0.06, 0.02, 24); star.rotateZ(Math.PI / 2); star.translate(gx + 0.045, gr.y, 0); body.add(mesh(star, mats.chrome, false));
  }

  if (m.bumpers !== 'none') {
    const bm = { chrome: mats.chrome, body: mats.paint, black: mats.trim }[m.bumpers];
    const y = m.bumperY, rad = m.bumpers === 'black' ? 0.06 : 0.035;
    for (const s of [1, -1]) {
      const xe = s > 0 ? frontAt(y) : rearAt(y);
      const pts = [[xe - s * 0.3, y, -W * 0.49], [xe + s * 0.03, y, -W * 0.38], [xe + s * 0.06, y, 0], [xe + s * 0.03, y, W * 0.38], [xe - s * 0.3, y, W * 0.49]];
      tube(pts, rad, bm);
    }
  }
  // exhaust
  for (const z of m.id === 'sls' ? [-0.12, -0.24, 0.12, 0.24] : [-0.35]) {
    const ex = new THREE.CylinderGeometry(0.035, 0.035, 0.18, 16); ex.rotateZ(Math.PI / 2);
    ex.translate(-L / 2 + 0.02, clr + 0.08, z); body.add(mesh(ex, mats.chrome, false));
  }
  if (m.spare) {
    const sp = buildWheel(m, 'mono', mats);
    sp.rotation.y = -Math.PI / 2;
    sp.position.set(-L / 2 - m.wheel.w / 2 - 0.02, 1.0, 0);
    body.add(sp);
  }

  /* --- tunable parts --- */
  const tuneGroup = new THREE.Group();
  body.add(tuneGroup);
  const wheels = [];
  const wheelZ = W / 2 - m.wheel.w / 2 - 0.03;
  for (const wx of m.wheel.x) for (const s of [1, -1]) wheels.push({ x: wx, s });
  const wheelGroup = new THREE.Group();
  root.add(wheelGroup);

  const build = {
    rims: style => {
      wheelGroup.clear();
      for (const { x, s } of wheels) {
        const w = buildWheel(m, style, mats);
        w.position.set(x, r, s * wheelZ);
        if (s < 0) w.rotation.y = Math.PI;
        wheelGroup.add(w);
      }
    },
    parts: (spoiler, kit) => {
      tuneGroup.clear();
      const ty = x => top(x);
      if (spoiler !== 'none') {
        const x = -L / 2 + (m.trunk ? 0.16 : 0.1);
        if (spoiler === 'lip') {
          const s = polyShape([[x + 0.12, ty(x + 0.12)], [x - 0.04, ty(x) + 0.04], [x - 0.05, ty(x) - 0.01]]);
          tuneGroup.add(mesh(extrude(s, -W * 0.42, W * 0.42, 0.008), mats.paint));
        } else if (spoiler === 'duck') {
          const s = polyShape([[x + 0.3, ty(x + 0.3) - 0.005], [x - 0.04, ty(x) + 0.09], [x - 0.07, ty(x) + 0.08], [x - 0.07, ty(x) - 0.02]]);
          tuneGroup.add(mesh(extrude(s, -W * 0.46, W * 0.46, 0.015), mats.paint));
        } else {
          const wy = ty(x) + 0.26;
          for (const z of [-W * 0.3, W * 0.3]) {
            const p = new THREE.BoxGeometry(0.06, 0.26, 0.02); p.translate(x + 0.02, ty(x) + 0.13, z);
            tuneGroup.add(mesh(p, mats.carbon));
          }
          const wing = polyShape([[x + 0.18, wy], [x - 0.14, wy + 0.04], [x - 0.15, wy + 0.015], [x + 0.18, wy - 0.012]]);
          tuneGroup.add(mesh(extrude(wing, -W * 0.48, W * 0.48, 0.006), mats.carbon));
          for (const z of [-W * 0.48, W * 0.48]) {
            const e = new THREE.BoxGeometry(0.36, 0.12, 0.012); e.translate(x + 0.01, wy + 0.01, z);
            tuneGroup.add(mesh(e, mats.carbon));
          }
        }
      }
      if (kit === 'sport') {
        const fx = frontAt(clr + 0.1);
        const sp = new THREE.BoxGeometry(0.18, 0.025, W * 0.9); sp.translate(fx - 0.02, bottom(fx - 0.1) - 0.01, 0);
        tuneGroup.add(mesh(sp, mats.carbon));
        const a = m.wheel.x[0] - archR - 0.02, b = m.wheel.x[1] + archR + 0.02;
        for (const s of [1, -1]) {
          const sk = new THREE.BoxGeometry(a - b, 0.06, 0.05); sk.translate((a + b) / 2, clr + 0.02, s * (W / 2 + 0.005));
          tuneGroup.add(mesh(sk, mats.carbon));
        }
        const df = new THREE.BoxGeometry(0.22, 0.05, W * 0.7); df.translate(-L / 2 + 0.12, bottom(-L / 2 + 0.2) - 0.015, 0);
        tuneGroup.add(mesh(df, mats.carbon));
      }
    },
  };

  const car = {
    root, body, doors, hood, trunk, mats, model: m, driverEye,
    size: new THREE.Vector3(L, roofH, W),
    open: { doors: 0, hood: 0, trunk: 0 },
    target: { doors: 0, hood: 0, trunk: 0 },
    tuning: null,
    applyTuning(tu) {
      const prev = this.tuning || {};
      this.tuning = { ...tu };
      const f = FINISHES[tu.finish] || FINISHES.gloss;
      mats.paint.color.set(tu.color);
      mats.paint.metalness = f.metalness; mats.paint.roughness = f.roughness; mats.paint.clearcoat = f.clearcoat;
      const rc = RIM_COLORS[tu.rimColor] || RIM_COLORS.silver;
      mats.rim.color.setHex(rc[1]); mats.rim.metalness = rc[2]; mats.rim.roughness = rc[3];
      const ti = TINTS[tu.tint] || TINTS.clear;
      mats.glass.opacity = ti[1]; mats.glass.color.setHex(ti[2]);
      mats.head.emissive.setHex((LIGHTS[tu.lights] || LIGHTS.white)[1]);
      mats.interior.color.setHex((INTERIORS[tu.interior] || INTERIORS.black)[1]);
      mats.caliper.color.set(tu.kit === 'sport' ? '#c4161c' : (m.caliper || '#2a2b2e'));
      body.position.y = (tu.ride || 0) / 100;
      if (prev.rims !== tu.rims) build.rims(tu.rims);
      if (prev.spoiler !== tu.spoiler || prev.kit !== tu.kit) build.parts(tu.spoiler, tu.kit);
    },
    update(dt) {
      const k = 1 - Math.exp(-dt * 5);
      for (const key of ['doors', 'hood', 'trunk']) this.open[key] += (this.target[key] - this.open[key]) * k;
      const ease = v => v * v * (3 - 2 * v);
      for (const d of doors) d.pivot.rotation[d.axis] = d.max * ease(this.open.doors);
      if (hood) hood.pivot.rotation.z = hood.max * ease(this.open.hood);
      if (trunk) trunk.pivot.rotation.z = trunk.max * ease(this.open.trunk);
    },
    dispose() {
      root.traverse(o => { if (o.geometry) o.geometry.dispose(); });
      Object.values(mats).forEach(mt => mt.dispose());
    },
  };
  car.applyTuning(tuning || defaultTuning(m));
  return car;
}
