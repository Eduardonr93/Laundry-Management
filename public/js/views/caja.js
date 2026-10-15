import { get } from '../api.js';
import { isAdmin } from '../state.js';
import { $, METHOD_LABEL, fmtTime, html, money, render } from '../ui.js';

export async function cajaView(el) {
  render(el, html`
    <header class="page-head">
      <div><h1>Corte de caja</h1><p class="muted">Todo lo cobrado y reembolsado en el día.</p></div>
      <label class="field field-inline">Día
        <input type="date" id="day" ${isAdmin() ? '' : html`disabled title="Solo el administrador puede ver otros días"`}>
      </label>
    </header>
    <div id="cash" class="stack"></div>`);

  const dayInput = $('#day', el);

  const load = async (day) => {
    const c = await get(`/cash${day ? `?date=${day}` : ''}`);
    dayInput.value = c.date;
    dayInput.max = c.today;
    const label = c.date === c.today ? 'hoy' : new Intl.DateTimeFormat('es-MX', { dateStyle: 'long' }).format(new Date(`${c.date}T12:00:00`));

    render($('#cash', el), html`
      <section class="stats">
        <div class="stat stat-primary"><span class="stat-label">Total ${label}</span><span class="stat-value num">${money(c.total_cents)}</span></div>
        <div class="stat"><span class="stat-label">Efectivo en caja</span><span class="stat-value num">${money(c.by_method.efectivo)}</span></div>
        <div class="stat"><span class="stat-label">Tarjeta</span><span class="stat-value num">${money(c.by_method.tarjeta)}</span></div>
        <div class="stat"><span class="stat-label">Transferencia</span><span class="stat-value num">${money(c.by_method.transferencia)}</span></div>
      </section>
      <div class="columns">
        <section class="panel">
          <h2>Por servicio</h2>
          <dl class="facts facts-wide">
            <dt>Encargos (anticipos y saldos)</dt><dd class="num">${money(c.by_kind.encargo)}</dd>
            <dt>Autoservicio</dt><dd class="num">${money(c.by_kind.autoservicio)}</dd>
            <dt>Reembolsos incluidos</dt><dd class="num ${c.refunds_cents < 0 ? 'danger-text' : ''}">${money(c.refunds_cents)}</dd>
          </dl>
        </section>
        <section class="panel">
          <h2>Movimiento del día</h2>
          <dl class="facts facts-wide">
            <dt>Encargos recibidos</dt><dd class="num">${c.counts.encargos_recibidos}</dd>
            <dt>Encargos entregados</dt><dd class="num">${c.counts.encargos_entregados}</dd>
            <dt>Ventas de autoservicio</dt><dd class="num">${c.counts.ventas_autoservicio}</dd>
          </dl>
        </section>
      </div>
      <section class="panel">
        <h2>Detalle de cobros</h2>
        ${c.movements.length ? html`
          <div class="table-wrap"><table class="table table-plain">
            <thead><tr><th>Hora</th><th>Folio</th><th>Concepto</th><th>Cliente</th><th>Forma</th><th>Atendió</th><th class="r">Monto</th></tr></thead>
            <tbody>${c.movements.map((m) => html`
              <tr>
                <td>${fmtTime(m.created_at)}</td>
                <td><a class="folio link" href="#/pedidos/${m.order_id}">${m.folio}</a></td>
                <td>${m.kind === 'reembolso' ? 'Reembolso' : m.order_kind === 'encargo' ? 'Encargo' : 'Autoservicio'}</td>
                <td>${m.customer_name ?? html`<span class="muted">Mostrador</span>`}</td>
                <td>${METHOD_LABEL[m.method]}</td>
                <td class="muted">${m.user_name ?? ''}</td>
                <td class="r num ${m.amount_cents < 0 ? 'danger-text' : ''}">${money(m.amount_cents)}</td>
              </tr>`)}</tbody>
          </table></div>` : html`<p class="empty-line">No hay cobros registrados este día.</p>`}
      </section>`);
  };

  dayInput.addEventListener('change', () => { if (dayInput.value) load(dayInput.value); });
  await load();
}
