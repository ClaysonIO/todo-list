import { cronError, describeCron, nextOccurrence, parseCron } from '../cron';
import type { Schedule, State, Theme } from '../types';
import { clear, formatDateTime, h } from './dom';

export interface SettingsActions {
  setTheme(theme: Theme): void;
  addSchedule(text: string, cron: string): string | null; // returns error message or null
  toggleSchedule(id: string, enabled: boolean): void;
  deleteSchedule(id: string): void;
  exportCsv(): void;
  setFocusOnLaunch(on: boolean): void;
  focusOnLaunch(): boolean;
}

const PRESETS: Array<[string, string]> = [
  ['0 9 * * *', 'Every day at 09:00'],
  ['0 18 * * *', 'Every day at 18:00'],
  ['0 8 * * 1-5', 'Weekdays at 08:00'],
  ['0 10 * * 6', 'Saturdays at 10:00'],
  ['0 9 1 * *', '1st of the month at 09:00'],
  ['0 * * * *', 'Every hour'],
];

export function renderSettings(root: HTMLElement, state: State, actions: SettingsActions): void {
  clear(root);
  root.append(h('h1', {}, 'Settings'));

  // ---- Appearance ----
  root.append(h('h2', {}, 'Appearance'));
  const seg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Theme' });
  for (const [value, label] of [
    ['system', 'System'],
    ['light', 'Light'],
    ['dark', 'Dark'],
  ] as Array<[Theme, string]>) {
    seg.append(
      h(
        'button',
        {
          type: 'button',
          role: 'radio',
          'aria-checked': state.theme === value ? 'true' : 'false',
          class: state.theme === value ? 'active' : '',
          onclick: () => {
            actions.setTheme(value);
            renderSettings(root, state, actions);
          },
        },
        label,
      ),
    );
  }
  root.append(h('div', { class: 'card' }, h('div', { style: 'padding:12px' }, seg)));

  // ---- Behaviour ----
  root.append(h('h2', {}, 'Behaviour'));
  const focusOn = actions.focusOnLaunch();
  root.append(
    h(
      'div',
      { class: 'card' },
      h(
        'div',
        { class: 'row-setting' },
        h('div', { class: 'lbl' }, 'Open keyboard on launch', h('small', {}, 'Focus the add box as soon as the app opens')),
        h('button', {
          class: 'switch',
          type: 'button',
          role: 'switch',
          'aria-checked': focusOn ? 'true' : 'false',
          'aria-label': 'Open keyboard on launch',
          onclick: () => {
            actions.setFocusOnLaunch(!focusOn);
            renderSettings(root, state, actions);
          },
        }),
      ),
      h(
        'div',
        { class: 'row-setting' },
        h('div', { class: 'lbl' }, 'Item lifetime', h('small', {}, 'Every item lasts 30 hours. Tap its clock to restart the timer. Checked items are cleared at 1:00 am.')),
      ),
    ),
  );

  // ---- Scheduled tasks ----
  root.append(h('h2', {}, 'Scheduled tasks'));
  const listCard = h('div', { class: 'card' });
  if (!state.schedules.length) {
    listCard.append(h('p', { class: 'hint', style: 'padding:12px;margin:0' }, 'No scheduled tasks yet. Add one below and it will appear in your list on schedule (when the app is open or next opened).'));
  }
  const now = Date.now();
  for (const s of state.schedules) listCard.append(renderSchedule(s, now, actions, () => renderSettings(root, state, actions)));
  root.append(listCard);

  const form = h('form', { class: 'card', style: 'margin-top:8px', autocomplete: 'off' });
  const textInput = h('input', { type: 'text', placeholder: 'e.g. Take out the bins', maxlength: 500, required: true }) as HTMLInputElement;
  const cronInput = h('input', { type: 'text', placeholder: 'min hour day month weekday', list: 'cron-presets', required: true, spellcheck: 'false', autocapitalize: 'off' }) as HTMLInputElement;
  const datalist = h('datalist', { id: 'cron-presets' });
  for (const [expr, label] of PRESETS) datalist.append(h('option', { value: expr }, label));
  const preview = h('div', { class: 'hint' }, 'Pick a preset or type a 5-field cron expression (local time).');
  const presetSelect = h('select', { 'aria-label': 'Preset' }, h('option', { value: '' }, 'Presets…')) as HTMLSelectElement;
  for (const [expr, label] of PRESETS) presetSelect.append(h('option', { value: expr }, label));
  presetSelect.addEventListener('change', () => {
    if (presetSelect.value) cronInput.value = presetSelect.value;
    presetSelect.value = '';
    updatePreview();
  });
  const submit = h('button', { class: 'btn', type: 'submit' }, 'Add scheduled task') as HTMLButtonElement;
  const updatePreview = () => {
    const expr = cronInput.value.trim();
    if (!expr) {
      preview.textContent = 'Pick a preset or type a 5-field cron expression (local time).';
      preview.classList.remove('err');
      return;
    }
    const err = cronError(expr);
    if (err) {
      preview.textContent = err;
      preview.classList.add('err');
      return;
    }
    const next = nextOccurrence(parseCron(expr), now);
    preview.textContent = `${describeCron(expr)} · next: ${next ? formatDateTime(next) : 'never'}`;
    preview.classList.remove('err');
  };
  cronInput.addEventListener('input', updatePreview);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const err = actions.addSchedule(textInput.value, cronInput.value);
    if (err) {
      preview.textContent = err;
      preview.classList.add('err');
      return;
    }
    renderSettings(root, state, actions);
  });
  form.append(
    h('div', { class: 'field' }, h('label', {}, 'Task text'), textInput),
    h('div', { class: 'field' }, h('label', {}, 'Schedule (cron)'), h('div', { style: 'display:flex;gap:8px' }, cronInput, presetSelect), datalist, preview),
    h('div', { class: 'btn-row' }, submit),
  );
  root.append(form);

  // ---- Data ----
  root.append(h('h2', {}, 'Data'));
  root.append(
    h(
      'div',
      { class: 'card' },
      h(
        'div',
        { class: 'row-setting' },
        h('div', { class: 'lbl' }, 'Export to CSV', h('small', {}, `${state.items.length} active · ${state.expired.length} expired. Everything is stored on this device only.`)),
        h('button', { class: 'btn ghost', type: 'button', onclick: () => actions.exportCsv() }, 'Export'),
      ),
    ),
  );
  root.append(h('p', { class: 'hint', style: 'text-align:center;margin-top:24px' }, `Quick Todo ${__APP_VERSION__}`));
}

function renderSchedule(s: Schedule, now: number, actions: SettingsActions, rerender: () => void): HTMLElement {
  let next: number | null = null;
  try {
    next = s.enabled ? nextOccurrence(parseCron(s.cron), now) : null;
  } catch {
    /* invalid stored cron */
  }
  const meta = [describeCron(s.cron), s.enabled ? (next ? `next ${formatDateTime(next)}` : 'never') : 'paused'];
  return h(
    'div',
    { class: `sched${s.enabled ? '' : ' off'}` },
    h('div', {}, h('div', { class: 'name' }, s.text), h('div', { class: 'meta' }, meta.join(' · '))),
    h('button', {
      class: 'switch',
      type: 'button',
      role: 'switch',
      'aria-checked': s.enabled ? 'true' : 'false',
      'aria-label': `Enable ${s.text}`,
      onclick: () => {
        actions.toggleSchedule(s.id, !s.enabled);
        rerender();
      },
    }),
    h(
      'button',
      {
        class: 'del',
        type: 'button',
        'aria-label': `Delete ${s.text}`,
        onclick: () => {
          actions.deleteSchedule(s.id);
          rerender();
        },
      },
      '✕',
    ),
  );
}
