// Carga el catálogo inicial de servicios y máquinas.
// Con --demo agrega además clientes, un empleado y pedidos de ejemplo.
//   npm run seed      → solo catálogo (si está vacío)
//   npm run demo      → catálogo + datos de demostración
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { hashPassword } from './auth.js';
import { saveSettings } from './settings.js';
import {
  changeStatus, createEncargo, createSale, deliverEncargo, addPayment,
} from './orders.js';

// Precios de referencia en pesos (MXN). Ajústalos en Ajustes → Servicios.
const SERVICES = [
  // Encargo: el cliente deja la ropa y la recoge después
  ['Lavado y secado por kilo', 'encargo', 'kg', 3000, 3, null, null],
  ['Lavado exprés (mismo día)', 'encargo', 'kg', 4200, 3, null, null],
  ['Planchado', 'encargo', 'pieza', 1800, 0, null, null],
  ['Edredón individual', 'encargo', 'pieza', 12000, 0, null, null],
  ['Edredón matrimonial / queen', 'encargo', 'pieza', 15000, 0, null, null],
  ['Edredón king size', 'encargo', 'pieza', 18000, 0, null, null],
  ['Tenis (par)', 'encargo', 'pieza', 9000, 0, null, null],
  // Autoservicio: el cliente usa las máquinas
  ['Lavado normal', 'autoservicio', 'servicio', 4500, 0, 'lavadora', 35],
  ['Lavado agua caliente', 'autoservicio', 'servicio', 5500, 0, 'lavadora', 40],
  ['Secado 30 min', 'autoservicio', 'servicio', 4000, 0, 'secadora', 30],
  ['Secado extra 10 min', 'autoservicio', 'servicio', 1500, 0, 'secadora', 10],
  ['Detergente (sobre)', 'autoservicio', 'pieza', 1500, 0, null, null],
  ['Suavizante (sobre)', 'autoservicio', 'pieza', 1200, 0, null, null],
  ['Bolsa para ropa', 'autoservicio', 'pieza', 500, 0, null, null],
];

const MACHINES = [
  ['Lavadora 1', 'lavadora', 18], ['Lavadora 2', 'lavadora', 18],
  ['Lavadora 3', 'lavadora', 18], ['Lavadora 4', 'lavadora', 25],
  ['Secadora 1', 'secadora', 30], ['Secadora 2', 'secadora', 30], ['Secadora 3', 'secadora', 30],
];

export function seedCatalog(db) {
  if (!db.prepare('SELECT 1 FROM services LIMIT 1').get()) {
    const stmt = db.prepare(`INSERT INTO services
      (name, category, unit, price_cents, min_qty, machine_type, cycle_minutes, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    SERVICES.forEach((s, i) => stmt.run(...s, i));
  }
  if (!db.prepare('SELECT 1 FROM machines LIMIT 1').get()) {
    const stmt = db.prepare('INSERT INTO machines (name, type, capacity_kg, sort) VALUES (?, ?, ?, ?)');
    MACHINES.forEach((m, i) => stmt.run(...m, i));
  }
}

function seedDemo(db) {
  if (db.prepare('SELECT 1 FROM orders LIMIT 1').get()) {
    console.log('Ya hay pedidos registrados; no se agregan datos de demostración.');
    return;
  }
  saveSettings(db, {
    business_name: 'Lavandería Burbujas',
    business_address: 'Av. Tulum 123, SM 22, Cancún, Q. Roo',
    business_phone: '998 123 4567',
  });

  const iso = new Date().toISOString();
  const created = [];
  const ensureUser = (name, username, password, role) => {
    const found = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (found) return found.id;
    created.push(`  ${role === 'admin' ? 'Administrador' : 'Empleado     '} → usuario: ${username.padEnd(10)}  contraseña: ${password}`);
    return Number(db.prepare(`INSERT INTO users (name, username, password_hash, role, active, created_at)
      VALUES (?, ?, ?, ?, 1, ?)`).run(name, username, hashPassword(password), role, iso).lastInsertRowid);
  };
  const adminId = ensureUser('Administrador', 'admin', 'admin123', 'admin');
  const staffId = ensureUser('Mostrador', 'mostrador', 'mostrador123', 'empleado');

  const customers = [
    ['María Fernanda López', '998 145 2233'], ['Jorge Canché', '998 211 8890'],
    ['Hotel Coral Azul', '998 300 1100'], ['Ana Sofía Pech', '998 402 7781'],
    ['Luis Alberto May', '998 576 0042'], ['Daniela Ruiz', '998 688 3410'],
  ].map(([name, phone]) => Number(db.prepare(`INSERT INTO customers (name, phone, created_at) VALUES (?, ?, ?)`)
    .run(name, phone, iso).lastInsertRowid));

  const svc = Object.fromEntries(db.prepare('SELECT id, name FROM services').all().map((s) => [s.name, s.id]));
  const mach = Object.fromEntries(db.prepare('SELECT id, name FROM machines').all().map((m) => [m.name, m.id]));
  const hoursAgo = (h) => new Date(Date.now() - h * 3600_000);
  const as = (date, userId) => ({ db, now: () => date, user: { id: userId } });

  const enc = (h, body, userId = staffId) => createEncargo(as(hoursAgo(h), userId), body);

  // Entregado ayer
  const e1 = enc(30, { customer_id: customers[0], items: [{ service_id: svc['Lavado y secado por kilo'], quantity: 6.4 }],
    payment: { amount_cents: 10000, method: 'efectivo' }, notes: 'Separar ropa blanca' });
  changeStatus(as(hoursAgo(26), staffId), e1.id, { status: 'en_proceso' });
  changeStatus(as(hoursAgo(22), staffId), e1.id, { status: 'listo' });
  deliverEncargo(as(hoursAgo(2), staffId), e1.id, { payment: { amount_cents: 9200, method: 'tarjeta' } });

  // Listo para entregar, con saldo
  const e2 = enc(20, { customer_id: customers[1], items: [
    { service_id: svc['Lavado y secado por kilo'], quantity: 4 },
    { service_id: svc['Planchado'], quantity: 6 },
  ], payment: { amount_cents: 10000, method: 'transferencia' } });
  changeStatus(as(hoursAgo(10), staffId), e2.id, { status: 'en_proceso' });
  changeStatus(as(hoursAgo(1), staffId), e2.id, { status: 'listo' });

  // Hotel: en proceso
  const e3 = enc(5, { customer_id: customers[2], items: [
    { service_id: svc['Edredón king size'], quantity: 4 },
    { service_id: svc['Lavado y secado por kilo'], quantity: 18.5 },
  ], due_at: new Date(Date.now() + 20 * 3600_000).toISOString(), notes: 'Factura a nombre del hotel' }, adminId);
  changeStatus(as(hoursAgo(4), staffId), e3.id, { status: 'en_proceso' });

  // Recibido, vencido (prometido hace 2 horas)
  enc(28, { customer_id: customers[3], items: [{ service_id: svc['Edredón matrimonial / queen'], quantity: 1 }],
    due_at: hoursAgo(2).toISOString() });

  // Recibido hoy, pagado completo
  const e5 = enc(1, { customer_id: customers[4], items: [{ service_id: svc['Lavado y secado por kilo'], quantity: 2.2 }] });
  addPayment(as(hoursAgo(1), staffId), e5.id, { amount_cents: 9000, method: 'efectivo' });

  // Autoservicio de hoy: dos ventas con máquinas trabajando ahora
  createSale(as(hoursAgo(3), staffId), { payment_method: 'efectivo', items: [
    { service_id: svc['Lavado normal'], machine_id: mach['Lavadora 1'] },
    { service_id: svc['Detergente (sobre)'], quantity: 1 },
  ] });
  createSale(as(new Date(Date.now() - 12 * 60_000), staffId), { customer_id: customers[5], payment_method: 'tarjeta', items: [
    { service_id: svc['Lavado agua caliente'], machine_id: mach['Lavadora 2'] },
    { service_id: svc['Suavizante (sobre)'], quantity: 1 },
  ] });
  createSale(as(new Date(Date.now() - 18 * 60_000), staffId), { payment_method: 'efectivo', items: [
    { service_id: svc['Secado 30 min'], machine_id: mach['Secadora 1'] },
  ] });
  db.prepare(`UPDATE machines SET status = 'mantenimiento' WHERE name = 'Secadora 3'`).run();

  console.log('Datos de demostración cargados.');
  if (created.length) {
    created.forEach((line) => console.log(line));
    console.log('  Estas contraseñas son solo para pruebas: cámbialas antes de usar la app en serio.');
  }
}

// pathToFileURL convierte bien rutas de Windows (C:\...) y de Linux/Mac.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const db = openDb(loadConfig().dbPath);
  seedCatalog(db);
  console.log('Catálogo de servicios y máquinas listo.');
  if (process.argv.includes('--demo')) seedDemo(db);
}
