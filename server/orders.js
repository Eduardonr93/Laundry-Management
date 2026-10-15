// Reglas de negocio de encargos (dejar y recoger) y ventas de autoservicio.
import { tx } from './db.js';
import { bad, notFound } from './errors.js';
import { id, int, num, str, oneOf } from './validate.js';
import { getSettings } from './settings.js';

export const PAYMENT_METHODS = ['efectivo', 'tarjeta', 'transferencia'];

export const STATUS_LABELS = {
  recibido: 'Recibido',
  en_proceso: 'En proceso',
  listo: 'Listo para entregar',
  entregado: 'Entregado',
  completado: 'Pagado',
  cancelado: 'Cancelado',
};

// Cambios de estado permitidos para un encargo (sin contar entrega y cancelación).
const ENCARGO_FLOW = {
  recibido: ['en_proceso'],
  en_proceso: ['listo', 'recibido'],
  listo: ['en_proceso'],
};

const EDITABLE = ['recibido', 'en_proceso'];

const ORDER_SELECT = `
  SELECT o.*, c.name AS customer_name, c.phone AS customer_phone,
         COALESCE((SELECT SUM(p.amount_cents) FROM payments p WHERE p.order_id = o.id), 0) AS paid_cents
  FROM orders o LEFT JOIN customers c ON c.id = o.customer_id`;

function withBalance(o) {
  return { ...o, balance_cents: o.status === 'cancelado' ? 0 : o.total_cents - o.paid_cents };
}

const money = (cents) => `$${(cents / 100).toFixed(2)}`;
const qtyText = (q, unit) => (unit === 'kg' ? `${q} kg` : `${q} ${q === 1 ? 'pieza' : 'piezas'}`);

export function nextFolio(db, kind) {
  db.prepare(`INSERT INTO counters (name, value) VALUES (?, 1)
    ON CONFLICT(name) DO UPDATE SET value = value + 1`).run(kind);
  const { value } = db.prepare('SELECT value FROM counters WHERE name = ?').get(kind);
  return `${kind === 'encargo' ? 'E' : 'A'}-${String(value).padStart(5, '0')}`;
}

export function currentMachineUse(db, machineId, nowIso) {
  return db.prepare(`SELECT * FROM machine_uses
    WHERE machine_id = ? AND stopped_at IS NULL AND ends_at > ?`).get(machineId, nowIso) ?? null;
}

/**
 * Valida y calcula el importe de cada partida.
 * - kg admite decimales (se redondea a 0.01); pieza/servicio solo enteros.
 * - Si el servicio tiene mínimo (ej. 3 kg), se cobra el mínimo.
 * - En autoservicio, un ciclo de máquina exige máquina libre del tipo correcto.
 */
function priceItems(db, rawItems, category, nowIso) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) throw bad('Agrega al menos un servicio');
  if (rawItems.length > 50) throw bad('Demasiadas partidas en un solo pedido');
  const usedMachines = new Set();

  return rawItems.map((raw) => {
    const service = db.prepare('SELECT * FROM services WHERE id = ? AND active = 1')
      .get(id(raw?.service_id, 'Servicio'));
    if (!service || service.category !== category) throw bad('Uno de los servicios ya no está disponible');

    let machine = null;
    let quantity;
    if (service.machine_type) {
      machine = db.prepare('SELECT * FROM machines WHERE id = ? AND active = 1').get(id(raw.machine_id, 'Máquina'));
      if (!machine) throw bad('Máquina no encontrada');
      if (machine.type !== service.machine_type) throw bad(`"${service.name}" no se puede usar en ${machine.name}`);
      if (machine.status !== 'disponible') throw bad(`${machine.name} no está disponible`);
      if (usedMachines.has(machine.id)) throw bad(`${machine.name} está dos veces en la venta`);
      if (currentMachineUse(db, machine.id, nowIso)) throw bad(`${machine.name} está en uso`);
      usedMachines.add(machine.id);
      quantity = 1;
    } else if (service.unit === 'kg') {
      quantity = Math.round(num(raw.quantity, 'Kilos', { min: 0.01, max: 1000 }) * 100) / 100;
    } else {
      quantity = int(raw.quantity, 'Cantidad', { min: 1, max: 1000 });
    }

    const billed = Math.max(quantity, service.min_qty || 0);
    let description = machine ? `${service.name} · ${machine.name}` : service.name;
    if (billed > quantity) description += ` (mínimo ${qtyText(service.min_qty, service.unit)})`;

    return {
      service_id: service.id,
      description,
      unit: service.unit,
      quantity,
      unit_price_cents: service.price_cents,
      amount_cents: Math.round(service.price_cents * billed),
      machine_id: machine?.id ?? null,
      cycle_minutes: service.cycle_minutes,
    };
  });
}

function parsePayment(raw, maxCents, { required = false } = {}) {
  const amount = raw?.amount_cents;
  if (!raw || amount === undefined || amount === null || amount === 0 || amount === '0') {
    if (required) throw bad('Falta el pago');
    return null;
  }
  return {
    amount_cents: int(amount, 'Monto del pago', { min: 1, max: maxCents }),
    method: oneOf(raw.method, 'Forma de pago', PAYMENT_METHODS),
  };
}

function parseDueAt(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const d = new Date(value);
  if (typeof value !== 'string' || Number.isNaN(d.getTime())) throw bad('Fecha de entrega inválida');
  return d.toISOString();
}

function addEvent(db, orderId, event, detail, userId, at) {
  db.prepare('INSERT INTO order_events (order_id, event, detail, user_id, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(orderId, event, detail, userId, at);
}

function insertItems(db, orderId, items) {
  const stmt = db.prepare(`INSERT INTO order_items
    (order_id, service_id, description, unit, quantity, unit_price_cents, amount_cents, machine_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const it of items) {
    stmt.run(orderId, it.service_id, it.description, it.unit, it.quantity,
      it.unit_price_cents, it.amount_cents, it.machine_id);
  }
}

function insertPayment(db, orderId, payment, kind, userId, at) {
  const amount = kind === 'reembolso' ? -payment.amount_cents : payment.amount_cents;
  db.prepare(`INSERT INTO payments (order_id, amount_cents, method, kind, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run(orderId, amount, payment.method, kind, userId, at);
  addEvent(db, orderId, kind === 'reembolso' ? 'Reembolso' : 'Pago',
    `${money(payment.amount_cents)} en ${payment.method}`, userId, at);
}

function loadOrder(db, orderId) {
  const order = db.prepare(`${ORDER_SELECT} WHERE o.id = ?`).get(orderId);
  if (!order) throw notFound('Pedido no encontrado');
  return withBalance(order);
}

export function getOrder(db, orderId) {
  const order = loadOrder(db, orderId);
  return {
    ...order,
    customer: order.customer_id
      ? db.prepare('SELECT * FROM customers WHERE id = ?').get(order.customer_id)
      : null,
    items: db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(orderId),
    payments: db.prepare(`SELECT p.*, u.name AS user_name FROM payments p
      LEFT JOIN users u ON u.id = p.created_by WHERE p.order_id = ? ORDER BY p.id`).all(orderId),
    events: db.prepare(`SELECT e.*, u.name AS user_name FROM order_events e
      LEFT JOIN users u ON u.id = e.user_id WHERE e.order_id = ? ORDER BY e.id`).all(orderId),
    machine_uses: db.prepare(`SELECT mu.*, m.name AS machine_name FROM machine_uses mu
      JOIN machines m ON m.id = mu.machine_id WHERE mu.order_id = ? ORDER BY mu.id`).all(orderId),
  };
}

export function listOrders(db, { kind, status, q, customerId, from, to, limit = 100 } = {}) {
  const where = [];
  const params = [];
  if (kind) { where.push('o.kind = ?'); params.push(kind); }
  if (status === 'activos') where.push(`o.status IN ('recibido', 'en_proceso', 'listo')`);
  else if (status) { where.push('o.status = ?'); params.push(status); }
  if (customerId) { where.push('o.customer_id = ?'); params.push(customerId); }
  if (from) { where.push('o.created_at >= ?'); params.push(from); }
  if (to) { where.push('o.created_at < ?'); params.push(to); }
  if (q) {
    where.push('(o.folio LIKE ? OR c.name LIKE ? OR c.phone LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  const sql = `${ORDER_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY o.created_at DESC, o.id DESC LIMIT ?`;
  return db.prepare(sql).all(...params, limit).map(withBalance);
}

// ---------- Encargos ----------

export function createEncargo({ db, now, user }, body) {
  const at = now();
  const nowIso = at.toISOString();
  const customerId = id(body?.customer_id, 'Cliente');
  if (!db.prepare('SELECT 1 FROM customers WHERE id = ?').get(customerId)) throw bad('Cliente no encontrado');
  const notes = str(body.notes, 'Notas', { max: 500 });
  const hours = getSettings(db).default_turnaround_hours;
  const dueAt = parseDueAt(body.due_at, new Date(at.getTime() + hours * 3600_000).toISOString());

  return tx(db, () => {
    const items = priceItems(db, body.items, 'encargo', nowIso);
    const total = items.reduce((s, it) => s + it.amount_cents, 0);
    const payment = parsePayment(body.payment, total);
    const folio = nextFolio(db, 'encargo');
    const { lastInsertRowid } = db.prepare(`INSERT INTO orders
      (folio, kind, customer_id, status, notes, due_at, total_cents, created_by, created_at, updated_at)
      VALUES (?, 'encargo', ?, 'recibido', ?, ?, ?, ?, ?, ?)`)
      .run(folio, customerId, notes, dueAt, total, user.id, nowIso, nowIso);
    const orderId = Number(lastInsertRowid);
    insertItems(db, orderId, items);
    addEvent(db, orderId, 'Recibido', `Total ${money(total)}`, user.id, nowIso);
    if (payment) insertPayment(db, orderId, payment, 'pago', user.id, nowIso);
    return getOrder(db, orderId);
  });
}

export function changeStatus({ db, now, user }, orderId, body) {
  const nowIso = now().toISOString();
  return tx(db, () => {
    const order = loadOrder(db, orderId);
    if (order.kind !== 'encargo') throw bad('Solo los encargos cambian de estado');
    const status = oneOf(body?.status, 'Estado', Object.keys(STATUS_LABELS));
    if (!(ENCARGO_FLOW[order.status] ?? []).includes(status)) {
      throw bad(`No se puede pasar de "${STATUS_LABELS[order.status]}" a "${STATUS_LABELS[status]}"`);
    }
    db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?').run(status, nowIso, orderId);
    addEvent(db, orderId, STATUS_LABELS[status], '', user.id, nowIso);
    return getOrder(db, orderId);
  });
}

export function updateEncargo({ db, now, user }, orderId, body) {
  const nowIso = now().toISOString();
  return tx(db, () => {
    const order = loadOrder(db, orderId);
    if (order.kind !== 'encargo') throw bad('Solo se pueden editar encargos');
    if (!EDITABLE.includes(order.status)) throw bad('Este encargo ya no se puede modificar');

    const notes = body.notes === undefined ? order.notes : str(body.notes, 'Notas', { max: 500 });
    const dueAt = body.due_at === undefined ? order.due_at : parseDueAt(body.due_at, order.due_at);
    let total = order.total_cents;

    if (body.items !== undefined) {
      const items = priceItems(db, body.items, 'encargo', nowIso);
      total = items.reduce((s, it) => s + it.amount_cents, 0);
      if (total < order.paid_cents) {
        throw bad(`El nuevo total (${money(total)}) es menor a lo ya pagado (${money(order.paid_cents)})`);
      }
      db.prepare('DELETE FROM order_items WHERE order_id = ?').run(orderId);
      insertItems(db, orderId, items);
      if (total !== order.total_cents) {
        addEvent(db, orderId, 'Servicios modificados',
          `Total ${money(order.total_cents)} → ${money(total)}`, user.id, nowIso);
      }
    }
    db.prepare('UPDATE orders SET notes = ?, due_at = ?, total_cents = ?, updated_at = ? WHERE id = ?')
      .run(notes, dueAt, total, nowIso, orderId);
    return getOrder(db, orderId);
  });
}

export function addPayment({ db, now, user }, orderId, body) {
  const nowIso = now().toISOString();
  return tx(db, () => {
    const order = loadOrder(db, orderId);
    if (order.kind !== 'encargo') throw bad('Las ventas de autoservicio se cobran al momento');
    if (!['recibido', 'en_proceso', 'listo'].includes(order.status)) throw bad('Este encargo ya está cerrado');
    if (order.balance_cents <= 0) throw bad('El encargo ya está pagado');
    const payment = parsePayment(body, order.balance_cents, { required: true });
    insertPayment(db, orderId, payment, 'pago', user.id, nowIso);
    db.prepare('UPDATE orders SET updated_at = ? WHERE id = ?').run(nowIso, orderId);
    return getOrder(db, orderId);
  });
}

export function deliverEncargo({ db, now, user }, orderId, body) {
  const nowIso = now().toISOString();
  return tx(db, () => {
    const order = loadOrder(db, orderId);
    if (order.kind !== 'encargo') throw bad('Solo se entregan encargos');
    if (order.status !== 'listo') throw bad('Marca el encargo como "Listo para entregar" antes de entregarlo');
    if (order.balance_cents > 0) {
      const payment = parsePayment(body?.payment, order.balance_cents, { required: true });
      if (payment.amount_cents !== order.balance_cents) {
        throw bad(`Para entregar hay que cobrar el saldo completo: ${money(order.balance_cents)}`);
      }
      insertPayment(db, orderId, payment, 'pago', user.id, nowIso);
    }
    db.prepare(`UPDATE orders SET status = 'entregado', delivered_at = ?, updated_at = ? WHERE id = ?`)
      .run(nowIso, nowIso, orderId);
    addEvent(db, orderId, 'Entregado', '', user.id, nowIso);
    return getOrder(db, orderId);
  });
}

/** Cancela un encargo o una venta. Si hubo pagos, registra el reembolso. */
export function cancelOrder({ db, now, user }, orderId, body) {
  const nowIso = now().toISOString();
  const reason = str(body?.reason, 'Motivo de cancelación', { required: true, max: 300 });
  return tx(db, () => {
    const order = loadOrder(db, orderId);
    if (order.status === 'cancelado') throw bad('El pedido ya está cancelado');
    if (order.status === 'entregado') throw bad('No se puede cancelar un encargo ya entregado');
    if (order.paid_cents > 0) {
      const method = oneOf(body.refund_method ?? 'efectivo', 'Forma de reembolso', PAYMENT_METHODS);
      insertPayment(db, orderId, { amount_cents: order.paid_cents, method }, 'reembolso', user.id, nowIso);
    }
    db.prepare(`UPDATE machine_uses SET stopped_at = ?
      WHERE order_id = ? AND stopped_at IS NULL AND ends_at > ?`).run(nowIso, orderId, nowIso);
    db.prepare(`UPDATE orders SET status = 'cancelado', cancelled_at = ?, cancel_reason = ?, updated_at = ?
      WHERE id = ?`).run(nowIso, reason, nowIso, orderId);
    addEvent(db, orderId, 'Cancelado', reason, user.id, nowIso);
    return getOrder(db, orderId);
  });
}

// ---------- Autoservicio ----------

/** Venta de mostrador: ciclos de máquina y productos, cobrada al momento. */
export function createSale({ db, now, user }, body) {
  const at = now();
  const nowIso = at.toISOString();
  let customerId = null;
  if (body?.customer_id) {
    customerId = id(body.customer_id, 'Cliente');
    if (!db.prepare('SELECT 1 FROM customers WHERE id = ?').get(customerId)) throw bad('Cliente no encontrado');
  }
  const method = oneOf(body?.payment_method, 'Forma de pago', PAYMENT_METHODS);
  const notes = str(body.notes, 'Notas', { max: 300 });

  return tx(db, () => {
    const items = priceItems(db, body.items, 'autoservicio', nowIso);
    const total = items.reduce((s, it) => s + it.amount_cents, 0);
    if (total <= 0) throw bad('El total de la venta debe ser mayor a cero');
    const folio = nextFolio(db, 'autoservicio');
    const { lastInsertRowid } = db.prepare(`INSERT INTO orders
      (folio, kind, customer_id, status, notes, total_cents, created_by, created_at, updated_at)
      VALUES (?, 'autoservicio', ?, 'completado', ?, ?, ?, ?, ?)`)
      .run(folio, customerId, notes, total, user.id, nowIso, nowIso);
    const orderId = Number(lastInsertRowid);
    insertItems(db, orderId, items);
    addEvent(db, orderId, 'Venta', `Total ${money(total)}`, user.id, nowIso);
    insertPayment(db, orderId, { amount_cents: total, method }, 'pago', user.id, nowIso);

    const useStmt = db.prepare(`INSERT INTO machine_uses (machine_id, order_id, started_at, ends_at)
      VALUES (?, ?, ?, ?)`);
    for (const it of items) {
      if (!it.machine_id) continue;
      const endsAt = new Date(at.getTime() + (it.cycle_minutes || 30) * 60_000).toISOString();
      useStmt.run(it.machine_id, orderId, nowIso, endsAt);
    }
    return getOrder(db, orderId);
  });
}

export function listMachines(db, nowIso, { includeInactive = false } = {}) {
  return db.prepare(`
    SELECT m.*, mu.id AS use_id, mu.started_at, mu.ends_at,
           o.id AS order_id, o.folio, c.name AS customer_name
    FROM machines m
    LEFT JOIN machine_uses mu ON mu.machine_id = m.id AND mu.stopped_at IS NULL AND mu.ends_at > ?
    LEFT JOIN orders o ON o.id = mu.order_id
    LEFT JOIN customers c ON c.id = o.customer_id
    ${includeInactive ? '' : 'WHERE m.active = 1'}
    ORDER BY m.type, m.sort, m.id
  `).all(nowIso).map((m) => ({ ...m, in_use: Boolean(m.use_id) }));
}

export function stopMachine({ db, now, user }, machineId) {
  const nowIso = now().toISOString();
  return tx(db, () => {
    const use = currentMachineUse(db, machineId, nowIso);
    if (!use) throw bad('La máquina no está en uso');
    db.prepare('UPDATE machine_uses SET stopped_at = ? WHERE id = ?').run(nowIso, use.id);
    const machine = db.prepare('SELECT name FROM machines WHERE id = ?').get(machineId);
    addEvent(db, use.order_id, 'Máquina liberada', machine.name, user.id, nowIso);
  });
}
