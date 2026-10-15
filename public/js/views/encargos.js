import { get } from '../api.js';
import { navigate } from '../app.js';
import { $, $$, debounce, fmtDateTime, html, icon, money, render, statusChip } from '../ui.js';

const TABS = [
  ['activos', 'Activos'],
  ['recibido', 'Recibidos'],
  ['en_proceso', 'En proceso'],
  ['listo', 'Listos'],
  ['entregado', 'Entregados'],
  ['cancelado', 'Cancelados'],
];

export async function encargosView(el, { query }) {
  let status = TABS.some(([v]) => v === query.get('estado')) ? query.get('estado') : 'activos';
  let q = '';

  render(el, html`
    <header class="page-head">
      <div><h1>Encargos</h1><p class="muted">Ropa que el cliente deja y recoge después.</p></div>
      <div class="actions"><a class="btn btn-primary" href="#/encargos/nuevo">${icon('plus')} Nuevo encargo</a></div>
    </header>
    <div class="toolbar">
      <div class="tabs" role="tablist">
        ${TABS.map(([v, l]) => html`<button type="button" role="tab" data-status="${v}">${l}</button>`)}
      </div>
      <div class="search">${icon('search')}<input type="search" placeholder="Folio, nombre o teléfono" aria-label="Buscar encargo"></div>
    </div>
    <div class="table-wrap" id="results"></div>`);

  const results = $('#results', el);

  const load = async () => {
    $$('[data-status]', el).forEach((b) => b.setAttribute('aria-selected', String(b.dataset.status === status)));
    const params = new URLSearchParams({ kind: 'encargo', status });
    if (q) params.set('q', q);
    const orders = await get(`/orders?${params}`);
    const now = new Date().toISOString();
    if (!orders.length) {
      render(results, html`<p class="empty-line">No hay encargos ${q ? 'que coincidan con la búsqueda' : 'en esta lista'}.</p>`);
      return;
    }
    render(results, html`
      <table class="table">
        <thead><tr><th>Folio</th><th>Cliente</th><th>Estado</th><th>Entrega</th><th class="r">Total</th><th class="r">Saldo</th></tr></thead>
        <tbody>
          ${orders.map((o) => {
            const late = ['recibido', 'en_proceso'].includes(o.status) && o.due_at && o.due_at < now;
            return html`
              <tr class="clickable" data-id="${o.id}" tabindex="0">
                <td class="folio">${o.folio}</td>
                <td><strong>${o.customer_name}</strong><div class="muted">${o.customer_phone}</div></td>
                <td>${statusChip(o.status)} ${late ? html`<span class="chip chip-bad">Atrasado</span>` : ''}</td>
                <td>${o.status === 'entregado' ? html`<span class="muted">Entregado ${fmtDateTime(o.delivered_at)}</span>` : fmtDateTime(o.due_at)}</td>
                <td class="r num">${money(o.total_cents)}</td>
                <td class="r num ${o.balance_cents > 0 ? 'owed' : 'muted'}">${o.balance_cents > 0 ? money(o.balance_cents) : '—'}</td>
              </tr>`;
          })}
        </tbody>
      </table>`);
    $$('tr[data-id]', results).forEach((tr) => {
      const go = () => navigate(`#/pedidos/${tr.dataset.id}`);
      tr.addEventListener('click', go);
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    });
  };

  $$('[data-status]', el).forEach((b) => b.addEventListener('click', () => { status = b.dataset.status; load(); }));
  $('input[type=search]', el).addEventListener('input', debounce((e) => { q = e.target.value.trim(); load(); }, 250));
  await load();
}
