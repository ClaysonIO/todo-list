export interface Item {
  id: string;
  text: string;
  createdAt: number;
  /** Epoch ms when the 30-hour timer runs out. */
  expiresAt: number;
  done: boolean;
  doneAt: number | null;
}

export type ExpiryReason = 'timer' | 'nightly';

export interface ExpiredItem {
  id: string;
  text: string;
  createdAt: number;
  expiredAt: number;
  done: boolean;
  /** When it was checked; absent on history recorded before this was stored. */
  doneAt?: number | null;
  reason: ExpiryReason;
}

/** A one-off task added from the calendar for a future day. */
export interface Planned {
  id: string;
  text: string;
  /** Epoch ms (local midnight of the chosen day) when it joins the list. */
  at: number;
  createdAt: number;
}

export interface Schedule {
  id: string;
  text: string;
  /** 5-field cron expression evaluated in local time. */
  cron: string;
  enabled: boolean;
  createdAt: number;
  /** Last time this schedule was evaluated (not necessarily fired). */
  checkedAt: number;
  lastFiredAt: number | null;
}

export type Theme = 'system' | 'light' | 'dark';

export interface State {
  items: Item[];
  expired: ExpiredItem[];
  schedules: Schedule[];
  planned: Planned[];
  theme: Theme;
}
