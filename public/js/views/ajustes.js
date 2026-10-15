import { get, post, put } from '../api.js';
import { refreshSettings } from '../app.js';
import { state } from '../state.js';
import {
  $, $$, centsToInput, html, icon, money, openDialog, options, raw, render, toCents, toast,
} from '../ui.js';

const TABS = [
  ['negocio', 'Negocio'],
  ['servicios', 'Servicios y precios'],
  ['maquinas', 'Máquinas'],
  ['usuarios', 'Usuarios'],
];

export async function ajustesView(el, { params }) {
  const tab = TABS.some(([t]) => t === params[0]) ? params[0] : 'negocio';
  render(el, html`
    <header class="page-head"><div><h1>Ajustes</h1></div></header>
    <nav class="tabs tabs-links" aria-label="Ajustes">
      ${TABS.map(([t, label]) => html`<a href="#/ajustes/${t}" ${t === tab ? raw('aria-current="page"') : ''}>${label}</a>`)}
    </nav>
    <div id="tab"></div>`);
  const target = $('#tab', el);
  await { negocio, servicios, maquinas, usuarios }[tab](target);
}

const checked = (v) => (v ? raw('checked') : '');

// ---------- Negocio ----------

async function negocio(el) {
  const s = state.settings;
  render(el, html`
    <form class="panel form-narrow" novalidate>
      <h2>Datos del negocio</h2>
      <p class="muted">Aparecen en el ticket y en los mensajes de WhatsApp.</p>
      <label class="field">Nombre <input name="business_name" required maxlength="80" value="${s.business_name}"></label>
      <label class="field">Dirección <input name="business_address" maxlength="200" value="${s.business_address}"></label>
      <label class="field">Teléfono <input name="business_phone" maxlength="40" value="${s.business_phone}"></label>
      <label class="field">Leyenda al pie del ticket <textarea name="ticket_footer" rows="3" maxlength="400">${s.ticket_footer}</textarea></label>
      <label class="field">Tiempo normal de entrega de un encargo (horas)
        <input name="default_turnaround_hours" type="number" min="1" max="720" value="${s.default_turnaround_hours}">
      </label>
      <p class="form-error" hidden></p>
      <button class="btn btn-primary" type="submit">Guardar</button>
    </form>`);
  const form = $('form', el);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('.form-error', el);
    err.hidden = true;
    try {
      const values = Object.fromEntries(new FormData(form));
      await put('/settings', { ...values, default_turnaround_hours: Number(values.default_turnaround_hours) });
      await refreshSettings();
      $('.brand-name').textContent = state.settings.business_name;
      toast('Datos del negocio guardados');
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    }
  });
}

// ---------- Servicios ----------

const UNIT_TEXT = { kg: 'por kilo', pieza: 'por pieza', servicio: 'por ciclo' };

function serviceDialog(service, onSaved) {
  const s = service ?? { category: 'encargo', unit: 'kg', price_cents: 0, min_qty: 0, active: 1, sort: 0 };
  openDialog({
    title: service ? `Editar “${service.name}”` : 'Nuevo servicio',
    body: html`
      <div class="grid-2">
        <label class="field span-2">Nombre <input name="name" required maxlength="80" value="${s.name ?? ''}"></label>
        <label class="field">Tipo
          <select name="category">${options([['encargo', 'Encargo (dejar y recoger)'], ['autoservicio', 'Autoservicio']], s.category)}</select>
        </label>
        <label class="field" data-show="autoservicio">Se usa en
          <select name="machine_type">${options([['', 'Ninguna máquina (producto)'], ['lavadora', 'Lavadora'], ['secadora', 'Secadora']], s.machine_type ?? '')}</select>
        </label>
        <label class="field" data-show="unit">Se cobra
          <select name="unit">${options([['kg', 'Por kilo'], ['pieza', 'Por pieza']], s.unit === 'servicio' ? 'pieza' : s.unit)}</select>
        </label>
        <label class="field">Precio
          <div class="money-input"><span>$</span><input name="price" inputmode="decimal" required value="${centsToInput(s.price_cents)}"></div>
        </label>
        <label class="field" data-show="min">Cantidad mínima a cobrar
          <input name="min_qty" type="number" min="0" step="0.5" value="${s.min_qty || 0}">
        </label>
        <label class="field" data-show="cycle">Duración del ciclo (minutos)
          <input name="cycle_minutes" type="number" min="1" max="240" value="${s.cycle_minutes ?? 35}">
        </label>
        <label class="field">Orden en la lista <input name="sort" type="number" min="0" value="${s.sort ?? 0}"></label>
        <label class="check span-2"><input type="checkbox" name="active" ${checked(s.active)}> Disponible para vender</label>
      </div>`,
    onOpen: (dlg) => {
      const form = $('form', dlg);
      const sync = () => {
        const auto = form.category.value === 'autoservicio';
        const machine = auto && form.machine_type.value;
        $('[data-show=autoservicio]', dlg).hidden = !auto;
        $('[data-show=unit]', dlg).hidden = Boolean(machine);
        $('[data-show=min]', dlg).hidden = Boolean(machine);
        $('[data-show=cycle]', dlg).hidden = !machine;
      };
      form.addEventListener('change', sync);
      sync();
    },
    onSubmit: async (v) => {
      const price = toCents(v.price);
      if (!(price >= 0)) throw new Error('Escribe un precio válido');
      const machineType = v.category === 'autoservicio' && v.machine_type ? v.machine_type : null;
      const body = {
        name: v.name,
        category: v.category,
        unit: machineType ? 'servicio' : v.unit,
        price_cents: price,
        min_qty: machineType ? 0 : Number(v.min_qty || 0),
        machine_type: machineType,
        cycle_minutes: machineType ? Number(v.cycle_minutes) : null,
        sort: Number(v.sort || 0),
        active: v.active ? 1 : 0,
      };
      if (service) await put(`/services/${service.id}`, body);
      else await post('/services', body);
      toast('Servicio guardado');
      onSaved();
    },
  });
}

async function servicios(el) {
  const load = async () => {
    const list = await get('/services?all=1');
    const section = (title, items) => html`
      <section class="panel">
        <h2>${title}</h2>
        <div class="table-wrap"><table class="table table-plain">
          <thead><tr><th>Servicio</th><th>Cobro</th><th class="r">Precio</th><th>Estado</th><th></th></tr></thead>
          <tbody>${items.map((s) => html`
            <tr class="${s.active ? '' : 'inactive'}">
              <td><strong>${s.name}</strong></td>
              <td>${s.machine_type ? `Ciclo de ${s.machine_type} · ${s.cycle_minutes} min` : UNIT_TEXT[s.unit]}${s.min_qty > 0 ? ` · mínimo ${s.min_qty}` : ''}</td>
              <td class="r num">${money(s.price_cents)}</td>
              <td>${s.active ? html`<span class="chip chip-ok">Activo</span>` : html`<span class="chip chip-muted">Oculto</span>`}</td>
              <td class="r"><button type="button" class="btn btn-ghost btn-sm" data-edit="${s.id}">Editar</button></td>
            </tr>`)}</tbody>
        </table></div>
      </section>`;
    render(el, html`
      <div class="toolbar"><p class="muted">Los cambios de precio aplican a los pedidos nuevos; los ya registrados conservan su precio.</p>
        <button type="button" class="btn btn-primary" id="add">${icon('plus')} Nuevo servicio</button></div>
      ${section('Encargo', list.filter((s) => s.category === 'encargo'))}
      ${section('Autoservicio', list.filter((s) => s.category === 'autoservicio'))}`);
    $('#add', el).addEventListener('click', () => serviceDialog(null, load));
    $$('[data-edit]', el).forEach((b) => b.addEventListener('click', () => serviceDialog(list.find((s) => s.id === Number(b.dataset.edit)), load)));
  };
  await load();
}

// ---------- Máquinas ----------

const MACHINE_STATUS = { disponible: 'Disponible', mantenimiento: 'Mantenimiento', fuera_servicio: 'Fuera de servicio' };

function machineDialog(machine, onSaved) {
  const m = machine ?? { type: 'lavadora', status: 'disponible', active: 1, sort: 0 };
  openDialog({
    title: machine ? `Editar ${machine.name}` : 'Nueva máquina',
    body: html`
      <div class="grid-2">
        <label class="field">Nombre <input name="name" required maxlength="40" value="${m.name ?? ''}" placeholder="Lavadora 5"></label>
        <label class="field">Tipo <select name="type">${options([['lavadora', 'Lavadora'], ['secadora', 'Secadora']], m.type)}</select></label>
        <label class="field">Capacidad (kg) <input name="capacity_kg" type="number" min="1" step="0.5" value="${m.capacity_kg ?? ''}"></label>
        <label class="field">Estado <select name="status">${options(Object.entries(MACHINE_STATUS), m.status)}</select></label>
        <label class="field">Orden <input name="sort" type="number" min="0" value="${m.sort ?? 0}"></label>
        <label class="check"><input type="checkbox" name="active" ${checked(m.active)}> Mostrar en autoservicio</label>
      </div>`,
    onSubmit: async (v) => {
      const body = {
        name: v.name, type: v.type, status: v.status, sort: Number(v.sort || 0), active: v.active ? 1 : 0,
        capacity_kg: v.capacity_kg ? Number(v.capacity_kg) : null,
      };
      if (machine) await put(`/machines/${machine.id}`, body);
      else await post('/machines', body);
      toast('Máquina guardada');
      onSaved();
    },
  });
}

async function maquinas(el) {
  const load = async () => {
    const { machines } = await get('/machines?all=1');
    render(el, html`
      <div class="toolbar"><p class="muted">Pon una máquina en mantenimiento para que no se pueda vender un ciclo en ella.</p>
        <button type="button" class="btn btn-primary" id="add">${icon('plus')} Nueva máquina</button></div>
      <section class="panel"><div class="table-wrap"><table class="table table-plain">
        <thead><tr><th>Máquina</th><th>Tipo</th><th class="r">Capacidad</th><th>Estado</th><th></th></tr></thead>
        <tbody>${machines.map((m) => html`
          <tr class="${m.active ? '' : 'inactive'}">
            <td><strong>${m.name}</strong></td><td>${m.type === 'lavadora' ? 'Lavadora' : 'Secadora'}</td>
            <td class="r num">${m.capacity_kg ? `${m.capacity_kg} kg` : '—'}</td>
            <td>${!m.active ? html`<span class="chip chip-muted">Oculta</span>`
              : m.in_use ? html`<span class="chip chip-info">En uso</span>`
              : html`<span class="chip ${m.status === 'disponible' ? 'chip-ok' : m.status === 'mantenimiento' ? 'chip-warn' : 'chip-bad'}">${MACHINE_STATUS[m.status]}</span>`}</td>
            <td class="r"><button type="button" class="btn btn-ghost btn-sm" data-edit="${m.id}">Editar</button></td>
          </tr>`)}</tbody>
      </table></div></section>`);
    $('#add', el).addEventListener('click', () => machineDialog(null, load));
    $$('[data-edit]', el).forEach((b) => b.addEventListener('click', () => machineDialog(machines.find((m) => m.id === Number(b.dataset.edit)), load)));
  };
  await load();
}

// ---------- Usuarios ----------

function userDialog(user, onSaved) {
  const u = user ?? { role: 'empleado', active: 1 };
  openDialog({
    title: user ? `Editar ${user.name}` : 'Nuevo usuario',
    body: html`
      <div class="grid-2">
        <label class="field span-2">Nombre <input name="name" required maxlength="80" value="${u.name ?? ''}"></label>
        <label class="field">Usuario para entrar
          <input name="username" required maxlength="40" autocapitalize="none" value="${u.username ?? ''}" ${user ? raw('disabled') : ''}>
        </label>
        <label class="field">Rol <select name="role">${options([['empleado', 'Mostrador'], ['admin', 'Administrador']], u.role)}</select></label>
        <label class="field span-2">${user ? 'Nueva contraseña (déjala vacía para no cambiarla)' : 'Contraseña (mínimo 6 caracteres)'}
          <input name="password" type="password" autocomplete="new-password" minlength="6" ${user ? '' : raw('required')}>
        </label>
        ${user ? html`<label class="check span-2"><input type="checkbox" name="active" ${checked(u.active)}> Puede entrar al sistema</label>` : ''}
      </div>
      <p class="muted">Mostrador: encargos, autoservicio, clientes y corte del día. Administrador: además precios, máquinas, usuarios, cancelaciones y cortes de días anteriores.</p>`,
    onSubmit: async (v) => {
      if (user) {
        await put(`/users/${user.id}`, { name: v.name, role: v.role, active: v.active ? 1 : 0, password: v.password || undefined });
      } else {
        await post('/users', { name: v.name, username: v.username, role: v.role, password: v.password });
      }
      toast('Usuario guardado');
      onSaved();
    },
  });
}

async function usuarios(el) {
  const load = async () => {
    const users = await get('/users');
    render(el, html`
      <div class="toolbar"><span></span><button type="button" class="btn btn-primary" id="add">${icon('plus')} Nuevo usuario</button></div>
      <section class="panel"><div class="table-wrap"><table class="table table-plain">
        <thead><tr><th>Nombre</th><th>Usuario</th><th>Rol</th><th>Estado</th><th></th></tr></thead>
        <tbody>${users.map((u) => html`
          <tr class="${u.active ? '' : 'inactive'}">
            <td><strong>${u.name}</strong>${u.id === state.user.id ? html` <span class="muted">(tú)</span>` : ''}</td>
            <td>${u.username}</td><td>${u.role === 'admin' ? 'Administrador' : 'Mostrador'}</td>
            <td>${u.active ? html`<span class="chip chip-ok">Activo</span>` : html`<span class="chip chip-muted">Sin acceso</span>`}</td>
            <td class="r"><button type="button" class="btn btn-ghost btn-sm" data-edit="${u.id}">Editar</button></td>
          </tr>`)}</tbody>
      </table></div></section>`);
    $('#add', el).addEventListener('click', () => userDialog(null, load));
    $$('[data-edit]', el).forEach((b) => b.addEventListener('click', () => userDialog(users.find((u) => u.id === Number(b.dataset.edit)), load)));
  };
  await load();
}
