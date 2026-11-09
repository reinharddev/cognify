// Ringkasan Cognify untuk Notch (berkas cognify-hub.json di folder bersama; lihat docs/notch/protokol-tautan.md):
// pelajaran hari ini, dokumen sematan dan terbaru, dan daftar Alat. Notch menampilkannya dan mengirim
// perintah balik lewat folder inbox/ (dibaca src-tauri/src/link/inbox.rs).

import type { Occurrence } from "$lib/calendar/types";

export interface HubFile {
  schema: 1;
  updatedAt: string;
  lessons: { id: string; title: string; start: string; end?: string; room?: string }[];
  docs: {
    pinned: { id: string; title: string; kind: string }[];
    recent: { id: string; title: string; kind: string }[];
  };
  tools: { id: string; name: string }[];
}

interface DocLike {
  id: string;
  title: string;
  kind: string;
}

const MAX_LESSONS = 12;
const MAX_DOCS = 8;
const MAX_TOOLS = 40;

const clip = (s: string, n: number) => (s.trim() || "").slice(0, n);

/** Awal dan akhir hari ini (lokal), untuk memilih pelajaran. */
export function todayRange(now: number): [number, number] {
  const d = new Date(now);
  return [new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(), new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime()];
}

export function buildHub(input: {
  now: number;
  occurrences: Occurrence[];
  favorites: DocLike[];
  recent: DocLike[];
  tools: { id: string; name: string }[];
}): HubFile {
  const [from, to] = todayRange(input.now);
  const lessons = input.occurrences
    .filter((o) => o.origin === "lesson" && o.start >= from && o.start < to && Number.isFinite(o.start))
    .sort((a, b) => a.start - b.start)
    .slice(0, MAX_LESSONS)
    .map((o) => ({
      id: o.key,
      title: clip(o.title, 120),
      start: new Date(o.start).toISOString(),
      ...(o.end !== null && Number.isFinite(o.end) ? { end: new Date(o.end).toISOString() } : {}),
      ...(o.calendar ? { room: clip(o.calendar, 60) } : {}),
    }));
  const doc = (d: DocLike) => ({ id: d.id, title: clip(d.title, 120) || "Tanpa judul", kind: d.kind });
  const pinned = input.favorites.filter((d) => d.kind !== "folder").slice(0, MAX_DOCS).map(doc);
  const pinnedIds = new Set(pinned.map((d) => d.id));
  const recent = input.recent.filter((d) => d.kind !== "folder" && !pinnedIds.has(d.id)).slice(0, MAX_DOCS).map(doc);
  return {
    schema: 1,
    updatedAt: new Date(input.now).toISOString(),
    lessons,
    docs: { pinned, recent },
    tools: input.tools.slice(0, MAX_TOOLS).map((t) => ({ id: t.id, name: clip(t.name, 60) })),
  };
}
