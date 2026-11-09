process.env.TZ = "Asia/Jakarta";
import { describe, expect, it } from "vitest";
import { mergeItems, parsePeriod, parseScore, parseTables, parseWhen, summarize } from "./parse";

const HEAD = ["Type", "Subject", "Description", "Time Given", "Due Time", "Competency Achievements"];
const table = (rows: string[][]) => ({ headers: HEAD, rows });

describe("parseTables", () => {
  it("reads rows with scores and N/A", () => {
    const items = parseTables([
      table([
        ["Assignment", "Mathematics", "TERM 2 | ASSIGNMENT 2", "2026-11-04 07:10:00", "2026-11-04 09:10:00", "98"],
        ["Assignment", "Civic Education", "Infografis", "2026-10-19 13:50:00", "2026-10-26 13:50:00", "N/A"],
      ]),
    ]);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ kind: "Assignment", subject: "Mathematics", score: 98 });
    expect(items[1].score).toBeNull();
    expect(items[0].due).toBe(new Date(2026, 10, 4, 9, 10).getTime());
  });

  it("ignores tables without subject and due columns", () => {
    expect(parseTables([{ headers: ["Day", "Time"], rows: [["Senin", "07:00"]] }])).toEqual([]);
  });

  it("keeps two look-alike rows apart (same task, different scores) and stays stable on re-import", () => {
    const a = ["Assignment", "Art", "", "2026-09-04 00:00:00", "2026-09-04 23:59:59", "90"];
    const b = ["Assignment", "Art", "", "2026-09-04 00:00:00", "2026-09-04 23:59:59", "87"];
    const first = parseTables([table([a, b])]);
    expect(first.map((i) => i.score)).toEqual([90, 87]);
    expect(parseTables([table([a, b])]).map((i) => i.key)).toEqual(first.map((i) => i.key));
  });

  it("skips a header row that slipped into the data", () => {
    const items = parseTables([table([HEAD, ["Assignment", "Art", "", "2026-09-04 00:00:00", "2026-09-04 23:59:59", "90"]])]);
    expect(items.map((i) => i.subject)).toEqual(["Art"]);
  });

  it("reads a starred score as the number and flags it", () => {
    const [i] = parseTables([table([["Daily Exam", "Biology", "Sumatif harian", "2026-08-10 10:10:00", "2026-08-10 10:10:00", "70 *"]])]);
    expect(i).toMatchObject({ score: 70, adjusted: true });
  });

  it("understands Indonesian headers", () => {
    const t = { headers: ["Jenis", "Mata Pelajaran", "Keterangan", "Diberikan", "Tenggat", "Nilai"], rows: [["Tugas", "IPA", "Bab 1", "2026-01-01 08:00", "2026-01-02 08:00", "80,5"]] };
    expect(parseTables([t])[0]).toMatchObject({ subject: "IPA", score: 80.5 });
  });
});

describe("helpers", () => {
  it("parses dates and rejects junk", () => {
    expect(parseWhen("tidak ada")).toBeNull();
    expect(parseWhen("2026-11-04")).toBe(new Date(2026, 10, 4).getTime());
  });
  it("only accepts scores 0 to 100", () => {
    expect(parseScore("100")).toBe(100);
    expect(parseScore("101")).toBeNull();
    expect(parseScore("N/A")).toBeNull();
  });
  it("merge updates a score that arrived later and keeps other periods", () => {
    const base = { kind: "Assignment", subject: "A", description: "x", given: null, due: 1, score: null, adjusted: false, period: "P1", grade: "", term: "", year: "", key: "k1" };
    const other = { ...base, key: "k2", period: "P2", due: 2 };
    const merged = mergeItems([base, other], [{ ...base, score: 90 }]);
    expect(merged).toHaveLength(2);
    expect(merged.find((i) => i.key === "k1")?.score).toBe(90);
    expect(merged.find((i) => i.key === "k2")).toBeTruthy();
  });
  it("a new send replaces the whole period: subjects no longer on the portal disappear", () => {
    const mk = (subject: string, key: string, period = "P1") => ({ kind: "Assignment", subject, description: "", given: null, due: 1, score: 80, adjusted: false, period, grade: "", term: "", year: "", key });
    const merged = mergeItems([mk("Sociology", "s"), mk("Physics", "p"), mk("Art", "a", "P2")], [mk("Physics", "p"), mk("Advanced Mathematics", "am")]);
    expect(merged.map((i) => i.subject).sort()).toEqual(["Advanced Mathematics", "Art", "Physics"]);
  });
  it("averages only graded items per subject", () => {
    const mk = (subject: string, score: number | null, n: number) => ({ key: String(n), kind: "Assignment", subject, description: "", given: null, due: n, score, adjusted: false, period: "", grade: "", term: "", year: "" });
    const s = summarize([mk("Math", 90, 1), mk("Math", 80, 2), mk("Math", null, 3), mk("Bio", null, 4)]);
    expect(s).toEqual([
      { subject: "Bio", average: null, graded: 0, total: 1 },
      { subject: "Math", average: 85, graded: 2, total: 3 },
    ]);
  });
});

describe("parsePeriod", () => {
  it("splits grade, term and academic year", () => {
    expect(parsePeriod("12.2 / First / 2026-2027")).toEqual({ label: "12.2 / First / 2026-2027", grade: "12.2", term: "First", year: "2026-2027" });
    expect(parsePeriod("Kelas 10.1 / Second / 2024-2025")).toMatchObject({ grade: "Kelas 10.1", term: "Second", year: "2024-2025" });
  });
  it("copes with an empty or odd period", () => {
    expect(parsePeriod("")).toEqual({ label: "", grade: "", term: "", year: "" });
    expect(parsePeriod("2026 - 2027")).toMatchObject({ year: "2026-2027", term: "" });
  });
  it("tags items with the period and keeps the same task of two semesters apart", () => {
    const row = ["Assignment", "Art", "", "2026-09-04 00:00:00", "2026-09-04 23:59:59", "90"];
    const a = parseTables([table([row])], "12.2 / First / 2026-2027")[0];
    const b = parseTables([table([row])], "12.2 / Second / 2026-2027")[0];
    expect(a).toMatchObject({ term: "First", year: "2026-2027" });
    expect(a.key).not.toBe(b.key);
  });
});
