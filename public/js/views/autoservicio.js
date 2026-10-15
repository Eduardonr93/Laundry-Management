import { get, post } from '../api.js';
import { customerPicker, methodRadios } from '../components.js';
import {
  $, $$, confirmDialog, countdown, fmtTime, html, icon, money, render, toCents, toast,
} from '../ui.js';

const TYPE_LABEL = { lavadora: 'Lavadoras', secadora: 'Secadoras' };
const STATUS_TEXT = { mantenimiento: 'Mantenimiento', fuera_servicio: 'Fuera de servicio' };

export async function autoservicioView(el) {
  const services = (await get('/services')).filter((s) => s.category === 'autoservicio');
  const cycles = services.filter((s) => s.machine_type);
  const products = services.filter((s) => !s.machine_type);

  let machines = [];
  let skew = 0;
  let cart = []; // { key, service, machine?, qty }
  let customer = null;
  let lastSale = null;
  let refreshing = false;

  render(el, html`
    <header class="page-head">
      <div><h1>Autoservicio</h1><p class="muted">Toca una máquina libre para agregar el ciclo a la venta.</p></div>
    </header>
    <div class="pos">
      <div class="pos-main">
        <div id="machines"></div>
        <section class="panel">
          <h2>Productos</h2>
          <div class="product-grid" id="products">
            ${products.map((p) => html`
              <button type="button" class="product" data-product="${p.id}">
                <span>${p.name}</span><strong class="num">${money(p.price_cents)}</strong>
              </button>`)}
          </div>
        </section>
        <section class="panel">
          <div class="panel-head"><h2>Ventas de hoy</h2></div>
          <div id="sales"></div>
        </section>
      </div>
      <aside class="pos-side">
        <form class="panel sticky cart" novalidate>
          <h2>Venta</h2>
          <div id="cart-lines"></div>
          <div class="total-line big"><span>Total</span><strong class="num" id="cart-total">${money(0)}</strong></div>
          <div class="field">
            <span class="field-label">Cliente</span>
            <div id="sale-customer"></div>
          </div>
          <div class="field"><span class="field-label">Forma de pago</span>${methodRadios('pay_method')}</div>
          <label class="field" id="cash-field">Pago con
            <div class="money-input"><span>$</span><input name="received" inputmode="decimal" placeholder="0.00"></div>
          </label>
          <p class="change" id="change"></p>
          <p class="form-error" hidden></p>
          <button class="btn btn-primary btn-block btn-lg" type="submit" disabled>Cobrar</button>
          <div id="last-sale"></div>
        </form>
      </aside>
    </div>`);

  const form = $('form.cart', el);
  const errorEl = $('.form-error', form);
  customerPicker($('#sale-customer', el), { optional: true, onChange: (c) => { customer = c; } });

  const total = () => cart.reduce((s, l) => s + l.service.price_cents * l.qty, 0);

  function drawMachines() {
    const groups = ['lavadora', 'secadora'].map((type) => [type, machines.filter((m) => m.type === type)]).filter(([, list]) => list.length);
    render($('#machines', el), groups.map(([type, list]) => html`
      <section class="panel">
        <h2>${TYPE_LABEL[type]}</h2>
        <div class="machine-grid">
          ${list.map((m) => {
            const inCart = cart.some((l) => l.machine?.id === m.id);
            const state = m.in_use ? 'busy' : m.status !== 'disponible' ? 'off' : inCart ? 'picked' : 'free';
            return html`
              <div class="machine machine-${state}">
                <div class="machine-head">
                  <span class="machine-icon">${icon('washer')}</span>
                  <div class="machine-name"><strong>${m.name}</strong>${m.capacity_kg ? html`<span class="muted">${m.capacity_kg} kg</span>` : ''}</div>
                </div>
                ${m.in_use ? html`
                  <div class="machine-time num" data-ends="${m.ends_at}">—</div>
                  <div class="machine-meta muted">${m.folio}${m.customer_name ? ` · ${m.customer_name}` : ''} · termina ${fmtTime(m.ends_at)}</div>
                  <button type="button" class="btn btn-ghost btn-sm" data-stop="${m.id}">Liberar ahora</button>`
                : m.status !== 'disponible' ? html`<div class="machine-state">${STATUS_TEXT[m.status]}</div>`
                : inCart ? html`
                  <div class="machine-state">En la venta</div>
                  <button type="button" class="btn btn-ghost btn-sm" data-unpick="${m.id}">Quitar</button>`
                : html`
                  <div class="machine-state">Libre</div>
                  <div class="cycle-buttons">
                    ${cycles.filter((c) => c.machine_type === m.type).map((c) => html`
                      <button type="button" class="btn btn-secondary btn-sm" data-machine="${m.id}" data-cycle="${c.id}">
                        <span>${c.name}</span><span class="num">${money(c.price_cents)}</span></button>`)}
                  </div>`}
              </div>`;
          })}
        </div>
      </section>`));

    $$('[data-cycle]', el).forEach((b) => b.addEventListener('click', () => {
      const machine = machines.find((m) => m.id === Number(b.dataset.machine));
      const service = cycles.find((c) => c.id === Number(b.dataset.cycle));
      cart.push({ key: `m${machine.id}`, service, machine, qty: 1 });
      drawAll();
    }));
    $$('[data-unpick]', el).forEach((b) => b.addEventListener('click', () => {
      cart = cart.filter((l) => l.machine?.id !== Number(b.dataset.unpick));
      drawAll();
    }));
    $$('[data-stop]', el).forEach((b) => b.addEventListener('click', async () => {
      const m = machines.find((x) => x.id === Number(b.dataset.stop));
      const ok = await confirmDialog({
        title: `Liberar ${m.name}`,
        message: 'La máquina quedará disponible aunque no haya terminado su tiempo. Úsalo si el cliente ya sacó su ropa o hubo un error.',
        confirmLabel: 'Liberar máquina',
      });
      if (!ok) return;
      try {
        await post(`/machines/${m.id}/stop`);
        toast(`${m.name} liberada`);
        await loadMachines();
      } catch (err) { toast(err.message, 'bad'); }
    }));
    tick();
  }

  function drawCart() {
    const lines = $('#cart-lines', el);
    if (!cart.length) {
      render(lines, html`<p class="empty-line">Agrega un ciclo o un producto.</p>`);
    } else {
      render(lines, html`<ul class="cart-lines">${cart.map((l) => html`
        <li>
          <span class="grow">${l.service.name}${l.machine ? html`<span class="muted"> · ${l.machine.name}</span>` : ''}</span>
          ${l.machine ? '' : html`
            <span class="stepper">
              <button type="button" data-dec="${l.key}" aria-label="Quitar uno">−</button>
              <span class="num">${l.qty}</span>
              <button type="button" data-inc="${l.key}" aria-label="Agregar uno">+</button>
            </span>`}
          <span class="num">${money(l.service.price_cents * l.qty)}</span>
          <button type="button" class="icon-btn" data-remove="${l.key}" aria-label="Quitar">${icon('x')}</button>
        </li>`)}</ul>`);
    }
    $$('[data-remove]', lines).forEach((b) => b.addEventListener('click', () => { cart = cart.filter((l) => l.key !== b.dataset.remove); drawAll(); }));
    $$('[data-inc]', lines).forEach((b) => b.addEventListener('click', () => { cart.find((l) => l.key === b.dataset.inc).qty += 1; drawAll(); }));
    $$('[data-dec]', lines).forEach((b) => b.addEventListener('click', () => {
      const line = cart.find((l) => l.key === b.dataset.dec);
      line.qty -= 1;
      if (line.qty <= 0) cart = cart.filter((l) => l !== line);
      drawAll();
    }));
    $('#cart-total', el).textContent = money(total());
    $('button[type=submit]', form).disabled = cart.length === 0;
    $('button[type=submit]', form).textContent = cart.length ? `Cobrar ${money(total())}` : 'Cobrar';
    updateChange();
  }

  function updateChange() {
    const cash = form.elements.pay_method.value === 'efectivo';
    $('#cash-field', el).hidden = !cash;
    const received = toCents(form.received.value);
    const t = total();
    $('#change', el).textContent = cash && t > 0 && received >= t ? `Cambio: ${money(received - t)}` : '';
  }

  function drawAll() {
    drawMachines();
    drawCart();
  }

  async function loadMachines() {
    const data = await get('/machines');
    skew = new Date(data.server_now).getTime() - Date.now();
    machines = data.machines;
    // Si una máquina del carrito dejó de estar libre, se quita.
    cart = cart.filter((l) => !l.machine || machines.some((m) => m.id === l.machine.id && !m.in_use && m.status === 'disponible'));
    drawAll();
  }

  async function loadSales() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const sales = (await get('/orders?kind=autoservicio')).filter((o) => new Date(o.created_at) >= today);
    render($('#sales', el), sales.length ? html`
      <div class="table-wrap"><table class="table table-plain">
        <thead><tr><th>Folio</th><th>Hora</th><th>Cliente</th><th class="r">Total</th></tr></thead>
        <tbody>${sales.map((s) => html`
          <tr><td><a class="folio link" href="#/pedidos/${s.id}">${s.folio}</a> ${s.status === 'cancelado' ? html`<span class="chip chip-bad">Cancelada</span>` : ''}</td>
          <td>${fmtTime(s.created_at)}</td><td>${s.customer_name ?? html`<span class="muted">Mostrador</span>`}</td>
          <td class="r num">${money(s.total_cents)}</td></tr>`)}</tbody>
      </table></div>` : html`<p class="empty-line">Todavía no hay ventas hoy.</p>`);
  }

  function tick() {
    const now = Date.now() + skew;
    let finished = false;
    $$('[data-ends]', el).forEach((node) => {
      const left = new Date(node.dataset.ends).getTime() - now;
      node.textContent = countdown(left);
      if (left <= 0) finished = true;
    });
    if (finished && !refreshing) {
      refreshing = true;
      loadMachines().finally(() => { refreshing = false; });
    }
  }

  $$('[data-product]', el).forEach((b) => b.addEventListener('click', () => {
    const service = products.find((p) => p.id === Number(b.dataset.product));
    const line = cart.find((l) => l.key === `p${service.id}`);
    if (line) line.qty += 1;
    else cart.push({ key: `p${service.id}`, service, qty: 1 });
    drawCart();
  }));
  form.addEventListener('input', updateChange);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    if (!cart.length) return;
    const t = total();
    const method = form.elements.pay_method.value;
    const received = toCents(form.received.value);
    if (method === 'efectivo' && form.received.value.trim() && !(received >= t)) {
      errorEl.textContent = `El pago en efectivo (${money(received || 0)}) no cubre el total.`;
      errorEl.hidden = false;
      return;
    }
    const btn = $('button[type=submit]', form);
    btn.disabled = true;
    try {
      const sale = await post('/sales', {
        customer_id: customer?.id ?? null,
        payment_method: method,
        items: cart.map((l) => (l.machine
          ? { service_id: l.service.id, machine_id: l.machine.id }
          : { service_id: l.service.id, quantity: l.qty })),
      });
      const started = cart.filter((l) => l.machine).map((l) => l.machine.name);
      const change = method === 'efectivo' && received > t ? received - t : 0;
      lastSale = { ...sale, change };
      toast(`Venta ${sale.folio} cobrada${started.length ? `. En marcha: ${started.join(', ')}` : ''}`);
      cart = [];
      form.received.value = '';
      render($('#last-sale', el), html`
        <div class="last-sale">
          <span>Última venta <strong>${lastSale.folio}</strong> · ${money(lastSale.total_cents)}${change ? html` · cambio <strong>${money(change)}</strong>` : ''}</span>
          <a class="link" href="#/ticket/${lastSale.id}">Ticket</a>
        </div>`);
      await Promise.all([loadMachines(), loadSales()]);
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
      await loadMachines();
    } finally {
      btn.disabled = cart.length === 0;
    }
  });

  await Promise.all([loadMachines(), loadSales()]);
  const ticker = setInterval(tick, 1000);
  const poll = setInterval(() => { loadMachines().catch(() => {}); }, 20_000);
  return () => { clearInterval(ticker); clearInterval(poll); };
}
