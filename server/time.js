// La lavandería trabaja con un desfase fijo respecto a UTC (UTC_OFFSET).
// Las fechas se guardan en UTC (ISO 8601) y los "días" del corte de caja
// se calculan con ese desfase.

export function offsetMinutes(offset) {
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(offset);
  if (!m) throw new Error(`UTC_OFFSET inválido: ${offset} (usa el formato -05:00)`);
  const minutes = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === '-' ? -minutes : minutes;
}

/** Fecha local (YYYY-MM-DD) de un instante. */
export function localDate(date, offset) {
  return new Date(date.getTime() + offsetMinutes(offset) * 60000).toISOString().slice(0, 10);
}

/** Rango [inicio, fin) en UTC ISO de un día local YYYY-MM-DD. */
export function dayRange(day, offset) {
  const start = new Date(`${day}T00:00:00${offset}`);
  if (Number.isNaN(start.getTime())) return null;
  return [start.toISOString(), new Date(start.getTime() + 86400000).toISOString()];
}

export const isDay = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
