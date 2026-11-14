import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MODELS, ERAS } from './models.js';
import { FINISHES, RIM_COLORS, TINTS, LIGHTS, INTERIORS } from './tuning.js';
import { loadGlbCar } from './glbCar.js';
import { createDrive } from './drive.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const STORE = 'veloce-garage-tuning-v1';

/* ---------- renderer & scene ---------- */
const canvas = $('#c');
const stage = $('#stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environment = envTex;

const camera = new THREE.PerspectiveCamera(35, 1, 0.02, 100);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.autoRotateSpeed = 1.2;

function addLights(sc) {
  sc.add(new THREE.HemisphereLight(0xdfe8ff, 0x101015, 0.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(4, 8, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 1, far: 20 });
  key.shadow.bias = -0.0004;
  key.shadow.radius = 4;
  sc.add(key);
  const rim = new THREE.DirectionalLight(0x9fc8ff, 1.0);
  rim.position.set(-6, 3, -4);
  sc.add(rim);
  return key;
}
const keyLight = addLights(scene);

function radialTexture(stops) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  stops.forEach(([o, col]) => gr.addColorStop(o, col));
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function addFloor(sc) {
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(9, 64),
    new THREE.MeshStandardMaterial({
      color: 0x14161d, roughness: 0.42, metalness: 0.3, transparent: true,
      alphaMap: radialTexture([[0, '#fff'], [0.45, '#fff'], [1, '#000']]),
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  sc.add(floor);
  const ring = new THREE.Mesh(new THREE.RingGeometry(3.05, 3.1, 96), new THREE.MeshBasicMaterial({ color: 0x4fb3ff, transparent: true, opacity: 0.35 }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.002;
  sc.add(ring);
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
    map: radialTexture([[0, 'rgba(0,0,0,.75)'], [0.6, 'rgba(0,0,0,.35)'], [1, 'rgba(0,0,0,0)']]), transparent: true, depthWrite: false,
  }));
  blob.rotation.x = -Math.PI / 2; blob.position.y = 0.003;
  sc.add(blob);
  blob.userData.showroom = [floor, ring, blob];
  return blob;
}
const blob = addFloor(scene);

/* ---------- state ---------- */
let saved = {};
try { saved = JSON.parse(localStorage.getItem(STORE)) || {}; } catch { saved = {}; }
const persist = () => { try { localStorage.setItem(STORE, JSON.stringify(saved)); } catch { /* private mode */ } };

const state = { model: null, car: null, inside: false, era: 'all', brand: 'all' };

// Loads the car's 3D model and applies the tuning saved for it.
async function makeCar(m, onProgress) {
  const car = await loadGlbCar(m, onProgress);
  car.applyTuning({ ...car.baseTuning, ...(saved[m.id] || {}) });
  return car;
}
const thumbs = {};

/* ---------- camera framing ---------- */
function frameCar(car, instant = true) {
  const L = car.size.x, H = car.size.y;
  controls.minDistance = L * 0.75;
  controls.maxDistance = L * 2.6;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.enablePan = false;
  controls.enableZoom = true;
  controls.rotateSpeed = 1;
  controls.target.set(0, H * 0.42, 0);
  const k = camera.aspect < 1 ? 1.55 : 1;
  controls.maxDistance = L * 2.6 * k;
  if (instant) camera.position.set(L * 1.15 * k, H * 1.15 + L * 0.18 * k, L * 1.25 * k);
  controls.update();
}

function setInside(on) {
  const car = state.car;
  state.inside = on;
  $('[data-act="inside"]').setAttribute('aria-pressed', on);
  updateFov();
  if (!on) { frameCar(car); return; }
  controls.autoRotate = false;
  $('[data-act="spin"]').setAttribute('aria-pressed', false);
  const eye = car.driverEye.clone().add(car.body.position);
  controls.minDistance = controls.maxDistance = 0.03;
  controls.maxPolarAngle = Math.PI * 0.85;
  controls.enableZoom = false;
  controls.rotateSpeed = -0.35;
  controls.target.copy(eye).add(new THREE.Vector3(0.03, -0.004, 0));
  camera.position.copy(eye);
  controls.update();
}

/* ---------- model switching ---------- */
let selectToken = 0;
async function selectModel(id, { push = true } = {}) {
  const m = MODELS.find(x => x.id === id) || MODELS[0];
  const token = ++selectToken;
  if (drive.active) drive.stop();
  const ld = $('#loading');
  ld.textContent = 'იტვირთება…';
  const progress = f => { if (token === selectToken) ld.textContent = `იტვირთება… ${Math.round(f * 100)}%`; };
  ld.classList.remove('off');
  let car;
  try { car = await makeCar(m, progress); }
  catch (err) {
    console.warn(err);
    if (token === selectToken) ld.textContent = 'მოდელი ვერ ჩაიტვირთა. სცადე მოგვიანებით.';
    return;
  }
  if (token !== selectToken) { car.dispose(); return; }   // user clicked another model meanwhile
  if (state.car) { scene.remove(state.car.root); state.car.dispose(); }
  state.model = m;
  state.car = car;
  scene.add(car.root);
  blob.scale.set(m.dims.L * 1.25, m.dims.W * 1.5, 1);
  state.inside = false;
  updateFov();
  $$('#controls [aria-pressed]').forEach(b => { if (b.dataset.act !== 'spin') b.setAttribute('aria-pressed', false); });
  $('[data-act="doors"]').hidden = !car.doors.length;
  $('[data-act="hood"]').hidden = !car.hood;
  $('[data-act="trunk"]').hidden = !car.trunk;
  $('[data-act="inside"]').hidden = !!car.noInterior;
  frameCar(car);

  $('#ovYear').textContent = m.years;
  $('#ovName').textContent = m.name;
  $('#ovChassis').textContent = `${m.chassis} · ${m.body}`;
  $$('#list li').forEach(li => li.classList.toggle('on', li.dataset.id === m.id));
  renderInfo(m);
  renderTuning(m);
  ld.classList.add('off');
  if (push) history.replaceState(null, '', `#${m.id}`);
}

/* ---------- catalog ---------- */
function renderBrands() {
  const brands = [...new Set(MODELS.map(m => m.brand))];
  const el = $('#brands');
  el.hidden = brands.length < 2;
  el.innerHTML = [['all', 'ყველა მარკა'], ...brands.map(b => [b, b])]
    .map(([id, label]) => `<button role="tab" data-brand="${id}" class="${id === state.brand ? 'on' : ''}">${label}</button>`).join('');
  $$('#brands button').forEach(b => b.onclick = () => { state.brand = b.dataset.brand; renderBrands(); renderList(); });
}
function renderEras() {
  $('#eras').innerHTML = ERAS.map(e => `<button role="tab" data-era="${e.id}" class="${e.id === state.era ? 'on' : ''}">${e.label}</button>`).join('');
  $$('#eras button').forEach(b => b.onclick = () => { state.era = b.dataset.era; renderEras(); renderList(); });
}
function renderList() {
  const list = MODELS.filter(m => (state.era === 'all' || m.era === state.era) && (state.brand === 'all' || m.brand === state.brand))
    .sort((a, b) => a.year - b.year);
  $('#list').innerHTML = list.map(m => `
    <li data-id="${m.id}" class="${state.model && state.model.id === m.id ? 'on' : ''}">
      <button class="card" aria-label="${m.name} ${m.year}">
        <img alt="" loading="lazy" src="${thumbs[m.id] || `thumbs/${m.id}.jpg`}" onerror="this.onerror=null;this.src='data:image/gif;base64,R0lGODlhAQABAAAAACw='">
        <span class="meta"><span class="yr">${m.year} · ${m.brand}</span><br><span class="nm">${m.name}</span><br><span class="ch">${m.chassis} · ${m.body}</span></span>
      </button>
    </li>`).join('');
  $$('#list li').forEach(li => li.querySelector('button').onclick = () => selectModel(li.dataset.id));
}

/* ---------- info panel ---------- */
const SPEC_LABELS = { engine: 'ძრავი', power: 'სიმძლავრე', accel: '0–100 კმ/სთ', top: 'მაქს. სიჩქარე', weight: 'წონა', built: 'გამოშვებული' };
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function modelNote(m) {
  const cr = state.car && state.car.credit;
  if (!cr) return 'მონაცემები მიახლოებითია.';
  const title = cr.url ? `<a href="${esc(cr.url)}" target="_blank" rel="noopener" style="color:var(--accent)">${esc(cr.title)}</a>` : esc(cr.title);
  return `მონაცემები მიახლოებითია. 3D მოდელი: ${title}, ავტორი ${esc(cr.author)} (${esc(cr.license)}).`;
}
function renderInfo(m) {
  $('#tab-info').innerHTML = `
    <h2>${m.brand} ${m.name}</h2>
    <span class="badge">${m.chassis}</span><span class="badge">${m.years}</span><span class="badge">${m.body}</span>
    <p class="desc">${m.desc}</p>
    <dl class="specs">${Object.entries(SPEC_LABELS).map(([k, l]) => `<div><dt>${l}</dt><dd>${m.specs[k]}</dd></div>`).join('')}</dl>
    <p class="note">${modelNote(m)}</p>`;
}

/* ---------- tuning panel ---------- */
function seg(key, opts, cur) {
  return `<div class="seg" data-key="${key}">${Object.entries(opts).map(([k, v]) =>
    `<button data-v="${k}" class="${k === cur ? 'on' : ''}">${Array.isArray(v) ? v[0] : (v.label || v)}</button>`).join('')}</div>`;
}
function renderTuning(m) {
  const tu = state.car.tuning;
  const caps = state.car.caps || {};
  const on = k => caps[k] !== false;
  const orig = o => ({ orig: 'ორიგინალი', ...o });
  const opt = (k, label, body) => (on(k) ? `<div class="opt"><div class="lbl">${label}</div>${body}</div>` : '');
  const ride = v => (v > 0 ? `+${v}` : `${v}`) + ' სმ';
  $('#tab-tune').innerHTML = `
    ${on('color') ? `<div class="opt"><div class="lbl">ფერი <b id="colName">${tu.color}</b></div>
      <div class="sw" id="sw">${m.palette.map(c => `<button style="--c:${c}" data-c="${c}" class="${c === tu.color ? 'on' : ''}" aria-label="${c}"></button>`).join('')}
      <input type="color" id="custom" value="${tu.color}" aria-label="საკუთარი ფერი"></div></div>` : ''}
    ${opt('finish', 'საფარი', seg('finish', orig(FINISHES), tu.finish))}
    ${opt('rimColor', 'დისკის ფერი', seg('rimColor', orig(RIM_COLORS), tu.rimColor))}
    ${on('ride') ? `<div class="opt"><label for="ride">სუსპენზია <b id="rideV">${ride(tu.ride)}</b></label>
      <input type="range" id="ride" min="-5" max="6" step="1" value="${tu.ride}"></div>` : ''}
    ${opt('tint', 'მინის ტონირება', seg('tint', orig(TINTS), tu.tint))}
    ${opt('lights', 'ფარების ფერი', seg('lights', orig(LIGHTS), tu.lights))}
    ${opt('interior', 'სალონის ფერი', seg('interior', orig(INTERIORS), tu.interior))}
    <button class="reset" id="reset">↺ ქარხნული პარამეტრები</button>`;

  const set = patch => {
    const next = { ...state.car.tuning, ...patch };
    state.car.applyTuning(next);
    saved[m.id] = next; persist();
  };
  $$('#sw button').forEach(b => b.onclick = () => {
    set({ color: b.dataset.c });
    $$('#sw button').forEach(x => x.classList.toggle('on', x === b));
    $('#custom').value = b.dataset.c; $('#colName').textContent = b.dataset.c;
  });
  if ($('#custom')) $('#custom').oninput = e => {
    set({ color: e.target.value });
    $$('#sw button').forEach(x => x.classList.remove('on'));
    $('#colName').textContent = e.target.value;
  };
  $$('#tab-tune .seg').forEach(g => $$('button', g).forEach(b => b.onclick = () => {
    set({ [g.dataset.key]: b.dataset.v });
    $$('button', g).forEach(x => x.classList.toggle('on', x === b));
  }));
  if ($('#ride')) $('#ride').oninput = e => { set({ ride: +e.target.value }); $('#rideV').textContent = ride(+e.target.value); };
  $('#reset').onclick = () => {
    delete saved[m.id]; persist();
    state.car.applyTuning(state.car.baseTuning);
    renderTuning(m);
  };
}

/* ---------- tabs & controls ---------- */
$$('.tabs button').forEach(b => b.onclick = () => {
  $$('.tabs button').forEach(x => x.classList.toggle('on', x === b));
  $$('.tab').forEach(t => t.classList.toggle('on', t.id === `tab-${b.dataset.tab}`));
});

$$('#controls button').forEach(b => b.onclick = () => {
  const act = b.dataset.act, car = state.car;
  const toggle = () => { const on = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', on); return on; };
  if (act === 'doors' || act === 'hood' || act === 'trunk') car.target[act] = toggle() ? 1 : 0;
  else if (act === 'inside') setInside(!state.inside);
  else if (act === 'spin') { if (state.inside) setInside(false); controls.autoRotate = toggle(); }
  else if (act === 'shot') screenshot();
  else if (act === 'drive') {
    if (state.inside) setInside(false);
    controls.autoRotate = false;
    car.target.doors = car.target.hood = car.target.trunk = 0;
    $$('#controls [aria-pressed]').forEach(x => x.setAttribute('aria-pressed', false));
    drive.start(car, state.model);
  }
});

function screenshot() {
  renderer.render(scene, camera);
  canvas.toBlob(blobData => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blobData);
    a.download = `veloce-${state.model.id}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
}

/* ---------- thumbnails ---------- */
async function makeThumbs() {
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  r.setSize(480, 240, false);
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.shadowMap.enabled = true;
  const pm = new THREE.PMREMGenerator(r);
  const sc = new THREE.Scene();
  sc.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  addLights(sc);
  const b = addFloor(sc);
  const cam = new THREE.PerspectiveCamera(30, 2, 0.1, 50);
  for (const m of MODELS) {
    await new Promise(res => setTimeout(res, 30));
    let car;
    try { car = await makeCar(m); } catch { continue; }
    sc.add(car.root);
    b.scale.set(m.dims.L * 1.25, m.dims.W * 1.5, 1);
    const L = m.dims.L, H = car.size.y;
    cam.position.set(L * 0.95, H * 0.75 + 0.4, L * 0.78);
    cam.lookAt(0, H * 0.4, 0);
    r.render(sc, cam);
    thumbs[m.id] = r.domElement.toDataURL('image/jpeg', 0.85);
    const img = $(`#list li[data-id="${m.id}"] img`);
    if (img) img.src = thumbs[m.id];
    sc.remove(car.root); car.dispose();
  }
  pm.dispose(); r.dispose(); r.forceContextLoss();
}

/* ---------- loop ---------- */
function updateFov() {
  const portrait = camera.aspect < 1;
  const driving = document.body.classList.contains('driving');
  camera.fov = driving ? (portrait ? 75 : 62) : state.inside ? (portrait ? 90 : 70) : (portrait ? 48 : 35);
  camera.updateProjectionMatrix();
}
function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  updateFov();
}
new ResizeObserver(resize).observe(stage);

const drive = createDrive({
  scene, camera, controls, keyLight, stage,
  hide: blob.userData.showroom,
  onExit: () => { updateFov(); frameCar(state.car); },
});
const timer = new THREE.Timer();
renderer.setAnimationLoop(t => {
  timer.update(t);
  const dt = Math.min(timer.getDelta(), 0.05);
  if (state.car) state.car.update(dt);
  if (drive.active) drive.update(dt);
  else controls.update();
  renderer.render(scene, camera);
});

/* ---------- boot ---------- */
renderBrands();
renderEras();
renderList();
selectModel(location.hash.slice(1) || MODELS[0].id, { push: false });
resize();
addEventListener('hashchange', () => { const id = location.hash.slice(1); if (id && (!state.model || id !== state.model.id)) selectModel(id, { push: false }); });
// Catalog pictures are static files (thumbs/<id>.jpg) so opening the site only
// downloads the selected car. Open the site with ?thumbs to render them anew.
if (new URLSearchParams(location.search).has('thumbs')) setTimeout(makeThumbs, 300);

window.__garage = { state, camera, controls, selectModel, setInside, renderer, scene, MODELS, drive, thumbs };
