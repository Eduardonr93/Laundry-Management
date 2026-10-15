import { get, put } from '../api.js';
import { navigate } from '../app.js';
import { customerFormBody, newCustomerDialog } from '../components.js';
import {
  $, $$, debounce, fmtDate, fmtDateTime, html, icon, money, openDialog, render, statusChip, toast, waLink,
} from '../ui.js';

export async function clientesView(el) {
  render(el, html`
    <header class="page-head">
      <div><h1>Clientes</h1></div>
      <div class="actions"><button type="button" class="btn btn-primary" id="new">${icon('plus')} Nuevo cliente</button></div>
    </header>
    <div class="toolbar">
      <div class="search">${icon('search')}<input type="search" placeholder="Buscar por nombre o teléfono" aria-label="Buscar cliente"></div>
    </div>
    <div class="table-wrap" id="results"></div>`);

  const results = $('#results', el);
  const load = async (q = '') => {
    const list = await get(`/customers${q ? `?q=${encodeURIComponent(q)}` : ''}`);
    if (!list.length) {
      render(results, html`<p class="empty-line">${q ? 'Nadie coincide con la búsqueda.' : 'Aún no hay clientes registrados.'}</p>`);
      return;
    }
    render(results, html`
      <table class="table">
        <thead><tr><th>Nombre</th><th>Teléfono</th><th class="r">Pedidos</th><th>Última visita</th></tr></thead>
        <tbody>${list.map((c) => html`
          <tr class="clickable" data-id="${c.id}" tabindex="0">
            <td><strong>${c.name}</strong></td><td>${c.phone || html`<span class="muted">—</span>`}</td>
            <td class="r num">${c.orders_count}</td><td>${c.last_order_at ? fmtDate(c.last_order_at) : html`<span class="muted">—</span>`}</td>
          </tr>`)}</tbody>
      </table>`);
    $$('tr[data-id]', results).forEach((tr) => {
      const go = () => navigate(`#/clientes/${tr.dataset.id}`);
      tr.addEventListener('click', go);
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    });
  };

  $('input[type=search]', el).addEventListener('input', debounce((e) => load(e.target.value.trim()), 250));
  $('#new', el).addEventListener('click', async () => {
    const created = await newCustomerDialog();
    if (created) navigate(`#/clientes/${created.id}`);
  });
  await load();
}

export async function clienteView(el, { params }) {
  const customerId = Number(params[0]);
  let c = await get(`/customers/${customerId}`);

  const draw = () => {
    const valid = c.orders.filter((o) => o.status !== 'cancelado');
    const spent = valid.reduce((s, o) => s + o.paid_cents, 0);
    const owed = valid.reduce((s, o) => s + Math.max(0, o.balance_cents), 0);
    const wa = waLink(c.phone, `Hola ${c.name.split(' ')[0]}, `);

    render(el, html`
      <header class="page-head">
        <div>
          <a class="back" href="#/clientes">${icon('back')} Clientes</a>
          <h1>${c.name}</h1>
          <p class="muted">Cliente desde ${fmtDate(c.created_at)}</p>
        </div>
        <div class="actions">
          <a class="btn btn-primary" href="#/encargos/nuevo?cliente=${c.id}">${icon('plus')} Nuevo encargo</a>
          <button type="button" class="btn btn-ghost" id="edit">Editar datos</button>
        </div>
      </header>
      <section class="stats stats-3">
        <div class="stat"><span class="stat-label">Visitas</span><span class="stat-value num">${valid.length}</span></div>
        <div class="stat"><span class="stat-label">Ha pagado</span><span class="stat-value num">${money(spent)}</span></div>
        <div class="stat ${owed > 0 ? 'stat-warn' : ''}"><span class="stat-label">Saldo pendiente</span><span class="stat-value num">${money(owed)}</span></div>
      </section>
      <div class="columns columns-detail">
        <section class="panel">
          <h2>Pedidos</h2>
          ${c.orders.length ? html`
            <div class="table-wrap"><table class="table table-plain">
              <thead><tr><th>Folio</th><th>Fecha</th><th>Estado</th><th class="r">Total</th><th class="r">Saldo</th></tr></thead>
              <tbody>${c.orders.map((o) => html`
                <tr><td><a class="folio link" href="#/pedidos/${o.id}">${o.folio}</a></td><td>${fmtDateTime(o.created_at)}</td>
                <td>${statusChip(o.status)}</td><td class="r num">${money(o.total_cents)}</td>
                <td class="r num ${o.balance_cents > 0 ? 'owed' : 'muted'}">${o.balance_cents > 0 ? money(o.balance_cents) : '—'}</td></tr>`)}
              </tbody></table></div>`
            : html`<p class="empty-line">Sin pedidos todavía.</p>`}
        </section>
        <section class="panel">
          <h2>Contacto</h2>
          <dl class="facts">
            <dt>Teléfono</dt><dd>${c.phone || '—'}</dd>
            <dt>Correo</dt><dd>${c.email || '—'}</dd>
            <dt>Dirección</dt><dd>${c.address || '—'}</dd>
          </dl>
          ${c.notes ? html`<p class="note">${c.notes}</p>` : ''}
          ${wa ? html`<a class="btn btn-whatsapp btn-block" href="${wa}" target="_blank" rel="noopener">${icon('chat')} Escribir por WhatsApp</a>` : ''}
        </section>
      </div>`);

    $('#edit', el).addEventListener('click', () => openDialog({
      title: 'Editar cliente',
      body: customerFormBody(c),
      onSubmit: async (values) => {
        const updated = await put(`/customers/${c.id}`, values);
        c = { ...c, ...updated };
        toast('Cliente actualizado');
        draw();
      },
    }));
  };
  draw();
}
