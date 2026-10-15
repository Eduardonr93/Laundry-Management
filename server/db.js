import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

// Montos en centavos (enteros) para evitar errores de redondeo.
// Fechas en UTC con formato ISO 8601 (comparables como texto).
const MIGRATIONS = [
  `
  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE users (
    id            INTEGER PRIMARY KEY,
    name          TEXT NOT NULL,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('admin', 'empleado')),
    active        INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL
  );

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE customers (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    phone      TEXT NOT NULL DEFAULT '',
    email      TEXT NOT NULL DEFAULT '',
    address    TEXT NOT NULL DEFAULT '',
    notes      TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE INDEX customers_name ON customers(name COLLATE NOCASE);
  CREATE INDEX customers_phone ON customers(phone);

  CREATE TABLE services (
    id            INTEGER PRIMARY KEY,
    name          TEXT NOT NULL,
    category      TEXT NOT NULL CHECK (category IN ('encargo', 'autoservicio')),
    unit          TEXT NOT NULL CHECK (unit IN ('kg', 'pieza', 'servicio')),
    price_cents   INTEGER NOT NULL CHECK (price_cents >= 0),
    min_qty       REAL NOT NULL DEFAULT 0,
    machine_type  TEXT CHECK (machine_type IN ('lavadora', 'secadora')),
    cycle_minutes INTEGER,
    active        INTEGER NOT NULL DEFAULT 1,
    sort          INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE machines (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    type        TEXT NOT NULL CHECK (type IN ('lavadora', 'secadora')),
    capacity_kg REAL,
    status      TEXT NOT NULL DEFAULT 'disponible'
                CHECK (status IN ('disponible', 'mantenimiento', 'fuera_servicio')),
    active      INTEGER NOT NULL DEFAULT 1,
    sort        INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE counters (
    name  TEXT PRIMARY KEY,
    value INTEGER NOT NULL
  );

  CREATE TABLE orders (
    id            INTEGER PRIMARY KEY,
    folio         TEXT NOT NULL UNIQUE,
    kind          TEXT NOT NULL CHECK (kind IN ('encargo', 'autoservicio')),
    customer_id   INTEGER REFERENCES customers(id),
    status        TEXT NOT NULL CHECK (status IN
                  ('recibido', 'en_proceso', 'listo', 'entregado', 'completado', 'cancelado')),
    notes         TEXT NOT NULL DEFAULT '',
    due_at        TEXT,
    total_cents   INTEGER NOT NULL DEFAULT 0,
    created_by    INTEGER REFERENCES users(id),
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    delivered_at  TEXT,
    cancelled_at  TEXT,
    cancel_reason TEXT
  );
  CREATE INDEX orders_kind_status ON orders(kind, status);
  CREATE INDEX orders_created ON orders(created_at);
  CREATE INDEX orders_customer ON orders(customer_id);

  CREATE TABLE order_items (
    id               INTEGER PRIMARY KEY,
    order_id         INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    service_id       INTEGER REFERENCES services(id),
    description      TEXT NOT NULL,
    unit             TEXT NOT NULL,
    quantity         REAL NOT NULL,
    unit_price_cents INTEGER NOT NULL,
    amount_cents     INTEGER NOT NULL,
    machine_id       INTEGER REFERENCES machines(id)
  );
  CREATE INDEX order_items_order ON order_items(order_id);

  CREATE TABLE machine_uses (
    id         INTEGER PRIMARY KEY,
    machine_id INTEGER NOT NULL REFERENCES machines(id),
    order_id   INTEGER NOT NULL REFERENCES orders(id),
    started_at TEXT NOT NULL,
    ends_at    TEXT NOT NULL,
    stopped_at TEXT
  );
  CREATE INDEX machine_uses_machine ON machine_uses(machine_id, ends_at);

  CREATE TABLE payments (
    id           INTEGER PRIMARY KEY,
    order_id     INTEGER NOT NULL REFERENCES orders(id),
    amount_cents INTEGER NOT NULL,
    method       TEXT NOT NULL CHECK (method IN ('efectivo', 'tarjeta', 'transferencia')),
    kind         TEXT NOT NULL DEFAULT 'pago' CHECK (kind IN ('pago', 'reembolso')),
    created_by   INTEGER REFERENCES users(id),
    created_at   TEXT NOT NULL
  );
  CREATE INDEX payments_created ON payments(created_at);
  CREATE INDEX payments_order ON payments(order_id);

  CREATE TABLE order_events (
    id         INTEGER PRIMARY KEY,
    order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    event      TEXT NOT NULL,
    detail     TEXT NOT NULL DEFAULT '',
    user_id    INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL
  );
  CREATE INDEX order_events_order ON order_events(order_id);
  `,
];

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  migrate(db);
  return db;
}

function migrate(db) {
  const { user_version: current } = db.prepare('PRAGMA user_version').get();
  for (let v = current; v < MIGRATIONS.length; v++) {
    tx(db, () => {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

/** Ejecuta fn dentro de una transacción; revierte todo si lanza un error. */
export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
