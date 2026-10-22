// Ekspor data sumber ke format pustaka referensi: BibTeX (LaTeX), RIS (Zotero, Mendeley, EndNote), dan CSL-JSON.

import { toCsl, type CslName, type CslSource } from "./cite";

const name = (n: CslName) => n.literal ?? [n.family, n.given].filter(Boolean).join(", ");
const year = (s: CslSource) => s.issued?.["date-parts"]?.[0]?.[0];
const pad = (n: number | undefined) => String(n ?? "").padStart(2, "0");
const dateIso = (d?: { "date-parts": number[][] }) => (d ? d["date-parts"][0].map((x, i) => (i ? pad(x) : String(x))).join("-") : "");
const ascii = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]/g, "");

const BIB_TYPE: Record<string, string> = {
  "article-journal": "article",
  "article-newspaper": "article",
  article: "misc",
  report: "techreport",
  thesis: "phdthesis",
  book: "book",
};

/** Escape karakter khusus BibTeX; judul dibungkus `{}` supaya huruf besar tidak diubah. */
const esc = (s: string) => s.replace(/([&%$#_])/g, "\\$1");

export function toBibtex(source: CslSource, docTitle: string, accessed?: string): string {
  const csl = toCsl(source, docTitle, accessed) as Record<string, unknown> & CslSource;
  const first = csl.author?.[0];
  const key = `${ascii(first ? (first.family ?? first.literal ?? "") : "anon")}${year(csl) ?? "nd"}${ascii((csl.title ?? "").split(/\s+/)[0] ?? "")}`.slice(0, 40) || "ref";
  const type = BIB_TYPE[csl.type ?? ""] ?? "misc";
  const f: [string, string | undefined][] = [
    ["author", csl.author?.length ? csl.author.map((a) => (a.literal ? `{${a.literal}}` : name(a))).join(" and ") : undefined],
    ["title", csl.title ? `{${esc(csl.title)}}` : undefined],
    [type === "article" ? "journal" : "howpublished", csl["container-title"] && type === "article" ? esc(csl["container-title"]) : csl["container-title"] ? esc(csl["container-title"]) : undefined],
    ["publisher", csl.publisher ? esc(csl.publisher) : undefined],
    ["year", year(csl)?.toString()],
    ["month", csl.issued?.["date-parts"]?.[0]?.[1]?.toString()],
    ["volume", csl.volume],
    ["number", csl.issue ?? csl.number],
    ["pages", csl.page?.replace(/-/g, "--")],
    ["doi", csl.DOI],
    ["url", csl.URL],
    ["urldate", dateIso(csl.accessed)],
  ];
  const body = f.filter(([, v]) => v).map(([k, v]) => `  ${k} = {${v}}`).join(",\n");
  return `@${type}{${key},\n${body}\n}`;
}

const RIS_TYPE: Record<string, string> = {
  "article-journal": "JOUR",
  "article-newspaper": "NEWS",
  "post-weblog": "BLOG",
  "entry-encyclopedia": "ENCYC",
  webpage: "ELEC",
  article: "UNPB",
  report: "RPRT",
  thesis: "THES",
  book: "BOOK",
  document: "GEN",
};

export function toRis(source: CslSource, docTitle: string, accessed?: string): string {
  const csl = toCsl(source, docTitle, accessed) as Record<string, unknown> & CslSource;
  const lines: string[] = [`TY  - ${RIS_TYPE[csl.type ?? ""] ?? "GEN"}`];
  for (const a of csl.author ?? []) lines.push(`AU  - ${name(a)}`);
  const add = (tag: string, v: string | number | undefined) => v !== undefined && v !== "" && lines.push(`${tag}  - ${v}`);
  add("TI", csl.title);
  add("T2", csl["container-title"]);
  add("PB", csl.publisher);
  add("PY", year(csl));
  add("DA", dateIso(csl.issued)?.replace(/-/g, "/"));
  add("VL", csl.volume);
  add("IS", csl.issue);
  const [sp, ep] = (csl.page ?? "").split(/[-–]/);
  add("SP", sp);
  add("EP", ep);
  add("DO", csl.DOI);
  add("UR", csl.URL);
  add("SN", csl.ISSN);
  add("Y2", dateIso(csl.accessed)?.replace(/-/g, "/"));
  lines.push("ER  - ");
  return lines.join("\n");
}

export const toCslJson = (source: CslSource, docTitle: string, accessed?: string): string => JSON.stringify([toCsl(source, docTitle, accessed)], null, 2);
