import { get, post, setUnauthorizedHandler } from './api.js';
import { state, isAdmin } from './state.js';
import { $, html, icon, render, toast } from './ui.js';
import { loginView } from './views/login.js';
import { dashboardView } from './views/dashboard.js';
import { encargosView } from './views/encargos.js';
import { nuevoEncargoView } from './views/encargo-nuevo.js';
import { pedidoView } from './views/pedido.js';
import { autoservicioView } from './views/autoservicio.js';
import { clientesView, clienteView } from './views/clientes.js';
import { cajaView } from './views/caja.js';
import { ajustesView } from './views/ajustes.js';
import { ticketView } from './views/ticket.js';

const ROUTES = [
  { re: /^\/login$/, view: loginView, public: true, bare: true },
  { re: /^\/$/, view: dashboardView, nav: 'inicio' },
  { re: /^\/encargos$/, view: encargosView, nav: 'encargos' },
  { re: /^\/encargos\/nuevo$/, view: nuevoEncargoView, nav: 'encargos' },
  { re: /^\/pedidos\/(\d+)$/, view: pedidoView, nav: 'encargos' },
  { re: /^\/autoservicio$/, view: autoservicioView, nav: 'autoservicio' },
  { re: /^\/clientes$/, view: clientesView, nav: 'clientes' },
  { re: /^\/clientes\/(\d+)$/, view: clienteView, nav: 'clientes' },
  { re: /^\/caja$/, view: cajaView, nav: 'caja' },
  { re: /^\/ajustes(?:\/(\w+))?$/, view: ajustesView, nav: 'ajustes', admin: true },
  { re: /^\/ticket\/(\d+)$/, view: ticketView, bare: true },
];

const NAV = [
  { id: 'inicio', href: '#/', label: 'Inicio', icon: 'home' },
  { id: 'encargos', href: '#/encargos', label: 'Encargos', icon: 'bag' },
  { id: 'autoservicio', href: '#/autoservicio', label: 'Autoservicio', icon: 'washer' },
  { id: 'clientes', href: '#/clientes', label: 'Clientes', icon: 'users' },
  { id: 'caja', href: '#/caja', label: 'Caja', icon: 'cash' },
  { id: 'ajustes', href: '#/ajustes', label: 'Ajustes', icon: 'gear', admin: true },
];

const appEl = document.getElementById('app');
let cleanup = null;
let renderId = 0;

export function navigate(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

function parseHash() {
  const h = location.hash.replace(/^#/, '') || '/';
  const [path, query = ''] = h.split('?');
  return { path, query: new URLSearchParams(query) };
}

function shell(activeNav) {
  const s = state.settings;
  return html`
    <div class="layout">
      <aside class="sidebar">
        <div class="brand">
          <span class="brand-mark">${icon('washer')}</span>
          <span class="brand-name">${s.business_name}</span>
        </div>
        <nav class="nav" aria-label="Secciones">
          ${NAV.filter((n) => !n.admin || isAdmin()).map((n) => html`
            <a href="${n.href}" class="nav-link ${n.id === activeNav ? 'active' : ''}"
               ${n.id === activeNav ? html`aria-current="page"` : ''}>${icon(n.icon)}<span>${n.label}</span></a>`)}
        </nav>
        <div class="session">
          <div class="session-user">
            <strong>${state.user.name}</strong>
            <span>${state.user.role === 'admin' ? 'Administrador' : 'Mostrador'}</span>
          </div>
          <button type="button" class="icon-btn" id="logout" title="Cerrar sesión" aria-label="Cerrar sesión">${icon('logout')}</button>
        </div>
      </aside>
      <main class="main" id="view"></main>
    </div>`;
}

async function route() {
  const id = ++renderId;
  if (cleanup) { cleanup(); cleanup = null; }
  const { path, query } = parseHash();
  const match = ROUTES.map((r) => ({ r, m: r.re.exec(path) })).find((x) => x.m);
  if (!match) return navigate('#/');
  const { r, m } = match;

  if (!r.public && !state.user) return navigate('#/login');
  if (r.admin && !isAdmin()) return navigate('#/');
  if (path === '/login' && state.user) return navigate('#/');

  let target;
  if (r.bare) {
    appEl.className = 'bare';
    target = appEl;
    target.replaceChildren();
  } else {
    appEl.className = '';
    render(appEl, shell(r.nav));
    $('#logout').addEventListener('click', logout);
    target = $('#view');
  }
  window.scrollTo(0, 0);
  try {
    const result = await r.view(target, { params: m.slice(1), query });
    if (id === renderId) cleanup = typeof result === 'function' ? result : null;
    else if (typeof result === 'function') result();
  } catch (err) {
    if (id !== renderId) return;
    render(target, html`<div class="empty"><p>${err.message}</p><a class="btn btn-ghost" href="#/">Volver al inicio</a></div>`);
  }
}

async function logout() {
  try { await post('/auth/logout'); } catch { /* se cierra de todos modos */ }
  state.user = null;
  navigate('#/login');
}

export async function afterLogin(user) {
  state.user = user;
  state.settings = await get('/settings');
  document.title = state.settings.business_name;
}

export async function refreshSettings() {
  state.settings = await get('/settings');
  document.title = state.settings.business_name;
}

setUnauthorizedHandler(() => {
  if (!state.user) return;
  state.user = null;
  toast('Tu sesión terminó. Vuelve a entrar.', 'warn');
  navigate('#/login');
});

async function start() {
  try {
    const { user } = await get('/auth/me');
    await afterLogin(user);
  } catch {
    state.user = null;
  }
  window.addEventListener('hashchange', route);
  route();
}

start();
