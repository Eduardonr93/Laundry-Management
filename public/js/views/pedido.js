import { get, post, put } from '../api.js';
import { state, isAdmin } from '../state.js';
import { itemsEditor, methodRadios } from '../components.js';
import {
  $, METHOD_LABEL, STATUS, centsToInput, fmtDateTime, fmtQty, html, icon, money, openDialog,
  render, statusChip, toCents, toLocalInput, toast, waLink,
} from '../ui.js';

const STEPS = ['recibido', 'en_proceso', 'listo', 'entregado'];

const NEXT_ACTION = {
  recibido: { status: 'en_proceso', label: 'Empezar a lavar' },
  en_proceso: { status: 'listo', label: 'Marcar como listo' },
};
const PREV_ACTION = {
  en_proceso: { status: 'recibido', label: 'Regresar a Recibido' },
  listo: { status: 'en_proceso', label: 'Regresar a En proceso' },
};

function readyMessage(o) {
  const name = o.customer_name?.split(' ')[0] ?? '';
  const owed = o.balance_cents > 0 ? ` Saldo a pagar: ${money(o.balance_cents)}.` : ' Ya está pagado.';
  return `Hola ${name}, tu ropa del folio ${o.folio} ya está lista para recoger en ${state.settings.business_name}.${owed} ¡Te esperamos!`;
}

export async function pedidoView(el, { params }) {
  const orderId = Number(params[0]);
  let order = await get(`/orders/${orderId}`);
  let editing = false;

  const act = async (fn, okMsg) => {
    try {
      order = await fn();
      if (okMsg) toast(okMsg);
      draw();
    } catch (err) {
      toast(err.message, 'bad');
    }
  };

  const payDialog = () => openDialog({
    title: 'Registrar pago',
    body: html`
      <p>Saldo pendiente: <strong class="num">${money(order.balance_cents)}</strong></p>
      <label class="field">Monto
        <div class="money-input"><span>$</span><input name="amount" inputmode="decimal" value="${centsToInput(order.balance_cents)}" required></div>
      </label>
      ${methodRadios('pay_method')}`,
    submitLabel: 'Registrar pago',
    onSubmit: async (v) => {
      const amount = toCents(v.amount);
      if (!(amount > 0)) throw new Error('Escribe un monto válido');
      order = await post(`/orders/${order.id}/payments`, { amount_cents: amount, method: v.pay_method });
      toast('Pago registrado');
      draw();
    },
  });

  const deliverDialog = () => openDialog({
    title: `Entregar ${order.folio}`,
    body: order.balance_cents > 0
      ? html`
        <p>Antes de entregar, cobra el saldo.</p>
        <div class="big-amount num">${money(order.balance_cents)}</div>
        ${methodRadios('pay_method')}
        <label class="field" id="cash-field">Pago con (para calcular el cambio)
          <div class="money-input"><span>$</span><input name="received" inputmode="decimal" placeholder="${centsToInput(order.balance_cents)}"></div>
        </label>
        <p class="change muted" id="change"></p>`
      : html`<p>El encargo está pagado. Confirma que el cliente recibió su ropa.</p>`,
    submitLabel: order.balance_cents > 0 ? 'Cobrar y entregar' : 'Entregar',
    onOpen: (dlg) => {
      const form = $('form', dlg);
      const changeEl = $('#change', dlg);
      if (!changeEl) return;
      const update = () => {
        $('#cash-field', dlg).hidden = form.elements.pay_method.value !== 'efectivo';
        const received = toCents(form.received.value);
        changeEl.textContent = received >= order.balance_cents ? `Cambio: ${money(received - order.balance_cents)}` : '';
      };
      form.addEventListener('input', update);
      update();
    },
    onSubmit: async (v) => {
      const body = order.balance_cents > 0 ? { payment: { amount_cents: order.balance_cents, method: v.pay_method } } : {};
      order = await post(`/orders/${order.id}/deliver`, body);
      toast(`${order.folio} entregado`);
      draw();
    },
  });

  const infoDialog = () => openDialog({
    title: 'Fecha de entrega y notas',
    body: html`
      <label class="field">Fecha y hora de entrega
        <input type="datetime-local" name="due_at" value="${order.due_at ? toLocalInput(order.due_at) : ''}" required>
      </label>
      <label class="field">Notas <textarea name="notes" rows="3" maxlength="500">${order.notes}</textarea></label>`,
    onSubmit: async (v) => {
      order = await put(`/orders/${order.id}`, { due_at: new Date(v.due_at).toISOString(), notes: v.notes });
      toast('Datos actualizados');
      draw();
    },
  });

  const cancelDialog = () => openDialog({
    title: `Cancelar ${order.folio}`,
    tone: 'danger',
    submitLabel: 'Cancelar pedido',
    body: html`
      <label class="field">Motivo <input name="reason" required maxlength="300" placeholder="Ej. el cliente ya no quiso el servicio"></label>
      ${order.paid_cents > 0 ? html`
        <p>Se registrará un reembolso de <strong>${money(order.paid_cents)}</strong>. ¿Cómo se devuelve?</p>
        ${methodRadios('refund_method')}` : ''}
      ${order.kind === 'autoservicio' ? html`<p class="muted">Las máquinas de esta venta quedarán libres.</p>` : ''}`,
    onSubmit: async (v) => {
      if (!v.reason?.trim()) throw new Error('Escribe el motivo de la cancelación');
      order = await post(`/orders/${order.id}/cancel`, { reason: v.reason, refund_method: v.refund_method });
      toast(`${order.folio} cancelado`, 'warn');
      draw();
    },
  });

  function draw() {
    const o = order;
    const isEncargo = o.kind === 'encargo';
    const closed = ['entregado', 'cancelado', 'completado'].includes(o.status);
    const editable = isEncargo && ['recibido', 'en_proceso'].includes(o.status);
    const next = NEXT_ACTION[o.status];
    const prev = PREV_ACTION[o.status];
    const wa = o.customer?.phone ? waLink(o.customer.phone, readyMessage(o)) : null;
    const late = editable && o.due_at && o.due_at < new Date().toISOString();

    render(el, html`
      <header class="page-head">
        <div>
          <a class="back" href="${isEncargo ? '#/encargos' : '#/autoservicio'}">${icon('back')} ${isEncargo ? 'Encargos' : 'Autoservicio'}</a>
          <h1 class="order-title"><span class="folio">${o.folio}</span> ${statusChip(o.status)} ${late ? html`<span class="chip chip-bad">Atrasado</span>` : ''}</h1>
          <p class="muted">${isEncargo ? 'Encargo' : 'Venta de autoservicio'} · ${fmtDateTime(o.created_at)}</p>
        </div>
        <div class="actions">
          <a class="btn btn-ghost" href="#/ticket/${o.id}">${icon('print')} Ticket</a>
          ${isAdmin() && !['cancelado', 'entregado'].includes(o.status) ? html`<button type="button" class="btn btn-ghost danger-text" data-act="cancel">Cancelar</button>` : ''}
        </div>
      </header>

      ${isEncargo && o.status !== 'cancelado' ? html`
        <ol class="steps">
          ${STEPS.map((s, i) => html`<li class="${STEPS.indexOf(o.status) > i ? 'done' : STEPS.indexOf(o.status) === i ? 'current' : ''}">${STATUS[s].label}</li>`)}
        </ol>` : ''}

      ${o.status === 'cancelado' ? html`<div class="notice notice-bad">Cancelado el ${fmtDateTime(o.cancelled_at)}: ${o.cancel_reason}</div>` : ''}

      ${isEncargo && !closed ? html`
        <div class="action-bar">
          ${next ? html`<button type="button" class="btn btn-primary btn-lg" data-act="next">${next.label}</button>` : ''}
          ${o.status === 'listo' ? html`<button type="button" class="btn btn-primary btn-lg" data-act="deliver">${o.balance_cents > 0 ? `Cobrar ${money(o.balance_cents)} y entregar` : 'Entregar al cliente'}</button>` : ''}
          ${o.status === 'listo' && wa ? html`<a class="btn btn-whatsapp" href="${wa}" target="_blank" rel="noopener">${icon('chat')} Avisar por WhatsApp</a>` : ''}
          ${o.balance_cents > 0 && o.status !== 'listo' ? html`<button type="button" class="btn btn-secondary" data-act="pay">Registrar pago</button>` : ''}
          ${prev ? html`<button type="button" class="btn btn-link" data-act="prev">${prev.label}</button>` : ''}
        </div>` : ''}

      <div class="columns columns-detail">
        <section class="panel">
          <div class="panel-head">
            <h2>Servicios</h2>
            ${editable && !editing ? html`<button type="button" class="btn btn-ghost btn-sm" data-act="edit">Corregir servicios</button>` : ''}
          </div>
          <div id="items-area">
            ${editing ? '' : html`
              <table class="table table-plain">
                <thead><tr><th>Concepto</th><th class="r">Cantidad</th><th class="r">Precio</th><th class="r">Importe</th></tr></thead>
                <tbody>${o.items.map((it) => html`
                  <tr><td>${it.description}</td><td class="r num">${it.unit === 'servicio' ? '1' : fmtQty(it.quantity, it.unit)}</td>
                  <td class="r num">${money(it.unit_price_cents)}</td><td class="r num">${money(it.amount_cents)}</td></tr>`)}
                </tbody>
              </table>`}
          </div>
          <div class="totals">
            <div class="total-line"><span>Total</span><strong class="num">${money(o.total_cents)}</strong></div>
            <div class="total-line"><span>Pagado</span><span class="num">${money(o.paid_cents)}</span></div>
            ${o.status !== 'cancelado' ? html`<div class="total-line balance ${o.balance_cents > 0 ? 'owed' : ''}"><span>Saldo</span><strong class="num">${money(o.balance_cents)}</strong></div>` : ''}
          </div>
          ${o.machine_uses.length ? html`
            <h3 class="subhead">Máquinas</h3>
            <ul class="plain-list">${o.machine_uses.map((u) => html`
              <li>${u.machine_name}: de ${fmtDateTime(u.started_at)} a ${fmtDateTime(u.stopped_at && u.stopped_at < u.ends_at ? u.stopped_at : u.ends_at)}
              ${u.stopped_at && u.stopped_at < u.ends_at ? html`<span class="muted">(liberada antes)</span>` : ''}</li>`)}</ul>` : ''}
        </section>

        <div class="stack">
          ${o.customer ? html`
            <section class="panel">
              <h2>Cliente</h2>
              <p><a class="link strong" href="#/clientes/${o.customer.id}">${o.customer.name}</a></p>
              ${o.customer.phone ? html`<p class="muted">${o.customer.phone}</p>` : ''}
              ${o.customer.notes ? html`<p class="note">${o.customer.notes}</p>` : ''}
            </section>` : ''}
          ${isEncargo ? html`
            <section class="panel">
              <div class="panel-head"><h2>Entrega</h2>${editable ? html`<button type="button" class="btn btn-ghost btn-sm" data-act="info">Cambiar</button>` : ''}</div>
              <dl class="facts">
                <dt>Prometido para</dt><dd>${fmtDateTime(o.due_at)}</dd>
                ${o.delivered_at ? html`<dt>Entregado</dt><dd>${fmtDateTime(o.delivered_at)}</dd>` : ''}
              </dl>
              ${o.notes ? html`<p class="note">${o.notes}</p>` : ''}
            </section>` : ''}
          <section class="panel">
            <h2>Pagos</h2>
            ${o.payments.length ? html`<ul class="plain-list">${o.payments.map((p) => html`
              <li class="pay-row"><span>${p.kind === 'reembolso' ? 'Reembolso' : METHOD_LABEL[p.method]}<span class="muted"> · ${fmtDateTime(p.created_at)}</span></span>
              <span class="num ${p.amount_cents < 0 ? 'danger-text' : ''}">${money(p.amount_cents)}</span></li>`)}</ul>`
              : html`<p class="empty-line">Sin pagos todavía.</p>`}
          </section>
          <section class="panel">
            <h2>Historial</h2>
            <ol class="timeline">${o.events.map((e) => html`
              <li><span><strong>${e.event}</strong>${e.detail ? html` · ${e.detail}` : ''}</span><span class="muted">${fmtDateTime(e.created_at)} · ${e.user_name ?? ''}</span></li>`)}</ol>
          </section>
        </div>
      </div>`);

    const on = (name, fn) => el.querySelector(`[data-act="${name}"]`)?.addEventListener('click', fn);
    on('next', () => act(() => post(`/orders/${o.id}/status`, { status: next.status }), `${o.folio}: ${STATUS[next.status].label}`));
    on('prev', () => act(() => post(`/orders/${o.id}/status`, { status: prev.status })));
    on('pay', payDialog);
    on('deliver', deliverDialog);
    on('info', infoDialog);
    on('cancel', cancelDialog);
    on('edit', startEditing);
  }

  async function startEditing() {
    editing = true;
    draw();
    const services = (await get('/services')).filter((s) => s.category === 'encargo');
    const initial = {};
    for (const it of order.items) if (it.service_id) initial[it.service_id] = (initial[it.service_id] ?? 0) + it.quantity;
    const area = $('#items-area', el);
    const wrap = document.createElement('div');
    const editorEl = document.createElement('div');
    wrap.append(editorEl);
    area.append(wrap);
    const editor = itemsEditor(editorEl, { services, initial });
    const bar = document.createElement('div');
    bar.className = 'edit-bar';
    render(bar, html`<button type="button" class="btn btn-ghost" data-x="cancel">Descartar</button>
      <button type="button" class="btn btn-primary" data-x="save">Guardar cambios</button>`);
    wrap.append(bar);
    $('[data-x=cancel]', bar).addEventListener('click', () => { editing = false; draw(); });
    $('[data-x=save]', bar).addEventListener('click', async () => {
      const items = editor.items();
      if (!items.length) return toast('Deja al menos un servicio', 'bad');
      editing = false;
      await act(() => put(`/orders/${order.id}`, { items }), 'Servicios actualizados');
    });
  }

  draw();
}
