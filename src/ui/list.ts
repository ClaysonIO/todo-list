import { moveItem, visibleItems } from '../store';
import type { Item, State } from '../types';
import { clear, h, svg } from './dom';

export interface ListActions {
  toggle(id: string): void;
  edit(id: string, text: string): void;
  remove(id: string): void;
  renew(id: string): void;
  reordered(): void;
}

const ICON_HANDLE = '<circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/>';
const ICON_CLOCK = '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>';
const ICON_X = '<path d="M6 6l12 12M18 6L6 18"/>';

export function timeLeftLabel(expiresAt: number, now: number): { text: string; cls: string } {
  const ms = Math.max(0, expiresAt - now);
  const hours = ms / 3_600_000;
  const text = hours >= 1 ? `${Math.round(hours)}h` : `${Math.max(1, Math.ceil(ms / 60_000))}m`;
  const cls = hours < 1 ? 'crit' : hours < 6 ? 'low' : '';
  return { text, cls };
}

let listEl: HTMLUListElement;
let emptyEl: HTMLElement;
let editingId: string | null = null;

export function mountList(list: HTMLUListElement, empty: HTMLElement): void {
  listEl = list;
  emptyEl = empty;
}

export function renderList(state: State, actions: ListActions, now = Date.now()): void {
  const items = visibleItems(state);
  clear(listEl);
  emptyEl.hidden = items.length > 0;
  const frag = document.createDocumentFragment();
  for (const item of items) frag.append(renderRow(item, state, actions, now));
  listEl.append(frag);
}

/** Update only the countdown labels; no DOM rebuild. */
export function refreshTimers(state: State, now = Date.now()): void {
  const byId = new Map(state.items.map((i) => [i.id, i]));
  for (const btn of listEl.querySelectorAll<HTMLButtonElement>('.timer')) {
    const item = byId.get(btn.dataset.id ?? '');
    if (item) applyTimer(btn, item, now);
  }
}

function applyTimer(btn: HTMLButtonElement, item: Item, now: number): void {
  const { text, cls } = timeLeftLabel(item.expiresAt, now);
  const label = btn.querySelector('.left');
  if (label && label.textContent !== text) label.textContent = text;
  btn.classList.toggle('low', cls === 'low');
  btn.classList.toggle('crit', cls === 'crit');
  btn.title = `Expires ${new Date(item.expiresAt).toLocaleString()} · tap to renew for 30h`;
}

function renderRow(item: Item, state: State, actions: ListActions, now: number): HTMLLIElement {
  const timer = h(
    'button',
    {
      class: 'timer',
      type: 'button',
      'data-id': item.id,
      'aria-label': 'Renew 30 hour timer',
      onclick: (e) => {
        const btn = e.currentTarget as HTMLButtonElement;
        actions.renew(item.id);
        btn.classList.remove('pulse');
        void btn.offsetWidth; // restart animation
        btn.classList.add('pulse');
        setTimeout(() => btn.classList.remove('pulse'), 450);
      },
    },
    svg(ICON_CLOCK),
    h('span', { class: 'left' }, ''),
  ) as HTMLButtonElement;
  applyTimer(timer, item, now);

  const text = h(
    'span',
    { class: 'text', role: 'button', tabindex: 0, 'aria-label': `Edit: ${item.text}` },
    item.text,
  );
  const startEdit = () => beginEdit(row, text, item, actions);
  text.addEventListener('click', startEdit);
  text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      startEdit();
    }
  });

  const handle = h('button', { class: 'handle', type: 'button', 'aria-label': 'Drag to reorder' }, svg(ICON_HANDLE));

  const row = h(
    'li',
    { class: `row${item.done ? ' done' : ''}`, 'data-id': item.id, 'data-done': item.done ? '1' : '0' },
    handle,
    h('input', {
      class: 'check',
      type: 'checkbox',
      'aria-label': item.done ? 'Mark not done' : 'Mark done',
      checked: item.done,
      onchange: () => actions.toggle(item.id),
    }),
    text,
    timer,
    h('button', { class: 'del', type: 'button', 'aria-label': 'Delete', title: 'Delete', onclick: (e) => confirmDelete(e.currentTarget as HTMLButtonElement, () => actions.remove(item.id)) }, svg(ICON_X)),
  );
  attachDrag(handle, row, state, actions);
  if (editingId === item.id) queueMicrotask(startEdit);
  return row;
}

function beginEdit(row: HTMLLIElement, textEl: HTMLElement, item: Item, actions: ListActions): void {
  if (row.querySelector('.edit')) return;
  editingId = item.id;
  const input = h('input', { class: 'edit', type: 'text', value: item.text, maxlength: 500, 'aria-label': 'Edit todo' }) as HTMLInputElement;
  let finished = false;
  const finish = (commit: boolean) => {
    if (finished) return;
    finished = true;
    editingId = null;
    const value = input.value.trim();
    input.replaceWith(textEl);
    if (commit && value && value !== item.text) actions.edit(item.id, value);
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      finish(true);
    } else if (e.key === 'Escape') {
      finish(false);
    }
  });
  input.addEventListener('blur', () => finish(true));
  textEl.replaceWith(input);
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

// ---------------------------------------------------------------------------
// Two-tap delete: the first tap arms the button (turns red), the second tap
// within ARM_MS deletes. Tapping anywhere else, or waiting, disarms it.
// ---------------------------------------------------------------------------

const ARM_MS = 3000;
let armed: { btn: HTMLButtonElement; timer: number } | null = null;

function disarm(): void {
  if (!armed) return;
  window.clearTimeout(armed.timer);
  armed.btn.classList.remove('armed');
  armed.btn.setAttribute('aria-label', 'Delete');
  armed.btn.title = 'Delete';
  armed = null;
}

function confirmDelete(btn: HTMLButtonElement, remove: () => void): void {
  if (armed?.btn === btn) {
    disarm();
    remove();
    return;
  }
  disarm();
  btn.classList.add('armed');
  btn.setAttribute('aria-label', 'Tap again to delete');
  btn.title = 'Tap again to delete';
  armed = { btn, timer: window.setTimeout(disarm, ARM_MS) };
}

document.addEventListener(
  'pointerdown',
  (e) => {
    if (armed && !armed.btn.contains(e.target as Node)) disarm();
  },
  true,
);

// ---------------------------------------------------------------------------
// Pointer-based drag to reorder (HTML5 DnD is unreliable in Android WebViews)
// ---------------------------------------------------------------------------

interface DragCtx {
  pointerId: number;
  row: HTMLLIElement;
  others: { el: HTMLLIElement; center: number }[];
  startIndex: number;
  currentIndex: number;
  startY: number;
  centerY: number;
  step: number;
}

function attachDrag(handle: HTMLButtonElement, row: HTMLLIElement, state: State, actions: ListActions): void {
  let ctx: DragCtx | null = null;

  const onMove = (e: PointerEvent) => {
    if (!ctx || e.pointerId !== ctx.pointerId) return;
    const dy = e.clientY - ctx.startY;
    ctx.row.style.transform = `translateY(${dy}px)`;
    const center = ctx.centerY + dy;
    let idx = 0;
    for (const o of ctx.others) if (o.center < center) idx++;
    if (idx !== ctx.currentIndex) {
      ctx.currentIndex = idx;
      ctx.others.forEach((o, j) => {
        let shift = 0;
        if (j >= ctx!.startIndex && j < idx) shift = -ctx!.step;
        else if (j < ctx!.startIndex && j >= idx) shift = ctx!.step;
        o.el.style.transform = shift ? `translateY(${shift}px)` : '';
      });
    }
  };

  const onEnd = (e: PointerEvent) => {
    if (!ctx || e.pointerId !== ctx.pointerId) return;
    const { row: r, others, startIndex, currentIndex } = ctx;
    handle.removeEventListener('pointermove', onMove);
    handle.removeEventListener('pointerup', onEnd);
    handle.removeEventListener('pointercancel', onEnd);
    r.classList.remove('dragging');
    r.style.transform = '';
    for (const o of others) o.el.style.transform = '';
    ctx = null;
    if (e.type === 'pointerup' && currentIndex !== startIndex) {
      const before = others[currentIndex]?.el.dataset.id ?? null;
      if (moveItem(state, r.dataset.id!, before)) actions.reordered();
    }
  };

  handle.addEventListener('pointerdown', (e) => {
    if (ctx || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    const siblings = [...listEl.querySelectorAll<HTMLLIElement>('.row')].filter((el) => el.dataset.done === row.dataset.done);
    const rect = row.getBoundingClientRect();
    const others = siblings
      .filter((el) => el !== row)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { el, center: r.top + r.height / 2 };
      });
    const gap = siblings.length > 1 ? Math.max(0, siblings[1]!.getBoundingClientRect().top - siblings[0]!.getBoundingClientRect().bottom) : 0;
    ctx = {
      pointerId: e.pointerId,
      row,
      others,
      startIndex: siblings.indexOf(row),
      currentIndex: siblings.indexOf(row),
      startY: e.clientY,
      centerY: rect.top + rect.height / 2,
      step: rect.height + gap,
    };
    row.classList.add('dragging');
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      /* not supported */
    }
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onEnd);
    handle.addEventListener('pointercancel', onEnd);
  });
}
