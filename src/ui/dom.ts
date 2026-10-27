/** Tiny DOM helpers: keeps the render code readable without a framework. */

type Attrs = Record<string, string | number | boolean | null | undefined | ((e: Event) => void)>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Array<Node | string | null | undefined | false>
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === 'class') {
      el.className = String(v);
    } else if (v === true) {
      el.setAttribute(k, '');
    } else {
      el.setAttribute(k, String(v));
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

export const ICON_X = '<path d="M6 6l12 12M18 6L6 18"/>';

export function svg(pathData: string, viewBox = '0 0 24 24'): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  s.setAttribute('viewBox', viewBox);
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = pathData;
  return s;
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

let toastTimer: number | undefined;
export function toast(message: string, ms = 2200): void {
  document.querySelector('.toast')?.remove();
  const el = h('div', { class: 'toast', role: 'status' }, message);
  document.body.append(el);
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.remove(), ms);
}

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function formatDateHeading(date: Date, now = new Date()): string {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((today.getTime() - date.getTime()) / 86_400_000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

export function formatDateTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
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

export function confirmDelete(btn: HTMLButtonElement, remove: () => void): void {
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
