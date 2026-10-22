// Klien kalender (src-tauri/src/store/calendar.rs). Di browser biasa dipakai penyimpanan sementara.

import { invoke, isTauri } from "@tauri-apps/api/core";
import { ApiError } from "$lib/workspace/errors";
import type { CalEvent, CalSource, EventInput, SourceInput } from "./types";

const STATUS: Record<string, number> = { not_found: 404, invalid: 422, db_error: 500 };

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return isTauri() ? await invoke<T>(command, args) : ((await mock(command, args ?? {})) as T);
  } catch (e) {
    const err = e as { code?: string; message?: string };
    if (err && typeof err === "object" && typeof err.code === "string") {
      throw new ApiError(STATUS[err.code] ?? 500, err.code, err.message ?? "Terjadi kesalahan");
    }
    throw new ApiError(500, "unknown", typeof e === "string" ? e : "Terjadi kesalahan");
  }
}

export const calendarApi = {
  events: {
    list: () => call<CalEvent[]>("event_list"),
    create: (input: EventInput) => call<CalEvent>("event_create", { input }),
    update: (id: string, input: EventInput) => call<CalEvent>("event_update", { id, input }),
    remove: (id: string) => call<void>("event_delete", { id }),
  },
  sources: {
    list: () => call<CalSource[]>("calendar_source_list"),
    add: (input: SourceInput) => call<CalSource>("calendar_source_add", { input }),
    refresh: (id: string) => call<CalSource>("calendar_source_refresh", { id }),
    setEnabled: (id: string, enabled: boolean) => call<CalSource>("calendar_source_enable", { id, enabled }),
    remove: (id: string) => call<void>("calendar_source_delete", { id }),
  },
};

// ── pratinjau di browser: penyimpanan sementara di localStorage ─────────────────
const KEY = "cognify.preview.calendar";
let state: { events: CalEvent[]; sources: CalSource[] } = (() => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "") ?? { events: [], sources: [] };
  } catch {
    return { events: [], sources: [] };
  }
})();
const persist = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* pratinjau saja */
  }
};

/** ICS contoh untuk langganan tautan di pratinjau: dua acara dekat hari ini dan satu yang berulang. */
function sampleIcs(): string {
  const d = new Date();
  const stamp = (offsetDays: number, h: number) => {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + offsetDays, h, 0, 0);
    return x.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  };
  return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:s1\r\nDTSTART:${stamp(1, 9)}\r\nDTEND:${stamp(1, 10)}\r\nSUMMARY:Kelas Fisika\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:s2\r\nDTSTART:${stamp(3, 13)}\r\nSUMMARY:Rapat OSIS\r\nLOCATION:https://meet.google.com/abc-defg-hij\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:s3\r\nDTSTART:${stamp(0, 7)}\r\nRRULE:FREQ=WEEKLY;COUNT=8\r\nSUMMARY:Latihan band\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
}

const bad = (message: string) => ({ code: "invalid", message });

async function mock(command: string, a: Record<string, any>): Promise<unknown> {
  const now = new Date().toISOString();
  switch (command) {
    case "event_list":
      return [...state.events].sort((x, y) => x.start.localeCompare(y.start));
    case "event_create": {
      const i = a.input as EventInput;
      if (!i.title?.trim()) throw bad("Beri judul pada acara.");
      const ev: CalEvent = {
        id: crypto.randomUUID(), title: i.title.trim(), notes: i.notes ?? "", start: i.start, end: i.end ?? null,
        allDay: i.allDay, repeat: i.repeat ?? "none", repeatUntil: i.repeatUntil ?? null, remindMin: i.remindMin ?? null, color: i.color ?? null,
      };
      state.events.push(ev);
      persist();
      return ev;
    }
    case "event_update": {
      const ev = state.events.find((e) => e.id === a.id);
      if (!ev) throw { code: "not_found", message: "Acara tidak ditemukan." };
      const i = a.input as EventInput;
      if (!i.title?.trim()) throw bad("Beri judul pada acara.");
      Object.assign(ev, { title: i.title.trim(), notes: i.notes ?? "", start: i.start, end: i.end ?? null, allDay: i.allDay, repeat: i.repeat ?? "none", repeatUntil: i.repeatUntil ?? null, remindMin: i.remindMin ?? null, color: i.color ?? null });
      persist();
      return ev;
    }
    case "event_delete":
      state.events = state.events.filter((e) => e.id !== a.id);
      persist();
      return null;
    case "calendar_source_list":
      return state.sources;
    case "calendar_source_add": {
      const i = a.input as SourceInput;
      if (!i.name?.trim()) throw bad("Beri nama kalender (maksimal 100 karakter).");
      if (i.kind === "url" && !/^(https|webcal):\/\//.test((i.url ?? "").trim())) throw bad("Tautan kalender harus berupa alamat https (atau webcal).");
      if (i.kind === "file" && !(i.ics ?? "").trimStart().startsWith("BEGIN:VCALENDAR")) throw bad("Isinya bukan kalender iCalendar (.ics).");
      const src: CalSource = {
        id: crypto.randomUUID(), name: i.name.trim(), kind: i.kind, url: i.url ?? null, color: i.color ?? null,
        ics: i.kind === "file" ? i.ics! : sampleIcs(), fetchedAt: now, error: null, enabled: true,
      };
      state.sources.push(src);
      persist();
      return src;
    }
    case "calendar_source_refresh": {
      const src = state.sources.find((s) => s.id === a.id);
      if (!src) throw { code: "not_found", message: "Kalender tidak ditemukan." };
      if (src.kind === "url") src.ics = sampleIcs();
      src.fetchedAt = now;
      persist();
      return src;
    }
    case "calendar_source_enable": {
      const src = state.sources.find((s) => s.id === a.id);
      if (!src) throw { code: "not_found", message: "Kalender tidak ditemukan." };
      src.enabled = a.enabled;
      persist();
      return src;
    }
    case "calendar_source_delete":
      state.sources = state.sources.filter((s) => s.id !== a.id);
      persist();
      return null;
    default:
      throw bad(`Perintah pratinjau tidak dikenal: ${command}`);
  }
}
