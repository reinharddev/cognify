import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Node as PMNode } from "@tiptap/pm/model";
import { Callout } from "./callout";
import { Comment } from "./comment";
import { findMatches } from "./find";
import { commentsOf, countWords, headingsOf, readingMinutes } from "./docstats";
import { toMarkdown } from "./markdown";
import { buildDocx } from "./docx";

const schema = getSchema([StarterKit, Callout, Comment]);
const T = (text: string, marks: object[] = []) => ({ type: "text", text, ...(marks.length ? { marks } : {}) });
const P = (...c: object[]) => ({ type: "paragraph", content: c });
const doc = (...c: object[]) => ({ type: "doc", content: c });
const pm = (j: object) => PMNode.fromJSON(schema, j);

describe("cari di dokumen", () => {
  it("menemukan semua kemunculan tanpa peduli huruf besar, dan memberi posisi yang benar", () => {
    const d = pm(doc(P(T("Halo dunia, halo lagi")), P(T("HALO"))));
    const m = findMatches(d, "halo", false);
    expect(m).toHaveLength(3);
    expect(d.textBetween(m[0].from, m[0].to)).toBe("Halo");
    expect(d.textBetween(m[1].from, m[1].to)).toBe("halo");
    expect(findMatches(d, "halo", true)).toHaveLength(1);
    expect(findMatches(d, "", false)).toEqual([]);
  });

  it("tetap menemukan kata yang terpotong format", () => {
    const d = pm(doc(P(T("dunia ta"), T("ngguh", [{ type: "bold" }]), T(" sekali"))));
    const m = findMatches(d, "tangguh", false);
    expect(m).toHaveLength(1);
    expect(d.textBetween(m[0].from, m[0].to)).toBe("tangguh");
  });

  it("tidak melintasi batas paragraf", () => {
    const d = pm(doc(P(T("abc")), P(T("def"))));
    expect(findMatches(d, "cd", false)).toHaveLength(0);
  });
});

describe("hitungan dan struktur", () => {
  it("menghitung kata dengan tanda hubung, apostrof, dan angka", () => {
    expect(countWords("Halo dunia, ini 3 kata-kata!")).toBe(5);
    expect(countWords("it's well-known")).toBe(2);
    expect(countWords("   ")).toBe(0);
    expect(readingMinutes(0)).toBe(0);
    expect(readingMinutes(50)).toBe(1);
    expect(readingMinutes(1000)).toBe(5);
  });

  it("mengumpulkan judul dengan levelnya dan komentar dengan kutipannya", () => {
    const d = pm(
      doc(
        { type: "heading", attrs: { level: 1 }, content: [T("Bab 1")] },
        P(T("isi "), T("penting", [{ type: "comment", attrs: { id: "c1", text: "cek sumber", at: "2026-11-09T00:00:00Z" } }])),
        { type: "heading", attrs: { level: 2 }, content: [T("Bagian 1.1")] },
        { type: "heading", attrs: { level: 3 }, content: [] },
      ),
    );
    expect(headingsOf(d).map((h) => [h.level, h.text])).toEqual([[1, "Bab 1"], [2, "Bagian 1.1"]]);
    const c = commentsOf(d);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ id: "c1", text: "cek sumber", quote: "penting" });
  });

  it("kotak penekanan menerima blok di dalamnya", () => {
    const d = pm(doc({ type: "callout", attrs: { kind: "warn" }, content: [P(T("awas"))] }));
    expect(d.firstChild?.type.name).toBe("callout");
    expect(d.firstChild?.attrs.kind).toBe("warn");
  });
});

const sample = doc(
  { type: "heading", attrs: { level: 1 }, content: [T("Judul")] },
  P(T("Teks "), T("tebal", [{ type: "bold" }]), T(" dan "), T("miring", [{ type: "italic" }]), T(" "), T("tautan", [{ type: "link", attrs: { href: "https://contoh.id" } }])),
  { type: "bulletList", content: [{ type: "listItem", content: [P(T("satu"))] }, { type: "listItem", content: [P(T("dua")), { type: "bulletList", content: [{ type: "listItem", content: [P(T("dua-a"))] }] }] }] },
  { type: "orderedList", attrs: { start: 1 }, content: [{ type: "listItem", content: [P(T("pertama"))] }, { type: "listItem", content: [P(T("kedua"))] }] },
  { type: "taskList", content: [{ type: "taskItem", attrs: { checked: true }, content: [P(T("selesai"))] }, { type: "taskItem", attrs: { checked: false }, content: [P(T("belum"))] }] },
  { type: "blockquote", content: [P(T("kutipan"))] },
  { type: "callout", attrs: { kind: "tip" }, content: [P(T("coba ini"))] },
  { type: "codeBlock", attrs: { language: "js" }, content: [T("let x = 1;")] },
  { type: "table", content: [{ type: "tableRow", content: [{ type: "tableHeader", content: [P(T("A"))] }, { type: "tableHeader", content: [P(T("B"))] }] }, { type: "tableRow", content: [{ type: "tableCell", content: [P(T("1"))] }, { type: "tableCell", content: [P(T("2"))] }] }] },
  { type: "blockMath", attrs: { latex: "x^2" } },
  { type: "details", content: [{ type: "detailsSummary", content: [T("Lihat")] }, { type: "detailsContent", content: [P(T("isi lipat"))] }] },
);

describe("ekspor Markdown", () => {
  const md = toMarkdown(JSON.stringify(sample), "Makalah");
  it("memetakan teks, daftar, tabel, dan blok khusus", () => {
    expect(md.startsWith("# Makalah\n\n# Judul\n\n")).toBe(true);
    expect(md).toContain("Teks **tebal** dan *miring* [tautan](https://contoh.id)");
    expect(md).toContain("- satu\n- dua\n  - dua-a");
    expect(md).toContain("1. pertama\n2. kedua");
    expect(md).toContain("- [x] selesai\n- [ ] belum");
    expect(md).toContain("> kutipan");
    expect(md).toContain("> **Tips**\n>\n> coba ini");
    expect(md).toContain("```js\nlet x = 1;\n```");
    expect(md).toContain("| A | B |\n| --- | --- |\n| 1 | 2 |");
    expect(md).toContain("$$\nx^2\n$$");
    expect(md).toContain("<details>\n<summary>Lihat</summary>\n\nisi lipat\n\n</details>");
  });
  it("teks biasa (bukan JSON) tetap jadi paragraf", () => {
    expect(toMarkdown("satu\n\ndua")).toBe("satu\n\ndua\n");
    expect(toMarkdown("")).toBe("\n");
  });
});

describe("ekspor Word", () => {
  it("menghasilkan berkas docx yang berisi teks dokumen", async () => {
    const d = await import("docx");
    const buf = await d.Packer.toBuffer(await buildDocx(JSON.stringify(sample), { title: "Makalah" }));
    expect(buf.subarray(0, 2).toString()).toBe("PK");
    const JSZip = (await import("jszip")).default;
    const xml = await (await JSZip.loadAsync(buf)).file("word/document.xml")!.async("string");
    for (const word of ["Makalah", "Judul", "tebal", "pertama", "selesai", "coba ini", "let x = 1;", "x^2", "isi lipat"]) expect(xml, word).toContain(word);
    expect(xml).toContain("<w:tbl>");
  });
});
