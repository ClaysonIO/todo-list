import { describe, expect, it } from 'vitest';
import { cronMatches, describeCron, isValidCron, lastFiredBetween, nextOccurrence, parseCron } from '../src/cron';

const local = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi, 0, 0);

describe('parseCron', () => {
  it('accepts common expressions', () => {
    expect(isValidCron('0 9 * * *')).toBe(true);
    expect(isValidCron('*/15 * * * *')).toBe(true);
    expect(isValidCron('30 7 * * mon-fri')).toBe(true);
    expect(isValidCron('0 0 1 jan,jul *')).toBe(true);
    expect(isValidCron('@daily')).toBe(true);
  });
  it('rejects bad expressions', () => {
    expect(isValidCron('')).toBe(false);
    expect(isValidCron('0 9 * *')).toBe(false);
    expect(isValidCron('60 9 * * *')).toBe(false);
    expect(isValidCron('0 24 * * *')).toBe(false);
    expect(isValidCron('a b c d e')).toBe(false);
    expect(isValidCron('5-1 * * * *')).toBe(false);
    expect(isValidCron('*/0 * * * *')).toBe(false);
  });
  it('normalises sunday=7', () => {
    const spec = parseCron('0 0 * * 7');
    expect(spec.dow.has(0)).toBe(true);
    expect(spec.dow.has(7)).toBe(false);
  });
});

describe('cronMatches', () => {
  it('matches minute/hour', () => {
    const spec = parseCron('30 9 * * *');
    expect(cronMatches(spec, local(2026, 9, 21, 9, 30))).toBe(true);
    expect(cronMatches(spec, local(2026, 9, 21, 9, 31))).toBe(false);
  });
  it('uses OR when both day fields are restricted', () => {
    const spec = parseCron('0 0 15 * mon');
    expect(cronMatches(spec, local(2026, 9, 15))).toBe(true); // 15th (a Tuesday)
    expect(cronMatches(spec, local(2026, 9, 21))).toBe(true); // Monday
    expect(cronMatches(spec, local(2026, 9, 22))).toBe(false);
  });
});

describe('nextOccurrence', () => {
  it('finds the next daily run', () => {
    const spec = parseCron('0 9 * * *');
    const from = local(2026, 9, 21, 10, 0).getTime();
    expect(nextOccurrence(spec, from)).toBe(local(2026, 9, 22, 9, 0).getTime());
  });
  it('is strictly after the start', () => {
    const spec = parseCron('0 9 * * *');
    const at = local(2026, 9, 21, 9, 0).getTime();
    expect(nextOccurrence(spec, at)).toBe(local(2026, 9, 22, 9, 0).getTime());
  });
  it('skips to weekdays', () => {
    const spec = parseCron('0 8 * * mon-fri');
    const sat = local(2026, 9, 19, 12, 0).getTime();
    expect(nextOccurrence(spec, sat)).toBe(local(2026, 9, 21, 8, 0).getTime());
  });
  it('handles monthly and step expressions', () => {
    expect(nextOccurrence(parseCron('0 0 1 * *'), local(2026, 9, 21).getTime())).toBe(local(2026, 10, 1).getTime());
    expect(nextOccurrence(parseCron('*/20 * * * *'), local(2026, 9, 21, 9, 5).getTime())).toBe(local(2026, 9, 21, 9, 20).getTime());
  });
  it('returns null when nothing matches in range', () => {
    expect(nextOccurrence(parseCron('0 0 31 feb *'), local(2026, 1, 1).getTime(), 400)).toBeNull();
  });
});

describe('lastFiredBetween', () => {
  it('reports the latest firing inside the window', () => {
    const spec = parseCron('0 9 * * *');
    const a = local(2026, 9, 20, 10, 0).getTime();
    const b = local(2026, 9, 23, 10, 0).getTime();
    expect(lastFiredBetween(spec, a, b)).toBe(local(2026, 9, 23, 9, 0).getTime());
  });
  it('includes a firing exactly at the end of the window', () => {
    const spec = parseCron('0 9 * * *');
    const a = local(2026, 9, 20, 10, 0).getTime();
    const b = local(2026, 9, 21, 9, 0).getTime();
    expect(lastFiredBetween(spec, a, b)).toBe(b);
  });
  it('returns null when window does not include a firing', () => {
    const spec = parseCron('0 9 * * *');
    const a = local(2026, 9, 21, 9, 30).getTime();
    const b = local(2026, 9, 21, 12, 0).getTime();
    expect(lastFiredBetween(spec, a, b)).toBeNull();
    expect(lastFiredBetween(spec, b, a)).toBeNull();
  });
});

describe('describeCron', () => {
  it('summarises common shapes', () => {
    expect(describeCron('0 9 * * *')).toBe('Every day at 09:00');
    expect(describeCron('30 7 * * 1-5')).toBe('Weekdays at 07:30');
    expect(describeCron('0 10 * * 0,6')).toBe('Weekends at 10:00');
    expect(describeCron('0 12 1 * *')).toBe('Day 1 of each month at 12:00');
    expect(describeCron('15 * * * *')).toBe('Every hour at :15');
    expect(describeCron('bad')).toBe('bad');
  });
});
