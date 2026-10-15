// Configuración del negocio, servicios/precios, máquinas y usuarios.
import { requireAdmin, hashPassword } from '../auth.js';
import { bad, notFound } from '../errors.js';
import { id, int, num, str, oneOf, bool } from '../validate.js';
import { getSettings, saveSettings } from '../settings.js';
import { listMachines, stopMachine, currentMachineUse } from '../orders.js';

function serviceFields(body) {
  const category = oneOf(body?.category, 'Tipo de servicio', ['encargo', 'autoservicio']);
  const machineType = category === 'autoservicio' && body.machine_type
    ? oneOf(body.machine_type, 'Tipo de máquina', ['lavadora', 'secadora'])
    : null;
  const unit = machineType ? 'servicio' : oneOf(body.unit, 'Unidad', ['kg', 'pieza', 'servicio']);
  return {
    name: str(body.name, 'Nombre', { required: true, max: 80 }),
    category,
    unit,
    price_cents: int(body.price_cents, 'Precio', { min: 0, max: 10_000_000 }),
    min_qty: unit === 'servicio' ? 0 : num(body.min_qty ?? 0, 'Mínimo', { min: 0, max: 1000 }),
    machine_type: machineType,
    cycle_minutes: machineType ? int(body.cycle_minutes, 'Duración del ciclo', { min: 1, max: 240 }) : null,
    active: body.active === undefined ? 1 : bool(body.active),
    sort: body.sort === undefined ? 0 : int(body.sort, 'Orden', { min: 0, max: 9999 }),
  };
}

function machineFields(body) {
  return {
    name: str(body?.name, 'Nombre', { required: true, max: 40 }),
    type: oneOf(body.type, 'Tipo', ['lavadora', 'secadora']),
    capacity_kg: body.capacity_kg === undefined || body.capacity_kg === null || body.capacity_kg === ''
      ? null : num(body.capacity_kg, 'Capacidad', { min: 1, max: 200 }),
    status: body.status === undefined ? 'disponible'
      : oneOf(body.status, 'Estado', ['disponible', 'mantenimiento', 'fuera_servicio']),
    active: body.active === undefined ? 1 : bool(body.active),
    sort: body.sort === undefined ? 0 : int(body.sort, 'Orden', { min: 0, max: 9999 }),
  };
}

export default function catalogRoutes(api, ctx) {
  const { db, now } = ctx;

  // --- Negocio ---
  api.get('/settings', (req, res) => res.json(getSettings(db)));

  api.put('/settings', requireAdmin, (req, res) => {
    const b = req.body ?? {};
    saveSettings(db, {
      business_name: str(b.business_name, 'Nombre del negocio', { required: true, max: 80 }),
      business_address: str(b.business_address, 'Dirección', { max: 200 }),
      business_phone: str(b.business_phone, 'Teléfono', { max: 40 }),
      ticket_footer: str(b.ticket_footer, 'Leyenda del ticket', { max: 400 }),
      default_turnaround_hours: int(b.default_turnaround_hours, 'Horas de entrega', { min: 1, max: 720 }),
    });
    res.json(getSettings(db));
  });

  // --- Servicios y precios ---
  api.get('/services', (req, res) => {
    const all = req.query.all === '1' && req.user.role === 'admin';
    res.json(db.prepare(`SELECT * FROM services ${all ? '' : 'WHERE active = 1'}
      ORDER BY category, sort, name`).all());
  });

  api.post('/services', requireAdmin, (req, res) => {
    const f = serviceFields(req.body);
    const { lastInsertRowid } = db.prepare(`INSERT INTO services
      (name, category, unit, price_cents, min_qty, machine_type, cycle_minutes, active, sort)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(f.name, f.category, f.unit, f.price_cents, f.min_qty, f.machine_type, f.cycle_minutes, f.active, f.sort);
    res.status(201).json(db.prepare('SELECT * FROM services WHERE id = ?').get(lastInsertRowid));
  });

  api.put('/services/:id', requireAdmin, (req, res) => {
    const serviceId = id(req.params.id, 'Servicio');
    if (!db.prepare('SELECT 1 FROM services WHERE id = ?').get(serviceId)) throw notFound('Servicio no encontrado');
    const f = serviceFields(req.body);
    db.prepare(`UPDATE services SET name = ?, category = ?, unit = ?, price_cents = ?, min_qty = ?,
      machine_type = ?, cycle_minutes = ?, active = ?, sort = ? WHERE id = ?`)
      .run(f.name, f.category, f.unit, f.price_cents, f.min_qty, f.machine_type, f.cycle_minutes,
        f.active, f.sort, serviceId);
    res.json(db.prepare('SELECT * FROM services WHERE id = ?').get(serviceId));
  });

  // --- Máquinas ---
  api.get('/machines', (req, res) => {
    const includeInactive = req.query.all === '1' && req.user.role === 'admin';
    res.json({ server_now: now().toISOString(), machines: listMachines(db, now().toISOString(), { includeInactive }) });
  });

  api.post('/machines', requireAdmin, (req, res) => {
    const f = machineFields(req.body);
    const { lastInsertRowid } = db.prepare(`INSERT INTO machines (name, type, capacity_kg, status, active, sort)
      VALUES (?, ?, ?, ?, ?, ?)`).run(f.name, f.type, f.capacity_kg, f.status, f.active, f.sort);
    res.status(201).json(db.prepare('SELECT * FROM machines WHERE id = ?').get(lastInsertRowid));
  });

  api.put('/machines/:id', requireAdmin, (req, res) => {
    const machineId = id(req.params.id, 'Máquina');
    const current = db.prepare('SELECT * FROM machines WHERE id = ?').get(machineId);
    if (!current) throw notFound('Máquina no encontrada');
    const f = machineFields(req.body);
    const busy = currentMachineUse(db, machineId, now().toISOString());
    if (busy && (f.status !== 'disponible' || !f.active || f.type !== current.type)) {
      throw bad('La máquina está en uso. Libérala antes de cambiar su estado o tipo.');
    }
    db.prepare('UPDATE machines SET name = ?, type = ?, capacity_kg = ?, status = ?, active = ?, sort = ? WHERE id = ?')
      .run(f.name, f.type, f.capacity_kg, f.status, f.active, f.sort, machineId);
    res.json(db.prepare('SELECT * FROM machines WHERE id = ?').get(machineId));
  });

  api.post('/machines/:id/stop', (req, res) => {
    stopMachine({ ...ctx, user: req.user }, id(req.params.id, 'Máquina'));
    res.json({ ok: true });
  });

  // --- Usuarios ---
  const USER_COLUMNS = 'id, name, username, role, active, created_at';

  api.get('/users', requireAdmin, (req, res) => {
    res.json(db.prepare(`SELECT ${USER_COLUMNS} FROM users ORDER BY active DESC, name`).all());
  });

  api.post('/users', requireAdmin, (req, res) => {
    const b = req.body ?? {};
    const username = str(b.username, 'Usuario', { required: true, max: 40 }).toLowerCase();
    if (!/^[a-z0-9._-]+$/.test(username)) throw bad('El usuario solo puede tener letras, números, punto, guion y guion bajo');
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw bad('Ese usuario ya existe');
    const password = typeof b.password === 'string' ? b.password : '';
    if (password.length < 6) throw bad('La contraseña debe tener al menos 6 caracteres');
    const { lastInsertRowid } = db.prepare(`INSERT INTO users (name, username, password_hash, role, active, created_at)
      VALUES (?, ?, ?, ?, 1, ?)`).run(
      str(b.name, 'Nombre', { required: true, max: 80 }), username, hashPassword(password),
      oneOf(b.role, 'Rol', ['admin', 'empleado']), now().toISOString());
    res.status(201).json(db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).get(lastInsertRowid));
  });

  api.put('/users/:id', requireAdmin, (req, res) => {
    const userId = id(req.params.id, 'Usuario');
    const current = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!current) throw notFound('Usuario no encontrado');
    const b = req.body ?? {};
    const role = oneOf(b.role, 'Rol', ['admin', 'empleado']);
    const active = bool(b.active);
    if (userId === req.user.id && (role !== 'admin' || !active)) {
      throw bad('No puedes quitarte el rol de administrador ni desactivar tu propia cuenta');
    }
    const name = str(b.name, 'Nombre', { required: true, max: 80 });
    let hash = current.password_hash;
    if (b.password) {
      if (typeof b.password !== 'string' || b.password.length < 6) throw bad('La contraseña debe tener al menos 6 caracteres');
      hash = hashPassword(b.password);
    }
    db.prepare('UPDATE users SET name = ?, role = ?, active = ?, password_hash = ? WHERE id = ?')
      .run(name, role, active, hash, userId);
    // Cerrar sesiones abiertas si cambió la contraseña o se desactivó.
    if (hash !== current.password_hash || !active) {
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    }
    res.json(db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).get(userId));
  });
}
