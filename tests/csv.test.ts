import { describe, expect, it } from 'vitest';
import { fromCsv, parseCsv, toCsv } from '../src/csv';
import { addItem, addPlanned, emptyState, mergeImport, sweep, toggleItem, TTL_MS } from '../src/store';

const H = 3_600_000;

describe('parseCsv', () => {
  it('handles quotes, escaped quotes, embedded newlines and CRLF', () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\r\n"multi\nline",\r\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
      ['multi\nline', ''],
    ]);
  });
  it('ignores blank lines and a missing trailing newline', () => {
    expect(parseCsv('a\n\nb')).toEqual([['a'], ['b']]);
  });
});

describe('fromCsv', () => {
  it('round-trips everything toCsv writes', () => {
    const now = Date.UTC(2026, 9, 25, 12);
    const s = emptyState();
    const a = addItem(s, 'say "hi", friend\nsecond line', now)!;
    const b = addItem(s, 'checked', now - H)!;
    toggleItem(s, b.id, now);
    s.expired.push(
      { id: 'e1', text: 'missed', createdAt: now - 40 * H, expiredAt: now - 10 * H, done: false, doneAt: null, reason: 'timer' },
      { id: 'e2', text: 'cleared', createdAt: now - 30 * H, expiredAt: now - 11 * H, done: true, doneAt: now - 20 * H, reason: 'nightly' },
    );
    addPlanned(s, 'later', now + 48 * H, now);

    const back = fromCsv(toCsv(s));
    expect(back.skipped).toBe(0);
    expect(back.items).toEqual(expect.arrayContaining(s.items));
    expect(back.items).toHaveLength(2);
    expect(back.expired).toEqual(expect.arrayContaining(s.expired));
    expect(back.planned).toEqual([{ ...s.planned[0]!, createdAt: s.planned[0]!.at }]);
    expect(back.items.find((i) => i.id === a.id)!.text).toBe('say "hi", friend\nsecond line');
  });

  it('rejects files that are not an export', () => {
    expect(() => fromCsv('name,age\nbob,3\n')).toThrow('Not a Quick Todo CSV export');
    expect(() => fromCsv('')).toThrow();
  });

  it('skips unreadable rows and fills sensible defaults', () => {
    const csv = [
      '﻿id,text,status,created_at,expires_at,done_at,expired_at,expiry_reason',
      'x,ok,active,2026-10-25T00:00:00.000Z,,,,',
      'y,,active,2026-10-25T00:00:00.000Z,,,,',
      'z,bad date,active,yesterday,,,,',
      'w,weird,archived,2026-10-25T00:00:00.000Z,,,,',
    ].join('\n');
    const r = fromCsv(csv);
    expect(r.skipped).toBe(3);
    expect(r.items).toEqual([
      { id: 'x', text: 'ok', createdAt: Date.UTC(2026, 9, 25), expiresAt: Date.UTC(2026, 9, 25) + TTL_MS, done: false, doneAt: null },
    ]);
  });
});

describe('mergeImport', () => {
  it('adds only new ids, keeps active before done, and lets sweep expire stale timers', () => {
    const now = Date.UTC(2026, 9, 25, 12);
    const s = emptyState();
    const kept = addItem(s, 'kept', now)!;
    const data = {
      items: [
        { ...kept, text: 'dupe' },
        { id: 'n1', text: 'new done', createdAt: now, expiresAt: now + H, done: true, doneAt: now },
        { id: 'n2', text: 'new open', createdAt: now, expiresAt: now + H, done: false, doneAt: null },
        { id: 'n3', text: 'stale', createdAt: now - 40 * H, expiresAt: now - H, done: false, doneAt: null },
      ],
      expired: [],
      planned: [],
    };
    expect(mergeImport(s, data)).toBe(3);
    expect(s.items.map((i) => i.text)).toEqual(['kept', 'new open', 'stale', 'new done']);
    expect(mergeImport(s, data)).toBe(0);
    sweep(s, now);
    expect(s.items.map((i) => i.text)).toEqual(['kept', 'new open', 'new done']);
    expect(s.expired.map((e) => e.text)).toEqual(['stale']);
  });
});
