// Agenda Cognify untuk Notch (berkas cognify-agenda.json di folder bersama; lihat docs/notch/protokol-tautan.md).
// Notch Windows memakainya sebagai pilihan sumber kalender, di samping tautan Google Calendar atau Outlook.

import type { Occurrence } from "$lib/calendar/types";

/** Berapa hari ke depan (termasuk hari ini) yang dibagikan. */
export const AGENDA_DAYS = 3;
const MAX_EVENTS = 100;

export interface AgendaFile {
  schema: 1;
  updatedAt: string;
  events: { id: string; title: string; start: string; end?: string; allDay: boolean; calendar?: string; remindMin?: number; kind?: "task" }[];
}

/** Tugas Moodle dibagikan lebih jauh: dari 14 hari lalu (terlambat) sampai 60 hari ke depan. */
export function taskRange(now: number): [number, number] {
  return [now - 14 * 86_400_000, now + 60 * 86_400_000];
}

/** Awal rentang (hari ini 00:00 lokal) dan akhirnya (AGENDA_DAYS hari kemudian). */
export function agendaRange(now: number): [number, number] {
  const d = new Date(now);
  const from = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const to = new Date(d.getFullYear(), d.getMonth(), d.getDate() + AGENDA_DAYS).getTime();
  return [from, to];
}

/**
 * Susun berkas dari kemunculan acara. Acara yang datang dari Notch sendiri dilewati supaya data tidak
 * berputar balik. Acara yang sudah selesai tidak ikut.
 */
export function buildAgenda(occurrences: Occurrence[], now: number): AgendaFile {
  const events = occurrences
    // Tugas Moodle yang lewat tenggat tetap ikut (belum dikumpulkan); acara lain yang sudah selesai tidak.
    .filter((o) => o.origin !== "notch" && (o.origin === "moodle" || (o.end ?? o.start) > now) && Number.isFinite(o.start))
    .sort((a, b) => a.start - b.start || a.title.localeCompare(b.title))
    .slice(0, MAX_EVENTS)
    .map((o) => ({
      id: o.key,
      title: o.title.slice(0, 200),
      start: new Date(o.start).toISOString(),
      ...(o.end !== null && Number.isFinite(o.end) ? { end: new Date(o.end).toISOString() } : {}),
      allDay: o.allDay,
      ...(o.calendar ? { calendar: o.calendar.slice(0, 80) } : {}),
      ...(o.origin === "moodle" || o.origin === "school" ? { kind: "task" as const } : {}),
      // Menit sebelum mulai saat pengingat berbunyi; hanya acara buatan pengguna dan tugas Moodle yang punya pengingat.
      ...((o.origin === "local" || o.origin === "moodle" || o.origin === "school" || o.origin === "lesson") && o.remindMin !== null && o.remindMin >= 0 ? { remindMin: Math.min(Math.round(o.remindMin), 10080) } : {}),
    }));
  return { schema: 1, updatedAt: new Date(now).toISOString(), events };
}
