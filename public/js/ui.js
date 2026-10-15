// Utilidades de interfaz: plantillas con escape automático, formato y diálogos.

class Raw {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}

export const raw = (s) => new Raw(String(s));

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

function fmt(v) {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(fmt).join('');
  return esc(v);
}

/** Plantilla HTML: todo lo interpolado se escapa salvo lo que ya es html``/raw(). */
export function html(strings, ...values) {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < values.length) out += fmt(values[i]);
  });
  return new Raw(out);
}

export function render(el, content) {
  el.innerHTML = fmt(content);
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---------- Formato ----------

const moneyFmt = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
export const money = (cents) => moneyFmt.format((cents || 0) / 100);

/** "45.5" → 4550 centavos. Devuelve NaN si no es un número válido. */
export function toCents(value) {
  const n = Number(String(value ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}
export const centsToInput = (cents) => (cents / 100).toFixed(2);

const dateTimeFmt = new Intl.DateTimeFormat('es-MX', {
  weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
});
const dateFmt = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('es-MX', { hour: 'numeric', minute: '2-digit' });

export const fmtDateTime = (iso) => (iso ? dateTimeFmt.format(new Date(iso)) : '—');
export const fmtDate = (iso) => (iso ? dateFmt.format(new Date(iso)) : '—');
export const fmtTime = (iso) => (iso ? timeFmt.format(new Date(iso)) : '—');

export function fmtQty(q, unit) {
  if (unit === 'kg') return `${Number(q).toLocaleString('es-MX', { maximumFractionDigits: 2 })} kg`;
  if (unit === 'pieza') return `${q} ${Number(q) === 1 ? 'pieza' : 'piezas'}`;
  return `${q}`;
}

export const UNIT_LABEL = { kg: 'kg', pieza: 'pieza', servicio: 'servicio' };

/** Valor para <input type="datetime-local"> en hora local. */
export function toLocalInput(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function countdown(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export const STATUS = {
  recibido: { label: 'Recibido', tone: 'neutral' },
  en_proceso: { label: 'En proceso', tone: 'info' },
  listo: { label: 'Listo para entregar', tone: 'ok' },
  entregado: { label: 'Entregado', tone: 'muted' },
  completado: { label: 'Pagado', tone: 'muted' },
  cancelado: { label: 'Cancelado', tone: 'bad' },
};

export const statusChip = (status) => {
  const s = STATUS[status] ?? { label: status, tone: 'neutral' };
  return html`<span class="chip chip-${s.tone}">${s.label}</span>`;
};

export const METHOD_LABEL = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia' };

/** Enlace a WhatsApp para números de México de 10 dígitos. */
export function waLink(phone, text) {
  let digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 10) digits = `52${digits}`;
  if (digits.length < 11) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

export function debounce(fn, ms = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// ---------- Íconos ----------

const ICONS = {
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  bag: '<path d="M5 8h14l-1 12H6L5 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  washer: '<rect x="4" y="3" width="16" height="18" rx="2"/><circle cx="12" cy="13" r="5"/><path d="M7 6h.01M10 6h.01"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6"/>',
  cash: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 9.5v5M18 9.5v5"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  logout: '<path d="M15 4h4v16h-4"/><path d="M10 8l-4 4 4 4"/><path d="M6 12h10"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  print: '<path d="M7 8V3h10v5"/><rect x="3" y="8" width="18" height="9" rx="2"/><path d="M7 14h10v7H7z"/>',
  chat: '<path d="M4 20l1.5-4A8 8 0 1 1 9 19.5z"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
};

export const icon = (name) => raw(`<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none"
  stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] ?? ''}</svg>`);

// ---------- Avisos ----------

export function toast(message, tone = 'ok') {
  const box = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast toast-${tone}`;
  el.textContent = message;
  box.append(el);
  setTimeout(() => el.classList.add('leaving'), 3800);
  setTimeout(() => el.remove(), 4300);
}

// ---------- Diálogos ----------

/**
 * Diálogo con formulario. onSubmit(values, form) puede lanzar un error:
 * el mensaje se muestra dentro del diálogo y no se cierra.
 */
export function openDialog({ title, body, submitLabel = 'Guardar', tone = 'primary', onSubmit, onOpen, wide = false }) {
  const dlg = document.createElement('dialog');
  dlg.className = wide ? 'dialog dialog-wide' : 'dialog';
  render(dlg, html`
    <form method="dialog" novalidate>
      <header class="dialog-head">
        <h2>${title}</h2>
        <button type="button" class="icon-btn" data-close aria-label="Cerrar">${icon('x')}</button>
      </header>
      <div class="dialog-body">${body}</div>
      <p class="form-error" hidden></p>
      <footer class="dialog-foot">
        <button type="button" class="btn btn-ghost" data-close>Cancelar</button>
        <button type="submit" class="btn btn-${tone}">${submitLabel}</button>
      </footer>
    </form>`);
  document.body.append(dlg);
  const form = dlg.querySelector('form');
  const errorEl = dlg.querySelector('.form-error');
  const submitBtn = form.querySelector('button[type="submit"]');
  const close = () => { dlg.close(); dlg.remove(); };

  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  $$('[data-close]', dlg).forEach((b) => b.addEventListener('click', close));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    submitBtn.disabled = true;
    try {
      const values = Object.fromEntries(new FormData(form));
      await onSubmit?.(values, form);
      close();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    } finally {
      submitBtn.disabled = false;
    }
  });
  dlg.showModal();
  onOpen?.(dlg);
  const first = form.querySelector('input:not([type=hidden]):not([disabled]), select, textarea');
  first?.focus();
  return { dialog: dlg, close };
}

export function confirmDialog({ title, message, confirmLabel = 'Confirmar', tone = 'primary' }) {
  return new Promise((resolve) => {
    let confirmed = false;
    const { dialog } = openDialog({
      title,
      body: html`<p>${message}</p>`,
      submitLabel: confirmLabel,
      tone,
      onSubmit: () => { confirmed = true; },
    });
    dialog.addEventListener('close', () => resolve(confirmed));
  });
}

/** Opciones de <select>; marca la seleccionada. */
export const options = (pairs, selected) =>
  pairs.map(([value, label]) => html`<option value="${value}" ${String(value) === String(selected) ? raw('selected') : ''}>${label}</option>`);
