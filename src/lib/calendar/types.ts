// Tipe kalender. Harus sinkron dengan src-tauri/src/store/calendar.rs.

export type Repeat = "none" | "daily" | "weekly" | "monthly" | "yearly";

export interface CalEvent {
  id: string;
  title: string;
  notes: string;
  /** Acara berjam: UTC ISO ("2026-10-22T08:00:00.000Z"). Sehari penuh: tanggal lokal ("2026-10-22"). */
  start: string;
  end: string | null;
  allDay: boolean;
  repeat: Repeat;
  /** Tanggal lokal "YYYY-MM-DD", termasuk hari itu. */
  repeatUntil: string | null;
  remindMin: number | null;
  color: string | null;
}

export interface EventInput {
  title: string;
  notes?: string;
  start: string;
  end?: string | null;
  allDay: boolean;
  repeat?: Repeat;
  repeatUntil?: string | null;
  remindMin?: number | null;
  color?: string | null;
}

export interface CalSource {
  id: string;
  name: string;
  kind: "url" | "file";
  url: string | null;
  color: string | null;
  ics: string;
  fetchedAt: string | null;
  error: string | null;
  enabled: boolean;
}

export interface SourceInput {
  name: string;
  kind: "url" | "file";
  url?: string;
  color?: string;
  ics?: string;
}

/** Satu kemunculan acara di garis waktu, dari mana pun asalnya. Waktu dalam ms (zona lokal saat ditampilkan). */
export interface Occurrence {
  /** Unik per kemunculan, aman dipakai sebagai kunci daftar dan pengingat. */
  key: string;
  title: string;
  start: number;
  end: number | null;
  allDay: boolean;
  origin: "local" | "ics" | "notch";
  /** Nama kalender (langganan atau "Notch"); kosong untuk acara Cognify. */
  calendar: string | null;
  color: string | null;
  /** Id acara Cognify, bila bisa diubah atau dihapus. */
  eventId: string | null;
  meeting: string | null;
  notes: string;
  remindMin: number | null;
}
