// Kalender untuk seluruh UI: acara Cognify, langganan ICS, dan agenda dari Notch (baca saja),
// digabung menjadi kemunculan di sebuah rentang waktu.

import { calendarApi } from "$lib/calendar/api";
import { expandEvent } from "$lib/calendar/expand";
import { parseIcs } from "$lib/calendar/ics";
import type { CalEvent, CalSource, EventInput, Occurrence, SourceInput } from "$lib/calendar/types";
import { notchLink } from "./link.svelte";

const REFRESH_MS = 30 * 60_000;

class CalendarStore {
  events = $state<CalEvent[]>([]);
  sources = $state<CalSource[]>([]);
  loaded = $state(false);
  error = $state<string | null>(null);
  refreshing = $state(false);

  #started = false;
  /** Hasil penguraian ICS per langganan dan rentang, supaya menggulir bulan tidak menguraikan ulang. */
  #icsCache = new Map<string, Occurrence[]>();

  async init() {
    if (this.#started) return;
    this.#started = true;
    try {
      [this.events, this.sources] = await Promise.all([calendarApi.events.list(), calendarApi.sources.list()]);
      this.error = null;
    } catch (e) {
      this.error = e instanceof Error ? e.message : "Kalender tidak bisa dimuat.";
    } finally {
      this.loaded = true;
    }
    void this.refreshStale();
    setInterval(() => void this.refreshStale(), REFRESH_MS);
  }

  /** Ambil ulang langganan tautan yang sudah lebih dari 30 menit tidak diperbarui. */
  async refreshStale() {
    const stale = this.sources.filter(
      (s) => s.enabled && s.kind === "url" && (!s.fetchedAt || Date.now() - Date.parse(s.fetchedAt) > REFRESH_MS - 60_000),
    );
    await Promise.all(stale.map((s) => this.refreshSource(s.id)));
  }

  async refreshSource(id: string) {
    this.refreshing = true;
    try {
      this.#replaceSource(await calendarApi.sources.refresh(id));
    } catch (e) {
      this.error = e instanceof Error ? e.message : "Kalender tidak bisa diperbarui.";
    } finally {
      this.refreshing = false;
    }
  }

  #replaceSource(next: CalSource) {
    this.#icsCache.clear();
    this.sources = this.sources.some((s) => s.id === next.id) ? this.sources.map((s) => (s.id === next.id ? next : s)) : [...this.sources, next];
  }

  async saveEvent(input: EventInput, id?: string): Promise<CalEvent> {
    const saved = id ? await calendarApi.events.update(id, input) : await calendarApi.events.create(input);
    this.events = id ? this.events.map((e) => (e.id === id ? saved : e)) : [...this.events, saved];
    return saved;
  }

  async deleteEvent(id: string) {
    await calendarApi.events.remove(id);
    this.events = this.events.filter((e) => e.id !== id);
  }

  async addSource(input: SourceInput) {
    this.#replaceSource(await calendarApi.sources.add(input));
  }

  async setSourceEnabled(id: string, enabled: boolean) {
    this.#replaceSource(await calendarApi.sources.setEnabled(id, enabled));
  }

  async removeSource(id: string) {
    await calendarApi.sources.remove(id);
    this.#icsCache.clear();
    this.sources = this.sources.filter((s) => s.id !== id);
  }

  #icsOccurrences(s: CalSource, from: number, to: number): Occurrence[] {
    const key = `${s.id}|${s.fetchedAt}|${from}|${to}`;
    const hit = this.#icsCache.get(key);
    if (hit) return hit;
    let out: Occurrence[] = [];
    try {
      out = parseIcs(s.ics, from, to).map((e) => ({
        key: `ics:${s.id}:${e.id}`, title: e.title, start: e.start, end: e.end, allDay: e.allDay, origin: "ics" as const,
        calendar: s.name, color: s.color, eventId: null, meeting: e.meeting, notes: "", remindMin: null,
      }));
    } catch {
      /* satu langganan rusak tidak boleh merusak tampilan lainnya */
    }
    if (this.#icsCache.size > 60) this.#icsCache.clear();
    this.#icsCache.set(key, out);
    return out;
  }

  /** Semua kemunculan di [from, to] (ms) dari ketiga sumber, terurut menurut waktu. */
  occurrences(from: number, to: number): Occurrence[] {
    const out: Occurrence[] = [];
    for (const e of this.events) out.push(...expandEvent(e, from, to));
    for (const s of this.sources) if (s.enabled && s.ics) out.push(...this.#icsOccurrences(s, from, to));
    for (const a of notchLink.data?.agenda ?? []) {
      const start = Date.parse(a.start);
      const end = a.end ? Date.parse(a.end) : null;
      if (Number.isNaN(start) || (end ?? start) < from || start > to) continue;
      out.push({
        key: `notch:${a.id}`, title: a.title, start, end: end !== null && !Number.isNaN(end) ? end : null, allDay: a.allDay,
        origin: "notch", calendar: a.calendar ? `Notch, ${a.calendar}` : "Notch", color: null, eventId: null, meeting: null, notes: "", remindMin: null,
      });
    }
    return out.sort((x, y) => x.start - y.start || x.title.localeCompare(y.title));
  }
}

export const calendar = new CalendarStore();
