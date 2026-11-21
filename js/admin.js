// Admin panel (admin.html): catalog texts, users and records, through the API's /api/admin routes.
// The server checks the admin role on every call; this page only hides what a visitor cannot use.
import { api } from './api.js';
import { MODELS } from './models.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtMs = ms => (ms == null ? '—' : `${Math.floor(ms / 60000)}:${((ms % 60000) / 1000).toFixed(2).padStart(5, '0')}`);
const fmtDate = d => (d ? new Date(d).toLocaleString('ka-GE', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const SPECS = { engine: 'ძრავი', power: 'სიმძლავრე', accel: '0–100 კმ/სთ', top: 'მაქს. სიჩქარე', weight: 'წონა', built: 'გამოშვებული' };
const TRACKS = { circuit: '🏁 ტრასა', city: '🏙 ქალაქი', mountain: '⛰ მთა' };
const app = $('#app');
let tab = 'cars';

function message(html) { app.innerHTML = `<div class="adm-msg">${html}</div>`; }
function fail(ex) { alert(ex.message); }

async function boot() {
  if (!(await api.init())) {
    message('სერვერი ან მონაცემთა ბაზა მიუწვდომელია. ადმინ-პანელი მუშაობს მხოლოდ მაშინ, როცა ბექენდი (backend/Veloce.Api) ჩართულია.<br><a href="./">← კატალოგზე დაბრუნება</a>');
    return;
  }
  api.onUser(render);
  render();
}

function render() {
  const u = api.user;
  $('#who').innerHTML = u ? `<button class="acct-btn" id="out">👤 ${esc(u.displayName)} · გასვლა</button>` : '';
  if ($('#out')) $('#out').onclick = () => api.logout();
  if (!u) return loginForm();
  if (!u.isAdmin) return message(`${esc(u.displayName)}, ეს გვერდი მხოლოდ ადმინისთვისაა.<br><a href="./">← კატალოგზე დაბრუნება</a>`);
  app.innerHTML = `
    <section class="stats" id="stats"></section>
    <nav class="adm-tabs">
      <button data-t="cars">🚗 მანქანები</button><button data-t="users">👤 მომხმარებლები</button><button data-t="records">🏆 რეკორდები</button>
    </nav>
    <section id="view"></section>`;
  $$('.adm-tabs button').forEach(b => (b.onclick = () => { tab = b.dataset.t; show(); }));
  show();
}

function loginForm() {
  app.innerHTML = `
    <form class="mbox adm-login">
      <h2>ადმინის შესვლა</h2>
      <label>ელ-ფოსტა<input name="email" type="email" autocomplete="email" required></label>
      <label>პაროლი<input name="password" type="password" autocomplete="current-password" required></label>
      <p class="merr"></p>
      <button class="mgo">შესვლა</button>
      <a href="./" class="mnote">← კატალოგზე დაბრუნება</a>
    </form>`;
  const f = $('form', app);
  f.onsubmit = async e => {
    e.preventDefault();
    try { await api.login(f.email.value.trim(), f.password.value); }
    catch (ex) { $('.merr', f).textContent = ex.message; }
  };
}

async function show() {
  $$('.adm-tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === tab));
  try {
    const s = await api.get('/admin/stats');
    $('#stats').innerHTML = [['მომხმარებელი', s.users], ['რეკორდი', s.records], ['ტუნინგი', s.tunings], ['რჩეული', s.favorites], ['მანქანა ბაზაში', s.cars]]
      .map(([l, v]) => `<div><b>${v}</b><small>${l}</small></div>`).join('');
    if (tab === 'cars') await carsView();
    else if (tab === 'users') await usersView();
    else await recordsView();
  } catch (ex) {
    $('#view').innerHTML = `<p class="adm-msg">${esc(ex.message)}</p>`;
  }
}

/* ---------- cars ---------- */
function fromModel(m, i) {
  return {
    id: m.id, brand: m.brand, name: m.name, chassis: m.chassis, year: m.year, years: m.years, body: m.body, era: m.era,
    desc: m.desc, specs: { ...m.specs }, vmax: (m.perf && m.perf.vmax) || 0, t100: (m.perf && m.perf.t100) || 0, visible: true, sortOrder: i + 1,
  };
}

async function carsView() {
  const cars = await api.get('/admin/cars');
  const inDb = new Set(cars.map(c => c.id));
  const missing = MODELS.filter(m => !inDb.has(m.id));
  const view = $('#view');
  view.innerHTML = `
    <div class="adm-bar">
      ${missing.length ? `<button class="mgo" id="seed">🌱 შევსება models.js-იდან (${missing.length} მანქანა)</button>` : '<span class="ok">✓ ყველა მანქანა ბაზაშია</span>'}
      <small>ბაზაში ინახება კატალოგის ტექსტები; 3D მოდელები და მათი პარამეტრები რჩება js/models.js-ში.</small>
    </div>
    ${cars.length ? `<table class="adm-table">
      <tr><th></th><th>მანქანა</th><th>წელი</th><th>ეპოქა</th><th>მაქს. / 0–100</th><th>ჩანს</th><th></th></tr>
      ${cars.map(c => `<tr data-id="${esc(c.id)}">
        <td><img src="thumbs/${esc(c.id)}.jpg" alt=""></td>
        <td><b>${esc(c.brand)} ${esc(c.name)}</b><small>${esc(c.id)} · ${esc(c.chassis)}</small></td>
        <td>${c.year}</td><td>${c.era === 'classic' ? 'კლასიკა' : 'თანამედროვე'}</td>
        <td>${c.vmax} კმ/სთ · ${c.t100} წმ</td>
        <td><input type="checkbox" data-do="vis" ${c.visible ? 'checked' : ''} aria-label="ჩანს კატალოგში"></td>
        <td><button data-do="edit">✎ რედაქტირება</button></td>
      </tr>`).join('')}
    </table>` : '<p class="adm-msg">ბაზა ჯერ ცარიელია: კატალოგი იყენებს js/models.js-ს. დააჭირე „შევსებას“, რომ ტექსტები ბაზაში გადავიდეს და აქედან შეცვალო.</p>'}`;
  if ($('#seed')) $('#seed').onclick = async () => {
    try { const r = await api.post('/admin/cars/seed', missing.map(m => fromModel(m, MODELS.indexOf(m)))); alert(`დაემატა ${r.added} მანქანა.`); show(); }
    catch (ex) { fail(ex); }
  };
  $$('tr[data-id]', view).forEach(tr => {
    const car = cars.find(c => c.id === tr.dataset.id);
    $('[data-do="edit"]', tr).onclick = () => editCar(car);
    $('[data-do="vis"]', tr).onchange = async e => {
      try { await api.put(`/admin/cars/${encodeURIComponent(car.id)}`, { ...car, visible: e.target.checked }); car.visible = e.target.checked; }
      catch (ex) { e.target.checked = !e.target.checked; fail(ex); }
    };
  });
}

function editCar(car) {
  const dlg = document.createElement('div');
  dlg.className = 'modal';
  const field = (k, label, v, type = 'text', extra = '') => `<label>${label}<input name="${k}" type="${type}" value="${esc(v)}" ${extra}></label>`;
  dlg.innerHTML = `
    <form class="mbox adm-edit">
      <button type="button" class="mclose" aria-label="დახურვა">✕</button>
      <h2>${esc(car.brand)} ${esc(car.name)} <small>${esc(car.id)}</small></h2>
      <div class="adm-grid">
        ${field('brand', 'მარკა', car.brand, 'text', 'required maxlength="60"')}
        ${field('name', 'მოდელი', car.name, 'text', 'required maxlength="80"')}
        ${field('chassis', 'შასი', car.chassis, 'text', 'maxlength="40"')}
        ${field('body', 'ძარა', car.body, 'text', 'maxlength="40"')}
        ${field('year', 'წელი (თაიმლაინზე)', car.year, 'number', 'min="1880" max="2100" required')}
        ${field('years', 'გამოშვების წლები', car.years, 'text', 'maxlength="40"')}
        <label>ეპოქა<select name="era"><option value="classic" ${car.era === 'classic' ? 'selected' : ''}>კლასიკა</option><option value="modern" ${car.era !== 'classic' ? 'selected' : ''}>თანამედროვე</option></select></label>
        <label class="chk"><input name="visible" type="checkbox" ${car.visible ? 'checked' : ''}> ჩანს კატალოგში</label>
      </div>
      <label>აღწერა<textarea name="desc" rows="4" maxlength="2000">${esc(car.desc)}</textarea></label>
      <h3>მახასიათებლები</h3>
      <div class="adm-grid">${Object.entries(SPECS).map(([k, l]) => field(`spec_${k}`, l, car.specs[k] || '', 'text', 'maxlength="80"')).join('')}</div>
      <h3>ტესტ-დრაივი</h3>
      <div class="adm-grid">
        ${field('vmax', 'მაქს. სიჩქარე, კმ/სთ', car.vmax, 'number', 'min="0" max="600"')}
        ${field('t100', '0–100, წამი', car.t100, 'number', 'min="0" max="60" step="0.1"')}
      </div>
      <p class="merr"></p>
      <div class="adm-actions">
        <button type="button" class="adm-danger" data-do="drop" title="ბაზიდან წაშლა: კატალოგი დაუბრუნდება js/models.js-ის ტექსტს">↺ models.js-ის ტექსტზე დაბრუნება</button>
        <button class="mgo">💾 შენახვა</button>
      </div>
    </form>`;
  document.body.appendChild(dlg);
  const f = $('form', dlg), close = () => dlg.remove();
  $('.mclose', dlg).onclick = close;
  dlg.addEventListener('pointerdown', e => { if (e.target === dlg) close(); });
  $('[data-do="drop"]', dlg).onclick = async () => {
    if (!confirm('წავშალო ბაზიდან? კატალოგი ისევ js/models.js-ის ტექსტს აჩვენებს.')) return;
    try { await api.del(`/admin/cars/${encodeURIComponent(car.id)}`); close(); show(); } catch (ex) { fail(ex); }
  };
  f.onsubmit = async e => {
    e.preventDefault();
    const v = k => f[k].value.trim();
    const body = {
      id: car.id, brand: v('brand'), name: v('name'), chassis: v('chassis'), body: v('body'), year: +v('year'), years: v('years'),
      era: f.era.value, desc: v('desc'), visible: f.visible.checked, sortOrder: car.sortOrder,
      specs: Object.fromEntries(Object.keys(SPECS).map(k => [k, v(`spec_${k}`)])), vmax: +v('vmax') || 0, t100: +v('t100') || 0,
    };
    try { await api.put(`/admin/cars/${encodeURIComponent(car.id)}`, body); close(); show(); }
    catch (ex) { $('.merr', f).textContent = ex.message; }
  };
}

/* ---------- users ---------- */
async function usersView() {
  const users = await api.get('/admin/users');
  const view = $('#view');
  view.innerHTML = `<table class="adm-table">
    <tr><th>#</th><th>სახელი</th><th>ელ-ფოსტა</th><th>რეგისტრაცია</th><th>რეკორდი</th><th>ტუნინგი</th><th>ადმინი</th><th></th></tr>
    ${users.map(u => `<tr data-id="${u.id}">
      <td>${u.id}</td><td><b>${esc(u.displayName)}</b></td><td>${esc(u.email)}</td><td>${fmtDate(u.createdAt)}</td>
      <td>${u.records}</td><td>${u.tunings}</td>
      <td><input type="checkbox" data-do="admin" ${u.isAdmin ? 'checked' : ''} ${u.id === api.user.id ? 'disabled' : ''} aria-label="ადმინი"></td>
      <td>${u.id === api.user.id ? '<small>შენ</small>' : '<button data-do="del" class="adm-danger">🗑</button>'}</td>
    </tr>`).join('')}
  </table>`;
  $$('tr[data-id]', view).forEach(tr => {
    const id = +tr.dataset.id, u = users.find(x => x.id === id);
    const adm = $('[data-do="admin"]', tr);
    adm.onchange = async () => {
      try { await api.put(`/admin/users/${id}/admin`, { isAdmin: adm.checked }); show(); }
      catch (ex) { adm.checked = !adm.checked; fail(ex); }
    };
    const del = $('[data-do="del"]', tr);
    if (del) del.onclick = async () => {
      if (!confirm(`წავშალო ${u.displayName} (${u.email}) რეკორდებით და გარაჟით?`)) return;
      try { await api.del(`/admin/users/${id}`); show(); } catch (ex) { fail(ex); }
    };
  });
}

/* ---------- records ---------- */
async function recordsView() {
  const recs = await api.get('/admin/records?take=200');
  const name = id => { const m = MODELS.find(x => x.id === id); return m ? `${m.brand} ${m.name}` : id; };
  const view = $('#view');
  view.innerHTML = recs.length ? `<table class="adm-table">
    <tr><th>მომხმარებელი</th><th>მანქანა</th><th>ტრასა</th><th>წრე</th><th>დრიფტი</th><th>ბოლოს</th><th></th></tr>
    ${recs.map((r, i) => `<tr data-i="${i}">
      <td><b>${esc(r.name)}</b></td><td>${esc(name(r.carId))}</td><td>${TRACKS[r.track] || esc(r.track)}</td>
      <td>${fmtMs(r.lapMs)} ${r.lapMs != null ? '<button data-do="lap" title="წრის წაშლა">✕</button>' : ''}</td>
      <td>${r.drift ?? '—'} ${r.drift != null ? '<button data-do="drift" title="დრიფტის წაშლა">✕</button>' : ''}</td>
      <td>${fmtDate(r.lapAt > r.driftAt || !r.driftAt ? r.lapAt : r.driftAt)}</td>
      <td><button data-do="all" class="adm-danger" title="ორივეს წაშლა">🗑</button></td>
    </tr>`).join('')}
  </table>` : '<p class="adm-msg">რეკორდები ჯერ არ არის.</p>';
  $$('tr[data-i]', view).forEach(tr => {
    const r = recs[+tr.dataset.i];
    $$('[data-do]', tr).forEach(b => (b.onclick = async () => {
      if (!confirm('წავშალო ეს შედეგი?')) return;
      try { await api.del(`/admin/records/${r.userId}/${encodeURIComponent(r.carId)}/${r.track}?part=${b.dataset.do}`); show(); }
      catch (ex) { fail(ex); }
    }));
  });
}

boot();
