// Configuración por variables de entorno. Ver README.md.
export function loadConfig(env = process.env) {
  return {
    port: Number(env.PORT || 3000),
    dbPath: env.DB_PATH || 'data/lavanderia.db',
    // Cancún está en UTC-05:00 todo el año (sin horario de verano).
    utcOffset: env.UTC_OFFSET || '-05:00',
    // Actívalo (SECURE_COOKIES=1) cuando la app se sirva por HTTPS.
    secureCookies: env.SECURE_COOKIES === '1',
    // Actívalo (TRUST_PROXY=1) si hay un proxy inverso (nginx, Caddy) delante.
    trustProxy: env.TRUST_PROXY === '1' ? 1 : false,
    sessionHours: Number(env.SESSION_HOURS || 12),
  };
}
