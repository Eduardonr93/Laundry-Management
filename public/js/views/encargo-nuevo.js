import { get, post } from '../api.js';
import { navigate } from '../app.js';
import { state } from '../state.js';
import { customerPicker, itemsEditor, methodRadios } from '../components.js';
import { $, centsToInput, html, icon, money, render, toCents, toLocalInput, toast } from '../ui.js';

export async function nuevoEncargoView(el, { query }) {
  const [services, preselected] = await Promise.all([
    get('/services'),
    query.get('cliente') ? get(`/customers/${Number(query.get('cliente'))}`).catch(() => null) : null,
  ]);
  const encargo = services.filter((s) => s.category === 'encargo');
  const defaultDue = new Date(Date.now() + state.settings.default_turnaround_hours * 3600_000);
  defaultDue.setMinutes(0, 0, 0);
  defaultDue.setHours(defaultDue.getHours() + 1);

  render(el, html`
    <header class="page-head">
      <div>
        <a class="back" href="#/encargos">${icon('back')} Encargos</a>
        <h1>Nuevo encargo</h1>
      </div>
    </header>
    <form class="order-form" novalidate>
      <div class="order-main">
        <section class="panel">
          <h2>Cliente</h2>
          <div id="customer"></div>
        </section>
        <section class="panel">
          <h2>Servicios</h2>
          <p class="muted hint">Escribe los kilos de la báscula o el número de piezas.</p>
          <div id="items"></div>
        </section>
      </div>
      <aside class="order-side">
        <section class="panel sticky">
          <h2>Entrega y pago</h2>
          <label class="field">Fecha y hora de entrega
            <input type="datetime-local" name="due_at" value="${toLocalInput(defaultDue.toISOString())}" required>
          </label>
          <label class="field">Notas para el ticket
            <textarea name="notes" rows="3" maxlength="500" placeholder="Ej. mancha en camisa blanca, no usar suavizante"></textarea>
          </label>
          <div class="totals">
            <div class="total-line"><span>Total</span><strong class="num" id="total">${money(0)}</strong></div>
          </div>
          <fieldset class="field">
            <legend>Anticipo (opcional)</legend>
            <div class="money-input"><span>$</span><input name="advance" inputmode="decimal" placeholder="0.00" aria-label="Monto del anticipo"></div>
            <div class="quick">
              <button type="button" class="btn btn-ghost btn-sm" data-advance="half">50%</button>
              <button type="button" class="btn btn-ghost btn-sm" data-advance="full">Pago completo</button>
            </div>
            ${methodRadios('pay_method')}
          </fieldset>
          <div class="total-line balance"><span>Queda a pagar al recoger</span><strong class="num" id="balance">${money(0)}</strong></div>
          <p class="form-error" hidden></p>
          <button class="btn btn-primary btn-block btn-lg" type="submit">Registrar encargo</button>
        </section>
      </aside>
    </form>`);

  const form = $('form', el);
  const errorEl = $('.form-error', el);
  let customer = preselected;
  customerPicker($('#customer', el), { initial: preselected, onChange: (c) => { customer = c; } });

  let editor = null;
  const updateTotals = () => {
    const total = editor ? editor.total() : 0;
    $('#total', el).textContent = money(total);
    const advance = toCents(form.advance.value) || 0;
    $('#balance', el).textContent = money(Math.max(0, total - advance));
  };
  editor = itemsEditor($('#items', el), { services: encargo, onChange: updateTotals });
  form.advance.addEventListener('input', updateTotals);
  el.querySelectorAll('[data-advance]').forEach((b) => b.addEventListener('click', () => {
    const total = editor.total();
    form.advance.value = centsToInput(b.dataset.advance === 'full' ? total : Math.round(total / 2));
    updateTotals();
  }));
  updateTotals();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    const fail = (msg) => { errorEl.textContent = msg; errorEl.hidden = false; };
    if (!customer) return fail('Elige o registra al cliente.');
    const items = editor.items();
    if (!items.length) return fail('Agrega al menos un servicio con su cantidad.');
    const advance = form.advance.value.trim() ? toCents(form.advance.value) : 0;
    if (Number.isNaN(advance) || advance < 0) return fail('El anticipo no es un monto válido.');
    if (advance > editor.total()) return fail('El anticipo no puede ser mayor que el total.');
    if (!form.due_at.value) return fail('Indica la fecha de entrega.');

    const btn = $('button[type=submit]', form);
    btn.disabled = true;
    try {
      const order = await post('/orders/encargo', {
        customer_id: customer.id,
        items,
        due_at: new Date(form.due_at.value).toISOString(),
        notes: form.notes.value,
        payment: advance > 0 ? { amount_cents: advance, method: form.elements.pay_method.value } : null,
      });
      toast(`Encargo ${order.folio} registrado`);
      navigate(`#/pedidos/${order.id}`);
    } catch (err) {
      fail(err.message);
      btn.disabled = false;
    }
  });
}
