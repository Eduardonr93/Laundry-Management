import { bad } from './errors.js';

export function str(value, field, { required = false, max = 200 } = {}) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') throw bad(`${field}: valor inválido`);
  const v = value.trim();
  if (required && !v) throw bad(`${field} es obligatorio`);
  if (v.length > max) throw bad(`${field} es demasiado largo (máximo ${max} caracteres)`);
  return v;
}

export function int(value, field, { min = -Infinity, max = Infinity } = {}) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${field}: valor inválido`);
  return n;
}

export function num(value, field, { min = 0, max = 1e6 } = {}) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) throw bad(`${field}: valor inválido`);
  return n;
}

export function oneOf(value, field, options) {
  if (!options.includes(value)) throw bad(`${field}: valor inválido`);
  return value;
}

export const id = (value, field) => int(value, field, { min: 1 });

export const bool = (value) => (value === true || value === 1 || value === '1' || value === 'on' ? 1 : 0);
