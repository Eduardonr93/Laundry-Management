import crypto from 'node:crypto';
import { HttpError, forbidden } from './errors.js';

export const SESSION_COOKIE = 'lav_session';

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

// Hash de relleno para que un usuario inexistente tarde lo mismo que uno real.
const DUMMY_HASH = hashPassword(crypto.randomBytes(12).toString('hex'));

export function verifyPassword(password, stored = DUMMY_HASH) {
  const [alg, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = crypto.scryptSync(String(password), Buffer.from(salt, 'base64'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

export function createSession(db, userId, hours, now) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + hours * 3600_000).toISOString();
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(sha256(token), userId, expiresAt);
  return token;
}

export function sessionUser(db, token, now) {
  if (!token) return null;
  return db.prepare(`
    SELECT u.id, u.name, u.username, u.role
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1
  `).get(sha256(token), now.toISOString()) ?? null;
}

export function deleteSession(db, token) {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    try {
      out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      // cookie mal formada: se ignora
    }
  }
  return out;
}

/** Bloquea temporalmente después de varios intentos fallidos de login. */
export class LoginLimiter {
  constructor({ maxAttempts = 5, blockMinutes = 5 } = {}) {
    this.maxAttempts = maxAttempts;
    this.blockMs = blockMinutes * 60_000;
    this.entries = new Map();
  }
  blocked(key, now) {
    const e = this.entries.get(key);
    return Boolean(e && e.until && e.until > now.getTime());
  }
  fail(key, now) {
    const e = this.entries.get(key) ?? { count: 0, until: 0 };
    if (e.until && e.until <= now.getTime()) { e.count = 0; e.until = 0; }
    e.count += 1;
    if (e.count >= this.maxAttempts) e.until = now.getTime() + this.blockMs;
    this.entries.set(key, e);
  }
  reset(key) {
    this.entries.delete(key);
  }
}

export function requireAuth(req, res, next) {
  if (!req.user) return next(new HttpError(401, 'Inicia sesión para continuar'));
  next();
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return next(forbidden('Solo el administrador puede hacer esto'));
  next();
}
