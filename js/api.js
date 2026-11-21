// Client for the VELOCE Garage API (backend/Veloce.Api, ASP.NET Core + SQL Server).
// The API lives under /api on the same site (Visual Studio serves both; on Vercel a rewrite in vercel.json
// forwards /api). A <meta name="veloce-api" content="https://..."> tag points elsewhere.
// When the API does not answer (e.g. GitHub Pages) `api.available` stays false and the site
// works as before, with records and tunings kept in the browser only.
const TOKEN_KEY = 'veloce-token';
const meta = document.querySelector('meta[name="veloce-api"]');
const BASE = ((meta && meta.content) || '').replace(/\/$/, '') + '/api';

let token = null;
try { token = localStorage.getItem(TOKEN_KEY); } catch { /* private mode */ }
const listeners = new Set();

function setSession(t, user) {
  token = t;
  try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ }
  api.user = user;
  listeners.forEach(fn => fn(user));
}

async function call(method, path, body) {
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('სერვერთან კავშირი ვერ დამყარდა.');
  }
  if (res.status === 401 && token && !path.startsWith('/auth/login')) setSession(null, null);   // the login ran out
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const fallback = res.status === 401 ? 'ჯერ შედი ანგარიშზე.' : res.status === 403 ? 'წვდომა აკრძალულია.' : 'მოთხოვნა ვერ შესრულდა.';
    const err = new Error((data && data.error) || fallback);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  available: false,
  status: 'none',          // 'ok' | 'nodb' (the API answers but cannot reach its database) | 'none'
  health: null,            // the /api/health answer (in Development it explains a database error)
  user: null,

  // checks that the API and its database answer, then restores the saved login
  async init() {
    // GitHub Pages only hosts static files: do not even ask
    if (!(meta && meta.content) && location.hostname.endsWith('github.io')) return false;
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 5000);
      const res = await fetch(`${BASE}/health`, { signal: ctl.signal });
      clearTimeout(timer);
      const h = res.ok ? await res.json() : null;
      api.health = h;
      api.available = !!(h && h.ok && h.db);
      api.status = api.available ? 'ok' : h && h.ok ? 'nodb' : 'none';
    } catch { api.available = false; api.status = 'none'; }
    if (api.available && token) {
      try { api.user = await call('GET', '/auth/me'); } catch { setSession(null, null); }
    }
    return api.available;
  },
  onUser(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  async login(email, password) {
    const r = await call('POST', '/auth/login', { email, password });
    setSession(r.token, r.user);
    return r.user;
  },
  async register(email, password, displayName) {
    const r = await call('POST', '/auth/register', { email, password, displayName });
    setSession(r.token, r.user);
    return r.user;
  },
  logout() { setSession(null, null); },

  get: path => call('GET', path),
  post: (path, body) => call('POST', path, body ?? {}),
  put: (path, body) => call('PUT', path, body ?? {}),
  del: path => call('DELETE', path),
};
