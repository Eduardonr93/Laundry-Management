import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/auth.js';
import { seedCatalog } from '../server/seed.js';

// Reloj controlable: las pruebas adelantan el tiempo para terminar ciclos.
let clock = new Date('2026-03-10T15:00:00Z'); // 10:00 en Cancún
const advance = (minutes) => { clock = new Date(clock.getTime() + minutes * 60_000); };

let server;
let base;
const db = openDb(':memory:');

before(async () => {
  seedCatalog(db);
  const iso = clock.toISOString();
  db.prepare(`INSERT INTO users (name, username, password_hash, role, created_at) VALUES
    ('Admin', 'admin', ?, 'admin', ?), ('Mostrador', 'mostrador', ?, 'empleado', ?)`)
    .run(hashPassword('admin123'), iso, hashPassword('mostrador123'), iso);
  const config = { utcOffset: '-05:00', secureCookies: false, trustProxy: false, sessionHours: 12 };
  const app = createApp({ db, config, now: () => clock });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(() => server.close());

function client() {
  let cookie = '';
  const call = async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    return { status: res.status, body: await res.json() };
  };
  return {
    get: (p) => call('GET', p),
    post: (p, b) => call('POST', p, b),
    put: (p, b) => call('PUT', p, b),
    login: (u, pw) => call('POST', '/auth/login', { username: u, password: pw }),
  };
}

const services = () => Object.fromEntries(db.prepare('SELECT id, name FROM services').all().map((s) => [s.name, s.id]));
const machines = () => Object.fromEntries(db.prepare('SELECT id, name FROM machines').all().map((m) => [m.name, m.id]));

let admin;
let staff;
let customerId;

test('rechaza peticiones sin sesión y contraseñas incorrectas', async () => {
  const anon = client();
  assert.equal((await anon.get('/orders')).status, 401);
  assert.equal((await anon.login('admin', 'mala')).status, 401);
  admin = client();
  staff = client();
  assert.equal((await admin.login('admin', 'admin123')).status, 200);
  assert.equal((await staff.login('mostrador', 'mostrador123')).status, 200);
  assert.equal((await staff.get('/auth/me')).body.user.role, 'empleado');
});

test('bloquea el login después de 5 intentos fallidos', async () => {
  const c = client();
  for (let i = 0; i < 5; i++) await c.login('nadie', 'x');
  assert.equal((await c.login('nadie', 'x')).status, 429);
});

test('las escrituras deben ser JSON (protección CSRF)', async () => {
  const res = await fetch(`${base}/customers`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'name=x',
  });
  assert.equal(res.status, 415);
});

test('el empleado no puede cambiar precios ni ver usuarios', async () => {
  assert.equal((await staff.post('/services', { name: 'X', category: 'encargo', unit: 'kg', price_cents: 1 })).status, 403);
  assert.equal((await staff.get('/users')).status, 403);
  assert.equal((await admin.get('/users')).status, 200);
});

test('crea un encargo cobrando el mínimo de kilos y con anticipo', async () => {
  const c = await staff.post('/customers', { name: 'Ana Pech', phone: '998 111 2233' });
  assert.equal(c.status, 201);
  customerId = c.body.id;
  const s = services();
  const res = await staff.post('/orders/encargo', {
    customer_id: customerId,
    items: [
      { service_id: s['Lavado y secado por kilo'], quantity: 2.5 }, // mínimo 3 kg × $30 = $90
      { service_id: s['Planchado'], quantity: 4 },                   // 4 × $18 = $72
    ],
    payment: { amount_cents: 5000, method: 'efectivo' },
  });
  assert.equal(res.status, 201);
  const o = res.body;
  assert.match(o.folio, /^E-\d{5}$/);
  assert.equal(o.status, 'recibido');
  assert.equal(o.total_cents, 16200);
  assert.equal(o.paid_cents, 5000);
  assert.equal(o.balance_cents, 11200);
  assert.match(o.items[0].description, /mínimo 3 kg/);
  // Entrega por defecto: 24 horas después
  assert.equal(o.due_at, new Date(clock.getTime() + 24 * 3600_000).toISOString());
});

test('sigue el flujo de estados y exige cobrar el saldo para entregar', async () => {
  const [order] = (await staff.get('/orders?kind=encargo')).body;
  assert.equal((await staff.post(`/orders/${order.id}/status`, { status: 'listo' })).status, 400);
  assert.equal((await staff.post(`/orders/${order.id}/deliver`, {})).status, 400);
  assert.equal((await staff.post(`/orders/${order.id}/status`, { status: 'en_proceso' })).status, 200);
  assert.equal((await staff.post(`/orders/${order.id}/status`, { status: 'listo' })).status, 200);

  // Pagar de más no se permite
  assert.equal((await staff.post(`/orders/${order.id}/payments`, { amount_cents: 999999, method: 'efectivo' })).status, 400);
  // Entregar sin cobrar el saldo completo no se permite
  const partial = await staff.post(`/orders/${order.id}/deliver`, { payment: { amount_cents: 100, method: 'tarjeta' } });
  assert.equal(partial.status, 400);

  const done = await staff.post(`/orders/${order.id}/deliver`, { payment: { amount_cents: 11200, method: 'tarjeta' } });
  assert.equal(done.status, 200);
  assert.equal(done.body.status, 'entregado');
  assert.equal(done.body.balance_cents, 0);
  assert.equal((await admin.post(`/orders/${order.id}/cancel`, { reason: 'x' })).status, 400);
});

test('no permite bajar el total por debajo de lo pagado', async () => {
  const s = services();
  const o = (await staff.post('/orders/encargo', {
    customer_id: customerId,
    items: [{ service_id: s['Edredón king size'], quantity: 2 }],
    payment: { amount_cents: 30000, method: 'efectivo' },
  })).body;
  const res = await staff.put(`/orders/${o.id}`, { items: [{ service_id: s['Edredón king size'], quantity: 1 }] });
  assert.equal(res.status, 400);
  const ok = await staff.put(`/orders/${o.id}`, { items: [{ service_id: s['Edredón king size'], quantity: 3 }] });
  assert.equal(ok.body.total_cents, 54000);
});

test('la venta de autoservicio ocupa la máquina hasta que termina el ciclo', async () => {
  const s = services();
  const m = machines();
  const sale = await staff.post('/sales', {
    payment_method: 'efectivo',
    items: [
      { service_id: s['Lavado normal'], machine_id: m['Lavadora 1'] },
      { service_id: s['Detergente (sobre)'], quantity: 2 },
    ],
  });
  assert.equal(sale.status, 201);
  assert.match(sale.body.folio, /^A-\d{5}$/);
  assert.equal(sale.body.total_cents, 4500 + 3000);
  assert.equal(sale.body.balance_cents, 0);

  const again = await staff.post('/sales', {
    payment_method: 'efectivo', items: [{ service_id: s['Lavado normal'], machine_id: m['Lavadora 1'] }],
  });
  assert.equal(again.status, 400);
  assert.match(again.body.error, /en uso/);

  // Un ciclo de lavadora no se puede vender en una secadora
  const wrong = await staff.post('/sales', {
    payment_method: 'efectivo', items: [{ service_id: s['Lavado normal'], machine_id: m['Secadora 1'] }],
  });
  assert.equal(wrong.status, 400);

  const busy = (await staff.get('/machines')).body.machines.find((x) => x.id === m['Lavadora 1']);
  assert.equal(busy.in_use, true);

  advance(36); // el ciclo dura 35 minutos
  const free = (await staff.get('/machines')).body.machines.find((x) => x.id === m['Lavadora 1']);
  assert.equal(free.in_use, false);
});

test('liberar una máquina antes de tiempo', async () => {
  const s = services();
  const m = machines();
  await staff.post('/sales', { payment_method: 'tarjeta', items: [{ service_id: s['Secado 30 min'], machine_id: m['Secadora 2'] }] });
  assert.equal((await staff.post(`/machines/${m['Secadora 2']}/stop`, {})).status, 200);
  const machine = (await staff.get('/machines')).body.machines.find((x) => x.id === m['Secadora 2']);
  assert.equal(machine.in_use, false);
});

test('no se vende un ciclo en una máquina en mantenimiento', async () => {
  const s = services();
  const m = machines();
  const upd = await admin.put(`/machines/${m['Lavadora 3']}`, { name: 'Lavadora 3', type: 'lavadora', status: 'mantenimiento' });
  assert.equal(upd.status, 200);
  const res = await staff.post('/sales', { payment_method: 'efectivo', items: [{ service_id: s['Lavado normal'], machine_id: m['Lavadora 3'] }] });
  assert.equal(res.status, 400);
});

test('cancelar (solo admin) registra el reembolso y libera máquinas', async () => {
  const s = services();
  const m = machines();
  const sale = (await staff.post('/sales', {
    payment_method: 'efectivo', items: [{ service_id: s['Lavado normal'], machine_id: m['Lavadora 4'] }],
  })).body;
  assert.equal((await staff.post(`/orders/${sale.id}/cancel`, { reason: 'Error' })).status, 403);
  const res = await admin.post(`/orders/${sale.id}/cancel`, { reason: 'Se cobró dos veces', refund_method: 'efectivo' });
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'cancelado');
  assert.equal(res.body.paid_cents, 0);
  const machine = (await staff.get('/machines')).body.machines.find((x) => x.id === m['Lavadora 4']);
  assert.equal(machine.in_use, false);
});

test('el corte de caja suma por forma de pago y tipo de servicio', async () => {
  const cash = (await staff.get('/cash')).body;
  assert.equal(cash.date, '2026-03-10');
  // efectivo: 50 (anticipo) + 300 (anticipo edredón) + 75 (venta) + 45 - 45 (venta cancelada y reembolso)
  assert.equal(cash.by_method.efectivo, 5000 + 30000 + 7500);
  // tarjeta: 112 (saldo entregado) + 40 (secado)
  assert.equal(cash.by_method.tarjeta, 11200 + 4000);
  assert.equal(cash.refunds_cents, -4500);
  assert.equal(cash.by_kind.encargo, 5000 + 11200 + 30000);
  assert.equal(cash.by_kind.autoservicio, 7500 + 4000);
  assert.equal(cash.total_cents, cash.by_kind.encargo + cash.by_kind.autoservicio);
  // El empleado no puede consultar otros días; el administrador sí.
  assert.equal((await staff.get('/cash?date=2026-03-09')).status, 403);
  assert.equal((await admin.get('/cash?date=2026-03-09')).body.total_cents, 0);
});

test('el administrador no puede quitarse su propio rol', async () => {
  const me = (await admin.get('/auth/me')).body.user;
  const res = await admin.put(`/users/${me.id}`, { name: 'Admin', role: 'empleado', active: 1 });
  assert.equal(res.status, 400);
});

test('desactivar a un usuario cierra su sesión', async () => {
  const created = await admin.post('/users', { name: 'Temporal', username: 'temporal', password: 'secreto1', role: 'empleado' });
  assert.equal(created.status, 201);
  const temp = client();
  assert.equal((await temp.login('temporal', 'secreto1')).status, 200);
  await admin.put(`/users/${created.body.id}`, { name: 'Temporal', role: 'empleado', active: 0 });
  assert.equal((await temp.get('/orders')).status, 401);
});
