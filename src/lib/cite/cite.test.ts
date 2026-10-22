import { describe, expect, it } from "vitest";
import { formatCitation, guessedFields, htmlToText, missingFields, STYLES, toCsl, urlFromMarks, type CslSource, type Mark } from "./cite";

const journal: CslSource = {
  type: "article-journal",
  title: "Determinan Fungsi Intermediasi Bank KBMI 4 di Indonesia",
  author: [{ family: "Putri", given: "Friestha Sari" }, { family: "Falianty", given: "Telisa Aulia" }],
  issued: { "date-parts": [[2026]] },
  "container-title": "Jurnal Ekonomi dan Pembangunan Indonesia",
  volume: "26",
  issue: "2",
  page: "143-158",
  DOI: "10.7454/jepi.v26i2.1636",
  URL: "https://scholarhub.ui.ac.id/jepi/vol26/iss2/1",
};

const text = async (s: CslSource, style: Parameters<typeof formatCitation>[1], lang: "id" | "en" = "en", title = s.title ?? "", marks: Mark[] = []) =>
  formatCitation(s, style, lang, title, marks);

describe("sitasi", () => {
  it("APA 7: penulis, tahun, judul, jurnal, volume(issue), halaman, DOI", async () => {
    const r = await text(journal, "apa");
    const t = htmlToText(r.bibliography);
    expect(t).toContain("Putri, F. S.");
    expect(t).toContain("(2026)");
    expect(t).toContain("Determinan Fungsi Intermediasi Bank KBMI 4 di Indonesia");
    expect(t).toContain("143–158");
    expect(t).toContain("https://doi.org/10.7454/jepi.v26i2.1636");
    expect(r.inTextBase).toBe("(Putri & Falianty, 2026)");
    expect(r.bibliography).toContain("<i>"); // cetak miring dari gaya
  });

  it("semua gaya menghasilkan entri berisi judul dan tidak melempar galat", async () => {
    for (const s of STYLES) {
      const r = await text(journal, s.id);
      expect(htmlToText(r.bibliography).toLowerCase(), s.id).toContain("determinan fungsi intermediasi");
      expect(r.inTextBase.length, s.id).toBeGreaterThan(0);
    }
  }, 120_000);

  it("istilah mengikuti bahasa app: tanpa tahun menjadi t.t. atau n.d.", async () => {
    const web: CslSource = { type: "webpage", title: "Artikel tanpa tanggal", "container-title": "Harian", URL: "https://a.test/x" };
    expect(htmlToText((await text(web, "apa", "id")).bibliography)).toContain("t.t.");
    expect(htmlToText((await text(web, "apa", "en")).bibliography)).toContain("n.d.");
  });

  it("tanpa penulis, judul pindah ke depan (aturan APA)", async () => {
    const web: CslSource = { type: "webpage", title: "Spirit Airlines", "container-title": "Wikipedia", issued: { "date-parts": [[2026, 5, 2]] }, URL: "https://a.test/w" };
    const r = await text(web, "apa");
    expect(htmlToText(r.bibliography).startsWith("Spirit Airlines")).toBe(true);
    expect(r.inTextBase).toContain("Spirit Airlines");
  });

  it("lokasi per sorotan: nomor halaman lewat label CSL, judul bagian disisipkan", async () => {
    const r = await text(journal, "apa", "en", journal.title, [{ url: "u", page: 14 }, { url: "u", section: "Metode" }, { url: "u" }]);
    expect(r.inText[0]).toBe("(Putri & Falianty, 2026, p. 14)");
    expect(r.inText[1]).toBe("(Putri & Falianty, 2026, “Metode”)");
    expect(r.inText[2]).toBe("(Putri & Falianty, 2026)");
  });

  it("judul dokumen menggantikan judul sumber", async () => {
    const r = await text(journal, "apa", "en", "Judul yang kuubah");
    expect(htmlToText(r.bibliography)).toContain("Judul yang kuubah");
    expect(htmlToText(r.bibliography)).not.toContain("Determinan");
  });

  it("gaya numerik memberi [1] dan catatan kaki Chicago berupa kutipan", async () => {
    expect((await text(journal, "ieee")).inTextBase).toBe("[1]");
    expect((await text(journal, "chicago-nb")).inTextBase.length).toBeGreaterThan(10);
  });

  it("kolom internal tidak bocor ke mesin CSL", () => {
    const csl = toCsl({ ...journal, _guess: ["author"], _pdf: true, author: [{ family: "A", given: "B", _guess: true }] }, "J", "2026-10-22");
    expect(Object.keys(csl).some((k) => k.startsWith("_"))).toBe(false);
    expect((csl.author as object[])[0]).toEqual({ family: "A", given: "B" });
    expect(csl.accessed).toEqual({ "date-parts": [[2026, 10, 22]] });
  });

  it("baris penulis kosong dari formulir diabaikan", async () => {
    const web: CslSource = { type: "webpage", title: "Halaman", "container-title": "Situs", URL: "https://a.test", author: [{ family: "", given: "" }] };
    expect(htmlToText((await text(web, "apa")).bibliography).startsWith("Halaman")).toBe(true);
    expect(missingFields(web)).toContain("Penulis");
  });

  it("kelengkapan: yang kosong dan yang hanya disimpulkan dilaporkan", () => {
    expect(missingFields({ type: "webpage", title: "x", URL: "https://a.test" })).toEqual(["Penulis", "Tanggal terbit", "Nama situs atau penerbit"]);
    expect(missingFields(journal)).toEqual([]);
    expect(missingFields({ type: "webpage" }, "Judul dokumen")).not.toContain("Judul");
    expect(urlFromMarks([{ url: "https://a.test/p?x=1#:~:text=abc" }])).toBe("https://a.test/p?x=1");
    expect(guessedFields({ _guess: ["issued"], author: [{ family: "A", given: "B", _guess: true }] })).toEqual(["Tanggal terbit", "Penulis (nama diurai otomatis)"]);
  });
});

import { toBibtex, toCslJson, toRis } from "./export";

describe("ekspor", () => {
  it("BibTeX untuk artikel jurnal", () => {
    const b = toBibtex(journal, journal.title!, "2026-10-22");
    expect(b.startsWith("@article{Putri2026Determinan,")).toBe(true);
    expect(b).toContain("author = {Putri, Friestha Sari and Falianty, Telisa Aulia}");
    expect(b).toContain("pages = {143--158}");
    expect(b).toContain("doi = {10.7454/jepi.v26i2.1636}");
    expect(b).toContain("urldate = {2026-10-22}");
  });
  it("RIS memisahkan halaman awal dan akhir", () => {
    const r = toRis(journal, journal.title!);
    expect(r).toContain("TY  - JOUR");
    expect(r).toContain("AU  - Putri, Friestha Sari");
    expect(r).toContain("SP  - 143");
    expect(r).toContain("EP  - 158");
    expect(r.endsWith("ER  - ")).toBe(true);
  });
  it("CSL-JSON memuat judul dokumen dan tanpa kolom internal", () => {
    const j = JSON.parse(toCslJson({ ...journal, _guess: ["author"] }, "Judul baru"))[0];
    expect(j.title).toBe("Judul baru");
    expect(j._guess).toBeUndefined();
  });
});
