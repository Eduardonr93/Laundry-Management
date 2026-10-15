import { get } from '../api.js';
import { state } from '../state.js';
import { $$, countdown, fmtDateTime, html, icon, money, render } from '../ui.js';

const orderRow = (o, { showDue = true } = {}) => html`
  <li>
    <a class="list-row" href="#/pedidos/${o.id}">
      <span class="folio">${o.folio}</span>
      <span class="grow">
        <strong>${o.customer_name}</strong>
        ${showDue ? html`<span class="muted">Entrega: ${fmtDateTime(o.due_at)}</span>` : ''}
      </span>
      ${o.balance_cents > 0
        ? html`<span class="chip chip-warn">Debe ${money(o.balance_cents)}</span>`
        : html`<span class="chip chip-ok">Pagado</span>`}
    </a>
  </li>`;

export async function dashboardView(el) {
  const d = await get('/dashboard');
  const skew = new Date(d.server_now).getTime() - Date.now();
  const free = d.machines.filter((m) => !m.in_use && m.status === 'disponible').length;
  const pending = d.counts.recibido + d.counts.en_proceso;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches';

  render(el, html`
    <header class="page-head">
      <div>
        <h1>${greeting}, ${state.user.name.split(' ')[0]}</h1>
        <p class="muted">${new Intl.DateTimeFormat('es-MX', { dateStyle: 'full' }).format(new Date())}</p>
      </div>
      <div class="actions">
        <a class="btn btn-primary" href="#/encargos/nuevo">${icon('plus')} Nuevo encargo</a>
        <a class="btn btn-secondary" href="#/autoservicio">${icon('washer')} Venta autoservicio</a>
      </div>
    </header>

    <section class="stats" aria-label="Resumen de hoy">
      <a class="stat" href="#/caja"><span class="stat-label">Cobrado hoy</span><span class="stat-value num">${money(d.sales_today_cents)}</span></a>
      <a class="stat" href="#/encargos"><span class="stat-label">Encargos por lavar</span><span class="stat-value num">${pending}</span>
        <span class="stat-note">${d.counts.recibido} recibidos · ${d.counts.en_proceso} en proceso</span></a>
      <a class="stat stat-ok" href="#/encargos?estado=listo"><span class="stat-label">Listos para entregar</span><span class="stat-value num">${d.counts.listo}</span></a>
      <a class="stat" href="#/autoservicio"><span class="stat-label">Máquinas libres</span><span class="stat-value num">${free}<small> de ${d.machines.length}</small></span></a>
    </section>

    <div class="columns">
      <section class="panel">
        <h2>Listos para entregar</h2>
        ${d.ready.length
          ? html`<ul class="list">${d.ready.map((o) => orderRow(o, { showDue: false }))}</ul>`
          : html`<p class="empty-line">No hay encargos listos por ahora.</p>`}
      </section>
      <section class="panel">
        <h2>Pendientes con fecha</h2>
        ${d.overdue.length ? html`
          <h3 class="subhead subhead-bad">Atrasados (${d.overdue.length})</h3>
          <ul class="list">${d.overdue.map((o) => orderRow(o))}</ul>` : ''}
        <h3 class="subhead">Prometidos para hoy</h3>
        ${d.due_today.length
          ? html`<ul class="list">${d.due_today.map((o) => orderRow(o))}</ul>`
          : html`<p class="empty-line">Nada más prometido para hoy.</p>`}
      </section>
    </div>

    <section class="panel">
      <div class="panel-head"><h2>Máquinas</h2><a href="#/autoservicio" class="link">Ir a autoservicio</a></div>
      <div class="machine-strip">
        ${d.machines.map((m) => html`
          <div class="mini-machine ${m.in_use ? 'busy' : m.status !== 'disponible' ? 'off' : 'free'}">
            <strong>${m.name}</strong>
            <span>${m.in_use ? html`<span class="num" data-ends="${m.ends_at}"></span>` : m.status === 'disponible' ? 'Libre' : m.status === 'mantenimiento' ? 'Mantenimiento' : 'Fuera de servicio'}</span>
          </div>`)}
      </div>
    </section>`);

  const tick = () => {
    const now = Date.now() + skew;
    $$('[data-ends]', el).forEach((span) => {
      span.textContent = `Termina en ${countdown(new Date(span.dataset.ends).getTime() - now)}`;
    });
  };
  tick();
  const timer = setInterval(tick, 1000);
  return () => clearInterval(timer);
}
