// Code-built cabin parts for models whose file has no usable interior.
//
// Everything is in car coordinates, metres: x forward, y up, z towards the
// passenger (the driver sits at negative z). A recipe in CABINS places seats,
// dashboard, working dials, steering wheel and trim inside the real body shell;
// glbCar.js calls buildCabin() when a catalog entry has `glb.cabin`.
import * as THREE from 'three';

/* ---------- textures ---------- */
const DIAL_A0 = -120 * Math.PI / 180, DIAL_SWEEP = 240 * Math.PI / 180;   // needle angle from 12 o'clock, clockwise

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// A printed dial: `max` at full sweep, a number every `step`, optional red zone.
function dialTexture({ max, step, label = '', redFrom = null, face = '#0c0c0e', ink = '#f4f1e6', minor = 2 }) {
  return canvasTex(256, 256, g => {
    g.fillStyle = face; g.beginPath(); g.arc(128, 128, 127, 0, 7); g.fill();
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = 'bold 21px Georgia, serif';
    for (let v = 0; v <= max + 1e-6; v += step / minor) {
      const th = DIAL_A0 + DIAL_SWEEP * v / max, major = Math.abs(v / step - Math.round(v / step)) < 1e-6;
      const sx = Math.sin(th), cy = -Math.cos(th), r1 = major ? 94 : 105;
      g.strokeStyle = redFrom != null && v >= redFrom ? '#e23a2e' : ink; g.lineWidth = major ? 5 : 2;
      g.beginPath(); g.moveTo(128 + sx * r1, 128 + cy * r1); g.lineTo(128 + sx * 117, 128 + cy * 117); g.stroke();
      if (major) { g.fillStyle = g.strokeStyle; g.fillText(String(Math.round(v)), 128 + sx * 72, 128 + cy * 72); }
    }
    g.fillStyle = '#a9a595'; g.font = '15px Georgia, serif'; g.fillText(label, 128, 188);
  });
}

// Small auxiliary gauge: a short arc with two end labels.
function miniDialTexture(a, b, label) {
  return canvasTex(128, 128, g => {
    g.fillStyle = '#0c0c0e'; g.beginPath(); g.arc(64, 64, 63, 0, 7); g.fill();
    g.strokeStyle = '#f4f1e6'; g.lineWidth = 3; g.beginPath(); g.arc(64, 70, 40, Math.PI * 1.15, Math.PI * 1.85); g.stroke();
    g.fillStyle = '#f4f1e6'; g.font = 'bold 15px Georgia, serif'; g.textAlign = 'center';
    g.fillText(a, 26, 62); g.fillText(b, 102, 62);
    g.fillStyle = '#a9a595'; g.font = '13px Georgia, serif'; g.fillText(label, 64, 100);
    g.strokeStyle = '#e23a2e'; g.lineWidth = 3; g.beginPath(); g.moveTo(64, 76); g.lineTo(80, 38); g.stroke();
  });
}

// Pleated upholstery: soft ribs, used with repeat along the seat width.
function pleatTexture() {
  const t = canvasTex(8, 64, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#7d7d7d'); gr.addColorStop(0.12, '#ffffff'); gr.addColorStop(0.85, '#e6e6e6'); gr.addColorStop(1, '#6f6f6f');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function carpetTexture() {
  const t = canvasTex(64, 64, (g, w, h) => {
    g.fillStyle = '#8a8a8a'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) { const v = 90 + Math.floor(Math.random() * 110); g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5); }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(14, 14);
  return t;
}

/* ---------- the kit ---------- */
function createKit(paint) {
  const group = new THREE.Group();
  group.name = 'cabin';
  const mats = {
    paint,                                                             // follows the body colour
    leather: new THREE.MeshStandardMaterial({ color: 0x8c1c1c, roughness: 0.5, map: pleatTexture() }),
    leatherPlain: new THREE.MeshStandardMaterial({ color: 0x8c1c1c, roughness: 0.55 }),
    carpet: new THREE.MeshStandardMaterial({ color: 0x8c1c1c, roughness: 1, map: carpetTexture() }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.08 }),
    alu: new THREE.MeshStandardMaterial({ color: 0xb9bcc2, metalness: 0.9, roughness: 0.35 }),
    ivory: new THREE.MeshStandardMaterial({ color: 0xeee6cf, roughness: 0.35 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x121214, roughness: 0.7 }),
    gloss: new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.12, metalness: 0.3 }),
    headliner: new THREE.MeshStandardMaterial({ color: 0xd9d2bd, roughness: 0.95, side: THREE.DoubleSide }),
    needle: new THREE.MeshBasicMaterial({ color: 0xff4a2e }),
  };
  const add = (geo, mat, parent = group) => { const o = new THREE.Mesh(geo, mat); o.castShadow = false; o.receiveShadow = true; parent.add(o); return o; };

  const kit = {
    group, mats, add,
    needles: {},          // kind → { pivot, max }
    steer: null,          // group that spins with the steering
    // axis-aligned box: size [x, y, z] centred at pos
    box(size, mat, pos, rot) {
      const o = add(new THREE.BoxGeometry(...size), mat); o.position.set(...pos); if (rot) o.rotation.set(...rot); return o;
    },
    // side profile (points [x, y]) extruded across the car from z0 to z1 with rounded edges
    profile(pts, z0, z1, mat, bevel = 0.02, smooth = false) {
      let shape;
      if (smooth) {
        const c = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(p[0], p[1], 0)), true, 'centripetal');
        shape = new THREE.Shape(c.getPoints(pts.length * 8).map(v => new THREE.Vector2(v.x, v.y)));
      } else shape = new THREE.Shape(pts.map(p => new THREE.Vector2(p[0], p[1])));
      const b = Math.min(bevel, (z1 - z0) / 2.2);
      const g = new THREE.ExtrudeGeometry(shape, { depth: z1 - z0 - 2 * b, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelSegments: 4, curveSegments: 8 });
      g.translate(0, 0, z0 + b);
      return add(g, mat);
    },
    // cylinder along an axis ('x' | 'y' | 'z')
    cyl(r, len, axis, mat, pos, parent) {
      const g = new THREE.CylinderGeometry(r, r, len, 20);
      if (axis === 'x') g.rotateZ(Math.PI / 2); else if (axis === 'z') g.rotateX(Math.PI / 2);
      const o = add(g, mat, parent); o.position.set(...pos); return o;
    },
    // bucket seat. x0 = front edge, x1 = rear of the cushion, yTop = cushion top, backTop = top of the backrest
    seat({ z, x0, x1, yTop, backTop, width = 0.44, rake = 0.22, floor }) {
      const H = backTop - yTop, th = 0.11;
      const pts = [
        [x0, yTop - th], [x0 + 0.01, yTop + 0.015], [(x0 + x1) / 2, yTop - 0.005], [x1 + 0.13, yTop - 0.02],
        [x1 + 0.1 - rake * H * 0.5, yTop + H * 0.5], [x1 + 0.09 - rake * H, yTop + H], [x1 - 0.02 - rake * H, yTop + H - 0.01],
        [x1 - 0.03 - rake * H * 0.5, yTop + H * 0.5], [x1 - 0.02, yTop - th + 0.02], [x1 + 0.1, yTop - th - 0.01],
      ];
      const half = width / 2;
      const main = kit.profile(pts, z - half + 0.045, z + half - 0.045, mats.leather, 0.03, true);
      // bolsters: the same outline, a little proud, on both sides
      const grow = pts.map(([x, y], i) => [x + (i >= 4 && i <= 5 ? 0.03 : 0.0), y + (i >= 1 && i <= 3 ? 0.03 : 0)]);
      kit.profile(grow, z - half, z - half + 0.07, mats.leatherPlain, 0.03, true);
      kit.profile(grow, z + half - 0.07, z + half, mats.leatherPlain, 0.03, true);
      if (floor !== undefined) kit.box([Math.abs(x0 - x1) * 0.8, yTop - th - floor, width * 0.7], mats.dark, [(x0 + x1) / 2, (yTop - th + floor) / 2, z]);
      return main;
    },
    // round instrument facing the driver. tilt = how far the face leans back (radians)
    dial({ pos, r, tilt = 0, texture, kind, max, bezel = mats.chrome }) {
      const g = new THREE.Group(); g.position.set(...pos); g.rotation.z = -tilt; group.add(g);
      const face = new THREE.CircleGeometry(r, 40); face.rotateY(-Math.PI / 2);
      add(face, new THREE.MeshBasicMaterial({ map: texture }), g);
      const ring = new THREE.TorusGeometry(r * 1.02, r * 0.07, 10, 40); ring.rotateY(Math.PI / 2); ring.translate(-0.002, 0, 0);
      add(ring, bezel, g);
      if (kind) {
        const ng = new THREE.BoxGeometry(0.002, r * 0.86, r * 0.07); ng.translate(0, r * 0.3, 0);
        const cap = new THREE.CylinderGeometry(r * 0.12, r * 0.12, 0.006, 14); cap.rotateZ(Math.PI / 2);
        const piv = new THREE.Group(); piv.position.x = -0.004; piv.rotation.x = DIAL_A0;
        piv.add(new THREE.Mesh(ng, mats.needle), new THREE.Mesh(cap, mats.dark));
        g.add(piv);
        kit.needles[kind] = { pivot: piv, max };
      }
      return g;
    },
    // steering wheel at pos; tilt = angle of the column below horizontal. Returns the group; children of `spin` turn.
    wheel({ pos, tilt, r, rim = mats.dark, rimTube = 0.014, spokes = [Math.PI / 2, -Math.PI / 2], spokeMat, spokeW = 0.03, hub = mats.dark, hubR = 0.045, hornRing = 0, column = 0.3, columnMat = mats.dark }) {
      const g = new THREE.Group(); g.position.set(...pos); g.rotation.z = -tilt; group.add(g);
      const spin = new THREE.Group(); g.add(spin);
      const ring = new THREE.TorusGeometry(r, rimTube, 12, 56); ring.rotateY(Math.PI / 2);
      add(ring, rim, spin);
      for (const a of spokes) {       // angle from 12 o'clock, clockwise as the driver sees it
        const sp = new THREE.BoxGeometry(0.012, r, spokeW); sp.translate(0.012, r / 2, 0); sp.rotateX(a);
        add(sp, spokeMat || rim, spin);
      }
      const hg = new THREE.CylinderGeometry(hubR, hubR * 1.15, 0.05, 28); hg.rotateZ(Math.PI / 2); hg.translate(0.012, 0, 0);
      add(hg, hub, spin);
      if (hornRing) { const hr = new THREE.TorusGeometry(hornRing, 0.005, 8, 40); hr.rotateY(Math.PI / 2); hr.translate(-0.012, 0, 0); add(hr, mats.chrome, spin); }
      if (column) kit.cyl(0.022, column, 'x', columnMat, [column / 2 + 0.03, 0, 0], g);
      kit.steer = spin;
      return { group: g, spin };
    },
  };
  return kit;
}

/* ---------- recipes ---------- */
const CABINS = {
  // Mercedes-Benz 300 SL "Gullwing": body-colour dash with two big VDO dials,
  // ivory two-spoke wheel, pleated bucket seats, very wide leather sills.
  '300sl'(k) {
    const m = k.mats, FLOOR = 0.25, SILL = 0.53, IN = 0.56, OUT = 0.77, DRV = -0.315;
    // tub: floor, firewall, wide sills, tunnel, rear bulkhead, luggage shelf
    k.box([1.45, 0.03, 1.5], m.carpet, [0.07, FLOOR - 0.015, 0]);
    k.box([0.04, 0.72, 1.4], m.dark, [0.78, 0.55, 0]);
    k.box([0.5, 0.02, 1.1], m.carpet, [0.6, 0.36, 0], [0, 0, -0.5]);                       // toe board
    for (const s of [1, -1]) {
      k.profile([[0.78, FLOOR], [0.78, SILL], [-0.57, SILL], [-0.57, FLOOR]], s > 0 ? IN : -OUT, s > 0 ? OUT : -IN, m.leatherPlain, 0.025);
      k.box([1.4, 0.2, 0.02], m.leatherPlain, [0.08, SILL + 0.1, s * 0.765]);              // door inner trim up to the window
      k.cyl(0.011, 0.26, 'x', m.chrome, [-0.05, SILL + 0.13, s * 0.75]);                   // door pull
    }
    k.profile([[0.78, FLOOR], [0.78, 0.47], [0.3, 0.43], [-0.62, 0.4], [-0.62, FLOOR]], -0.1, 0.1, m.leatherPlain, 0.03);
    k.box([0.04, 0.5, 1.3], m.leatherPlain, [-0.6, 0.49, 0]);
    k.profile([[-0.6, 0.71], [-0.6, 0.74], [-1.36, 0.83], [-1.36, 0.8]], -0.68, 0.68, m.carpet, 0.005);
    for (const z of [-0.3, 0.3]) k.box([0.6, 0.012, 0.045], m.dark, [-0.95, 0.775, z], [0, 0, -0.12]);   // luggage straps

    // dashboard in body colour, with a cowl over the instruments
    k.profile([[0.27, 0.6], [0.245, 0.86], [0.3, 0.895], [0.6, 0.875], [0.6, 0.6]], -0.74, 0.74, m.paint, 0.015);
    k.profile([[0.215, 0.9], [0.225, 0.922], [0.36, 0.935], [0.5, 0.905], [0.5, 0.89]], DRV - 0.19, DRV + 0.19, m.paint, 0.012, true);
    k.cyl(0.03, 1.46, 'z', m.leatherPlain, [0.262, 0.6, 0]);                                // padded lower edge
    const FX = 0.224;                                                                       // just proud of the fascia
    k.dial({ pos: [FX, 0.845, DRV - 0.1], r: 0.06, tilt: 0.1, kind: 'speedo', max: 260, texture: dialTexture({ max: 260, step: 20, label: 'km/h' }) });
    k.dial({ pos: [FX, 0.845, DRV + 0.1], r: 0.06, tilt: 0.1, kind: 'tacho', max: 7000, texture: dialTexture({ max: 7, step: 1, label: 'U/min x1000', redFrom: 6 }) });
    k.dial({ pos: [FX, 0.745, DRV - 0.045], r: 0.026, tilt: 0.1, texture: miniDialTexture('0', '1', 'BENZIN') });
    k.dial({ pos: [FX, 0.745, DRV + 0.045], r: 0.026, tilt: 0.1, texture: miniDialTexture('40', '120', '°C') });
    k.dial({ pos: [FX, 0.79, 0.02], r: 0.04, tilt: 0.1, texture: dialTexture({ max: 12, step: 3, label: 'VDO', minor: 3 }) });   // clock
    for (let i = 0; i < 6; i++) k.cyl(0.011, 0.03, 'x', m.chrome, [FX - 0.012, 0.69, -0.06 + i * 0.075]);                       // pull switches
    k.box([0.006, 0.07, 0.2], m.chrome, [FX, 0.79, 0.26]);                                  // radio blanking plate
    k.box([0.004, 0.006, 0.3], m.chrome, [FX, 0.74, 0.52]);                                 // glovebox handle line
    k.cyl(0.011, 0.22, 'z', m.chrome, [FX - 0.03, 0.8, 0.5]);                               // passenger grab handle

    k.wheel({ pos: [0.165, 0.795, DRV], tilt: 0.46, r: 0.2, rim: m.ivory, rimTube: 0.013, spokes: [Math.PI / 2, -Math.PI / 2], spokeW: 0.028, hub: m.ivory, hubR: 0.04, hornRing: 0.105, column: 0.16, columnMat: m.paint });

    for (const z of [DRV, -DRV]) k.seat({ z, x0: 0.07, x1: -0.47, yTop: 0.44, backTop: 1.0, width: 0.44, rake: 0.2, floor: FLOOR });

    // long chrome gear lever with an ivory knob, handbrake, pedals
    const lever = k.cyl(0.008, 0.3, 'y', m.chrome, [0.17, 0.57, 0.0]); lever.rotation.z = 0.35;
    const knob = k.add(new THREE.SphereGeometry(0.026, 18, 14), m.ivory); knob.position.set(0.12, 0.71, 0);
    const boot = k.add(new THREE.ConeGeometry(0.045, 0.06, 14), m.dark); boot.position.set(0.215, 0.46, 0);
    k.box([0.24, 0.022, 0.022], m.chrome, [-0.12, 0.47, 0.075], [0, 0, 0.3]);
    for (const [pz, w] of [[-0.44, 0.06], [-0.33, 0.06], [-0.21, 0.045]]) k.box([0.02, 0.08, w], m.alu, [0.66, 0.38, pz], [0, 0, -0.5]);

    // cream headliner under the roof
    k.profile([[0.1, 1.19], [0.1, 1.2], [-0.3, 1.225], [-0.75, 1.185], [-0.75, 1.175], [-0.3, 1.215]], -0.42, 0.42, m.headliner, 0.002);
    return { eye: [-0.34, 1.03, DRV], interiorDefault: 0x8c1c1c };
  },
};

// Central display: a simple navigation / media screen.
function screenTexture() {
  return canvasTex(256, 144, (g, w, h) => {
    g.fillStyle = '#0a1420'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#1f3a55'; g.lineWidth = 6;
    for (const [a, b, c, d] of [[0, 100, 256, 60], [40, 0, 120, 144], [150, 144, 230, 0], [0, 40, 256, 110]]) { g.beginPath(); g.moveTo(a, b); g.lineTo(c, d); g.stroke(); }
    g.strokeStyle = '#4fb3ff'; g.lineWidth = 4; g.beginPath(); g.moveTo(40, 130); g.lineTo(96, 84); g.lineTo(170, 96); g.lineTo(214, 30); g.stroke();
    g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(96, 74); g.lineTo(104, 92); g.lineTo(88, 92); g.fill();
    g.fillStyle = '#0d0f12'; g.fillRect(0, 0, w, 22);
    g.fillStyle = '#d7dde5'; g.font = 'bold 13px sans-serif'; g.fillText('NAVI', 10, 16); g.fillText('21.5°C', 196, 16);
    g.fillStyle = '#8e99a6'; g.fillText('AUDIO', 70, 16); g.fillText('TEL', 134, 16);
  });
}

// Mercedes-AMG GT: the file's cabin geometry is good (glbCar splits and colours
// it); this only adds what cannot be painted on: working dials and the display.
CABINS.amggt = k => {
  const m = k.mats, DRV = -0.445;
  const face = { face: '#08080a', ink: '#f2f2f2' };
  k.dial({ pos: [0.206, 0.785, DRV - 0.1], r: 0.05, tilt: 0.2, kind: 'speedo', max: 360, bezel: m.alu, texture: dialTexture({ max: 360, step: 40, label: 'km/h', ...face }) });
  k.dial({ pos: [0.206, 0.785, DRV + 0.1], r: 0.05, tilt: 0.2, kind: 'tacho', max: 8000, bezel: m.alu, texture: dialTexture({ max: 8, step: 1, label: 'x1000', redFrom: 7, ...face }) });
  const scr = new THREE.PlaneGeometry(0.235, 0.125); scr.rotateY(-Math.PI / 2);
  const o = k.add(scr, new THREE.MeshBasicMaterial({ map: screenTexture() })); o.position.set(0.126, 0.82, -0.015); o.rotation.z = -0.08;
  return { eye: [-0.58, 1.0, DRV], noTrim: true };
};

// Digital instrument face (Audi "virtual cockpit" style): thin coloured arc, numbers, dark glass.
function digitalDialTexture({ max, step, label, redFrom = null, accent = '#e8202a' }) {
  return canvasTex(256, 256, g => {
    const gr = g.createRadialGradient(128, 128, 20, 128, 128, 128);
    gr.addColorStop(0, '#1a1d22'); gr.addColorStop(1, '#050608');
    g.fillStyle = gr; g.beginPath(); g.arc(128, 128, 127, 0, 7); g.fill();
    g.lineWidth = 7; g.strokeStyle = '#2a2f37';
    g.beginPath(); g.arc(128, 128, 110, DIAL_A0 - Math.PI / 2, DIAL_A0 + DIAL_SWEEP - Math.PI / 2); g.stroke();
    if (redFrom != null) { g.strokeStyle = accent; g.beginPath(); g.arc(128, 128, 110, DIAL_A0 + DIAL_SWEEP * redFrom / max - Math.PI / 2, DIAL_A0 + DIAL_SWEEP - Math.PI / 2); g.stroke(); }
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '600 19px Arial, sans-serif';
    for (let v = 0; v <= max + 1e-6; v += step) {
      const th = DIAL_A0 + DIAL_SWEEP * v / max, sx = Math.sin(th), cy = -Math.cos(th);
      g.strokeStyle = '#d9dde3'; g.lineWidth = 3; g.beginPath(); g.moveTo(128 + sx * 96, 128 + cy * 96); g.lineTo(128 + sx * 106, 128 + cy * 106); g.stroke();
      g.fillStyle = redFrom != null && v >= redFrom ? accent : '#e9edf2'; g.fillText(String(Math.round(v)), 128 + sx * 76, 128 + cy * 76);
    }
    g.fillStyle = '#8d96a3'; g.font = '14px Arial, sans-serif'; g.fillText(label, 128, 180);
  });
}

// Audi R8 (4S): the file's cabin is a flat black lid. Black leather sport seats with
// red inserts, a "monoposto" arc around the driver, virtual-cockpit dials, flat-bottom wheel.
CABINS.r8 = k => {
  const m = k.mats, FLOOR = 0.14, DRV = -0.43;
  m.leather.color.set(0x7d1418); m.leatherPlain.color.set(0x5a0f12); m.carpet.color.set(0x1a1a1c);
  const carbon = new THREE.MeshStandardMaterial({ color: 0x1a1b1e, roughness: 0.25, metalness: 0.4 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x1c1c1e, roughness: 0.55 });   // dash and door leather: stays black whatever the seat colour
  // tub
  k.box([1.75, 0.03, 1.46], m.carpet, [0.1, FLOOR, 0]);
  k.box([0.04, 0.62, 1.42], m.dark, [0.96, 0.44, 0]);
  k.box([0.45, 0.02, 1.3], m.carpet, [0.82, 0.24, 0], [0, 0, -0.45]);                      // toe board
  k.box([0.04, 0.74, 1.44], trim, [-0.64, 0.51, 0]);                               // bulkhead to the engine bay
  for (const s of [1, -1]) {
    k.profile([[0.95, FLOOR], [0.95, 0.42], [-0.62, 0.42], [-0.62, FLOOR]], s > 0 ? 0.6 : -0.76, s > 0 ? 0.76 : -0.6, trim, 0.02);   // sills
    k.box([1.25, 0.34, 0.02], trim, [0.12, 0.62, s * 0.74]);                       // door card
    k.box([0.42, 0.05, 0.08], m.leatherPlain, [0.05, 0.6, s * 0.7]);                          // armrest
    k.box([0.5, 0.012, 0.012], m.alu, [0.12, 0.74, s * 0.728]);                               // aluminium strip
    k.box([0.08, 0.035, 0.02], m.alu, [0.42, 0.7, s * 0.725]);                                // door release
  }
  // centre console, rising to the dashboard
  k.profile([[0.92, FLOOR], [0.92, 0.66], [0.55, 0.64], [0.1, 0.5], [-0.6, 0.5], [-0.6, FLOOR]], -0.13, 0.13, carbon, 0.02);
  k.profile([[0.55, 0.645], [0.1, 0.505], [-0.6, 0.505], [-0.6, 0.51], [0.1, 0.512], [0.55, 0.652]], -0.11, 0.11, m.leatherPlain, 0.004);
  k.box([0.006, 0.08, 0.2], m.gloss, [0.6, 0.6, 0], [0, 0, 0.75]);                         // climate panel
  for (const z of [-0.06, 0, 0.06]) k.cyl(0.018, 0.02, 'x', m.alu, [0.585, 0.585, z]).rotation.z = 0.75;
  k.box([0.09, 0.03, 0.06], m.gloss, [0.12, 0.52, 0]);                                       // gear selector
  k.box([0.03, 0.06, 0.03], m.alu, [0.12, 0.56, 0]);
  k.box([0.05, 0.01, 0.03], m.needle, [0.2, 0.513, 0.05]);                                  // start button glow
  // dashboard and the arc that wraps the driver
  k.profile([[0.42, 0.52], [0.37, 0.7], [0.43, 0.79], [0.9, 0.83], [0.97, 0.6]], -0.74, 0.74, trim, 0.02);
  k.profile([[0.355, 0.945], [0.365, 0.962], [0.52, 0.968], [0.66, 0.86], [0.64, 0.845], [0.5, 0.948]], DRV - 0.21, DRV + 0.21, trim, 0.008, true);   // hood over the dials
  const arc = new THREE.TorusGeometry(0.33, 0.012, 8, 40, Math.PI * 0.85); arc.rotateZ(Math.PI * 0.08); arc.rotateY(Math.PI / 2);
  k.add(arc, m.alu).position.set(0.42, 0.52, DRV + 0.05);
  // virtual cockpit: a dark glass panel with two round dials
  const vc = new THREE.Group(); vc.position.set(0.385, 0.875, DRV); vc.rotation.z = -0.22; k.group.add(vc);
  k.add(new THREE.BoxGeometry(0.012, 0.13, 0.33), m.gloss, vc);
  const face = new THREE.MeshBasicMaterial({ color: 0x0b1018 }); const fp = new THREE.PlaneGeometry(0.31, 0.115); fp.rotateY(-Math.PI / 2); k.add(fp, face, vc).position.x = -0.007;
  k.dial({ pos: [0.378, 0.876, DRV - 0.085], r: 0.05, tilt: 0.22, kind: 'speedo', max: 340, bezel: m.gloss, texture: digitalDialTexture({ max: 340, step: 40, label: 'km/h' }) });
  k.dial({ pos: [0.378, 0.876, DRV + 0.085], r: 0.05, tilt: 0.22, kind: 'tacho', max: 9000, bezel: m.gloss, texture: digitalDialTexture({ max: 9, step: 1, label: '1/min x1000', redFrom: 8.5 }) });
  for (const z of [-0.62, -0.18, 0.18, 0.62]) { const v = k.cyl(0.032, 0.02, 'x', m.alu, [0.42, 0.74, z]); v.rotation.z = Math.PI / 2 - 0.3; k.cyl(0.024, 0.022, 'x', m.dark, [0.418, 0.74, z]).rotation.z = Math.PI / 2 - 0.3; }
  // flat-bottomed three-spoke wheel
  k.wheel({ pos: [0.28, 0.75, DRV], tilt: 0.38, r: 0.183, rim: trim, rimTube: 0.016, spokes: [Math.PI / 2, -Math.PI / 2, Math.PI], spokeMat: m.alu, spokeW: 0.03, hub: trim, hubR: 0.065, column: 0.16 });
  // sport seats and headliner
  for (const z of [DRV, -DRV]) {
    k.seat({ z, x0: 0.17, x1: -0.3, yTop: 0.37, backTop: 1.02, width: 0.5, rake: 0.13, floor: FLOOR });
    k.box([0.05, 0.13, 0.1], m.alu, [-0.44, 0.88, z]);                                        // headrest badge
  }
  return { eye: [-0.27, 1.04, DRV], light: [-0.1, 0.95, 0] };
};

// Porsche 911 Turbo (930): the file's cabin is a black lid with silhouettes. Tan leather,
// five round dials across a black dash, four-spoke wheel, 2+2 rear seats, long gear lever.
CABINS['930'] = k => {
  const m = k.mats, FLOOR = 0.3, DRV = -0.33;
  m.leather.color.set(0x8a5a33); m.leatherPlain.color.set(0x7a4f2d); m.carpet.color.set(0x3b2a1e); m.headliner.color.set(0x2a2a2c);
  const vinyl = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.6 });
  // tub
  k.box([2.0, 0.03, 1.26], m.carpet, [-0.25, FLOOR, 0]);
  k.box([0.04, 0.7, 1.24], vinyl, [0.8, 0.63, 0]);
  k.box([0.4, 0.02, 1.1], m.carpet, [0.66, 0.42, 0], [0, 0, -0.5]);
  k.box([0.04, 0.6, 1.24], m.carpet, [-1.3, 0.62, 0]);                                       // behind the rear seats
  k.profile([[0.8, FLOOR], [0.8, 0.44], [-0.6, 0.42], [-0.6, FLOOR]], -0.09, 0.09, m.carpet, 0.02);   // tunnel
  for (const s of [1, -1]) {
    k.profile([[0.8, FLOOR], [0.8, 0.5], [-1.3, 0.5], [-1.3, FLOOR]], s > 0 ? 0.5 : -0.64, s > 0 ? 0.64 : -0.5, m.carpet, 0.02);
    k.box([1.15, 0.4, 0.02], m.leatherPlain, [0.08, 0.72, s * 0.615]);                       // door card
    k.box([0.5, 0.12, 0.03], vinyl, [0.1, 0.6, s * 0.6]);                                     // map pocket
    k.cyl(0.009, 0.16, 'x', m.chrome, [0.38, 0.84, s * 0.6]);                                 // door pull
    k.box([0.5, 0.3, 0.02], m.leatherPlain, [-0.95, 0.75, s * 0.6]);                          // rear side trim
  }
  // dashboard, padded top, instrument hood
  k.profile([[0.5, 0.66], [0.44, 0.87], [0.49, 0.99], [0.79, 1.03], [0.79, 0.66]], -0.62, 0.62, vinyl, 0.02);
  k.cyl(0.03, 1.22, 'z', vinyl, [0.46, 0.66, 0]);
  k.profile([[0.41, 1.01], [0.42, 1.04], [0.56, 1.06], [0.62, 1.02]], DRV - 0.31, DRV + 0.31, vinyl, 0.012, true);
  const FX = 0.428, face = { face: '#07070a', ink: '#f2f1ea' };
  k.dial({ pos: [FX, 0.935, DRV], r: 0.062, tilt: 0.18, kind: 'tacho', max: 8000, bezel: vinyl, texture: dialTexture({ max: 8, step: 1, label: 'U/min x1000', redFrom: 6.8, ...face }) });
  k.dial({ pos: [FX, 0.930, DRV + 0.135], r: 0.055, tilt: 0.18, kind: 'speedo', max: 300, bezel: vinyl, texture: dialTexture({ max: 300, step: 40, label: 'km/h', ...face }) });
  k.dial({ pos: [FX, 0.930, DRV - 0.135], r: 0.055, tilt: 0.18, bezel: vinyl, texture: dialTexture({ max: 150, step: 30, label: 'ÖL °C', ...face }) });
  k.dial({ pos: [FX, 0.925, DRV + 0.26], r: 0.048, tilt: 0.18, bezel: vinyl, texture: dialTexture({ max: 12, step: 3, label: 'KIENZLE', minor: 3, ...face }) });
  k.dial({ pos: [FX, 0.925, DRV - 0.26], r: 0.048, tilt: 0.18, bezel: vinyl, texture: miniDialTexture('R', '1', 'BENZIN') });
  k.box([0.01, 0.06, 0.18], m.gloss, [0.452, 0.78, 0.12]);                                  // radio
  for (let i = 0; i < 4; i++) k.cyl(0.008, 0.02, 'x', m.chrome, [0.445, 0.78, 0.05 + i * 0.045]);
  for (const z of [-0.5, 0.0, 0.5]) k.box([0.012, 0.035, 0.1], m.dark, [0.47, 0.95, z]);   // vents
  k.box([0.004, 0.006, 0.26], m.chrome, [0.445, 0.86, 0.42]);                               // glovebox line
  // four-spoke wheel with a gold crest
  k.wheel({ pos: [0.26, 0.8, DRV], tilt: 0.34, r: 0.19, rim: m.dark, rimTube: 0.016, spokes: [Math.PI / 3, -Math.PI / 3, Math.PI * 2 / 3, -Math.PI * 2 / 3], spokeMat: m.dark, spokeW: 0.035, hub: m.dark, hubR: 0.07, column: 0.2 });
  const crest = new THREE.CircleGeometry(0.022, 20); crest.rotateY(-Math.PI / 2); crest.translate(-0.014, 0, 0);
  k.add(crest, new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 0.9, roughness: 0.3 }), k.steer);
  // seats: two buckets with high backs, and a small 2+2 rear bench
  for (const z of [DRV, -DRV]) k.seat({ z, x0: 0.12, x1: -0.36, yTop: 0.55, backTop: 1.16, width: 0.47, rake: 0.18, floor: FLOOR });
  for (const z of [-0.3, 0.3]) {
    k.profile([[-0.75, 0.42], [-0.75, 0.53], [-1.05, 0.5], [-1.05, 0.42]], z - 0.22, z + 0.22, m.leather, 0.03);
    k.profile([[-1.03, 0.5], [-1.02, 0.56], [-1.2, 0.92], [-1.26, 0.9], [-1.1, 0.5]], z - 0.22, z + 0.22, m.leather, 0.03);
  }
  // gear lever, handbrake, pedals, headliner
  const lever = k.cyl(0.007, 0.32, 'y', m.chrome, [0.25, 0.58, 0]); lever.rotation.z = 0.25;
  const knob = k.add(new THREE.SphereGeometry(0.024, 16, 12), m.dark); knob.position.set(0.21, 0.74, 0);
  k.box([0.2, 0.02, 0.02], m.dark, [-0.05, 0.47, 0.06], [0, 0, 0.3]);
  for (const [pz, w] of [[-0.43, 0.06], [-0.33, 0.06], [-0.22, 0.05]]) k.box([0.02, 0.08, w], m.alu, [0.62, 0.46, pz], [0, 0, -0.5]);
  k.profile([[0.25, 1.355], [0.25, 1.365], [-0.3, 1.38], [-0.85, 1.315], [-0.85, 1.305], [-0.3, 1.37]], -0.56, 0.56, m.headliner, 0.002);
  return { eye: [-0.28, 1.19, DRV], light: [-0.2, 1.1, 0] };
};

// Builds the cabin named by `name` into `body`. `paint` is the car's paint material.
export function buildCabin(name, body, paint) {
  const recipe = CABINS[name];
  if (!recipe) return null;
  const kit = createKit(paint);
  const info = recipe(kit) || {};
  if (info.light) { const l = new THREE.PointLight(0xfff3e0, 0.9, 2.2, 1.5); l.position.set(...info.light); kit.group.add(l); }
  body.add(kit.group);
  const turn = (n, value) => { if (n) n.pivot.rotation.x = DIAL_A0 + DIAL_SWEEP * Math.min(1, Math.max(0, value / n.max)); };
  return {
    group: kit.group,
    eye: info.eye,
    interiorMats: info.noTrim ? [] : [kit.mats.leather, kit.mats.leatherPlain, kit.mats.carpet],   // follow the "interior colour" tuning
    setSteer(a) { if (kit.steer) kit.steer.rotation.x = -a; },
    setGauges(kmh, rpm) { turn(kit.needles.speedo, Math.abs(kmh)); turn(kit.needles.tacho, rpm); },
  };
}
