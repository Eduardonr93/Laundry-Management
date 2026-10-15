// Componentes reutilizables: buscador de clientes y editor de partidas de encargo.
import { get, post } from './api.js';
import { $, $$, debounce, html, icon, money, openDialog, render, raw } from './ui.js';

export function customerFormBody(c = {}) {
  return html`
    <div class="grid-2">
      <label class="field span-2">Nombre <input name="name" required maxlength="100" value="${c.name ?? ''}" autocomplete="off"></label>
      <label class="field">Teléfono (WhatsApp) <input name="phone" type="tel" maxlength="30" value="${c.phone ?? ''}" placeholder="998 123 4567"></label>
      <label class="field">Correo <input name="email" type="email" maxlength="120" value="${c.email ?? ''}"></label>
      <label class="field span-2">Dirección <input name="address" maxlength="200" value="${c.address ?? ''}"></label>
      <label class="field span-2">Notas <textarea name="notes" rows="2" maxlength="500" placeholder="Ej. prefiere suavizante sin aroma">${c.notes ?? ''}</textarea></label>
    </div>`;
}

export function newCustomerDialog(prefill = {}) {
  return new Promise((resolve) => {
    let created = null;
    const { dialog } = openDialog({
      title: 'Nuevo cliente',
      body: customerFormBody(prefill),
      submitLabel: 'Guardar cliente',
      onSubmit: async (values) => { created = await post('/customers', values); },
    });
    dialog.addEventListener('close', () => resolve(created));
  });
}

/**
 * Buscador de clientes con alta rápida.
 * onChange(cliente | null) se llama al elegir o quitar.
 */
export function customerPicker(el, { onChange, initial = null, optional = false }) {
  let selected = initial;

  const show = () => {
    if (selected) {
      render(el, html`
        <div class="picked">
          <div>
            <strong>${selected.name}</strong>
            <span class="muted">${selected.phone || 'Sin teléfono'}</span>
          </div>
          <button type="button" class="btn btn-ghost btn-sm" data-change>Cambiar</button>
        </div>`);
      $('[data-change]', el).addEventListener('click', () => { selected = null; onChange(null); show(); $('input', el).focus(); });
      return;
    }
    render(el, html`
      <div class="picker">
        <div class="search">
          ${icon('search')}
          <input type="search" placeholder="Buscar por nombre o teléfono${optional ? ' (opcional)' : ''}"
                 aria-label="Buscar cliente" autocomplete="off">
        </div>
        <ul class="picker-results" hidden></ul>
        <button type="button" class="btn btn-ghost btn-sm" data-new>${icon('plus')} Cliente nuevo</button>
      </div>`);
    const input = $('input', el);
    const list = $('.picker-results', el);

    const search = debounce(async () => {
      const q = input.value.trim();
      if (q.length < 2) { list.hidden = true; return; }
      const results = await get(`/customers?q=${encodeURIComponent(q)}`);
      list.hidden = false;
      render(list, results.length
        ? results.slice(0, 8).map((c) => html`
            <li><button type="button" data-id="${c.id}"><strong>${c.name}</strong><span class="muted">${c.phone}</span></button></li>`)
        : html`<li class="muted picker-none">Sin resultados. Usa “Cliente nuevo”.</li>`);
      $$('button[data-id]', list).forEach((b) => b.addEventListener('click', () => {
        selected = results.find((c) => c.id === Number(b.dataset.id));
        onChange(selected);
        show();
      }));
    }, 200);

    input.addEventListener('input', search);
    $('[data-new]', el).addEventListener('click', async () => {
      const q = input.value.trim();
      const prefill = /\d{3}/.test(q) ? { phone: q } : { name: q };
      const created = await newCustomerDialog(prefill);
      if (created) { selected = created; onChange(created); show(); }
    });
  };

  show();
  return { get: () => selected };
}

// ---------- Partidas de encargo ----------

const unitText = (s) => (s.unit === 'kg' ? 'kg' : 'pieza');

/** Importe que calcula el servidor: aplica el mínimo del servicio. */
export function lineAmount(service, qty) {
  if (!qty || qty <= 0) return 0;
  return Math.round(service.price_cents * Math.max(qty, service.min_qty || 0));
}

/**
 * Lista de servicios de encargo con su cantidad.
 * initial: { [service_id]: cantidad }
 */
export function itemsEditor(el, { services, initial = {}, onChange }) {
  render(el, html`
    <div class="items-editor">
      ${services.map((s) => html`
        <div class="item-row" data-id="${s.id}">
          <div class="item-name">
            <strong>${s.name}</strong>
            <span class="muted">${money(s.price_cents)} / ${unitText(s)}${s.min_qty > 0 ? ` · mínimo ${s.min_qty} ${unitText(s)}` : ''}</span>
          </div>
          <label class="qty">
            <span class="sr-only">Cantidad de ${s.name}</span>
            <input type="number" inputmode="decimal" min="0" step="${s.unit === 'kg' ? '0.1' : '1'}"
                   value="${initial[s.id] ?? ''}" placeholder="0">
            <span class="qty-unit">${s.unit === 'kg' ? 'kg' : 'pzs'}</span>
          </label>
          <span class="item-amount num">—</span>
        </div>`)}
    </div>`);

  const read = () => $$('.item-row', el).map((row) => {
    const service = services.find((s) => s.id === Number(row.dataset.id));
    const qty = Number($('input', row).value);
    return { row, service, qty: Number.isFinite(qty) && qty > 0 ? qty : 0 };
  });

  const update = () => {
    let total = 0;
    for (const { row, service, qty } of read()) {
      const amount = lineAmount(service, qty);
      total += amount;
      row.classList.toggle('selected', qty > 0);
      $('.item-amount', row).textContent = qty > 0 ? money(amount) : '—';
      const minApplied = qty > 0 && service.min_qty > qty;
      $('.item-amount', row).title = minApplied ? `Se cobra el mínimo de ${service.min_qty} ${unitText(service)}` : '';
      row.classList.toggle('min-applied', minApplied);
    }
    onChange?.(total);
  };

  $$('input', el).forEach((input) => input.addEventListener('input', update));
  update();

  return {
    items: () => read().filter((x) => x.qty > 0).map((x) => ({
      service_id: x.service.id,
      quantity: x.service.unit === 'kg' ? Math.round(x.qty * 100) / 100 : Math.round(x.qty),
    })),
    total: () => read().reduce((s, x) => s + lineAmount(x.service, x.qty), 0),
  };
}

export const methodRadios = (name, selected = 'efectivo') => html`
  <div class="segmented" role="radiogroup" aria-label="Forma de pago">
    ${[['efectivo', 'Efectivo'], ['tarjeta', 'Tarjeta'], ['transferencia', 'Transferencia']].map(([v, l]) => html`
      <label><input type="radio" name="${name}" value="${v}" ${v === selected ? raw('checked') : ''}><span>${l}</span></label>`)}
  </div>`;
