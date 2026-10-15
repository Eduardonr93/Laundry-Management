// Clientes, encargos, autoservicio, caja e inicio.
import { requireAdmin } from '../auth.js';
import { bad, forbidden, notFound } from '../errors.js';
import { id, str, oneOf } from '../validate.js';
import { dayRange, isDay, localDate } from '../time.js';
import {
  STATUS_LABELS, addPayment, cancelOrder, changeStatus, createEncargo, createSale,
  deliverEncargo, getOrder, listMachines, listOrders, updateEncargo,
} from '../orders.js';

function customerFields(body) {
  const email = str(body?.email, 'Correo', { max: 120 });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad('Correo inválido');
  const phone = str(body.phone, 'Teléfono', { max: 30 });
  if (phone && !/^[\d\s()+-]{7,}$/.test(phone)) throw bad('Teléfono inválido');
  return {
    name: str(body.name, 'Nombre', { required: true, max: 100 }),
    phone,
    email,
    address: str(body.address, 'Dirección', { max: 200 }),
    notes: str(body.notes, 'Notas', { max: 500 }),
  };
}

export default function businessRoutes(api, ctx) {
  const { db, config, now } = ctx;
  const withUser = (req) => ({ ...ctx, user: req.user });

  // --- Clientes ---
  api.get('/customers', (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const like = `%${q}%`;
    res.json(db.prepare(`
      SELECT c.*,
        (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id AND o.status != 'cancelado') AS orders_count,
        (SELECT MAX(created_at) FROM orders o WHERE o.customer_id = c.id) AS last_order_at
      FROM customers c
      ${q ? 'WHERE c.name LIKE ? OR c.phone LIKE ?' : ''}
      ORDER BY ${q ? 'c.name' : 'last_order_at DESC NULLS LAST, c.name'}
      LIMIT 100
    `).all(...(q ? [like, like] : [])));
  });

  api.get('/customers/:id', (req, res) => {
    const customerId = id(req.params.id, 'Cliente');
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId);
    if (!customer) throw notFound('Cliente no encontrado');
    res.json({ ...customer, orders: listOrders(db, { customerId, limit: 200 }) });
  });

  api.post('/customers', (req, res) => {
    const f = customerFields(req.body);
    const { lastInsertRowid } = db.prepare(`INSERT INTO customers (name, phone, email, address, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`).run(f.name, f.phone, f.email, f.address, f.notes, now().toISOString());
    res.status(201).json(db.prepare('SELECT * FROM customers WHERE id = ?').get(lastInsertRowid));
  });

  api.put('/customers/:id', (req, res) => {
    const customerId = id(req.params.id, 'Cliente');
    if (!db.prepare('SELECT 1 FROM customers WHERE id = ?').get(customerId)) throw notFound('Cliente no encontrado');
    const f = customerFields(req.body);
    db.prepare('UPDATE customers SET name = ?, phone = ?, email = ?, address = ?, notes = ? WHERE id = ?')
      .run(f.name, f.phone, f.email, f.address, f.notes, customerId);
    res.json(db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId));
  });

  // --- Pedidos (encargos y ventas) ---
  api.get('/orders', (req, res) => {
    const { kind, status, q } = req.query;
    res.json(listOrders(db, {
      kind: kind ? oneOf(kind, 'Tipo', ['encargo', 'autoservicio']) : undefined,
      status: status ? oneOf(status, 'Estado', ['activos', ...Object.keys(STATUS_LABELS)]) : undefined,
      q: typeof q === 'string' ? q.trim().slice(0, 60) : undefined,
      limit: 200,
    }));
  });

  api.get('/orders/:id', (req, res) => res.json(getOrder(db, id(req.params.id, 'Pedido'))));

  api.post('/orders/encargo', (req, res) => res.status(201).json(createEncargo(withUser(req), req.body)));
  api.put('/orders/:id', (req, res) => res.json(updateEncargo(withUser(req), id(req.params.id, 'Pedido'), req.body ?? {})));
  api.post('/orders/:id/status', (req, res) => res.json(changeStatus(withUser(req), id(req.params.id, 'Pedido'), req.body)));
  api.post('/orders/:id/payments', (req, res) => res.json(addPayment(withUser(req), id(req.params.id, 'Pedido'), req.body)));
  api.post('/orders/:id/deliver', (req, res) => res.json(deliverEncargo(withUser(req), id(req.params.id, 'Pedido'), req.body)));
  api.post('/orders/:id/cancel', requireAdmin, (req, res) => res.json(cancelOrder(withUser(req), id(req.params.id, 'Pedido'), req.body)));

  api.post('/sales', (req, res) => res.status(201).json(createSale(withUser(req), req.body)));

  // --- Corte de caja ---
  api.get('/cash', (req, res) => {
    const today = localDate(now(), config.utcOffset);
    const day = req.query.date === undefined ? today : req.query.date;
    if (!isDay(day)) throw bad('Fecha inválida');
    if (day !== today && req.user.role !== 'admin') throw forbidden('Solo el administrador puede ver cortes de otros días');
    const range = dayRange(day, config.utcOffset);
    if (!range) throw bad('Fecha inválida');

    const movements = db.prepare(`
      SELECT p.id, p.amount_cents, p.method, p.kind, p.created_at,
             o.id AS order_id, o.folio, o.kind AS order_kind, c.name AS customer_name, u.name AS user_name
      FROM payments p
      JOIN orders o ON o.id = p.order_id
      LEFT JOIN customers c ON c.id = o.customer_id
      LEFT JOIN users u ON u.id = p.created_by
      WHERE p.created_at >= ? AND p.created_at < ?
      ORDER BY p.created_at, p.id
    `).all(...range);

    const byMethod = { efectivo: 0, tarjeta: 0, transferencia: 0 };
    const byKind = { encargo: 0, autoservicio: 0 };
    let refunds = 0;
    for (const m of movements) {
      byMethod[m.method] += m.amount_cents;
      byKind[m.order_kind] += m.amount_cents;
      if (m.kind === 'reembolso') refunds += m.amount_cents;
    }
    const [{ n: encargosRecibidos }] = db.prepare(`SELECT COUNT(*) AS n FROM orders
      WHERE kind = 'encargo' AND created_at >= ? AND created_at < ?`).all(...range);
    const [{ n: encargosEntregados }] = db.prepare(`SELECT COUNT(*) AS n FROM orders
      WHERE kind = 'encargo' AND delivered_at >= ? AND delivered_at < ?`).all(...range);
    const [{ n: ventas }] = db.prepare(`SELECT COUNT(*) AS n FROM orders
      WHERE kind = 'autoservicio' AND status = 'completado' AND created_at >= ? AND created_at < ?`).all(...range);

    res.json({
      date: day,
      today,
      total_cents: byMethod.efectivo + byMethod.tarjeta + byMethod.transferencia,
      by_method: byMethod,
      by_kind: byKind,
      refunds_cents: refunds,
      counts: { encargos_recibidos: encargosRecibidos, encargos_entregados: encargosEntregados, ventas_autoservicio: ventas },
      movements,
    });
  });

  // --- Inicio ---
  api.get('/dashboard', (req, res) => {
    const at = now();
    const nowIso = at.toISOString();
    const [start, end] = dayRange(localDate(at, config.utcOffset), config.utcOffset);
    const { total } = db.prepare(`SELECT COALESCE(SUM(amount_cents), 0) AS total FROM payments
      WHERE created_at >= ? AND created_at < ?`).get(start, end);
    const counts = Object.fromEntries(db.prepare(`SELECT status, COUNT(*) AS n FROM orders
      WHERE kind = 'encargo' AND status IN ('recibido', 'en_proceso', 'listo') GROUP BY status`)
      .all().map((r) => [r.status, r.n]));
    const open = listOrders(db, { kind: 'encargo', status: 'activos', limit: 500 });
    const machines = listMachines(db, nowIso);

    res.json({
      server_now: nowIso,
      sales_today_cents: total,
      counts: { recibido: counts.recibido ?? 0, en_proceso: counts.en_proceso ?? 0, listo: counts.listo ?? 0 },
      ready: open.filter((o) => o.status === 'listo').slice(0, 20),
      overdue: open.filter((o) => o.status !== 'listo' && o.due_at && o.due_at < nowIso),
      due_today: open.filter((o) => o.status !== 'listo' && o.due_at && o.due_at >= nowIso && o.due_at < end),
      machines,
    });
  });
}
