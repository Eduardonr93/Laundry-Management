import crypto from 'node:crypto';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { createApp } from './app.js';
import { hashPassword } from './auth.js';

const config = loadConfig();
const db = openDb(config.dbPath);

// Primer arranque: crea el usuario administrador.
if (!db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
  const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(6).toString('base64url');
  db.prepare(`INSERT INTO users (name, username, password_hash, role, active, created_at)
    VALUES ('Administrador', 'admin', ?, 'admin', 1, ?)`).run(hashPassword(password), new Date().toISOString());
  console.log('Se creó el usuario administrador.');
  console.log(`  Usuario: admin   Contraseña: ${password}`);
  console.log('  Cámbiala en Ajustes → Usuarios después de entrar.');
}

const app = createApp({ db, config });
app.listen(config.port, () => {
  console.log(`Lavandería en marcha: http://localhost:${config.port}`);
});
