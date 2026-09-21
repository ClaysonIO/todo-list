import { groupExpired } from '../store';
import type { State } from '../types';
import { clear, formatDateHeading, formatTime, h } from './dom';

export function renderExpired(root: HTMLElement, state: State, onClear: () => void): void {
  clear(root);
  const groups = groupExpired(state.expired);
  root.append(
    h(
      'div',
      { class: 'page-head' },
      h('h1', {}, 'Expired'),
      groups.length ? h('button', { class: 'btn danger', type: 'button', onclick: onClear }, 'Clear history') : null,
    ),
  );
  if (!groups.length) {
    root.append(h('p', { class: 'empty' }, 'Nothing has expired yet. Items land here when their timer runs out or when checked items are cleared at 1am.'));
    return;
  }
  const now = new Date();
  for (const g of groups) {
    root.append(h('h2', {}, `${formatDateHeading(g.date, now)} · ${g.items.length}`));
    const card = h('div', { class: 'card' });
    for (const e of g.items) {
      card.append(
        h(
          'div',
          { class: `exp${e.done ? ' done' : ''}` },
          h('time', { datetime: new Date(e.expiredAt).toISOString() }, formatTime(e.expiredAt)),
          h('span', { class: 't' }, e.text),
          h('span', { class: `badge${e.done ? ' ok' : ''}` }, e.done ? 'Done' : e.reason === 'timer' ? 'Timed out' : 'Cleared'),
        ),
      );
    }
    root.append(card);
  }
}
