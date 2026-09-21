import type { State } from './types';

function cell(v: string | number | boolean | null): string {
  if (v === null) return '';
  const s = typeof v === 'number' ? new Date(v).toISOString() : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** All items (active, checked and expired) as one CSV. Timestamps are ISO-8601 UTC. */
export function toCsv(state: State): string {
  const rows: string[] = ['id,text,status,created_at,expires_at,done_at,expired_at,expiry_reason'];
  for (const i of state.items) {
    rows.push([i.id, i.text, i.done ? 'done' : 'active', i.createdAt, i.expiresAt, i.doneAt, null, null].map(cell).join(','));
  }
  const expired = [...state.expired].sort((a, b) => b.expiredAt - a.expiredAt);
  for (const e of expired) {
    rows.push([e.id, e.text, 'expired', e.createdAt, null, null, e.expiredAt, `${e.reason}${e.done ? ' (was checked)' : ''}`].map(cell).join(','));
  }
  return rows.join('\r\n') + '\r\n';
}

export function csvFilename(now = Date.now()): string {
  const d = new Date(now);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `quick-todo-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.csv`;
}
