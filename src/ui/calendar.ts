import { addDays, calendarEntries, KIND_ORDER, monthGrid, monthStart, startOfDay, type CalendarEntry, type EntryKind } from '../calendar';
import { describeCron } from '../cron';
import { localDateKey } from '../store';
import type { State } from '../types';
import { clear, formatTime, h, ICON_X, svg } from './dom';
import { timeLeftLabel } from './list';

export interface CalendarActions {
  /** Add `text` to the day containing `day`: today goes straight onto the list, later days are planned. */
  add(text: string, day: number): void;
  deletePlanned(id: string): void;
}

const KIND_LABEL: Record<EntryKind, string> = {
  open: 'Open',
  planned: 'Planned',
  recurring: 'Recurring',
  done: 'Done',
  missed: 'Missed',
};

const ICON_UP = '<path d="M6 15l6-6 6 6"/>';
const ICON_DOWN = '<path d="M6 9l6 6 6-6"/>';
const SWIPE_PX = 40;

// View state survives re-renders and route changes within a session.
let viewMonth = monthStart(Date.now());
let selected: number | null = startOfDay(Date.now());

let root: HTMLElement;
let state: State;
let actions: CalendarActions;

export function renderCalendar(el: HTMLElement, s: State, a: CalendarActions, slide: 'next' | 'prev' | null = null): void {
  root = el;
  state = s;
  actions = a;
  const draft = root.querySelector<HTMLInputElement>('.cal-add input')?.value ?? '';
  clear(root);

  const now = Date.now();
  const today = startOfDay(now);
  const days = monthGrid(viewMonth);
  const entries = calendarEntries(state, days[0]!, addDays(days[days.length - 1]!, 1), now);
  const month = new Date(viewMonth).getMonth();
  const isCurrentMonth = viewMonth === monthStart(now);

  root.append(
    h(
      'div',
      { class: 'page-head cal-head' },
      h('h1', {}, new Date(viewMonth).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })),
      h(
        'div',
        { class: 'cal-nav' },
        isCurrentMonth ? null : h('button', { class: 'btn ghost', type: 'button', onclick: () => goToday() }, 'Today'),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Previous month', onclick: () => shift(-1) }, svg(ICON_UP)),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Next month', onclick: () => shift(1) }, svg(ICON_DOWN)),
      ),
    ),
  );

  const weekdays = h('div', { class: 'cal-week', 'aria-hidden': 'true' });
  for (let i = 0; i < 7; i++) {
    weekdays.append(h('span', {}, new Date(2026, 0, 4 + i).toLocaleDateString(undefined, { weekday: 'narrow' })));
  }

  const grid = h('div', { class: `cal-grid${slide ? ` slide-${slide}` : ''}`, role: 'grid', style: `--rows:${days.length / 7}` });
  for (const day of days) {
    const list = entries.get(localDateKey(day)) ?? [];
    const kinds = KIND_ORDER.filter((k) => list.some((e) => e.kind === k));
    const date = new Date(day);
    const cls = ['cal-day'];
    if (date.getMonth() !== month) cls.push('other');
    if (day === today) cls.push('today');
    if (day === selected) cls.push('sel');
    const label = `${date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}${list.length ? `, ${list.length} task${list.length === 1 ? '' : 's'}` : ''}`;
    grid.append(
      h(
        'button',
        { class: cls.join(' '), type: 'button', role: 'gridcell', 'aria-label': label, 'aria-selected': day === selected ? 'true' : 'false', onclick: () => select(day) },
        h('span', { class: 'num' }, String(date.getDate())),
        h('span', { class: 'dots' }, ...kinds.map((k) => h('i', { class: `dot ${k}` }))),
      ),
    );
  }
  attachSwipe(grid);

  const legend = h('div', { class: 'cal-legend' });
  for (const k of KIND_ORDER) legend.append(h('span', {}, h('i', { class: `dot ${k}` }), KIND_LABEL[k]));

  root.append(h('div', { class: 'cal' }, weekdays, grid), legend);

  if (selected !== null && monthStart(selected) === viewMonth) {
    root.append(renderDay(selected, entries.get(localDateKey(selected)) ?? [], today, now, draft));
  } else {
    root.append(h('p', { class: 'empty' }, 'Tap a day to see its tasks.'));
  }
}

function rerender(slide: 'next' | 'prev' | null = null): void {
  renderCalendar(root, state, actions, slide);
}

function select(day: number): void {
  selected = day;
  const month = monthStart(day);
  const slide = month === viewMonth ? null : month > viewMonth ? 'next' : 'prev';
  viewMonth = month;
  rerender(slide);
}

function shift(by: number): void {
  viewMonth = monthStart(viewMonth, by);
  const today = startOfDay(Date.now());
  selected = viewMonth === monthStart(today) ? today : null;
  rerender(by > 0 ? 'next' : 'prev');
}

function goToday(): void {
  select(startOfDay(Date.now()));
}

/** Swipe up for the next month, down for the previous one. A mouse wheel does the same. */
function attachSwipe(grid: HTMLElement): void {
  let start: { id: number; x: number; y: number } | null = null;
  grid.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    start = { id: e.pointerId, x: e.clientX, y: e.clientY };
  });
  const end = (e: PointerEvent) => {
    if (!start || e.pointerId !== start.id) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    start = null;
    if (Math.abs(dy) < SWIPE_PX || Math.abs(dy) < Math.abs(dx)) return;
    // Swallow the click the browser may deliver to the day under the finger.
    grid.addEventListener('click', (ev) => ev.stopPropagation(), { capture: true, once: true });
    setTimeout(() => shift(dy < 0 ? 1 : -1), 0);
  };
  grid.addEventListener('pointerup', end);
  grid.addEventListener('pointercancel', () => (start = null));

  let wheelAt = 0;
  grid.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      if (Math.abs(e.deltaY) < 10 || e.timeStamp - wheelAt < 400) return;
      wheelAt = e.timeStamp;
      shift(e.deltaY > 0 ? 1 : -1);
    },
    { passive: false },
  );
}

function renderDay(day: number, list: CalendarEntry[], today: number, now: number, draft: string): HTMLElement {
  const wrap = h('section', { class: 'cal-detail' });
  const heading = new Date(day).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  wrap.append(h('h2', {}, `${day === today ? `Today · ${heading}` : heading}${list.length ? ` · ${list.length}` : ''}`));

  const card = h('div', { class: 'card' });
  if (!list.length) {
    card.append(h('p', { class: 'hint', style: 'padding:12px;margin:0' }, day < today ? 'Nothing on this day.' : 'Nothing planned yet.'));
  }
  for (const e of list) card.append(renderEntry(e, now));

  if (day >= today) {
    const input = h('input', {
      type: 'text',
      placeholder: day === today ? 'Add a todo for today' : `Add a task for ${new Date(day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`,
      'aria-label': 'New task for this day',
      autocapitalize: 'sentences',
      maxlength: 500,
      value: draft,
    }) as HTMLInputElement;
    const form = h('form', { class: 'cal-add', autocomplete: 'off' }, input, h('button', { class: 'btn', type: 'submit' }, 'Add'));
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      if (!input.value.trim()) return;
      actions.add(input.value, day);
      input.value = '';
      rerender();
      root.querySelector<HTMLInputElement>('.cal-add input')?.focus();
    });
    card.append(form);
  }
  wrap.append(card);
  return wrap;
}

function renderEntry(e: CalendarEntry, now: number): HTMLElement {
  let meta: string;
  switch (e.kind) {
    case 'open':
      meta = `${timeLeftLabel(e.expiresAt ?? now, now).text} left`;
      break;
    case 'done':
      meta = formatTime(e.at);
      break;
    case 'missed':
      meta = `added ${formatTime(e.at)}`;
      break;
    case 'recurring':
      meta = `${formatTime(e.at)} · ${describeCron(e.cron ?? '')}`;
      break;
    case 'planned':
      meta = 'one-off';
      break;
  }
  return h(
    'div',
    { class: `cal-entry ${e.kind}` },
    h('i', { class: `dot ${e.kind}` }),
    h('div', { class: 'body' }, h('div', { class: 't' }, e.text), h('div', { class: 'meta' }, `${KIND_LABEL[e.kind]} · ${meta}`)),
    e.kind === 'planned'
      ? h(
          'button',
          {
            class: 'del',
            type: 'button',
            'aria-label': `Remove ${e.text}`,
            onclick: () => {
              actions.deletePlanned(e.id);
              rerender();
            },
          },
          svg(ICON_X),
        )
      : null,
  );
}
