process.env.TZ = "Asia/Jakarta";
import { describe, expect, it } from "vitest";
import type { SchoolItem } from "./parse";
import { DEFAULT_CALC, inMajor, levelOf, applyFilter, byKind, byPeriod, distribution, monthly, neededAverage, overview, ranked, statusOf, subjectStats, terms, trendOf, weightedMean, years } from "./stats";

let n = 0;
const it_ = (over: Partial<SchoolItem>): SchoolItem => ({
  key: String(n++), kind: "Assignment", subject: "Math", description: "", given: null, due: new Date(2026, 8, 5).getTime(),
  score: 80, adjusted: false, period: "12.2 / First / 2026-2027", grade: "12.2", term: "First", year: "2026-2027", ...over,
});

const data = [
  it_({ score: 90 }),
  it_({ score: 60, kind: "Mid Exam", subject: "Bio", due: new Date(2026, 9, 5).getTime() }),
  it_({ score: null, subject: "Bio" }),
  it_({ score: 70, term: "Second", due: new Date(2027, 1, 5).getTime() }),
  it_({ score: 95, year: "2025-2026", term: "First", due: new Date(2025, 8, 5).getTime() }),
];

describe("filter", () => {
  it("lists years newest first and terms of a year", () => {
    expect(years(data)).toEqual(["2026-2027", "2025-2026"]);
    expect(terms(data, "2026-2027")).toEqual(["First", "Second"]);
    expect(terms(data, "2025-2026")).toEqual(["First"]);
  });
  it("filters by year and term, empty means all", () => {
    expect(applyFilter(data, { year: "", term: "" })).toHaveLength(5);
    expect(applyFilter(data, { year: "2026-2027", term: "" })).toHaveLength(4);
    expect(applyFilter(data, { year: "2026-2027", term: "Second" })).toHaveLength(1);
  });
});

describe("statistics", () => {
  it("summarises graded work only", () => {
    expect(overview(data)).toMatchObject({ average: 78.8, graded: 4, total: 5, gradedPct: 80, belowMark: 1, highest: 95, lowest: 60 });
  });
  it("handles an empty list", () => {
    expect(overview([])).toMatchObject({ average: null, gradedPct: null, highest: null });
  });
  it("averages by month in time order", () => {
    expect(monthly(data).map((b) => [b.label, b.average])).toEqual([["2025-09", 95], ["2026-09", 90], ["2026-10", 60], ["2027-02", 70]]);
  });
  it("averages by kind and by period", () => {
    expect(byKind(data).find((b) => b.label === "Mid Exam")?.average).toBe(60);
    expect(byPeriod(data).map((b) => b.label)).toEqual(["2025-2026 / First", "2026-2027 / First", "2026-2027 / Second"]);
  });
});

describe("per subject", () => {
  const s = DEFAULT_CALC;
  const mk = (subject: string, scores: (number | null)[], kind = "Assignment") =>
    scores.map((score, i) => it_({ subject, score, kind, due: new Date(2026, 8, 1 + i).getTime() }));

  it("weights exams more than assignments", () => {
    const items = [...mk("M", [100], "Assignment"), ...mk("M", [70], "Mid Exam")]; // bobot 1 dan 3
    expect(weightedMean(items, s)).toBe(77.5);
    expect(overview(items, s).average).toBe(85);
  });

  it("gives median, spread, extremes and below-mark count", () => {
    const [m] = subjectStats(mk("M", [60, 80, 90, 100]), s);
    expect(m).toMatchObject({ average: 82.5, median: 85, min: 60, max: 100, below: 1, graded: 4, total: 4 });
    expect(m.stdev).toBeGreaterThan(10);
  });

  it("reads the trend from the latest scores against the earlier ones", () => {
    expect(trendOf(mk("M", [70, 70, 70, 90, 90, 90]))).toBe(20);
    expect(trendOf(mk("M", [90, 90]))).toBeNull();
  });

  it("classifies subjects", () => {
    expect(statusOf(null, null, s)).toBe("nodata");
    expect(statusOf(65, null, s)).toBe("risk");
    expect(statusOf(72, 0, s)).toBe("improve");
    expect(statusOf(80, -6, s)).toBe("improve");
    expect(statusOf(80, 0, s)).toBe("ok");
    expect(statusOf(88, 2, s)).toBe("strong");
  });

  it("ranks weakest first and sets the gap against the overall average", () => {
    const stats = subjectStats([...mk("Hi", [95, 95]), ...mk("Lo", [60, 60]), ...mk("None", [null])], s);
    expect(ranked(stats).map((x) => x.subject)).toEqual(["Lo", "Hi"]);
    expect(stats.find((x) => x.subject === "Hi")?.gap).toBe(17.5);
  });

  it("works out the average needed on the next assessments", () => {
    const items = mk("M", [80, 80]); // jumlah 160
    expect(neededAverage(items, 85, 1)).toBe(95); // (85*3-160)/1
    expect(neededAverage(items, 85, 2)).toBe(90); // (85*4-160)/2
    expect(neededAverage(items, 85, 0)).toBeNull();
    expect(neededAverage([], 85, 1)).toBeNull();
  });

  it("buckets the distribution around the pass mark", () => {
    const d = distribution(mk("M", [50, 70, 85, 95, 100]), s);
    expect(d.map((b) => b.count)).toEqual([1, 1, 1, 2]);
  });
});

describe("penjurusan", () => {
  const ipa = { ...DEFAULT_CALC, major: { enabled: true, name: "IPA", auto: false, fromLevel: 11, subjects: ["Physics", "biology"], boost: 2 } };
  const phys = (grade: string, score: number) => it_({ subject: "Physics", grade, score });
  const civic = (grade: string, score: number) => it_({ subject: "Civic", grade, score });

  it("reads the class level from the portal's class name", () => {
    expect(levelOf("12.2")).toBe(12);
    expect(levelOf("Kelas 10.1")).toBe(10);
    expect(levelOf("")).toBeNull();
  });

  it("treats class 10 as general even for a major subject, and class 11 onwards as major", () => {
    expect(inMajor(phys("Kelas 10.1", 80), ipa)).toBe(false);
    expect(inMajor(phys("11.2", 80), ipa)).toBe(true);
    expect(inMajor(phys("12.2", 80), ipa)).toBe(true);
    expect(inMajor(civic("12.2", 80), ipa)).toBe(false);
    expect(inMajor(phys("12.2", 80), DEFAULT_CALC)).toBe(false); // belum berjurusan
    expect(inMajor(phys("12.2", 80), { ...ipa, major: { ...ipa.major, enabled: false } })).toBe(false);
  });

  it("matches subject names regardless of case and honours the start level", () => {
    const bio = it_({ subject: "BIOLOGY", grade: "11.1" });
    expect(inMajor(bio, ipa)).toBe(true);
    expect(inMajor(bio, { ...ipa, major: { ...ipa.major, fromLevel: 12 } })).toBe(false);
  });

  it("makes major subjects count more in the overall weighted average, without moving a subject's own average", () => {
    const items = [phys("12.2", 90), civic("12.2", 60)];
    expect(weightedMean(items, DEFAULT_CALC)).toBe(75);
    expect(weightedMean(items, ipa)).toBe(80); // (90*2 + 60) / 3
    const [c, p] = subjectStats(items, ipa);
    expect([c.weighted, p.weighted]).toEqual([60, 90]);
    expect(p.major).toBe(true);
    expect(c.major).toBe(false);
  });

  it("splits the average into major and general", () => {
    const o = overview([phys("12.2", 90), civic("12.2", 60)], ipa);
    expect(o).toMatchObject({ majorAverage: 90, generalAverage: 60 });
    expect(overview([phys("12.2", 90)], DEFAULT_CALC)).toMatchObject({ majorAverage: null, generalAverage: null });
  });
});
