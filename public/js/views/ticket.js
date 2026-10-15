import { get } from '../api.js';
import { state } from '../state.js';
import { $, METHOD_LABEL, fmtDateTime, fmtQty, html, icon, money, render } from '../ui.js';

export async function ticketView(el, { params }) {
  const o = await get(`/orders/${Number(params[0])}`);
  const s = state.settings;
  const isEncargo = o.kind === 'encargo';
  const payments = o.payments.filter((p) => p.kind === 'pago');
  // Un pago registrado al recibir el encargo es el anticipo.
  const payLabel = (p) => {
    if (!isEncargo) return 'Pagado';
    if (new Date(p.created_at) - new Date(o.created_at) < 60_000) return 'Anticipo';
    return o.delivered_at && p.created_at >= o.delivered_at.slice(0, 16) ? 'Pago al entregar' : 'Abono';
  };

  render(el, html`
    <div class="ticket-page">
      <div class="ticket-tools no-print">
        <a class="btn btn-ghost" href="#/pedidos/${o.id}">${icon('back')} Volver</a>
        <button type="button" class="btn btn-primary" id="print">${icon('print')} Imprimir</button>
      </div>
      <article class="ticket">
        <header>
          <h1>${s.business_name}</h1>
          ${s.business_address ? html`<p>${s.business_address}</p>` : ''}
          ${s.business_phone ? html`<p>Tel. ${s.business_phone}</p>` : ''}
        </header>
        <div class="ticket-folio">${isEncargo ? 'ENCARGO' : 'AUTOSERVICIO'}<strong>${o.folio}</strong></div>
        ${o.status === 'cancelado' ? html`<p class="ticket-cancel">CANCELADO</p>` : ''}
        <dl>
          <dt>Fecha</dt><dd>${fmtDateTime(o.created_at)}</dd>
          ${o.customer ? html`<dt>Cliente</dt><dd>${o.customer.name}</dd>` : ''}
          ${o.customer?.phone ? html`<dt>Tel.</dt><dd>${o.customer.phone}</dd>` : ''}
          ${isEncargo ? html`<dt>Entrega</dt><dd><strong>${fmtDateTime(o.due_at)}</strong></dd>` : ''}
        </dl>
        <table>
          ${o.items.map((it) => html`
            <tr><td>${it.description}${it.unit !== 'servicio' ? html`<br><small>${fmtQty(it.quantity, it.unit)} × ${money(it.unit_price_cents)}</small>` : ''}</td>
            <td class="r">${money(it.amount_cents)}</td></tr>`)}
        </table>
        <dl class="ticket-totals">
          <dt>TOTAL</dt><dd>${money(o.total_cents)}</dd>
          ${payments.map((p) => html`<dt>${payLabel(p)} (${METHOD_LABEL[p.method]})</dt><dd>${money(p.amount_cents)}</dd>`)}
          ${isEncargo && o.status !== 'cancelado' ? html`<dt>SALDO</dt><dd><strong>${money(o.balance_cents)}</strong></dd>` : ''}
        </dl>
        ${o.machine_uses.length ? html`<p class="ticket-note">${o.machine_uses.map((u) => html`${u.machine_name}: termina ${fmtDateTime(u.ends_at)}<br>`)}</p>` : ''}
        ${o.notes ? html`<p class="ticket-note">Notas: ${o.notes}</p>` : ''}
        ${isEncargo ? html`<p class="ticket-note">Presente este ticket para recoger su ropa.</p>` : ''}
        ${s.ticket_footer ? html`<footer>${s.ticket_footer}</footer>` : ''}
      </article>
    </div>`);

  $('#print', el).addEventListener('click', () => window.print());
}
