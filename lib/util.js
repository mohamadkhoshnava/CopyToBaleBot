// lib/util — small helpers with no platform dependencies.

export const now = () => Math.floor(Date.now() / 1000);

// Tehran calendar day as YYYY-MM-DD (Iran has no DST).
export function day(daysAgo = 0) {
  return new Date(Date.now() + 3.5 * 3600e3 - daysAgo * 86400e3).toISOString().slice(0, 10);
}

export function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function randCode(n = 6) {
  let s = '';
  for (let i = 0; i < n; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

export const fa = (n) => Number(n || 0).toLocaleString('fa-IR');

export function ago(ms) {
  if (!ms) return 'هرگز';
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${fa(s)} ثانیه پیش`;
  if (s < 3600) return `${fa(Math.floor(s / 60))} دقیقه پیش`;
  if (s < 86400) return `${fa(Math.floor(s / 3600))} ساعت پیش`;
  return `${fa(Math.floor(s / 86400))} روز پیش`;
}

export function trunc(s, n) {
  s = String(s ?? '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

export function parseJSON(s, fallback) {
  if (s == null || s === '') return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}

export function errText(e) {
  if (!e) return 'unknown';
  return String(e.description || e.message || e).slice(0, 500);
}

export function escRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
