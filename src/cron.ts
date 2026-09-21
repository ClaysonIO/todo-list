/**
 * Minimal 5-field cron matcher (minute hour day-of-month month day-of-week).
 * Supports `*`, lists (`1,15`), ranges (`1-5`), steps (`*\/10`, `1-30/5`),
 * month names (jan..dec) and weekday names (sun..sat, 0 or 7 = Sunday).
 * Standard cron semantics: when both day-of-month and day-of-week are
 * restricted, a date matches if EITHER matches.
 */

export interface CronSpec {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
  domRestricted: boolean;
  dowRestricted: boolean;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const ALIASES: Record<string, string> = {
  '@hourly': '0 * * * *',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@weekly': '0 0 * * 0',
  '@monthly': '0 0 1 * *',
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
};

function parseValue(token: string, names: string[] | null, min: number, max: number): number {
  const lower = token.toLowerCase();
  if (names) {
    const idx = names.indexOf(lower.slice(0, 3));
    if (idx >= 0 && lower.length === 3) return idx + (names === MONTHS ? 1 : 0);
  }
  if (!/^\d+$/.test(token)) throw new Error(`Invalid value "${token}"`);
  const n = Number(token);
  if (n < min || n > max) throw new Error(`Value ${n} out of range ${min}-${max}`);
  return n;
}

function parseField(field: string, min: number, max: number, names: string[] | null): { set: Set<number>; restricted: boolean } {
  const set = new Set<number>();
  let restricted = false;
  for (const part of field.split(',')) {
    if (part === '') throw new Error('Empty list entry');
    const [rangePart, stepPart] = part.split('/');
    if (rangePart === undefined) throw new Error('Invalid field');
    let step = 1;
    if (stepPart !== undefined) {
      if (!/^\d+$/.test(stepPart) || Number(stepPart) < 1) throw new Error(`Invalid step "${stepPart}"`);
      step = Number(stepPart);
    }
    let lo: number;
    let hi: number;
    if (rangePart === '*') {
      lo = min;
      hi = max;
      if (stepPart !== undefined) restricted = true;
    } else {
      restricted = true;
      const dash = rangePart.split('-');
      if (dash.length === 1) {
        lo = parseValue(dash[0]!, names, min, max);
        hi = stepPart !== undefined ? max : lo;
      } else if (dash.length === 2) {
        lo = parseValue(dash[0]!, names, min, max);
        hi = parseValue(dash[1]!, names, min, max);
        if (hi < lo) throw new Error(`Range ${rangePart} is reversed`);
      } else {
        throw new Error(`Invalid range "${rangePart}"`);
      }
    }
    for (let v = lo; v <= hi; v += step) set.add(v);
  }
  return { set, restricted };
}

export function parseCron(expr: string): CronSpec {
  const trimmed = expr.trim().toLowerCase();
  const source = ALIASES[trimmed] ?? trimmed;
  const fields = source.split(/\s+/);
  if (fields.length !== 5) throw new Error('Expected 5 fields: minute hour day month weekday');
  const [m, h, dom, mon, dow] = fields as [string, string, string, string, string];
  const minute = parseField(m, 0, 59, null);
  const hour = parseField(h, 0, 23, null);
  const domF = parseField(dom, 1, 31, null);
  const monthF = parseField(mon, 1, 12, MONTHS);
  const dowF = parseField(dow, 0, 7, DAYS);
  if (dowF.set.has(7)) {
    dowF.set.delete(7);
    dowF.set.add(0);
  }
  return {
    minute: minute.set,
    hour: hour.set,
    dom: domF.set,
    month: monthF.set,
    dow: dowF.set,
    domRestricted: domF.restricted,
    dowRestricted: dowF.restricted,
  };
}

export function isValidCron(expr: string): boolean {
  try {
    parseCron(expr);
    return true;
  } catch {
    return false;
  }
}

export function cronError(expr: string): string | null {
  try {
    parseCron(expr);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** Does the given local Date (to minute precision) match the spec? */
export function cronMatches(spec: CronSpec, d: Date): boolean {
  if (!spec.minute.has(d.getMinutes())) return false;
  if (!spec.hour.has(d.getHours())) return false;
  if (!spec.month.has(d.getMonth() + 1)) return false;
  const domOk = spec.dom.has(d.getDate());
  const dowOk = spec.dow.has(d.getDay());
  if (spec.domRestricted && spec.dowRestricted) return domOk || dowOk;
  if (spec.domRestricted) return domOk;
  if (spec.dowRestricted) return dowOk;
  return true;
}

const MINUTE = 60_000;

function floorMinute(t: number): number {
  return Math.floor(t / MINUTE) * MINUTE;
}

/**
 * Next matching time strictly after `after` (epoch ms), or null if none
 * within `maxDays`. Walks minute by minute but skips whole hours/days that
 * cannot match, so typical expressions resolve in microseconds.
 */
export function nextOccurrence(spec: CronSpec, after: number, maxDays = 366): number | null {
  const limit = after + maxDays * 86_400_000;
  let t = floorMinute(after) + MINUTE;
  while (t <= limit) {
    const d = new Date(t);
    if (!spec.month.has(d.getMonth() + 1)) {
      // jump to first minute of next month
      d.setMonth(d.getMonth() + 1, 1);
      d.setHours(0, 0, 0, 0);
      t = d.getTime();
      continue;
    }
    if (!dayMatches(spec, d)) {
      d.setDate(d.getDate() + 1);
      d.setHours(0, 0, 0, 0);
      t = d.getTime();
      continue;
    }
    if (!spec.hour.has(d.getHours())) {
      d.setHours(d.getHours() + 1, 0, 0, 0);
      t = d.getTime();
      continue;
    }
    if (spec.minute.has(d.getMinutes())) return t;
    t += MINUTE;
  }
  return null;
}

function dayMatches(spec: CronSpec, d: Date): boolean {
  const domOk = spec.dom.has(d.getDate());
  const dowOk = spec.dow.has(d.getDay());
  if (spec.domRestricted && spec.dowRestricted) return domOk || dowOk;
  if (spec.domRestricted) return domOk;
  if (spec.dowRestricted) return dowOk;
  return true;
}

/**
 * The most recent firing in the window (after, until], or null if none.
 * Used when the app was closed across several runs: we want the latest one.
 */
export function lastFiredBetween(spec: CronSpec, after: number, until: number, maxIterations = 20_000): number | null {
  if (until <= after) return null;
  const days = Math.ceil((until - after) / 86_400_000) + 1;
  let last: number | null = null;
  let cursor = after;
  for (let i = 0; i < maxIterations; i++) {
    const next = nextOccurrence(spec, cursor, days);
    if (next === null || next > until) break;
    last = next;
    cursor = next;
  }
  return last;
}

/** Human-readable summary for a handful of common shapes; falls back to the raw expression. */
export function describeCron(expr: string): string {
  try {
    const spec = parseCron(expr);
    const pad = (n: number) => String(n).padStart(2, '0');
    const single = (s: Set<number>) => (s.size === 1 ? [...s][0]! : null);
    const min = single(spec.minute);
    const hr = single(spec.hour);
    if (min !== null && hr !== null) {
      const time = `${pad(hr)}:${pad(min)}`;
      if (!spec.domRestricted && !spec.dowRestricted) return `Every day at ${time}`;
      if (spec.dowRestricted && !spec.domRestricted) {
        const days = [...spec.dow].sort((a, b) => a - b).map((d) => DAYS[d]!.replace(/^\w/, (c) => c.toUpperCase()));
        const isWeekdays = days.join() === 'Mon,Tue,Wed,Thu,Fri';
        const isWeekend = days.join() === 'Sun,Sat';
        return `${isWeekdays ? 'Weekdays' : isWeekend ? 'Weekends' : days.join(', ')} at ${time}`;
      }
      if (spec.domRestricted && !spec.dowRestricted && spec.dom.size === 1) {
        return `Day ${[...spec.dom][0]} of each month at ${time}`;
      }
    }
    if (hr === null && min !== null && spec.hour.size === 24 && !spec.domRestricted && !spec.dowRestricted) {
      return `Every hour at :${pad(min)}`;
    }
    return expr;
  } catch {
    return expr;
  }
}
