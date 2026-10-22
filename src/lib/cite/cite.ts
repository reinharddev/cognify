// Sitasi dari data sumber (CSL-JSON) memakai mesin CSL (citeproc-js) dan gaya CSL resmi (lisensi CC BY-SA 3.0, lihat
// THIRD_PARTY_NOTICES.md). Berjalan penuh di komputer ini. Istilah ("t.t." atau "n.d.", "diakses" atau "accessed") mengikuti
// bahasa app lewat berkas locale CSL.

import CSL from "citeproc";

export interface CslName {
  family?: string;
  given?: string;
  literal?: string;
  /** Pemisahan nama depan/belakang disimpulkan otomatis; perlu diperiksa. */
  _guess?: boolean;
}

export interface CslSource {
  type?: string;
  title?: string;
  author?: CslName[];
  issued?: { "date-parts": number[][] };
  accessed?: { "date-parts": number[][] };
  "container-title"?: string;
  publisher?: string;
  URL?: string;
  DOI?: string;
  volume?: string;
  issue?: string;
  page?: string;
  ISSN?: string;
  number?: string;
  language?: string;
  /** Kolom yang disimpulkan, bukan dibaca langsung dari sumber: "title", "author", "issued", "container-title", "type". */
  _guess?: string[];
  _pdf?: boolean;
  [key: string]: unknown;
}

export interface Mark {
  url: string;
  section?: string;
  page?: number | null;
  accessed?: string;
}

export type StyleId = "apa" | "mla" | "chicago-ad" | "chicago-nb" | "harvard" | "ieee" | "vancouver" | "iso690-ad" | "iso690-num";

interface StyleInfo {
  id: StyleId;
  label: string;
  /** author-date: (Penulis, tahun); numeric: [1]; note: catatan kaki. */
  kind: "author-date" | "numeric" | "note";
  load: () => Promise<string>;
}

export const STYLES: StyleInfo[] = [
  { id: "apa", label: "APA 7", kind: "author-date", load: () => import("./styles/apa.csl?raw").then((m) => m.default) },
  { id: "mla", label: "MLA 9", kind: "author-date", load: () => import("./styles/modern-language-association.csl?raw").then((m) => m.default) },
  { id: "chicago-ad", label: "Chicago 18 (penulis-tahun)", kind: "author-date", load: () => import("./styles/chicago-author-date.csl?raw").then((m) => m.default) },
  { id: "chicago-nb", label: "Chicago 18 (catatan kaki)", kind: "note", load: () => import("./styles/chicago-notes-bibliography.csl?raw").then((m) => m.default) },
  { id: "harvard", label: "Harvard (Cite Them Right 12)", kind: "author-date", load: () => import("./styles/harvard-cite-them-right.csl?raw").then((m) => m.default) },
  { id: "ieee", label: "IEEE", kind: "numeric", load: () => import("./styles/ieee.csl?raw").then((m) => m.default) },
  { id: "vancouver", label: "Vancouver (NLM)", kind: "numeric", load: () => import("./styles/vancouver.csl?raw").then((m) => m.default) },
  { id: "iso690-ad", label: "ISO 690 (penulis-tahun)", kind: "author-date", load: () => import("./styles/iso690-author-date-en.csl?raw").then((m) => m.default) },
  { id: "iso690-num", label: "ISO 690 (numerik)", kind: "numeric", load: () => import("./styles/iso690-numeric-en.csl?raw").then((m) => m.default) },
];

const LOCALES: Record<string, () => Promise<string>> = {
  "en-US": () => import("./locales/locales-en-US.xml?raw").then((m) => m.default),
  "id-ID": () => import("./locales/locales-id-ID.xml?raw").then((m) => m.default),
};

export interface CiteResult {
  /** Entri daftar pustaka (HTML dengan cetak miring dari gaya). */
  bibliography: string;
  /** Sitasi dalam teks (atau catatan kaki) untuk tiap sorotan, urutannya sama dengan `marks`. */
  inText: string[];
  /** Sitasi dalam teks tanpa lokasi, untuk dipakai bila tidak ada sorotan. */
  inTextBase: string;
}

const ID = "src";

/** Tanggal "2026-10-22" menjadi bentuk CSL. */
export function cslDate(iso: string | undefined): { "date-parts": number[][] } | undefined {
  const m = (iso ?? "").match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  return m ? { "date-parts": [[Number(m[1]), Number(m[2]), Number(m[3])]] } : undefined;
}

/** Bersihkan data untuk mesin CSL: buang kolom internal dan nilai kosong; judul dokumen menggantikan judul sumber. */
export function toCsl(source: CslSource, docTitle: string, accessed?: string): Record<string, unknown> {
  const out: Record<string, unknown> = { id: ID };
  for (const [k, v] of Object.entries(source)) {
    if (k.startsWith("_") || v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length)) continue;
    out[k] = v;
  }
  out.type = typeof source.type === "string" && source.type ? source.type : "webpage";
  if (docTitle.trim()) out.title = docTitle.trim();
  if (Array.isArray(out.author)) {
    // Baris penulis yang masih kosong (baru ditambahkan di formulir) tidak ikut.
    const names = (out.author as CslName[]).map(({ _guess, ...n }) => n).filter((n) => (n.family ?? "").trim() || (n.given ?? "").trim() || (n.literal ?? "").trim());
    if (names.length) out.author = names;
    else delete out.author;
  }
  const acc = cslDate(accessed);
  if (acc && !out.accessed) out.accessed = acc;
  return out;
}

/** Alamat halaman (tanpa `#bagian`) dari penunjuk sorotan pertama: cadangan bila data sumber tidak punya URL. */
export function urlFromMarks(marks: Mark[]): string | undefined {
  const url = marks.find((m) => m.url)?.url;
  return url ? url.split("#")[0] : undefined;
}

/** Hapus tag HTML sederhana untuk salinan teks biasa. */
export const htmlToText = (html: string): string =>
  html.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#38;/g, "&").replace(/&#60;/g, "<").replace(/&#62;/g, ">").trim();

/** Sisipkan judul bagian ke sitasi dalam teks: `(Rahman, 2026)` menjadi `(Rahman, 2026, "Sejarah")`. */
function withSection(cite: string, section: string): string {
  const sec = `“${section}”`;
  const m = cite.match(/^([([])(.*)([)\]])$/s);
  return m ? `${m[1]}${m[2]}, ${sec}${m[3]}` : `${cite} (${sec})`;
}

export async function formatCitation(source: CslSource, styleId: StyleId, lang: "id" | "en", docTitle: string, marks: Mark[] = []): Promise<CiteResult> {
  const info = STYLES.find((s) => s.id === styleId) ?? STYLES[0];
  const [styleXml, locale] = await Promise.all([info.load(), LOCALES[lang === "id" ? "id-ID" : "en-US"]()]);
  const accessed = marks.map((m) => m.accessed).filter(Boolean).sort().at(-1);
  const item = toCsl(source, docTitle, accessed);
  const sys = { retrieveLocale: () => locale, retrieveItem: () => item };
  const engine = new CSL.Engine(sys, styleXml, lang === "id" ? "id-ID" : "en-US", true);
  engine.setOutputFormat("html");
  engine.updateItems([ID]);
  const bib = engine.makeBibliography();
  const entry = ((bib ? bib[1][0] : "") ?? "").replace(/<\/?div[^>]*>/g, "").trim();

  const cluster = (locator?: { value: string; label: string }) => {
    const e = new CSL.Engine(sys, styleXml, lang === "id" ? "id-ID" : "en-US", true);
    e.setOutputFormat("html");
    e.updateItems([ID]);
    const items = [{ id: ID, ...(locator ? { locator: locator.value, label: locator.label } : {}) }];
    const res = e.processCitationCluster({ citationID: "c1", citationItems: items, properties: { noteIndex: info.kind === "note" ? 1 : 0 } }, [], []);
    return htmlToText(String(res?.[1]?.[0]?.[1] ?? ""));
  };

  const inTextBase = cluster();
  const inText = marks.map((m) => {
    if (m.page) return cluster({ value: String(m.page), label: "page" });
    if (m.section && info.kind !== "note") return withSection(inTextBase, m.section);
    return inTextBase;
  });
  return { bibliography: entry, inText, inTextBase };
}

/** Kolom penting yang kosong, menurut jenis sumber, untuk ditampilkan sebagai "belum ada". */
export function missingFields(source: CslSource, docTitle = ""): string[] {
  const out: string[] = [];
  if (!source.author?.some((a) => (a.family ?? "").trim() || (a.literal ?? "").trim())) out.push("Penulis");
  if (!source.issued) out.push("Tanggal terbit");
  if (!docTitle.trim() && !source.title?.trim()) out.push("Judul");
  if (source.type === "article-journal") {
    if (!source["container-title"]) out.push("Nama jurnal");
    if (!source.volume && !source.DOI) out.push("Volume atau DOI");
  } else if (!source["container-title"] && !source.publisher) {
    out.push("Nama situs atau penerbit");
  }
  if (!source.URL && !source.DOI) out.push("URL atau DOI");
  return out;
}

const GUESS_LABEL: Record<string, string> = {
  title: "Judul",
  author: "Penulis (nama diurai otomatis)",
  issued: "Tanggal terbit",
  "container-title": "Nama situs",
  type: "Jenis sumber",
};

/** Kolom yang hanya disimpulkan, bukan dibaca dari sumber, untuk ditampilkan sebagai "periksa". */
export function guessedFields(source: CslSource): string[] {
  const g = new Set<string>(source._guess ?? []);
  if (source.author?.some((a) => a._guess)) g.add("author");
  return [...g].map((k) => GUESS_LABEL[k] ?? k);
}
