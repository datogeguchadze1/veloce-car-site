// Accounts on the main page: the sign-in dialog and header menu, "My garage" (starred cars,
// saved tunings, own records), the world leaderboard in the info panel, saving a tuning, and
// sending test-drive results to the server. Everything here stays hidden when the API is not
// available (see api.js), so the static site works without a backend.
import { api } from './api.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtMs = ms => (ms == null ? '—' : `${Math.floor(ms / 60000)}:${((ms % 60000) / 1000).toFixed(2).padStart(5, '0')}`);
const TRACK_TABS = [['circuit', '🏁', 'ტრასა'], ['city', '🏙', 'ქალაქი'], ['mountain', '⛰', 'მთა']];

// ctx: { models, current(), select(id), applyTuning(carId, settings), currentTuning(), thumb(id),
//        refreshList(), refreshInfo(), refreshTune(), tracks }
export function createAccount(ctx) {
  const favs = new Set();
  let tunings = [];
  let mine = new Map();                 // `${car}@${track}` → { lapMs, drift }: own bests on the server
  const lb = { track: 'circuit', type: 'lap' };
  const carName = id => { const m = ctx.models.find(x => x.id === id); return m ? `${m.brand} ${m.name}` : id; };

  /* ---------- toast ---------- */
  const toast = document.createElement('div');
  toast.className = 'toast';
  document.body.appendChild(toast);
  let toastT = 0;
  function say(text, bad = false) {
    toast.textContent = text;
    toast.classList.toggle('bad', bad);
    toast.classList.add('on');
    clearTimeout(toastT);
    toastT = setTimeout(() => toast.classList.remove('on'), 2600);
  }

  /* ---------- sign-in dialog ---------- */
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.hidden = true;
  modal.innerHTML = `
    <form class="mbox" novalidate>
      <button type="button" class="mclose" aria-label="დახურვა">✕</button>
      <div class="mtabs"><button type="button" data-m="login" class="on">შესვლა</button><button type="button" data-m="register">რეგისტრაცია</button></div>
      <label data-only="register">სახელი (ჩანს ლიდერბორდზე)<input name="name" maxlength="40" autocomplete="nickname"></label>
      <label>ელ-ფოსტა<input name="email" type="email" autocomplete="email" required></label>
      <label>პაროლი<input name="password" type="password" minlength="8" autocomplete="current-password" required></label>
      <p class="merr" role="alert"></p>
      <button class="mgo" type="submit">შესვლა</button>
      <p class="mnote">ანგარიშით რეკორდები ხვდება საერთო ცხრილში, ტუნინგები კი ინახება შენს გარაჟში.</p>
    </form>`;
  document.body.appendChild(modal);
  const form = $('form', modal);
  let mode = 'login';
  function setMode(m) {
    mode = m;
    $$('.mtabs button', modal).forEach(b => b.classList.toggle('on', b.dataset.m === m));
    $$('[data-only="register"]', modal).forEach(el => (el.hidden = m !== 'register'));
    $('.mgo', modal).textContent = m === 'login' ? 'შესვლა' : 'რეგისტრაცია';
    form.password.autocomplete = m === 'login' ? 'current-password' : 'new-password';
    $('.merr', modal).textContent = '';
  }
  function openLogin(m = 'login') {
    setMode(m);
    modal.hidden = false;
    setTimeout(() => (m === 'register' ? form.name : form.email).focus(), 30);
  }
  const closeLogin = () => { modal.hidden = true; };
  $$('.mtabs button', modal).forEach(b => (b.onclick = () => setMode(b.dataset.m)));
  $('.mclose', modal).onclick = closeLogin;
  modal.addEventListener('pointerdown', e => { if (e.target === modal) closeLogin(); });
  modal.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') closeLogin(); });
  form.onsubmit = async e => {
    e.preventDefault();
    const err = $('.merr', modal), go = $('.mgo', modal);
    const email = form.email.value.trim(), pw = form.password.value, name = form.name.value.trim();
    if (!email || !pw) { err.textContent = 'შეავსე ელ-ფოსტა და პაროლი.'; return; }
    if (mode === 'register' && name.length < 2) { err.textContent = 'სახელი უნდა იყოს მინიმუმ 2 სიმბოლო.'; return; }
    if (mode === 'register' && pw.length < 8) { err.textContent = 'პაროლი უნდა იყოს მინიმუმ 8 სიმბოლო.'; return; }
    go.disabled = true; err.textContent = '';
    try {
      const u = mode === 'login' ? await api.login(email, pw) : await api.register(email, pw, name);
      form.reset();
      closeLogin();
      say(mode === 'login' ? `გამარჯობა, ${u.displayName}!` : `მოგესალმები, ${u.displayName}! ანგარიში შეიქმნა.`);
    } catch (ex) { err.textContent = ex.message; }
    finally { go.disabled = false; }
  };

  /* ---------- header ---------- */
  const head = $('#acct');
  function renderHead() {
    if (!head) return;
    if (api.status === 'nodb') {             // the backend runs but has no database: say why
      head.hidden = false;
      head.innerHTML = '<button class="acct-btn acct-warn">⚠ ბაზა არ არის დაკავშირებული</button>';
      $('.acct-btn', head).onclick = showDbProblem;
      return;
    }
    head.hidden = !api.available;
    const u = api.user;
    head.innerHTML = u
      ? `<button class="acct-btn" aria-haspopup="true" aria-expanded="false">👤 <span>${esc(u.displayName)}</span> ▾</button>
         <div class="acct-menu" hidden>
           <button data-a="garage">🧰 ჩემი გარაჟი</button>
           ${u.isAdmin ? '<a href="admin.html">⚙ ადმინ-პანელი</a>' : ''}
           <button data-a="logout">↩ გასვლა</button>
         </div>`
      : '<button class="acct-btn" data-a="login">👤 შესვლა</button>';
    const btn = $('.acct-btn', head), menu = $('.acct-menu', head);
    btn.onclick = () => {
      if (!u) { openLogin(); return; }
      menu.hidden = !menu.hidden;
      btn.setAttribute('aria-expanded', !menu.hidden);
    };
    $$('[data-a]', menu || head).forEach(b => b.addEventListener('click', () => {
      if (menu) menu.hidden = true;
      if (b.dataset.a === 'garage') showGarageTab();
      if (b.dataset.a === 'logout') { api.logout(); say('გამოხვედი ანგარიშიდან.'); }
    }));
  }
  document.addEventListener('pointerdown', e => {
    const menu = head && $('.acct-menu', head);
    if (menu && !menu.hidden && !head.contains(e.target)) menu.hidden = true;
  });

  function showDbProblem() {
    const h = api.health || {};
    const box = document.createElement('div');
    box.className = 'modal';
    box.innerHTML = `<div class="mbox">
      <button type="button" class="mclose" aria-label="დახურვა">✕</button>
      <h3>⚠ ბაზასთან კავშირი ვერ მოხერხდა</h3>
      <p>სერვერი მუშაობს, მაგრამ SQL Server-ს ვერ უკავშირდება, ამიტომ შესვლა და რეკორდები დროებით გამორთულია.</p>
      ${h.hint ? `<p class="db-hint">💡 ${esc(h.hint)}</p>` : ''}
      ${h.error ? `<pre class="db-err">${esc(h.error)}</pre>` : ''}
      <p class="mnote">connection string იწერება Visual Studio-ში: Veloce.Api-ზე მარჯვენა ღილაკი → Manage User Secrets → <code>"ConnectionStrings": { "Veloce": "..." }</code>. შეცვლის შემდეგ გაუშვი პროექტი თავიდან.</p>
      <button class="mgo" data-a="retry">↻ თავიდან შემოწმება</button>
    </div>`;
    document.body.appendChild(box);
    const close = () => box.remove();
    $('.mclose', box).onclick = close;
    box.addEventListener('pointerdown', e => { if (e.target === box) close(); });
    $('[data-a="retry"]', box).onclick = async () => { close(); if (await api.init()) await refreshAll(); else { renderHead(); showDbProblem(); } };
  }

  /* ---------- data ---------- */
  async function loadMine() {
    favs.clear(); tunings = []; mine = new Map();
    if (!api.user) return;
    try {
      const [g, recs] = await Promise.all([api.get('/garage'), api.get('/records/mine')]);
      g.favorites.forEach(id => favs.add(id));
      tunings = g.tunings;
      recs.forEach(r => mine.set(`${r.carId}@${r.track}`, r));
    } catch (ex) { console.warn(ex); }
  }

  async function toggleFav(id) {
    if (!api.user) { openLogin(); return; }
    const on = !favs.has(id);
    try {
      if (on) await api.put(`/garage/favorites/${encodeURIComponent(id)}`); else await api.del(`/garage/favorites/${encodeURIComponent(id)}`);
      if (on) favs.add(id); else favs.delete(id);
      say(on ? '★ დაემატა რჩეულებში' : 'წაიშალა რჩეულებიდან');
      ctx.refreshList(); renderInfoExtras(); renderGarage();
    } catch (ex) { say(ex.message, true); }
  }

  /* ---------- info panel: star + world leaderboard ---------- */
  async function renderInfoExtras() {
    const box = $('#acctInfo'), m = ctx.current();
    if (!box || !m) return;
    if (!api.available) { box.innerHTML = ''; return; }
    const fav = favs.has(m.id);
    box.innerHTML = `
      <button class="fav-btn ${fav ? 'on' : ''}" id="favBtn">${fav ? '★ რჩეულია' : '☆ რჩეულებში დამატება'}</button>
      <div class="lb">
        <div class="lb-head"><b>🏆 საერთო ლიდერბორდი</b></div>
        <div class="lb-tabs">
          ${TRACK_TABS.map(([id, ico, label]) => `<button data-t="${id}" class="${lb.track === id ? 'on' : ''}" title="${label}">${ico} ${label}</button>`).join('')}
          <span></span>
          <button data-y="lap" class="${lb.type === 'lap' ? 'on' : ''}">⏱ წრე</button><button data-y="drift" class="${lb.type === 'drift' ? 'on' : ''}">💨 დრიფტი</button>
        </div>
        <ol class="lb-list" data-key="${m.id}|${lb.track}|${lb.type}"><li class="lb-empty">იტვირთება…</li></ol>
      </div>`;
    $('#favBtn').onclick = () => toggleFav(m.id);
    $$('.lb-tabs [data-t]', box).forEach(b => (b.onclick = () => { lb.track = b.dataset.t; renderInfoExtras(); }));
    $$('.lb-tabs [data-y]', box).forEach(b => (b.onclick = () => { lb.type = b.dataset.y; renderInfoExtras(); }));
    const list = $('.lb-list', box), key = list.dataset.key;
    try {
      const rows = await api.get(`/leaderboard?car=${encodeURIComponent(m.id)}&track=${lb.track}&type=${lb.type}&take=10`);
      if (!list.isConnected || list.dataset.key !== key) return;       // the panel changed meanwhile
      list.innerHTML = rows.length
        ? rows.map(r => `<li class="${r.me ? 'me' : ''}${r.rank > 10 ? ' gap' : ''}"><i>${r.rank}</i><span>${esc(r.name)}</span><b>${lb.type === 'lap' ? fmtMs(r.value) : r.value}</b></li>`).join('')
        : `<li class="lb-empty">ჯერ არავის უტარებია. ${api.user ? 'იყავი პირველი!' : 'შედი და იყავი პირველი!'}</li>`;
    } catch (ex) {
      if (list.isConnected) list.innerHTML = `<li class="lb-empty">${esc(ex.message)}</li>`;
    }
  }

  /* ---------- tuning panel: save to the garage ---------- */
  function renderTuneExtras() {
    const box = $('#acctTune'), m = ctx.current();
    if (!box || !m) return;
    if (!api.available) { box.innerHTML = ''; return; }
    if (!api.user) {
      box.innerHTML = '<button class="tsave-login">💾 შედი, რომ ტუნინგი გარაჟში შეინახო</button>';
      $('.tsave-login', box).onclick = () => openLogin();
      return;
    }
    const forCar = tunings.filter(t => t.carId === m.id);
    box.innerHTML = `
      <div class="tsave"><input id="tsName" maxlength="40" placeholder="სახელი, მაგ. „ღამის ვერსია“" aria-label="ტუნინგის სახელი"><button id="tsGo">💾 შენახვა</button></div>
      ${forCar.length ? `<div class="tsaved"><small>შენახული ამ მანქანისთვის:</small>${forCar.map(t =>
        `<button data-id="${t.id}"><i style="--c:${esc(t.settings.color || '#888')}"></i>${esc(t.name)}</button>`).join('')}</div>` : ''}`;
    const save = async () => {
      const input = $('#tsName', box), name = input.value.trim() || `ტუნინგი ${forCar.length + 1}`;
      try {
        const t = await api.post('/garage/tunings', { carId: m.id, name, settings: ctx.currentTuning() });
        tunings.unshift(t);
        say(`💾 „${t.name}“ შეინახა გარაჟში`);
        renderTuneExtras(); renderGarage();
      } catch (ex) { say(ex.message, true); }
    };
    $('#tsGo', box).onclick = save;
    $('#tsName', box).addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') save(); });
    $$('.tsaved button', box).forEach(b => (b.onclick = () => useTuning(+b.dataset.id)));
  }

  async function useTuning(id) {
    const t = tunings.find(x => x.id === id);
    if (!t) return;
    await ctx.applyTuning(t.carId, t.settings);
    say(`✓ „${t.name}“ ჩაირთო`);
  }

  /* ---------- "My garage" tab ---------- */
  const tabBtn = $('[data-tab="garage"]');
  function showGarageTab() {
    if (!tabBtn) return;
    tabBtn.click();
    $('.panel') && $('.panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function renderGarage() {
    const box = $('#tab-garage');
    if (tabBtn) tabBtn.hidden = !api.available;
    if (!box) return;
    if (!api.user) {
      box.innerHTML = `<h2>ჩემი გარაჟი</h2>
        <p class="desc">შედი ან დარეგისტრირდი: გარაჟში შეინახება რჩეული მანქანები და ტუნინგები, რეკორდები კი მოხვდება საერთო ლიდერბორდზე.</p>
        <button class="mgo wide" data-a="login">👤 შესვლა / რეგისტრაცია</button>`;
      $('[data-a="login"]', box).onclick = () => openLogin();
      return;
    }
    const recs = [...mine.values()].filter(r => r.lapMs != null || r.drift != null)
      .sort((a, b) => carName(a.carId).localeCompare(carName(b.carId)));
    const trackName = id => (ctx.tracks[id] ? `${ctx.tracks[id].icon} ${ctx.tracks[id].name}` : id);
    box.innerHTML = `
      <h2>ჩემი გარაჟი</h2>
      <p class="desc">${esc(api.user.displayName)} · ${esc(api.user.email)}</p>
      <h3 class="gh">★ რჩეული მანქანები</h3>
      ${favs.size ? `<div class="gfavs">${[...favs].map(id => `<button data-car="${esc(id)}"><img alt="" src="${esc(ctx.thumb(id))}"><span>${esc(carName(id))}</span></button>`).join('')}</div>`
        : '<p class="gempty">ჯერ ცარიელია. ინფოს ჩანართში დააჭირე „☆ რჩეულებში დამატება“.</p>'}
      <h3 class="gh">💾 შენახული ტუნინგები</h3>
      ${tunings.length ? `<ul class="gtunes">${tunings.map(t => `<li data-id="${t.id}">
          <i style="--c:${esc(t.settings.color || '#888')}"></i>
          <span><b>${esc(t.name)}</b><small>${esc(carName(t.carId))}</small></span>
          <button data-do="use" title="ჩართვა">▶</button><button data-do="rename" title="გადარქმევა">✎</button><button data-do="del" title="წაშლა">🗑</button>
        </li>`).join('')}</ul>`
        : '<p class="gempty">ჯერ ცარიელია. ტუნინგის ჩანართში დააჭირე „💾 შენახვა“.</p>'}
      <h3 class="gh">🏆 ჩემი რეკორდები</h3>
      ${recs.length ? `<table class="grecs"><tr><th>მანქანა</th><th>ტრასა</th><th>წრე</th><th>დრიფტი</th></tr>${recs.map(r =>
        `<tr><td>${esc(carName(r.carId))}</td><td>${trackName(r.track)}</td><td>${fmtMs(r.lapMs)}</td><td>${r.drift ?? '—'}</td></tr>`).join('')}</table>`
        : '<p class="gempty">ჯერ არ გაქვს. ტესტ-დრაივზე დასრულებული წრე და დრიფტი აქ ჩაიწერება.</p>'}`;
    $$('.gfavs button', box).forEach(b => (b.onclick = () => ctx.select(b.dataset.car)));
    $$('.gtunes li', box).forEach(li => {
      const id = +li.dataset.id, t = tunings.find(x => x.id === id);
      $('[data-do="use"]', li).onclick = () => useTuning(id);
      $('[data-do="rename"]', li).onclick = async () => {
        const name = prompt('ახალი სახელი:', t.name);
        if (!name || !name.trim()) return;
        try { Object.assign(t, await api.put(`/garage/tunings/${id}`, { name: name.trim() })); renderGarage(); renderTuneExtras(); }
        catch (ex) { say(ex.message, true); }
      };
      $('[data-do="del"]', li).onclick = async () => {
        if (!confirm(`წავშალო „${t.name}“?`)) return;
        try { await api.del(`/garage/tunings/${id}`); tunings = tunings.filter(x => x.id !== id); renderGarage(); renderTuneExtras(); say('წაიშალა'); }
        catch (ex) { say(ex.message, true); }
      };
    });
  }

  /* ---------- test-drive results ---------- */
  // Called by the test drive after a finished lap (seconds) or drift (points). Sends only results
  // that beat the player's own best on the server; returns a short text for the HUD, or null.
  async function submitResult({ carId, track, lap, drift }) {
    if (!api.available || !api.user) return null;
    const key = `${carId}@${track}`, best = mine.get(key) || { carId, track, lapMs: null, drift: null };
    const lapMs = lap != null ? Math.round(lap * 1000) : null;
    const body = { carId, track };
    if (lapMs != null && (best.lapMs == null || lapMs < best.lapMs)) body.lapMs = lapMs;
    if (drift != null && drift > 0 && (best.drift == null || drift > best.drift)) body.drift = Math.round(drift);
    if (body.lapMs == null && body.drift == null) return null;
    try {
      const r = await api.post('/records', body);
      mine.set(key, { ...best, ...(body.lapMs != null ? { lapMs: body.lapMs } : {}), ...(body.drift != null ? { drift: body.drift } : {}) });
      renderGarage();
      if (body.lapMs != null && r.lapRank) return r.lapRank === 1 ? '🏆 მსოფლიო რეკორდი!' : `🏆 ადგილი #${r.lapRank}`;
      if (body.drift != null && r.driftRank) return r.driftRank === 1 ? '🏆 დრიფტის რეკორდი!' : `💨 დრიფტი: ადგილი #${r.driftRank}`;
    } catch (ex) { console.warn(ex); }
    return null;
  }

  // everyone's best lap and drift per track for a car (track cards before a drive)
  async function worldBest(carId) {
    if (!api.available) return null;
    try { return await api.get(`/leaderboard/best?car=${encodeURIComponent(carId)}`); } catch { return null; }
  }

  // catalog texts the admin edited: { cars: [...visible], hidden: [ids] }
  async function catalog() {
    if (!api.available) return null;
    try {
      const [cars, hidden] = await Promise.all([api.get('/cars'), api.get('/cars/hidden')]);
      return { cars, hidden };
    } catch { return null; }
  }

  async function refreshAll() {
    await loadMine();
    renderHead(); renderGarage(); renderInfoExtras(); renderTuneExtras(); ctx.refreshList();
  }
  api.onUser(refreshAll);

  return {
    favs,
    async init() {
      if (head && !(location.hostname.endsWith('github.io'))) {   // the first check may take a while
        head.hidden = false;
        head.innerHTML = '<span class="acct-btn acct-wait">⏳ სერვერთან კავშირი…</span>';
      }
      const ok = await api.init();
      if (ok) await refreshAll(); else renderHead();
      return ok;
    },
    info: renderInfoExtras,
    tune: renderTuneExtras,
    submitResult,
    worldBest,
    catalog,
    openLogin,
  };
}
