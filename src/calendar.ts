import { nextOccurrence, parseCron } from './cron';
import { NIGHTLY_HOUR, localDateKey } from './store';
import type { ExpiredItem, State } from './types';

/**
 * What a calendar day shows, in display order:
 *  - done:      checked, on the day it was checked
 *  - open:      on the list right now, shown on today
 *  - planned:   a one-off task added for a future day
 *  - recurring: a future run of an enabled scheduled task
 *  - missed:    timed out or cleared unchecked, on the day it was created
 */
export type EntryKind = 'done' | 'open' | 'planned' | 'recurring' | 'missed';

export const KIND_ORDER: EntryKind[] = ['open', 'planned', 'recurring', 'done', 'missed'];

export interface CalendarEntry {
  kind: EntryKind;
  /** Item, planned task or schedule id. */
  id: string;
  text: string;
  /** The moment that places the entry on its day. */
  at: number;
  /** Open items: when the 30h timer runs out. */
  expiresAt?: number;
  /** Recurring entries: the cron expression. */
  cron?: string;
}

/** Local midnight of the day containing `ts`. */
export function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function addDays(ts: number, days: number): number {
  const d = new Date(ts);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

/** First of the month containing `ts`, shifted by `offset` months. */
export function monthStart(ts: number, offset = 0): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth() + offset, 1).getTime();
}

/**
 * Midnights of every day shown for the month containing `month`: whole
 * weeks (Sunday first) from the week holding the 1st to the week holding
 * the last day. Four to six rows, so the month always fits one view.
 */
export function monthGrid(month: number): number[] {
  const first = monthStart(month);
  const last = addDays(monthStart(month, 1), -1);
  let day = addDays(first, -new Date(first).getDay());
  const end = addDays(last, 6 - new Date(last).getDay());
  const days: number[] = [];
  while (day <= end) {
    days.push(day);
    day = addDays(day, 1);
  }
  return days;
}

/**
 * Checked history recorded before `doneAt` was stored: a nightly clear
 * happens at 01:00 after the day it was checked, so step back past it.
 */
function expiredDoneAt(e: ExpiredItem): number {
  if (typeof e.doneAt === 'number') return e.doneAt;
  return e.reason === 'nightly' ? e.expiredAt - (NIGHTLY_HOUR + 1) * 3_600_000 : e.expiredAt;
}

/**
 * Every entry falling on a day in [from, to) (local midnights), keyed by
 * YYYY-MM-DD and sorted by kind then time.
 */
export function calendarEntries(state: State, from: number, to: number, now: number): Map<string, CalendarEntry[]> {
  const map = new Map<string, CalendarEntry[]>();
  const put = (e: CalendarEntry) => {
    if (e.at < from || e.at >= to) return;
    const key = localDateKey(e.at);
    const list = map.get(key);
    if (list) list.push(e);
    else map.set(key, [e]);
  };

  for (const i of state.items) {
    if (i.done) put({ kind: 'done', id: i.id, text: i.text, at: i.doneAt ?? i.createdAt });
    else put({ kind: 'open', id: i.id, text: i.text, at: now, expiresAt: i.expiresAt });
  }
  for (const e of state.expired) {
    if (e.done) put({ kind: 'done', id: e.id, text: e.text, at: expiredDoneAt(e) });
    else put({ kind: 'missed', id: e.id, text: e.text, at: e.createdAt });
  }
  for (const p of state.planned) put({ kind: 'planned', id: p.id, text: p.text, at: Math.max(p.at, now) });

  // One entry per schedule per day: its first run on that day after now
  // (a run at exactly now has already been added to the list by sweep).
  const start = Math.max(from - 1, now);
  for (const s of state.schedules) {
    if (!s.enabled || start >= to) continue;
    let spec;
    try {
      spec = parseCron(s.cron);
    } catch {
      continue;
    }
    let cursor = start;
    const days = Math.ceil((to - cursor) / 86_400_000) + 1;
    for (;;) {
      const next = nextOccurrence(spec, cursor, days);
      if (next === null || next >= to) break;
      put({ kind: 'recurring', id: s.id, text: s.text, at: next, cron: s.cron });
      cursor = addDays(startOfDay(next), 1) - 1;
    }
  }

  for (const list of map.values()) {
    list.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.at - b.at);
  }
  return map;
}
