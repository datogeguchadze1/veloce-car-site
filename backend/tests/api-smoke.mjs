// API smoke test against a running API (real SQL Server). Usage: node backend/tests/api-smoke.mjs [base URL]
// The admin account boss@test.ge must be listed in Admin:Emails (or be the first account).
// It cleans up after itself (test car and user are deleted). Login is rate-limited: wait a minute between runs.
const B = (process.argv[2] || 'http://localhost:5080').replace(/\/$/, '') + '/api';
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };
async function call(method, path, body, token) {
  const r = await fetch(B + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { s: r.status, j };
}
const rnd = Math.random().toString(36).slice(2, 7);
let r = await call('POST', '/auth/register', { email: 'boss@test.ge', password: 'password123', displayName: 'Boss' });
if (r.s === 409) r = await call('POST', '/auth/login', { email: 'boss@test.ge', password: 'password123' });
ok(r.s === 200 && r.j.user.isAdmin, 'admin register/login ' + r.s);
const admin = r.j.token, adminId = r.j.user.id;
r = await call('POST', '/auth/register', { email: `u${rnd}@test.ge`, password: 'password123', displayName: 'მძღოლი ' + rnd });
ok(r.s === 200 && !r.j.user.isAdmin, 'user register');
const u = r.j.token, uid = r.j.user.id;
ok((await call('POST', '/auth/register', { email: `u${rnd}@test.ge`, password: 'password123', displayName: 'x2' })).s === 409, 'duplicate email 409');
ok((await call('POST', '/auth/register', { email: 'bad', password: 'password123', displayName: 'xx' })).s === 400, 'bad email 400');
ok((await call('POST', '/auth/register', { email: `s${rnd}@t.ge`, password: 'short', displayName: 'xx' })).s === 400, 'short pw 400');
r = await call('POST', '/auth/login', { email: `U${rnd}@test.ge `, password: 'wrongpass' });
ok(r.s === 401 && r.j.error, 'wrong password 401 ' + JSON.stringify(r.j));
ok((await call('GET', '/auth/me', null, u)).j.id === uid, 'me');
ok((await call('GET', '/auth/me')).s === 401, 'me anon 401');
ok((await call('GET', '/auth/me', null, u + 'x')).s === 401, 'tampered token 401');
// records (on a made-up car, so the board starts empty)
const CAR = 'smoke-' + rnd;
r = await call('POST', '/records', { carId: CAR, track: 'circuit', lapMs: 61000 }, u);
ok(r.s === 200 && r.j.lapImproved && r.j.lapRank >= 1, 'submit lap ' + JSON.stringify(r.j));
r = await call('POST', '/records', { carId: CAR, track: 'circuit', lapMs: 65000 }, u);
ok(r.s === 200 && !r.j.lapImproved, 'slower lap not improved');
r = await call('POST', '/records', { carId: CAR, track: 'circuit', drift: 950 }, u);
ok(r.s === 200 && r.j.driftImproved && r.j.driftRank >= 1, 'drift');
r = await call('POST', '/records', { carId: CAR, track: 'circuit', lapMs: 59000 }, admin);
ok(r.s === 200 && r.j.lapRank === 1, 'admin faster rank 1 ' + JSON.stringify(r.j));
ok((await call('POST', '/records', { carId: CAR, track: 'moon', lapMs: 60000 }, u)).s === 400, 'bad track');
ok((await call('POST', '/records', { carId: CAR, track: 'city', lapMs: 2000 }, u)).s === 400, 'too fast lap');
ok((await call('POST', '/records', { carId: CAR, track: 'city', lapMs: 60000 })).s === 401, 'anon record 401');
r = await call('GET', `/leaderboard?car=${CAR}&track=circuit&type=lap`, null, u);
ok(r.s === 200 && r.j[0].name === 'Boss' && r.j.some(x => x.me), 'leaderboard ' + JSON.stringify(r.j));
r = await call('GET', `/leaderboard?car=${CAR}&track=circuit&type=lap&take=1`, null, u);
ok(r.j.length === 2 && r.j[1].me && r.j[1].rank >= 2, 'me appended outside top');
r = await call('GET', `/leaderboard?car=${CAR}&track=circuit&type=drift`);
ok(r.j[0].value === 950, 'drift board');
r = await call('GET', `/leaderboard/best?car=${CAR}`);
ok(r.j.circuit.lap.value === 59000 && r.j.city.lap === null, 'best ' + JSON.stringify(r.j));
r = await call('GET', '/records/mine', null, u);
r.j = r.j.filter(x => x.carId === CAR);
ok(r.j.length === 1 && r.j[0].lapMs === 61000 && r.j[0].drift === 950, 'mine');
// garage
ok((await call('PUT', '/garage/favorites/f40', null, u)).s === 204, 'fav add');
ok((await call('PUT', '/garage/favorites/f40', null, u)).s === 204, 'fav add twice');
r = await call('POST', '/garage/tunings', { carId: 'f40', name: 'წითელი', settings: { color: '#ff0000', ride: -3 } }, u);
ok(r.s === 200 && r.j.settings.color === '#ff0000', 'tuning add');
const tid = r.j.id;
ok((await call('POST', '/garage/tunings', { carId: 'f40', name: 'x', settings: [1] }, u)).s === 400, 'tuning array rejected');
ok((await call('POST', '/garage/tunings', { carId: 'f40', name: 'x', settings: { a: 'x'.repeat(5000) } }, u)).s === 400, 'tuning too big');
r = await call('PUT', `/garage/tunings/${tid}`, { name: 'ახალი' }, u);
ok(r.s === 200 && r.j.name === 'ახალი' && r.j.settings.ride === -3, 'rename');
ok((await call('PUT', `/garage/tunings/${tid}`, { name: 'hack' }, admin)).s === 404, 'other user cannot edit');
ok((await call('DELETE', `/garage/tunings/${tid}`, null, admin)).s === 404, 'other user cannot delete');
r = await call('GET', '/garage', null, u);
ok(r.j.favorites[0] === 'f40' && r.j.tunings.length === 1, 'garage get');
ok((await call('DELETE', `/garage/tunings/${tid}`, null, u)).s === 204, 'delete tuning');
ok((await call('DELETE', '/garage/favorites/f40', null, u)).s === 204, 'fav del');
ok((await call('GET', '/garage')).s === 401, 'garage anon');
// admin
ok((await call('GET', '/admin/stats', null, u)).s === 403, 'user not admin 403');
ok((await call('GET', '/admin/stats')).s === 401, 'anon admin 401');
r = await call('GET', '/admin/stats', null, admin);
ok(r.s === 200 && r.j.users >= 2, 'stats ' + JSON.stringify(r.j));
r = await call('POST', '/admin/cars/seed', [{ id: CAR, brand: 'Test', name: 'Smoke', chassis: 'F120', year: 1987, years: '1987–1992', body: 'კუპე', era: 'modern', desc: 'ტესტი', specs: { engine: 'V8' }, vmax: 324, t100: 4.1, visible: true, sortOrder: 0 }], admin);
ok(r.s === 200 && r.j.added === 1, 'seed ' + JSON.stringify(r.j));
r = await call('PUT', `/admin/cars/${CAR}`, { id: CAR, brand: 'Test', name: 'Smoke ✓', chassis: 'F120', year: 1987, years: '1987–1992', body: 'კუპე', era: 'modern', desc: 'შეცვლილი', specs: { engine: 'V8 2.9' }, vmax: 324, t100: 4.1, visible: true, sortOrder: 1 }, admin);
ok(r.s === 200 && r.j.name === 'Smoke ✓', 'edit car');
r = await call('GET', '/cars');
ok(r.j.find(c => c.id === CAR).desc === 'შეცვლილი', 'public cars');
r = await call('GET', '/admin/users', null, admin);
ok(r.s === 200 && r.j.length >= 2, 'users');
ok((await call('PUT', `/admin/users/${uid}/admin`, { isAdmin: true }, admin)).s === 204, 'make admin');
ok((await call('GET', '/admin/stats', null, u)).s === 200, 'now admin');
ok((await call('PUT', `/admin/users/${uid}/admin`, { isAdmin: false }, admin)).s === 204, 'revoke');
ok((await call('GET', '/admin/stats', null, u)).s === 403, 'revoked works at once');
r = await call('GET', '/admin/records', null, admin);
ok(r.s === 200 && r.j.length >= 2, 'admin records');
ok((await call('DELETE', `/admin/records/${uid}/${CAR}/circuit?part=lap`, null, admin)).s === 204, 'delete lap part');
r = await call('GET', '/records/mine', null, u);
r.j = r.j.filter(x => x.carId === CAR);
ok(r.j[0].lapMs === null && r.j[0].drift === 950, 'lap removed drift kept');
ok((await call('GET', '/nope')).s === 404, 'unknown api 404');
// clean up
ok((await call('DELETE', `/admin/cars/${CAR}`, null, admin)).s === 204, 'delete test car');
ok((await call('DELETE', `/admin/records/${adminId}/${CAR}/circuit`, null, admin)).s === 204, 'delete admin test record');
ok((await call('DELETE', `/admin/users/${uid}`, null, admin)).s === 204, 'delete test user (cascade)');
ok((await call('GET', '/auth/me', null, u)).s === 401, 'deleted user token rejected');
// login attempts are limited (10 a minute per address)
let limited = false;
for (let i = 0; i < 12 && !limited; i++) limited = (await call('POST', '/auth/login', { email: 'nobody@test.ge', password: 'x' })).s === 429;
ok(limited, 'rate limit on login');
console.log(fails ? `${fails} FAILED` : 'ALL OK');
