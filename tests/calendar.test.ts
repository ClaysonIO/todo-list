import { describe, expect, it } from 'vitest';
import { calendarEntries, monthGrid } from '../src/calendar';
import { TTL_MS, addPlanned, addSchedule, deserialize, emptyState, localDateKey, serialize, sweep, toggleItem } from '../src/store';
import type { State } from '../src/types';

const local = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi, 0, 0).getTime();
const H = 3_600_000;

function kinds(state: State, now: number, from = local(2026, 10, 1), to = local(2026, 11, 1)) {
  const map = calendarEntries(state, from, to, now);
  const out: Record<string, string[]> = {};
  for (const [key, list] of map) out[key] = list.map((e) => `${e.kind}:${e.text}`);
  return out;
}

describe('monthGrid', () => {
  it('covers whole weeks from the 1st to the last day', () => {
    const days = monthGrid(local(2026, 10, 15));
    expect(days.length % 7).toBe(0);
    expect(new Date(days[0]!).getDay()).toBe(0);
    expect(localDateKey(days[0]!)).toBe('2026-09-27');
    expect(localDateKey(days[days.length - 1]!)).toBe('2026-10-31');
    expect(days).toHaveLength(35);
  });
  it('never needs more than six rows', () => {
    for (let m = 1; m <= 24; m++) expect(monthGrid(local(2026, m, 1)).length).toBeLessThanOrEqual(42);
  });
});

describe('calendarEntries', () => {
  const now = local(2026, 10, 25, 12);

  it('puts open items on today and checked items on the day they were checked', () => {
    const s = emptyState();
    s.items.push(
      { id: 'a', text: 'open', createdAt: local(2026, 10, 24, 20), expiresAt: now + H, done: false, doneAt: null },
      { id: 'b', text: 'checked', createdAt: local(2026, 10, 24, 9), expiresAt: now + H, done: true, doneAt: local(2026, 10, 24, 22) },
    );
    expect(kinds(s, now)).toEqual({ '2026-10-25': ['open:open'], '2026-10-24': ['done:checked'] });
  });

  it('puts unchecked history on its creation day and checked history on its check day', () => {
    const s = emptyState();
    s.expired.push(
      { id: 'a', text: 'missed', createdAt: local(2026, 10, 10, 8), expiredAt: local(2026, 10, 11, 14), done: false, reason: 'timer' },
      { id: 'b', text: 'done', createdAt: local(2026, 10, 10, 8), expiredAt: local(2026, 10, 13, 1), done: true, doneAt: local(2026, 10, 12, 18), reason: 'nightly' },
      // legacy history without doneAt: a nightly clear lands on the evening before
      { id: 'c', text: 'legacy', createdAt: local(2026, 10, 1, 8), expiredAt: local(2026, 10, 3, 1), done: true, reason: 'nightly' },
    );
    expect(kinds(s, now)).toEqual({
      '2026-10-10': ['missed:missed'],
      '2026-10-12': ['done:done'],
      '2026-10-02': ['done:legacy'],
    });
  });

  it('records doneAt when a checked item expires', () => {
    const s = emptyState();
    s.items.push({ id: 'a', text: 'x', createdAt: local(2026, 10, 20, 9), expiresAt: local(2026, 10, 30), done: false, doneAt: null });
    toggleItem(s, 'a', local(2026, 10, 20, 18));
    sweep(s, local(2026, 10, 21, 2));
    expect(s.expired[0]!.doneAt).toBe(local(2026, 10, 20, 18));
  });

  it('shows planned one-offs and future recurring runs', () => {
    const s = emptyState();
    addPlanned(s, 'dentist', local(2026, 10, 28, 15), now);
    addSchedule(s, 'bins', '0 9 * * 1', now); // Mondays 09:00
    addSchedule(s, 'noon', '0 18 * * *', now);
    s.schedules[1]!.enabled = false;
    expect(kinds(s, now)).toEqual({
      '2026-10-26': ['recurring:bins'],
      '2026-10-28': ['planned:dentist'],
    });
  });

  it('shows one entry per day for schedules that run many times a day, starting after now', () => {
    const s = emptyState();
    addSchedule(s, 'hourly', '0 * * * *', now);
    const out = kinds(s, now);
    expect(Object.keys(out).sort()).toEqual(['2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31']);
    const today = calendarEntries(s, local(2026, 10, 25), local(2026, 10, 26), now).get('2026-10-25')!;
    expect(today).toHaveLength(1);
    expect(today[0]!.at).toBe(local(2026, 10, 25, 13));
  });
});

describe('planned tasks', () => {
  it('join the list when their day arrives', () => {
    const s = emptyState();
    const now = local(2026, 10, 25, 12);
    const p = addPlanned(s, '  call mum ', local(2026, 10, 27, 15), now)!;
    expect(p.at).toBe(local(2026, 10, 27));
    expect(addPlanned(s, ' ', local(2026, 10, 27), now)).toBeNull();
    expect(sweep(s, local(2026, 10, 26, 23)).scheduled).toBe(0);
    const later = local(2026, 10, 27, 7);
    expect(sweep(s, later).scheduled).toBe(1);
    expect(s.planned).toHaveLength(0);
    expect(s.items[0]).toMatchObject({ text: 'call mum', createdAt: local(2026, 10, 27), expiresAt: later + TTL_MS, done: false });
  });
  it('survive a save and load', () => {
    const s = emptyState();
    addPlanned(s, 'x', local(2026, 10, 27), 0);
    expect(deserialize(serialize(s)).planned).toEqual(s.planned);
  });
});
