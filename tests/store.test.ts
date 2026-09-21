import { describe, expect, it } from 'vitest';
import {
  TTL_MS,
  addItem,
  addSchedule,
  deleteItem,
  deserialize,
  editItem,
  emptyState,
  groupExpired,
  lastNightlyBoundary,
  moveItem,
  renewItem,
  serialize,
  sweep,
  toggleItem,
  visibleItems,
} from '../src/store';
import { toCsv } from '../src/csv';

const local = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi, 0, 0).getTime();
const H = 3_600_000;

describe('items', () => {
  it('adds new items to the top with a 30h timer', () => {
    const s = emptyState();
    const now = local(2026, 9, 21, 10);
    addItem(s, 'first', now);
    addItem(s, 'second', now + 1);
    expect(s.items.map((i) => i.text)).toEqual(['second', 'first']);
    expect(s.items[1]!.expiresAt).toBe(now + TTL_MS);
    expect(TTL_MS).toBe(30 * H);
  });
  it('ignores blank text', () => {
    const s = emptyState();
    expect(addItem(s, '   ', 0)).toBeNull();
    expect(s.items).toHaveLength(0);
  });
  it('edits, deletes, toggles and renews', () => {
    const s = emptyState();
    const now = local(2026, 9, 21, 10);
    const item = addItem(s, 'a', now)!;
    expect(editItem(s, item.id, '  b ')).toBe(true);
    expect(item.text).toBe('b');
    expect(editItem(s, item.id, '')).toBe(false);
    expect(toggleItem(s, item.id, now + H)).toBe(true);
    expect(item.done).toBe(true);
    expect(item.doneAt).toBe(now + H);
    expect(toggleItem(s, item.id, now + 2 * H)).toBe(true);
    expect(item.doneAt).toBeNull();
    expect(renewItem(s, item.id, now + 5 * H)).toBe(true);
    expect(item.expiresAt).toBe(now + 5 * H + TTL_MS);
    expect(deleteItem(s, item.id)).toBe(true);
    expect(deleteItem(s, item.id)).toBe(false);
  });
  it('shows checked items at the bottom', () => {
    const s = emptyState();
    const a = addItem(s, 'a', 3)!;
    addItem(s, 'b', 2)!;
    addItem(s, 'c', 1)!;
    toggleItem(s, a.id, 10);
    expect(visibleItems(s).map((i) => i.text)).toEqual(['c', 'b', 'a']);
  });
});

describe('moveItem', () => {
  function setup() {
    const s = emptyState();
    ['d', 'c', 'b', 'a'].forEach((t, i) => addItem(s, t, i)); // order: a b c d
    return s;
  }
  it('moves before a target', () => {
    const s = setup();
    const d = s.items.find((i) => i.text === 'd')!;
    const b = s.items.find((i) => i.text === 'b')!;
    expect(moveItem(s, d.id, b.id)).toBe(true);
    expect(s.items.map((i) => i.text)).toEqual(['a', 'd', 'b', 'c']);
  });
  it('moves to end with null target', () => {
    const s = setup();
    const a = s.items.find((i) => i.text === 'a')!;
    moveItem(s, a.id, null);
    expect(s.items.map((i) => i.text)).toEqual(['b', 'c', 'd', 'a']);
  });
  it('keeps done items below active ones', () => {
    const s = setup();
    const c = s.items.find((i) => i.text === 'c')!;
    const a = s.items.find((i) => i.text === 'a')!;
    toggleItem(s, c.id, 100);
    expect(moveItem(s, c.id, a.id)).toBe(false); // different section
    moveItem(s, a.id, null);
    expect(visibleItems(s).map((i) => i.text)).toEqual(['b', 'd', 'a', 'c']);
  });
});

describe('lastNightlyBoundary', () => {
  it('is 01:00 today when after 1am', () => {
    expect(lastNightlyBoundary(local(2026, 9, 21, 9))).toBe(local(2026, 9, 21, 1));
  });
  it('is 01:00 yesterday when before 1am', () => {
    expect(lastNightlyBoundary(local(2026, 9, 21, 0, 30))).toBe(local(2026, 9, 20, 1));
  });
  it('is exactly the boundary at 01:00', () => {
    expect(lastNightlyBoundary(local(2026, 9, 21, 1))).toBe(local(2026, 9, 21, 1));
  });
});

describe('sweep', () => {
  it('expires items whose timer ran out, checked or not', () => {
    const s = emptyState();
    const t0 = local(2026, 9, 21, 10);
    const a = addItem(s, 'a', t0)!;
    const b = addItem(s, 'b', t0)!;
    toggleItem(s, b.id, t0 + 1);
    // 1am boundary between t0 and t0+30h will also catch b; use a window
    // that avoids it: check just before expiry first.
    const beforeExpiry = t0 + TTL_MS - 1;
    // b was checked before the 1am boundary so it expires nightly; a stays.
    let r = sweep(s, beforeExpiry);
    expect(r.expired).toBe(1);
    expect(s.expired[0]!.reason).toBe('nightly');
    expect(s.items.map((i) => i.id)).toEqual([a.id]);
    r = sweep(s, t0 + TTL_MS);
    expect(r.expired).toBe(1);
    expect(s.items).toHaveLength(0);
    expect(s.expired[1]!.reason).toBe('timer');
    expect(s.expired[1]!.expiredAt).toBe(t0 + TTL_MS);
  });
  it('expires checked items at 1am even if the timer is fresh', () => {
    const s = emptyState();
    const t0 = local(2026, 9, 21, 22);
    const a = addItem(s, 'a', t0)!;
    const b = addItem(s, 'b', t0)!;
    toggleItem(s, a.id, t0 + 10 * 60_000);
    expect(sweep(s, local(2026, 9, 22, 0, 59)).expired).toBe(0);
    const r = sweep(s, local(2026, 9, 22, 1, 0));
    expect(r.expired).toBe(1);
    expect(s.items.map((i) => i.id)).toEqual([b.id]);
    expect(s.expired[0]!.expiredAt).toBe(local(2026, 9, 22, 1));
    expect(s.expired[0]!.done).toBe(true);
  });
  it('does not expire an item checked after the boundary', () => {
    const s = emptyState();
    const a = addItem(s, 'a', local(2026, 9, 21, 2))!;
    toggleItem(s, a.id, local(2026, 9, 21, 3));
    expect(sweep(s, local(2026, 9, 21, 20)).expired).toBe(0);
  });
  it('fires schedules once even after several missed runs', () => {
    const s = emptyState();
    const created = local(2026, 9, 18, 12);
    const sched = addSchedule(s, 'Water plants', '0 9 * * *', created);
    expect(sweep(s, local(2026, 9, 18, 13)).scheduled).toBe(0);
    const r = sweep(s, local(2026, 9, 21, 10));
    expect(r.scheduled).toBe(1);
    expect(s.items).toHaveLength(1);
    expect(s.items[0]!.text).toBe('Water plants');
    // latest missed run wins, and the timer starts from when it appeared
    expect(s.items[0]!.createdAt).toBe(local(2026, 9, 21, 9));
    expect(s.items[0]!.expiresAt).toBe(local(2026, 9, 21, 10) + TTL_MS);
    expect(sched.lastFiredAt).toBe(local(2026, 9, 21, 9));
    // checked again right away: nothing new
    expect(sweep(s, local(2026, 9, 21, 10, 1)).scheduled).toBe(0);
    // next day it fires again
    expect(sweep(s, local(2026, 9, 22, 9, 30)).scheduled).toBe(1);
  });
  it('skips disabled schedules and does not backfill when re-enabled', () => {
    const s = emptyState();
    const sched = addSchedule(s, 'x', '0 9 * * *', local(2026, 9, 18, 12));
    sched.enabled = false;
    expect(sweep(s, local(2026, 9, 21, 10)).scheduled).toBe(0);
    sched.enabled = true;
    expect(sweep(s, local(2026, 9, 21, 10, 5)).scheduled).toBe(0);
  });
  it('rejects invalid cron on add', () => {
    expect(() => addSchedule(emptyState(), 'x', 'nope', 0)).toThrow();
  });
});

describe('persistence', () => {
  it('round-trips and survives garbage', () => {
    const s = emptyState();
    addItem(s, 'a', 1);
    const copy = deserialize(serialize(s));
    expect(copy.items[0]!.text).toBe('a');
    expect(deserialize('{not json').items).toEqual([]);
    expect(deserialize(null).theme).toBe('system');
    expect(deserialize('{"items":[{"bad":true}],"theme":"dark"}')).toEqual({ ...emptyState(), theme: 'dark' });
  });
});

describe('groupExpired', () => {
  it('groups by local day, newest first', () => {
    const groups = groupExpired([
      { id: '1', text: 'a', createdAt: 0, expiredAt: local(2026, 9, 20, 9), done: false, reason: 'timer' },
      { id: '2', text: 'b', createdAt: 0, expiredAt: local(2026, 9, 21, 1), done: true, reason: 'nightly' },
      { id: '3', text: 'c', createdAt: 0, expiredAt: local(2026, 9, 20, 15), done: false, reason: 'timer' },
    ]);
    expect(groups.map((g) => g.key)).toEqual(['2026-09-21', '2026-09-20']);
    expect(groups[1]!.items.map((i) => i.id)).toEqual(['3', '1']);
  });
});

describe('csv', () => {
  it('quotes and escapes', () => {
    const s = emptyState();
    addItem(s, 'say "hi", friend', 0);
    s.expired.push({ id: 'e', text: 'old', createdAt: 0, expiredAt: 1000, done: true, reason: 'nightly' });
    const csv = toCsv(s);
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe('id,text,status,created_at,expires_at,done_at,expired_at,expiry_reason');
    expect(lines[1]).toContain('"say ""hi"", friend",active,1970-01-01T00:00:00.000Z');
    expect(lines[2]).toContain('old,expired,1970-01-01T00:00:00.000Z,,,1970-01-01T00:00:01.000Z,nightly (was checked)');
  });
});
