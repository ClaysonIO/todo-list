import './styles.css';
import { csvFilename, toCsv } from './csv';
import {
  addItem,
  addPlanned,
  addSchedule,
  clearExpired,
  deleteItem,
  deletePlanned,
  deleteSchedule,
  editItem,
  load,
  renewItem,
  save,
  setTheme,
  sweep,
  toggleItem,
  updateSchedule,
} from './store';
import type { Theme } from './types';
import { renderCalendar, type CalendarActions } from './ui/calendar';
import { toast } from './ui/dom';
import { renderExpired } from './ui/expired';
import { mountList, refreshTimers, renderList, type ListActions } from './ui/list';
import { renderSettings, type SettingsActions } from './ui/settings';

const FOCUS_KEY = 'quicktodo.focusOnLaunch';

// ---------------------------------------------------------------------------
// 1. Critical path: read state, apply expiries, paint the list. Nothing async,
//    no bridge calls, no plugin imports evaluated before this completes.
// ---------------------------------------------------------------------------
const state = load();
const startup = sweep(state, Date.now());
if (startup.expired || startup.scheduled || startup.planned) save(state);

const $ = <T extends Element>(sel: string) => document.querySelector(sel) as T;
const pages = {
  todo: $<HTMLElement>('#page-todo'),
  calendar: $<HTMLElement>('#page-calendar'),
  expired: $<HTMLElement>('#page-expired'),
  settings: $<HTMLElement>('#page-settings'),
};
type Route = keyof typeof pages;

mountList($<HTMLUListElement>('#list'), $<HTMLElement>('#empty'));

function persist(): void {
  save(state);
}

function rerenderList(): void {
  renderList(state, listActions);
}

const listActions: ListActions = {
  toggle(id) {
    if (toggleItem(state, id, Date.now())) {
      persist();
      rerenderList();
    }
  },
  edit(id, text) {
    if (editItem(state, id, text)) persist();
    rerenderList();
  },
  remove(id) {
    if (deleteItem(state, id)) {
      persist();
      rerenderList();
    }
  },
  renew(id) {
    if (renewItem(state, id, Date.now())) {
      persist();
      refreshTimers(state);
    }
  },
  reordered() {
    persist();
    rerenderList();
  },
};

rerenderList();

// ---------------------------------------------------------------------------
// 2. Everything below is wired after the first frame is painted.
// ---------------------------------------------------------------------------

function applyTheme(theme: Theme): void {
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

function currentRoute(): Route {
  const hash = location.hash.replace(/^#\/?/, '');
  return hash === 'calendar' || hash === 'expired' || hash === 'settings' ? hash : 'todo';
}

function showRoute(): void {
  const route = currentRoute();
  for (const [name, el] of Object.entries(pages)) el.hidden = name !== route;
  for (const a of document.querySelectorAll<HTMLAnchorElement>('.nav a')) a.classList.toggle('active', a.dataset.route === route);
  if (route === 'calendar') {
    tick();
    renderCalendar(pages.calendar, state, calendarActions);
  } else if (route === 'expired') {
    renderExpired(pages.expired, state, () => {
      clearExpired(state);
      persist();
      renderExpired(pages.expired, state, () => {});
      toast('History cleared');
    });
  } else if (route === 'settings') {
    renderSettings(pages.settings, state, settingsActions);
  } else {
    tick();
  }
  window.scrollTo(0, 0);
}

const calendarActions: CalendarActions = {
  add(text, day) {
    const now = Date.now();
    const added = day <= now ? addItem(state, text, now) : addPlanned(state, text, day, now);
    if (!added) return;
    persist();
    // The todo page is only hidden, so keep it current for when the user switches back.
    rerenderList();
    toast(day <= now ? 'Added to today' : 'Planned');
  },
  deletePlanned(id) {
    if (deletePlanned(state, id)) persist();
  },
};

const settingsActions: SettingsActions = {
  setTheme(theme) {
    setTheme(state, theme);
    applyTheme(theme);
    persist();
  },
  addSchedule(text, cron) {
    if (!text.trim()) return 'Enter the task text.';
    try {
      addSchedule(state, text, cron, Date.now());
    } catch (e) {
      return e instanceof Error ? e.message : 'Invalid schedule';
    }
    persist();
    toast('Scheduled task added');
    return null;
  },
  toggleSchedule(id, enabled) {
    // Re-enabling starts the clock from now; it never backfills missed runs.
    const s = state.schedules.find((x) => x.id === id);
    if (s && enabled && !s.enabled) s.checkedAt = Date.now();
    updateSchedule(state, id, { enabled });
    persist();
  },
  deleteSchedule(id) {
    deleteSchedule(state, id);
    persist();
  },
  exportCsv() {
    import('./native')
      .then((n) => n.shareCsv(csvFilename(), toCsv(state)))
      .then(() => toast('Exported'))
      .catch((e: unknown) => toast(`Export failed: ${e instanceof Error ? e.message : String(e)}`));
  },
  setFocusOnLaunch(on) {
    try {
      localStorage.setItem(FOCUS_KEY, on ? '1' : '0');
    } catch {
      /* ignore */
    }
  },
  focusOnLaunch() {
    try {
      return localStorage.getItem(FOCUS_KEY) === '1';
    } catch {
      return false;
    }
  },
};

/** Periodic housekeeping: expire, fire schedules, refresh countdowns. */
function tick(): void {
  const r = sweep(state, Date.now());
  if (r.expired || r.scheduled || r.planned) {
    persist();
    // Rebuild even when hidden: switching back to Todo only refreshes timers.
    rerenderList();
    // Leave the calendar alone while someone is typing into its add box.
    if (currentRoute() === 'calendar' && !pages.calendar.contains(document.activeElement)) renderCalendar(pages.calendar, state, calendarActions);
    const added = r.scheduled + r.planned;
    if (added) toast(added === 1 ? (r.planned ? 'Planned task added' : 'Scheduled task added') : `${added} tasks added`);
  } else if (currentRoute() === 'todo') {
    refreshTimers(state);
  }
}

function setupAddForm(): void {
  const form = $<HTMLFormElement>('#add-form');
  const input = $<HTMLInputElement>('#add-input');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (addItem(state, input.value, Date.now())) {
      persist();
      rerenderList();
    }
    input.value = '';
    input.focus();
  });
}

function deferredInit(): void {
  setupAddForm();
  window.addEventListener('hashchange', showRoute);
  if (location.hash && location.hash !== '#/') showRoute();

  setInterval(tick, 30_000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') tick();
  });

  if (settingsActions.focusOnLaunch()) $<HTMLInputElement>('#add-input').focus();

  import('./native').then((n) =>
    n.initNative({
      onResume: tick,
      onBack: () => {
        if (currentRoute() !== 'todo') {
          location.hash = '#/';
          return true;
        }
        return false;
      },
    }),
  );
}

// Let the browser paint the list first, then wire up the rest.
if ('requestIdleCallback' in window) {
  requestIdleCallback(deferredInit, { timeout: 200 });
} else {
  setTimeout(deferredInit, 0);
}
