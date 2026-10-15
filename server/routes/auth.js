import { HttpError } from '../errors.js';
import { str } from '../validate.js';
import {
  SESSION_COOKIE, LoginLimiter, createSession, deleteSession, verifyPassword,
} from '../auth.js';

export default function authRoutes(api, { db, config, now }) {
  const limiter = new LoginLimiter();

  api.post('/auth/login', (req, res) => {
    const username = str(req.body?.username, 'Usuario', { required: true, max: 60 });
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const key = `${req.ip}|${username.toLowerCase()}`;
    if (limiter.blocked(key, now())) {
      throw new HttpError(429, 'Demasiados intentos fallidos. Espera 5 minutos e intenta de nuevo.');
    }
    const user = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(username);
    if (!verifyPassword(password, user?.password_hash) || !user) {
      limiter.fail(key, now());
      throw new HttpError(401, 'Usuario o contraseña incorrectos');
    }
    limiter.reset(key);
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now().toISOString());
    const token = createSession(db, user.id, config.sessionHours, now());
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.secureCookies,
      maxAge: config.sessionHours * 3600_000,
      path: '/',
    });
    res.json({ user: { id: user.id, name: user.name, username: user.username, role: user.role } });
  });

  api.post('/auth/logout', (req, res) => {
    if (req.sessionToken) deleteSession(db, req.sessionToken);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  api.get('/auth/me', (req, res) => {
    if (!req.user) throw new HttpError(401, 'Inicia sesión para continuar');
    res.json({ user: req.user });
  });
}
