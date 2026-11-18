import { api } from './api.js';
import { showAuth } from './auth.js';
import { esc, icon, toast, statusPill, busy } from './ui.js';
import * as dashboard from './views/dashboard.js';
import * as create from './views/create.js';
import * as consoleView from './views/console.js';
import * as pluginsView from './views/plugins.js';
import * as settingsView from './views/settings.js';

const CONSOLE_MAX = 3000;

/** État partagé de l'application, alimenté par l'API puis par Socket.IO. */
export const store = {
  settings: null,
  install: null,
  server: null,
  profiles: [],
  modes: [],
  job: null,
  jobLogs: [],
  plugins: null,
  console: [],
  maps: null,
  network: null,
};

const listeners = new Map();
export function on(key, fn) {
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key).add(fn);
  return () => listeners.get(key).delete(fn);
}
function emit(key, payload) {
  for (const fn of listeners.get(key) || []) {
    try {
      fn(payload);
    } catch (e) {
      console.error(e);
    }
  }
}
function set(key, value) {
  const prev = store[key];
  store[key] = value;
  emit(key, { value, prev });
}

export const modeOf = (id) => store.modes.find((m) => m.id === id) || null;

export async function loadMaps(force = false) {
  if (!store.maps || force) store.maps = await api.get('/api/maps');
  return store.maps;
}

export async function loadNetwork(withPublic = false) {
  const net = await api.get(`/api/network${withPublic ? '?public=1' : ''}`);
  if (!withPublic && store.network?.public) net.public = store.network.public;
  store.network = net;
  return net;
}

// ---------- routeur ----------

const NAV = [
  { id: 'dashboard', href: '#/', label: 'Accueil', icon: 'home' },
  { id: 'create', href: '#/create', label: 'Créer un serveur', icon: 'plus' },
  { id: 'console', href: '#/console', label: 'Console', icon: 'terminal' },
  { id: 'plugins', href: '#/plugins', label: 'Plugins', icon: 'plug' },
  { id: 'settings', href: '#/settings', label: 'Paramètres', icon: 'settings' },
];

const ROUTES = [
  { re: /^\/?$/, view: dashboard, nav: 'dashboard' },
  { re: /^\/create$/, view: create, nav: 'create' },
  { re: /^\/edit\/([\w-]+)$/, view: create, nav: 'create' },
  { re: /^\/console$/, view: consoleView, nav: 'console' },
  { re: /^\/plugins$/, view: pluginsView, nav: 'plugins' },
  { re: /^\/settings$/, view: settingsView, nav: 'settings' },
];

let current = null;

function router() {
  const hash = location.hash.replace(/^#/, '') || '/';
  const route = ROUTES.find((r) => r.re.test(hash)) || ROUTES[0];
  const params = hash.match(route.re)?.slice(1) || [];
  if (current?.destroy) current.destroy();
  const el = document.getElementById('view');
  el.innerHTML = '';
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.id === route.nav));
  current = route.view.mount(el, { store, on, params, navigate }) || null;
  window.scrollTo(0, 0);
}

export function navigate(hash) {
  if (location.hash === hash) router();
  else location.hash = hash;
}

// ---------- coque (menu, statut, tâches) ----------

function renderShell() {
  document.getElementById('nav').innerHTML = NAV.map(
    (n) => `<a href="${n.href}" data-id="${n.id}">${icon(n.icon)}<span>${esc(n.label)}</span></a>`
  ).join('');
  const logout = document.getElementById('logout');
  logout.innerHTML = `${icon('logout', 16)} Déconnexion`;
  logout.onclick = async () => {
    await api.post('/api/auth/logout');
    location.reload();
  };
  renderSideStatus();
  renderJobbar();
}

function renderSideStatus() {
  const s = store.server;
  const el = document.getElementById('side-status');
  if (!s) return;
  const name = s.profile?.name || 'Aucun serveur lancé';
  const meta =
    s.status === 'running' && s.info
      ? `${s.info.map} · ${s.info.players}/${s.info.maxPlayers} joueurs`
      : s.status === 'stopped'
        ? 'Lance un serveur depuis l’accueil'
        : '';
  el.innerHTML = `${statusPill(s.status)}<div class="name">${esc(name)}</div>${meta ? `<div class="meta">${esc(meta)}</div>` : ''}`;
}

function renderJobbar() {
  const bar = document.getElementById('jobbar');
  const j = store.job;
  if (!j || j.status !== 'running') {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  const pct = j.progress == null ? null : Math.round(j.progress * 10) / 10;
  bar.innerHTML = `
    <div class="jobbar-inner">
      <div class="row between">
        <div class="row">${icon('download', 16)}<b>${esc(j.label)}</b>${pct != null ? `<span class="chip">${pct} %</span>` : ''}</div>
        <button class="btn btn-ghost btn-sm" id="job-cancel">${icon('x', 14)} Annuler</button>
      </div>
      <div class="progress ${pct == null ? 'indeterminate' : ''}"><i style="width:${pct ?? 0}%"></i></div>
      <div class="msg">${esc(j.message || '')}</div>
    </div>`;
  bar.querySelector('#job-cancel').onclick = (e) => busy(e.currentTarget, () => api.post('/api/jobs/cancel'));
}

// ---------- temps réel ----------

function connectSocket() {
  const socket = io({ transports: ['websocket', 'polling'] });
  const offline = document.getElementById('offline');
  let wasDisconnected = false;

  socket.on('connect', async () => {
    offline.hidden = true;
    if (wasDisconnected) {
      wasDisconnected = false;
      try {
        const state = await api.get('/api/state');
        for (const key of ['settings', 'install', 'server', 'profiles', 'plugins', 'job']) set(key, state[key]);
      } catch {
        /* sera réessayé */
      }
    }
  });
  socket.on('disconnect', () => {
    wasDisconnected = true;
    offline.hidden = false;
  });
  socket.on('connect_error', (err) => {
    if (err.message === 'unauthorized') location.reload();
    offline.hidden = false;
  });

  socket.on('server:state', (s) => {
    const prev = store.server?.status;
    if (s.status === 'starting' && (prev === 'stopped' || prev === 'crashed')) {
      store.console = [];
      emit('console:reset');
    }
    if (prev && prev !== s.status) {
      if (s.status === 'running') toast(`« ${s.profile?.name || 'Serveur'} » est en ligne`, 'ok');
      if (s.status === 'crashed') toast(s.lastError || 'Le serveur a planté', 'err', 7000);
    }
    set('server', s);
  });
  socket.on('console:lines', (lines) => {
    store.console.push(...lines);
    if (store.console.length > CONSOLE_MAX) store.console.splice(0, store.console.length - CONSOLE_MAX);
    emit('console', lines);
  });
  socket.on('job', (j) => {
    const prev = store.job;
    if (j && j.status === 'running' && prev?.id !== j.id) store.jobLogs = [...(j.logs || [])];
    if (j && prev?.status === 'running' && j.status !== 'running') {
      if (j.status === 'done') toast(`${j.label} : terminé`, 'ok', 6000);
      else if (j.status === 'error') toast(`${j.label} : ${j.message}`, 'err', 9000);
      else toast(`${j.label} : annulé`, 'info');
    }
    set('job', j);
  });
  socket.on('job:log', (line) => {
    store.jobLogs.push(line);
    if (store.jobLogs.length > 400) store.jobLogs.shift();
    emit('jobLog', line);
  });
  socket.on('profiles', (p) => set('profiles', p));
  socket.on('settings', (s) => set('settings', s));
  socket.on('plugins', (p) => set('plugins', p));
  socket.on('install', (i) => {
    store.maps = null;
    set('install', i);
  });
}

// ---------- démarrage ----------

let booted = false;

async function boot() {
  const status = await api.get('/api/auth/status');
  if (!status.authenticated) return showAuth(status.setupRequired, boot);

  const state = await api.get('/api/state');
  Object.assign(store, state);
  store.jobLogs = state.job?.logs || [];
  store.console = (await api.get('/api/server/console')).lines;

  document.getElementById('app').hidden = false;
  if (booted) return router();
  booted = true;

  renderShell();
  on('server', renderSideStatus);
  on('job', renderJobbar);
  connectSocket();
  window.addEventListener('hashchange', router);
  window.addEventListener('auth:required', () => location.reload());
  router();
}

boot().catch((e) => {
  document.body.innerHTML = `<div class="auth"><div class="card auth-card"><h2>Panel injoignable</h2><p>${esc(e.message)}</p></div></div>`;
});
