import { lastFiredBetween, parseCron } from './cron';
import type { ExpiredItem, ExpiryReason, Item, Schedule, State, Theme } from './types';

export const TTL_MS = 30 * 60 * 60 * 1000; // 30 hours
export const NIGHTLY_HOUR = 1; // checked items are cleared at 01:00 local time
export const MAX_EXPIRED = 2000; // history cap so localStorage never balloons
export const STORAGE_KEY = 'quicktodo.v1';
export const THEME_KEY = 'quicktodo.theme';

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function emptyState(): State {
  return { items: [], expired: [], schedules: [], theme: 'system' };
}

/** Parse persisted JSON defensively; a corrupt blob must never block startup. */
export function deserialize(raw: string | null): State {
  const state = emptyState();
  if (!raw) return state;
  try {
    const parsed = JSON.parse(raw) as Partial<State>;
    if (Array.isArray(parsed.items)) {
      state.items = parsed.items.filter(isItem);
    }
    if (Array.isArray(parsed.expired)) state.expired = parsed.expired.filter(isExpired);
    if (Array.isArray(parsed.schedules)) state.schedules = parsed.schedules.filter(isSchedule);
    if (parsed.theme === 'light' || parsed.theme === 'dark' || parsed.theme === 'system') state.theme = parsed.theme;
  } catch {
    /* ignore */
  }
  return state;
}

function isItem(x: unknown): x is Item {
  const o = x as Item;
  return !!o && typeof o.id === 'string' && typeof o.text === 'string' && typeof o.expiresAt === 'number';
}
function isExpired(x: unknown): x is ExpiredItem {
  const o = x as ExpiredItem;
  return !!o && typeof o.id === 'string' && typeof o.text === 'string' && typeof o.expiredAt === 'number';
}
function isSchedule(x: unknown): x is Schedule {
  const o = x as Schedule;
  return !!o && typeof o.id === 'string' && typeof o.text === 'string' && typeof o.cron === 'string';
}

export function serialize(state: State): string {
  return JSON.stringify(state);
}

export function load(): State {
  try {
    return deserialize(localStorage.getItem(STORAGE_KEY));
  } catch {
    return emptyState();
  }
}

export function save(state: State): void {
  try {
    localStorage.setItem(STORAGE_KEY, serialize(state));
    // Theme is also mirrored to its own key so the pre-paint inline script
    // in index.html can read it without parsing the whole state.
    localStorage.setItem(THEME_KEY, state.theme);
  } catch {
    /* quota or private mode: keep running in memory */
  }
}

// ---------------------------------------------------------------------------
// Item operations (pure: mutate the passed state, caller persists)
// ---------------------------------------------------------------------------

export function addItem(state: State, text: string, now: number): Item | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const item: Item = {
    id: uid(),
    text: trimmed,
    createdAt: now,
    expiresAt: now + TTL_MS,
    done: false,
    doneAt: null,
  };
  // New items go at the top of the active list.
  state.items.unshift(item);
  return item;
}

export function editItem(state: State, id: string, text: string): boolean {
  const item = state.items.find((i) => i.id === id);
  const trimmed = text.trim();
  if (!item || !trimmed || item.text === trimmed) return false;
  item.text = trimmed;
  return true;
}

export function deleteItem(state: State, id: string): boolean {
  const idx = state.items.findIndex((i) => i.id === id);
  if (idx < 0) return false;
  state.items.splice(idx, 1);
  return true;
}

export function toggleItem(state: State, id: string, now: number): boolean {
  const item = state.items.find((i) => i.id === id);
  if (!item) return false;
  item.done = !item.done;
  item.doneAt = item.done ? now : null;
  return true;
}

/** Restart the 30-hour timer from now. */
export function renewItem(state: State, id: string, now: number): boolean {
  const item = state.items.find((i) => i.id === id);
  if (!item) return false;
  item.expiresAt = now + TTL_MS;
  return true;
}

/**
 * Move `id` so that it sits immediately before `beforeId` (or at the end of
 * its section when beforeId is null). Items only move within their own
 * section (active or done) so a checked item can never float above an
 * unchecked one.
 */
export function moveItem(state: State, id: string, beforeId: string | null): boolean {
  const from = state.items.findIndex((i) => i.id === id);
  if (from < 0) return false;
  const moving = state.items[from]!;
  const section = state.items.filter((i) => i.done === moving.done && i.id !== id);
  let insertAt = section.length;
  if (beforeId) {
    const target = section.findIndex((i) => i.id === beforeId);
    if (target < 0) return false;
    insertAt = target;
  }
  section.splice(insertAt, 0, moving);
  const other = state.items.filter((i) => i.done !== moving.done);
  // Keep active items ahead of done items in storage as well as display.
  state.items = moving.done ? [...other, ...section] : [...section, ...other];
  return true;
}

/** Display order: active items in stored order, then checked items. */
export function visibleItems(state: State): Item[] {
  const active = state.items.filter((i) => !i.done);
  const done = state.items.filter((i) => i.done);
  return [...active, ...done];
}

// ---------------------------------------------------------------------------
// Expiry
// ---------------------------------------------------------------------------

/** Most recent 01:00 local time at or before `now`. */
export function lastNightlyBoundary(now: number): number {
  const d = new Date(now);
  d.setHours(NIGHTLY_HOUR, 0, 0, 0);
  if (d.getTime() > now) d.setDate(d.getDate() - 1);
  return d.getTime();
}

function expire(state: State, item: Item, at: number, reason: ExpiryReason): void {
  state.expired.push({
    id: item.id,
    text: item.text,
    createdAt: item.createdAt,
    expiredAt: at,
    done: item.done,
    reason,
  });
}

export interface SweepResult {
  expired: number;
  scheduled: number;
}

/**
 * Apply everything time-based:
 *  1. items whose 30h timer ran out are moved to history (checked or not);
 *  2. checked items are moved to history at the 01:00 boundary;
 *  3. enabled schedules that fired since their last check add a new item.
 * Safe to call as often as you like. Returns counts so the caller knows
 * whether to persist and re-render.
 */
export function sweep(state: State, now: number): SweepResult {
  const result: SweepResult = { expired: 0, scheduled: 0 };
  const boundary = lastNightlyBoundary(now);
  const keep: Item[] = [];
  for (const item of state.items) {
    if (item.expiresAt <= now) {
      expire(state, item, item.expiresAt, 'timer');
      result.expired++;
    } else if (item.done && item.doneAt !== null && item.doneAt < boundary) {
      expire(state, item, boundary, 'nightly');
      result.expired++;
    } else {
      keep.push(item);
    }
  }
  if (result.expired) {
    state.items = keep;
    if (state.expired.length > MAX_EXPIRED) {
      state.expired.sort((a, b) => a.expiredAt - b.expiredAt);
      state.expired.splice(0, state.expired.length - MAX_EXPIRED);
    }
  }

  for (const schedule of state.schedules) {
    if (!schedule.enabled) {
      schedule.checkedAt = now;
      continue;
    }
    let spec;
    try {
      spec = parseCron(schedule.cron);
    } catch {
      continue;
    }
    // If the app was closed across several occurrences we add one item, not
    // one per missed run: a daily "water the plants" should not pile up.
    // The item gets a full 30h timer from the moment it appears.
    const fired = lastFiredBetween(spec, schedule.checkedAt, now);
    if (fired !== null) {
      state.items.unshift({
        id: uid(),
        text: schedule.text,
        createdAt: fired,
        expiresAt: now + TTL_MS,
        done: false,
        doneAt: null,
      });
      result.scheduled++;
      schedule.lastFiredAt = fired;
    }
    schedule.checkedAt = now;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Schedules
// ---------------------------------------------------------------------------

export function addSchedule(state: State, text: string, cron: string, now: number): Schedule {
  parseCron(cron); // throws on invalid input
  const schedule: Schedule = {
    id: uid(),
    text: text.trim(),
    cron: cron.trim(),
    enabled: true,
    createdAt: now,
    checkedAt: now,
    lastFiredAt: null,
  };
  state.schedules.push(schedule);
  return schedule;
}

export function updateSchedule(state: State, id: string, patch: Partial<Pick<Schedule, 'text' | 'cron' | 'enabled'>>): boolean {
  const s = state.schedules.find((x) => x.id === id);
  if (!s) return false;
  if (patch.cron !== undefined) {
    parseCron(patch.cron);
    s.cron = patch.cron.trim();
  }
  if (patch.text !== undefined) s.text = patch.text.trim();
  if (patch.enabled !== undefined) s.enabled = patch.enabled;
  return true;
}

export function deleteSchedule(state: State, id: string): boolean {
  const idx = state.schedules.findIndex((x) => x.id === id);
  if (idx < 0) return false;
  state.schedules.splice(idx, 1);
  return true;
}

export function setTheme(state: State, theme: Theme): void {
  state.theme = theme;
}

// ---------------------------------------------------------------------------
// Expired history helpers
// ---------------------------------------------------------------------------

export interface ExpiredGroup {
  /** YYYY-MM-DD local date key */
  key: string;
  date: Date;
  items: ExpiredItem[];
}

export function localDateKey(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Group history by the local calendar day it expired, newest day first. */
export function groupExpired(expired: ExpiredItem[]): ExpiredGroup[] {
  const map = new Map<string, ExpiredGroup>();
  for (const e of expired) {
    const key = localDateKey(e.expiredAt);
    let g = map.get(key);
    if (!g) {
      const d = new Date(e.expiredAt);
      d.setHours(0, 0, 0, 0);
      g = { key, date: d, items: [] };
      map.set(key, g);
    }
    g.items.push(e);
  }
  const groups = [...map.values()];
  groups.sort((a, b) => b.date.getTime() - a.date.getTime());
  for (const g of groups) g.items.sort((a, b) => b.expiredAt - a.expiredAt);
  return groups;
}

export function clearExpired(state: State): void {
  state.expired = [];
}
