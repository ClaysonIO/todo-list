import { TTL_MS, uid } from './store';
import type { ExpiredItem, Item, Planned, State } from './types';

function cell(v: string | number | boolean | null): string {
  if (v === null) return '';
  const s = typeof v === 'number' ? new Date(v).toISOString() : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** All items (active, checked, expired and planned) as one CSV. For planned rows created_at is the day they join the list. Timestamps are ISO-8601 UTC. */
export function toCsv(state: State): string {
  const rows: string[] = ['id,text,status,created_at,expires_at,done_at,expired_at,expiry_reason'];
  for (const i of state.items) {
    rows.push([i.id, i.text, i.done ? 'done' : 'active', i.createdAt, i.expiresAt, i.doneAt, null, null].map(cell).join(','));
  }
  const expired = [...state.expired].sort((a, b) => b.expiredAt - a.expiredAt);
  for (const e of expired) {
    rows.push([e.id, e.text, 'expired', e.createdAt, null, e.doneAt ?? null, e.expiredAt, `${e.reason}${e.done ? ' (was checked)' : ''}`].map(cell).join(','));
  }
  for (const p of state.planned) {
    rows.push([p.id, p.text, 'planned', p.at, null, null, null, null].map(cell).join(','));
  }
  return rows.join('\r\n') + '\r\n';
}

export function csvFilename(now = Date.now()): string {
  const d = new Date(now);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `quick-todo-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.csv`;
}

/** RFC 4180 rows: quoted fields may hold commas, doubled quotes and newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f !== ''));
}

export interface CsvImport {
  items: Item[];
  expired: ExpiredItem[];
  planned: Planned[];
  /** Rows that could not be read (unknown status, missing text or dates). */
  skipped: number;
}

/** Read a CSV written by toCsv back into items, history and planned tasks. Throws if it is not one. */
export function fromCsv(text: string): CsvImport {
  const [header, ...rows] = parseCsv(text.replace(/^﻿/, ''));
  const col = new Map((header ?? []).map((name, i) => [name.trim(), i]));
  for (const name of ['id', 'text', 'status', 'created_at']) {
    if (!col.has(name)) throw new Error('Not a Quick Todo CSV export');
  }
  const get = (r: string[], name: string) => r[col.get(name) ?? -1] ?? '';
  const time = (r: string[], name: string): number | null => {
    const v = get(r, name);
    if (!v) return null;
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  };

  const out: CsvImport = { items: [], expired: [], planned: [], skipped: 0 };
  for (const r of rows) {
    const id = get(r, 'id') || uid();
    const text = get(r, 'text').trim();
    const status = get(r, 'status');
    const createdAt = time(r, 'created_at');
    if (!text || createdAt === null) {
      out.skipped++;
      continue;
    }
    if (status === 'active' || status === 'done') {
      const done = status === 'done';
      out.items.push({
        id,
        text,
        createdAt,
        expiresAt: time(r, 'expires_at') ?? createdAt + TTL_MS,
        done,
        doneAt: done ? (time(r, 'done_at') ?? createdAt) : null,
      });
    } else if (status === 'expired') {
      const reason = get(r, 'expiry_reason');
      out.expired.push({
        id,
        text,
        createdAt,
        expiredAt: time(r, 'expired_at') ?? createdAt,
        done: reason.includes('was checked'),
        doneAt: time(r, 'done_at'),
        reason: reason.startsWith('nightly') ? 'nightly' : 'timer',
      });
    } else if (status === 'planned') {
      out.planned.push({ id, text, at: createdAt, createdAt });
    } else {
      out.skipped++;
    }
  }
  return out;
}
