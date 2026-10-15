import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpError } from './errors.js';
import { SESSION_COOKIE, parseCookies, requireAuth, sessionUser } from './auth.js';
import authRoutes from './routes/auth.js';
import catalogRoutes from './routes/catalog.js';
import businessRoutes from './routes/business.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': [
    "default-src 'self'", "img-src 'self' data:", "style-src 'self'", "script-src 'self'",
    "connect-src 'self'", "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'",
  ].join('; '),
};

export function createApp({ db, config, now = () => new Date() }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  const ctx = { db, config, now };

  app.use((req, res, next) => {
    res.set(SECURITY_HEADERS);
    next();
  });

  const api = express.Router();
  api.use(express.json({ limit: '100kb' }));
  // Toda escritura debe ser JSON: un formulario de otro sitio no puede enviarlo (protección CSRF).
  api.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && !req.is('application/json')) {
      return next(new HttpError(415, 'Las peticiones deben enviarse como JSON'));
    }
    next();
  });
  api.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    req.sessionToken = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    req.user = sessionUser(db, req.sessionToken, now());
    next();
  });

  authRoutes(api, ctx);
  api.use(requireAuth);
  catalogRoutes(api, ctx);
  businessRoutes(api, ctx);
  api.use((req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

  app.use('/api', api);
  app.use(express.static(PUBLIC_DIR));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'La petición es demasiado grande' });
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  });

  return app;
}
