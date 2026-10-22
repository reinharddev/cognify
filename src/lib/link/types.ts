// Data dari Cognify Notch. Harus sinkron dengan src-tauri/src/link/model.rs dan docs/NOTCH_LINK.md.

export interface LinkStatus {
  connected: boolean;
  shareClipboard: boolean;
  connectedAt: string | null;
  notchInstalled: boolean;
  lastUpdate: string | null;
  needsNewerCognify: boolean;
  folder: string;
  /** Notch di sistem ini sudah bisa terhubung ke Cognify (belum di Windows). */
  linkAvailable: boolean;
  notchVersion: string | null;
  minNotchVersion: string | null;
  /** Versi Notch diketahui dan lebih lama dari yang dibutuhkan. */
  notchOutdated: boolean;
}

export interface NotchTodo { id: string; title: string; done: boolean; dueAt: string | null }
export interface NotchNote { id: string; text: string; createdAt: string | null }
export interface NotchClip { id: string; kind: string; text: string; at: string | null }
export interface NotchTrayItem { id: string; name: string; path: string; addedAt: string | null }
export interface NotchTimer { id: string; title: string; durationSec: number; endsAt: string | null; running: boolean }
export interface NotchWater {
  goalMl: number | null;
  today: { at: string; ml: number }[];
  history: { date: string; ml: number }[];
}
export interface NotchAgendaItem {
  id: string; title: string; start: string; end: string | null; allDay: boolean; calendar: string | null;
}
export interface NotchNow {
  weather: { tempC: number | null; summary: string; place: string | null } | null;
  playing: { title: string; artist: string | null } | null;
  battery: { percent: number; charging: boolean } | null;
}

export interface NotchData {
  schema: number;
  platform: string;
  appVersion: string;
  updatedAt: string;
  todos: NotchTodo[];
  notes: NotchNote[];
  clipboard: NotchClip[];
  tray: NotchTrayItem[];
  timers: NotchTimer[];
  water: NotchWater | null;
  agenda: NotchAgendaItem[];
  now: NotchNow | null;
}
