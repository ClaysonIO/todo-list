import { cronError, describeCron, nextOccurrence, parseCron } from '../cron';
import type { Schedule, State, Theme } from '../types';
import { clear, confirmDelete, formatDateTime, h, ICON_X, svg } from './dom';

export interface SettingsActions {
  setTheme(theme: Theme): void;
  addSchedule(text: string, cron: string): string | null; // returns error message or null
  editSchedule(id: string, text: string, cron: string): string | null; // returns error message or null
  toggleSchedule(id: string, enabled: boolean): void;
  deleteSchedule(id: string): void;
  exportCsv(): void;
  importCsv(file: File): void;
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

/** Id of the scheduled task whose edit form is open, if any. */
let editing: string | null = null;

interface CronField {
  el: HTMLElement;
  input: HTMLInputElement;
  showError(message: string): void;
}

/** Cron input with a preset picker and a live "next run" preview. */
function cronField(now: number, value = ''): CronField {
  const input = h('input', { type: 'text', placeholder: 'min hour day month weekday', list: 'cron-presets', required: true, spellcheck: 'false', autocapitalize: 'off', value }) as HTMLInputElement;
  const preview = h('div', { class: 'hint' });
  const presetSelect = h('select', { 'aria-label': 'Preset' }, h('option', { value: '' }, 'Presets…')) as HTMLSelectElement;
  for (const [expr, label] of PRESETS) presetSelect.append(h('option', { value: expr }, label));
  const showError = (message: string) => {
    preview.textContent = message;
    preview.classList.add('err');
  };
  const updatePreview = () => {
    const expr = input.value.trim();
    if (!expr) {
      preview.textContent = 'Pick a preset or type a 5-field cron expression (local time).';
      preview.classList.remove('err');
      return;
    }
    const err = cronError(expr);
    if (err) {
      showError(err);
      return;
    }
    const next = nextOccurrence(parseCron(expr), now);
    preview.textContent = `${describeCron(expr)} · next: ${next ? formatDateTime(next) : 'never'}`;
    preview.classList.remove('err');
  };
  presetSelect.addEventListener('change', () => {
    if (presetSelect.value) input.value = presetSelect.value;
    presetSelect.value = '';
    updatePreview();
  });
  input.addEventListener('input', updatePreview);
  updatePreview();
  const el = h('div', { class: 'field' }, h('label', {}, 'Schedule (cron)'), h('div', { style: 'display:flex;gap:8px' }, input, presetSelect), preview);
  return { el, input, showError };
}

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
        h('div', { class: 'lbl' }, 'Item lifetime', h('small', {}, 'Every item lasts 30 hours. Tap its clock to restart the timer. Checked items are cleared at 1:00 am. Tap ✕ twice to delete.')),
      ),
    ),
  );

  // ---- Scheduled tasks ----
  root.append(h('h2', {}, 'Scheduled tasks'));
  const datalist = h('datalist', { id: 'cron-presets' });
  for (const [expr, label] of PRESETS) datalist.append(h('option', { value: expr }, label));
  root.append(datalist);
  const listCard = h('div', { class: 'card' });
  if (!state.schedules.length) {
    listCard.append(h('p', { class: 'hint', style: 'padding:12px;margin:0' }, 'No scheduled tasks yet. Add one below and it will appear in your list on schedule (when the app is open or next opened).'));
  }
  const now = Date.now();
  for (const s of state.schedules) {
    const rerender = () => renderSettings(root, state, actions);
    listCard.append(editing === s.id ? renderScheduleEditor(s, now, actions, rerender) : renderSchedule(s, now, actions, rerender));
  }
  root.append(listCard);

  const form = h('form', { class: 'card', style: 'margin-top:8px', autocomplete: 'off' });
  const textInput = h('input', { type: 'text', placeholder: 'e.g. Take out the bins', maxlength: 500, required: true }) as HTMLInputElement;
  const cron = cronField(now);
  const submit = h('button', { class: 'btn', type: 'submit' }, 'Add scheduled task') as HTMLButtonElement;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const err = actions.addSchedule(textInput.value, cron.input.value);
    if (err) {
      cron.showError(err);
      return;
    }
    renderSettings(root, state, actions);
  });
  form.append(h('div', { class: 'field' }, h('label', {}, 'Task text'), textInput), cron.el, h('div', { class: 'btn-row' }, submit));
  root.append(form);

  // ---- Data ----
  const fileInput = h('input', { type: 'file', accept: '.csv,text/csv,text/comma-separated-values,text/plain', hidden: true }) as HTMLInputElement;
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (file) actions.importCsv(file);
  });
  root.append(fileInput);
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
      h(
        'div',
        { class: 'row-setting' },
        h('div', { class: 'lbl' }, 'Import from CSV', h('small', {}, 'Adds the items in an exported file. Items already here are kept and not duplicated.')),
        h('button', { class: 'btn ghost', type: 'button', onclick: () => fileInput.click() }, 'Import'),
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
    h(
      'button',
      {
        class: 'sched-info',
        type: 'button',
        'aria-label': `Edit ${s.text}`,
        onclick: () => {
          editing = s.id;
          rerender();
        },
      },
      h('div', { class: 'name' }, s.text),
      h('div', { class: 'meta' }, meta.join(' · ')),
    ),
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
        'aria-label': 'Delete',
        title: 'Delete',
        onclick: (e) =>
          confirmDelete(e.currentTarget as HTMLButtonElement, () => {
            actions.deleteSchedule(s.id);
            rerender();
          }),
      },
      svg(ICON_X),
    ),
  );
}

function renderScheduleEditor(s: Schedule, now: number, actions: SettingsActions, rerender: () => void): HTMLElement {
  const form = h('form', { class: 'sched-edit', autocomplete: 'off' });
  const textInput = h('input', { type: 'text', maxlength: 500, required: true, value: s.text, 'aria-label': 'Task text' }) as HTMLInputElement;
  const cron = cronField(now, s.cron);
  const close = () => {
    editing = null;
    rerender();
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const err = actions.editSchedule(s.id, textInput.value, cron.input.value);
    if (err) {
      cron.showError(err);
      return;
    }
    close();
  });
  form.append(
    h('div', { class: 'field' }, h('label', {}, 'Task text'), textInput),
    cron.el,
    h('p', { class: 'hint', style: 'padding:0 12px;margin:0' }, 'Changes apply to future runs only. Tasks already on your list or in history stay as they are.'),
    h('div', { class: 'btn-row' }, h('button', { class: 'btn ghost', type: 'button', onclick: close }, 'Cancel'), h('button', { class: 'btn', type: 'submit' }, 'Save')),
  );
  return form;
}
