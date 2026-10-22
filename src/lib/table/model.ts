import { tr } from "$lib/i18n.svelte";
// Model halaman Tabel: kolom bertipe, baris, tampilan tabel atau papan (kanban), urutan, dan pengelompokan.
// Semua fungsi murni dan tidak mengubah masukannya; isi disimpan sebagai JSON di kolom `content` halaman.

export type ColType = "text" | "number" | "date" | "select" | "checkbox";
export const COL_TYPES: ColType[] = ["text", "number", "date", "select", "checkbox"];

export interface Option {
  id: string;
  label: string;
  /** Indeks warna 0..7 (var(--cat-N)). */
  color: number;
}

export interface Column {
  id: string;
  name: string;
  type: ColType;
  options?: Option[];
}

export type CellValue = string | number | boolean | null;

export interface Row {
  id: string;
  cells: Record<string, CellValue>;
}

export interface Sort {
  col: string;
  dir: "asc" | "desc";
}

export interface TableData {
  version: 1;
  columns: Column[];
  rows: Row[];
  view: "table" | "board";
  /** Kolom pilihan yang menjadi lajur papan. */
  groupBy: string | null;
  sort: Sort | null;
}

export const MAX_COLUMNS = 30;
export const MAX_ROWS = 2000;
export const MAX_OPTIONS = 30;
const MAX_TEXT = 2000;
const MAX_NAME = 60;

let counter = 0;
export function newId(): string {
  counter = (counter + 1) % 1e6;
  const rnd = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `${rnd}${counter.toString(36)}`;
}

const clampName = (s: string): string => s.trim().slice(0, MAX_NAME);

export function emptyTable(): TableData {
  const title: Column = { id: newId(), name: "Judul", type: "text" };
  const status: Column = {
    id: newId(),
    name: "Status",
    type: "select",
    options: [
      { id: newId(), label: "Belum", color: 3 },
      { id: newId(), label: "Dikerjakan", color: 2 },
      { id: newId(), label: "Selesai", color: 4 },
    ],
  };
  return { version: 1, columns: [title, status], rows: [], view: "table", groupBy: status.id, sort: null };
}

function cleanOption(o: unknown, i: number): Option | null {
  if (!o || typeof o !== "object") return null;
  const r = o as Record<string, unknown>;
  const label = typeof r.label === "string" ? clampName(r.label) : "";
  if (!label) return null;
  return { id: typeof r.id === "string" && r.id ? r.id : newId(), label, color: Number.isInteger(r.color) ? ((r.color as number) % 8 + 8) % 8 : i % 8 };
}

/** Coba ubah nilai mentah menjadi nilai sah untuk kolom `col`; null bila tidak bisa. */
export function coerce(col: Column, value: unknown): CellValue {
  if (value === null || value === undefined || value === "") return col.type === "checkbox" ? false : null;
  switch (col.type) {
    case "text":
      return typeof value === "string" ? value.slice(0, MAX_TEXT) : typeof value === "number" || typeof value === "boolean" ? String(value) : null;
    case "number": {
      const n = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(",", ".")) : NaN;
      return Number.isFinite(n) ? n : null;
    }
    case "date":
      return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) ? value : null;
    case "select":
      return typeof value === "string" && col.options?.some((o) => o.id === value) ? value : null;
    case "checkbox":
      return value === true || value === "true";
  }
}

/** Baca isi halaman menjadi tabel yang sah. Data rusak atau kosong menjadi tabel kosong baru. */
export function parseTable(raw: string): TableData {
  let v: unknown;
  try {
    v = raw.trim() ? JSON.parse(raw) : null;
  } catch {
    v = null;
  }
  if (!v || typeof v !== "object" || !Array.isArray((v as TableData).columns)) return emptyTable();
  const src = v as Record<string, unknown>;

  const seen = new Set<string>();
  const columns: Column[] = [];
  for (const c of src.columns as unknown[]) {
    if (!c || typeof c !== "object" || columns.length >= MAX_COLUMNS) continue;
    const r = c as Record<string, unknown>;
    const type = COL_TYPES.includes(r.type as ColType) ? (r.type as ColType) : "text";
    let id = typeof r.id === "string" && r.id ? r.id : newId();
    if (seen.has(id)) id = newId();
    seen.add(id);
    const col: Column = { id, name: clampName(typeof r.name === "string" ? r.name : "") || "Kolom", type };
    if (type === "select") {
      const ids = new Set<string>();
      col.options = (Array.isArray(r.options) ? r.options : [])
        .map(cleanOption)
        .filter((o): o is Option => !!o && !ids.has(o.id) && !!ids.add(o.id))
        .slice(0, MAX_OPTIONS);
    }
    columns.push(col);
  }
  if (!columns.length) return emptyTable();

  const rowIds = new Set<string>();
  const rows: Row[] = [];
  for (const row of Array.isArray(src.rows) ? (src.rows as unknown[]) : []) {
    if (!row || typeof row !== "object" || rows.length >= MAX_ROWS) continue;
    const r = row as Record<string, unknown>;
    let id = typeof r.id === "string" && r.id ? r.id : newId();
    if (rowIds.has(id)) id = newId();
    rowIds.add(id);
    const cells: Record<string, CellValue> = {};
    const given = r.cells && typeof r.cells === "object" ? (r.cells as Record<string, unknown>) : {};
    for (const col of columns) {
      const cv = coerce(col, given[col.id]);
      if (cv !== null && !(col.type === "checkbox" && cv === false)) cells[col.id] = cv;
    }
    rows.push({ id, cells });
  }

  const groupBy = columns.some((c) => c.id === src.groupBy && c.type === "select") ? (src.groupBy as string) : (columns.find((c) => c.type === "select")?.id ?? null);
  const sortRaw = src.sort as Sort | null | undefined;
  const sort = sortRaw && columns.some((c) => c.id === sortRaw.col) && (sortRaw.dir === "asc" || sortRaw.dir === "desc") ? { col: sortRaw.col, dir: sortRaw.dir } : null;
  const view = src.view === "board" && groupBy ? "board" : "table";
  return { version: 1, columns, rows, view, groupBy, sort };
}

export const serialize = (t: TableData): string => JSON.stringify(t);

const col = (t: TableData, id: string): Column | undefined => t.columns.find((c) => c.id === id);

export function addColumn(t: TableData, name: string, type: ColType = "text"): TableData {
  if (t.columns.length >= MAX_COLUMNS) return t;
  const c: Column = { id: newId(), name: clampName(name) || "Kolom", type };
  if (type === "select") c.options = [];
  const next = { ...t, columns: [...t.columns, c] };
  return type === "select" && !t.groupBy ? { ...next, groupBy: c.id } : next;
}

export function renameColumn(t: TableData, id: string, name: string): TableData {
  const n = clampName(name);
  return n ? { ...t, columns: t.columns.map((c) => (c.id === id ? { ...c, name: n } : c)) } : t;
}

/** Hapus kolom; kolom terakhir tidak bisa dihapus. Pengaturan yang menunjuk kolom itu dibersihkan. */
export function removeColumn(t: TableData, id: string): TableData {
  if (t.columns.length <= 1 || !col(t, id)) return t;
  const columns = t.columns.filter((c) => c.id !== id);
  const rows = t.rows.map((r) => {
    const { [id]: _drop, ...cells } = r.cells;
    return { ...r, cells };
  });
  let groupBy = t.groupBy === id ? (columns.find((c) => c.type === "select")?.id ?? null) : t.groupBy;
  return { ...t, columns, rows, groupBy, view: t.view === "board" && !groupBy ? "table" : t.view, sort: t.sort?.col === id ? null : t.sort };
}

/** Ganti tipe kolom; isi sel diubah sebisanya (teks ↔ angka ↔ tanggal), pilihan dicocokkan lewat label. */
export function setColumnType(t: TableData, id: string, type: ColType): TableData {
  const old = col(t, id);
  if (!old || old.type === type) return t;
  let next: Column = { id, name: old.name, type };
  if (type === "select") {
    const labels = new Map<string, Option>();
    if (old.type === "text") {
      for (const r of t.rows) {
        const lab = typeof r.cells[id] === "string" ? clampName(r.cells[id] as string) : "";
        if (lab && !labels.has(lab.toLowerCase()) && labels.size < MAX_OPTIONS) labels.set(lab.toLowerCase(), { id: newId(), label: lab, color: labels.size % 8 });
      }
    }
    next = { ...next, options: [...labels.values()] };
  }
  const label = (v: CellValue) => (old.type === "select" ? (old.options?.find((o) => o.id === v)?.label ?? null) : v);
  const rows = t.rows.map((r) => {
    const raw = label(r.cells[id] ?? null);
    let v: CellValue;
    if (type === "select") v = typeof raw === "string" ? (next.options!.find((o) => o.label.toLowerCase() === clampName(raw).toLowerCase())?.id ?? null) : null;
    else v = coerce(next, raw);
    const cells = { ...r.cells };
    if (v === null || (type === "checkbox" && v === false)) delete cells[id];
    else cells[id] = v;
    return { ...r, cells };
  });
  const columns = t.columns.map((c) => (c.id === id ? next : c));
  let groupBy = t.groupBy;
  if (t.groupBy === id && type !== "select") groupBy = columns.find((c) => c.type === "select")?.id ?? null;
  else if (type === "select" && !groupBy) groupBy = id;
  return { ...t, columns, rows, groupBy, view: t.view === "board" && !groupBy ? "table" : t.view };
}

export function addOption(t: TableData, colId: string, label: string): TableData {
  const l = clampName(label);
  const c = col(t, colId);
  if (!l || !c || c.type !== "select" || (c.options?.length ?? 0) >= MAX_OPTIONS) return t;
  if (c.options?.some((o) => o.label.toLowerCase() === l.toLowerCase())) return t;
  const opt: Option = { id: newId(), label: l, color: (c.options?.length ?? 0) % 8 };
  return { ...t, columns: t.columns.map((x) => (x.id === colId ? { ...x, options: [...(x.options ?? []), opt] } : x)) };
}

export function renameOption(t: TableData, colId: string, optId: string, label: string): TableData {
  const l = clampName(label);
  if (!l) return t;
  return { ...t, columns: t.columns.map((c) => (c.id === colId ? { ...c, options: c.options?.map((o) => (o.id === optId ? { ...o, label: l } : o)) } : c)) };
}

export function recolorOption(t: TableData, colId: string, optId: string, color: number): TableData {
  const k = ((Math.trunc(color) % 8) + 8) % 8;
  return { ...t, columns: t.columns.map((c) => (c.id === colId ? { ...c, options: c.options?.map((o) => (o.id === optId ? { ...o, color: k } : o)) } : c)) };
}

/** Hapus pilihan; sel yang memakainya menjadi kosong. */
export function removeOption(t: TableData, colId: string, optId: string): TableData {
  return {
    ...t,
    columns: t.columns.map((c) => (c.id === colId ? { ...c, options: c.options?.filter((o) => o.id !== optId) } : c)),
    rows: t.rows.map((r) => {
      if (r.cells[colId] !== optId) return r;
      const { [colId]: _drop, ...cells } = r.cells;
      return { ...r, cells };
    }),
  };
}

export function addRow(t: TableData, init: Record<string, unknown> = {}): TableData {
  if (t.rows.length >= MAX_ROWS) return t;
  const cells: Record<string, CellValue> = {};
  for (const c of t.columns) {
    const v = coerce(c, init[c.id]);
    if (v !== null && !(c.type === "checkbox" && v === false)) cells[c.id] = v;
  }
  return { ...t, rows: [...t.rows, { id: newId(), cells }] };
}

export function removeRow(t: TableData, id: string): TableData {
  return { ...t, rows: t.rows.filter((r) => r.id !== id) };
}

export function setCell(t: TableData, rowId: string, colId: string, value: unknown): TableData {
  const c = col(t, colId);
  if (!c) return t;
  const v = coerce(c, value);
  return {
    ...t,
    rows: t.rows.map((r) => {
      if (r.id !== rowId) return r;
      const cells = { ...r.cells };
      if (v === null || (c.type === "checkbox" && v === false)) delete cells[colId];
      else cells[colId] = v;
      return { ...r, cells };
    }),
  };
}

export function setView(t: TableData, view: "table" | "board"): TableData {
  return view === "board" && !t.groupBy ? t : { ...t, view };
}

export function setGroupBy(t: TableData, colId: string): TableData {
  return col(t, colId)?.type === "select" ? { ...t, groupBy: colId } : t;
}

export function setSort(t: TableData, sort: Sort | null): TableData {
  return sort === null ? { ...t, sort: null } : col(t, sort.col) ? { ...t, sort } : t;
}

/** Klik judul kolom: naik → turun → tanpa urutan. */
export function cycleSort(t: TableData, colId: string): TableData {
  if (!col(t, colId)) return t;
  if (t.sort?.col !== colId) return { ...t, sort: { col: colId, dir: "asc" } };
  return t.sort.dir === "asc" ? { ...t, sort: { col: colId, dir: "desc" } } : { ...t, sort: null };
}

const collator = new Intl.Collator("id", { sensitivity: "base", numeric: true });

/** Baris menurut urutan dan saringan teks. Sel kosong selalu di akhir; urutan stabil. */
export function visibleRows(t: TableData, query = ""): Row[] {
  const q = query.trim().toLowerCase();
  let rows = t.rows;
  if (q) rows = rows.filter((r) => t.columns.some((c) => display(c, r.cells[c.id]).toLowerCase().includes(q)));
  const s = t.sort;
  const c = s && col(t, s.col);
  if (!s || !c) return rows;
  const sign = s.dir === "asc" ? 1 : -1;
  const key = (r: Row): string | number | boolean | null => {
    const v = r.cells[c.id] ?? null;
    if (c.type === "select") return v === null ? null : (c.options?.findIndex((o) => o.id === v) ?? -1);
    return v;
  };
  return rows
    .map((r, i) => ({ r, i, k: key(r) }))
    .sort((a, b) => {
      if (a.k === null && b.k === null) return a.i - b.i;
      if (a.k === null) return 1;
      if (b.k === null) return -1;
      const cmp = typeof a.k === "string" && typeof b.k === "string" ? collator.compare(a.k, b.k) : Number(a.k) - Number(b.k);
      return cmp * sign || a.i - b.i;
    })
    .map((x) => x.r);
}

/** Teks tampilan sebuah sel. */
export function display(c: Column, v: CellValue | undefined): string {
  if (v === null || v === undefined) return "";
  if (c.type === "select") return c.options?.find((o) => o.id === v)?.label ?? "";
  if (c.type === "checkbox") return v ? "Ya" : "";
  return String(v);
}

export interface Lane {
  /** Null untuk lajur "tanpa nilai". */
  option: Option | null;
  rows: Row[];
}

/** Lajur papan menurut kolom `groupBy`: satu per pilihan, ditambah lajur tanpa nilai bila ada isinya. */
export function lanes(t: TableData, query = ""): Lane[] {
  const g = t.groupBy ? col(t, t.groupBy) : undefined;
  if (!g || g.type !== "select") return [];
  const rows = visibleRows({ ...t, sort: null }, query);
  const out: Lane[] = (g.options ?? []).map((option) => ({ option, rows: rows.filter((r) => r.cells[g.id] === option.id) }));
  const none = rows.filter((r) => !out.some((l) => l.rows.includes(r)));
  return none.length ? [{ option: null, rows: none }, ...out] : out;
}

/** Pindahkan kartu ke lajur `optionId` (null = tanpa nilai), sebelum kartu `beforeId` atau di akhir lajur. */
export function moveCard(t: TableData, rowId: string, optionId: string | null, beforeId: string | null = null): TableData {
  const g = t.groupBy ? col(t, t.groupBy) : undefined;
  const row = t.rows.find((r) => r.id === rowId);
  if (!g || !row || rowId === beforeId) return t;
  const moved = setCell(t, rowId, g.id, optionId).rows.find((r) => r.id === rowId)!;
  const rest = t.rows.filter((r) => r.id !== rowId);
  let at = beforeId ? rest.findIndex((r) => r.id === beforeId) : -1;
  if (at < 0) {
    // Akhir lajur: setelah baris terakhir yang berada di lajur yang sama.
    const same = rest.map((r, i) => ({ r, i })).filter((x) => (x.r.cells[g.id] ?? null) === optionId);
    at = same.length ? same[same.length - 1].i + 1 : rest.length;
  }
  const rows = [...rest.slice(0, at), moved, ...rest.slice(at)];
  return { ...t, rows };
}

/** Teks polos untuk pencarian halaman: nama kolom lalu isi sel per baris. */
export function plainText(t: TableData): string {
  const head = t.columns.map((c) => c.name).join(" ");
  const body = t.rows.map((r) => t.columns.map((c) => display(c, r.cells[c.id])).filter(Boolean).join(" ")).filter(Boolean);
  return [head, ...body].join("\n").slice(0, 200_000);
}

// ── Templat ─────────────────────────────────────────────────────────────────

const opts = (labels: [string, number][]): Option[] => labels.map(([label, color]) => ({ id: newId(), label, color }));

/** Daftar PR: judul, mapel, tenggat, status. */
export function prTemplate(): TableData {
  const mapel: Column = { id: newId(), name: tr("Mapel", "Subject"), type: "select", options: opts([[tr("Matematika", "Math"), 0], [tr("IPA", "Science"), 4], [tr("Bahasa", "Language"), 3], [tr("Lainnya", "Other"), 1]]) };
  const status: Column = { id: newId(), name: "Status", type: "select", options: opts([[tr("Belum", "To do"), 3], [tr("Dikerjakan", "In progress"), 2], [tr("Selesai", "Done"), 4]]) };
  const columns: Column[] = [{ id: newId(), name: tr("PR", "Homework"), type: "text" }, mapel, { id: newId(), name: tr("Tenggat", "Due date"), type: "date" }, status];
  return { version: 1, columns, rows: [], view: "board", groupBy: status.id, sort: null };
}

/** Jadwal pelajaran: hari, jam, mapel, ruang. */
export function scheduleTemplate(): TableData {
  const hari: Column = { id: newId(), name: tr("Hari", "Day"), type: "select", options: opts([[tr("Senin", "Monday"), 0], [tr("Selasa", "Tuesday"), 1], [tr("Rabu", "Wednesday"), 2], [tr("Kamis", "Thursday"), 3], [tr("Jumat", "Friday"), 4], [tr("Sabtu", "Saturday"), 5]]) };
  const columns: Column[] = [{ id: newId(), name: tr("Mapel", "Subject"), type: "text" }, hari, { id: newId(), name: tr("Jam", "Time"), type: "text" }, { id: newId(), name: tr("Ruang", "Room"), type: "text" }];
  return { version: 1, columns, rows: [], view: "table", groupBy: hari.id, sort: null };
}
