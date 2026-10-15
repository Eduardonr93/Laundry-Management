export const SETTING_DEFAULTS = {
  business_name: 'Mi Lavandería',
  business_address: '',
  business_phone: '',
  ticket_footer: 'Gracias por su preferencia. Después de 30 días no nos hacemos responsables por prendas no recogidas.',
  default_turnaround_hours: '24',
};

export function getSettings(db) {
  const settings = { ...SETTING_DEFAULTS };
  for (const row of db.prepare('SELECT key, value FROM settings').all()) {
    if (row.key in settings) settings[row.key] = row.value;
  }
  return { ...settings, default_turnaround_hours: Number(settings.default_turnaround_hours) || 24 };
}

export function saveSettings(db, values) {
  const stmt = db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
  for (const [key, value] of Object.entries(values)) {
    if (key in SETTING_DEFAULTS) stmt.run(key, String(value));
  }
}
