// Catatan melayang per dokumen. Disimpan di dalam JSON dokumen (kunci `notes`), di samping isi editor.

export interface DocNote {
  id: string;
  title: string;
  text: string;
  /** Indeks ke NOTE_COLORS. */
  color: number;
  x: number;
  y: number;
  rot: number;
}

export const NOTE_COLORS = ["--tint-4", "--tint-5", "--tint-6", "--tint-3", "--tint-2", "--tint-1"] as const;

/** Catatan yang tersimpan di JSON dokumen; kosong bila tidak ada atau JSON bukan objek. */
export function readNotes(raw: string): DocNote[] {
  try {
    const doc = JSON.parse(raw) as { notes?: unknown };
    return Array.isArray(doc?.notes) ? (doc.notes as DocNote[]) : [];
  } catch {
    return [];
  }
}

/** Dokumen dalam mode kunci: blok dan catatan melayang tidak bisa bergeser tanpa sengaja. */
export function readLocked(raw: string): boolean {
  try {
    return (JSON.parse(raw) as { locked?: unknown })?.locked === true;
  } catch {
    return false;
  }
}

/** Tempelkan catatan dan mode kunci ke JSON dokumen dari editor; yang kosong dibuang. */
export function withNotes(json: string, notes: DocNote[], locked = false): string {
  try {
    const doc = JSON.parse(json) as Record<string, unknown>;
    if (notes.length) doc.notes = notes;
    else delete doc.notes;
    if (locked) doc.locked = true;
    else delete doc.locked;
    return JSON.stringify(doc);
  } catch {
    return json;
  }
}

export function newNote(index: number, width: number): DocNote {
  return {
    id: crypto.randomUUID(),
    title: "",
    text: "",
    color: index % NOTE_COLORS.length,
    x: Math.max(8, width - 232),
    y: 230 + (index % 6) * 36,
    rot: [-2, 1.5, -1, 2][index % 4],
  };
}
