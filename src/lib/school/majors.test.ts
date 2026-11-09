import { describe, expect, it } from "vitest";
import type { SchoolItem } from "./parse";
import { detectMajor, isCompulsory } from "./majors";

const item = (subject: string, grade: string): SchoolItem => ({
  key: `${subject}${grade}`, kind: "Assignment", subject, description: "", given: null, due: 1, score: 80, adjusted: false,
  period: "", grade, term: "First", year: "2025-2026",
});
const of = (grade: string, ...subjects: string[]) => subjects.map((s) => item(s, grade));

// Susunan mapel kelas 11.2 yang sebenarnya di portal sekolah pemilik.
const CLASS_11 = [
  "Physical Sport and Health Education", "PoCC Informatics", "Biology", "Advanced Mathematics", "Program of Entrepreneurship (POE)",
  "Civic Education", "Indonesian", "Physics", "English", "Mathematics", "Sundanesse", "History", "Christian", "Art",
];

describe("isCompulsory", () => {
  it("recognises the compulsory group in English and Indonesian", () => {
    for (const s of ["Christian", "Civic Education", "Indonesian", "English", "Mathematics", "Physical Sport and Health Education", "Art", "Sundanesse", "PoCC Informatics", "Program of Entrepreneurship (POE)", "History", "Pendidikan Agama Islam", "Matematika", "Seni Budaya", "Sejarah Indonesia"]) {
      expect(isCompulsory(s), s).toBe(true);
    }
  });
  it("leaves the electives out", () => {
    for (const s of ["Physics", "Biology", "Chemistry", "Economics", "Geography", "Sociology", "Fisika", "Kimia"]) expect(isCompulsory(s), s).toBe(false);
  });
});

describe("detectMajor on the real class 11 structure", () => {
  const d = detectMajor(of("11.2", ...CLASS_11), 11);

  it("picks Advanced Mathematics, Physics and Biology, and nothing compulsory", () => {
    expect(d.major).toEqual(["Advanced Mathematics", "Biology", "Physics"]);
    expect(d.general).toContain("Mathematics");
    expect(d.general).toContain("History");
  });

  it("says why each was picked", () => {
    expect(d.reasons).toEqual({ "Advanced Mathematics": "marker", Biology: "elective", Physics: "elective" });
  });

  it("does not need class 10 data", () => {
    expect(d.hasGeneralData).toBe(false);
    expect(d.hasMajorData).toBe(true);
  });
});

describe("subjects without any score", () => {
  it("are treated as not taken", () => {
    const empty = { ...item("Sociology", "12.2"), score: null };
    const d = detectMajor([...of("12.2", "Physics"), empty], 12);
    expect(d.major).toEqual(["Physics"]);
    expect(d.general).not.toContain("Sociology");
  });
  it("count again once one assessment is graded", () => {
    const d = detectMajor([{ ...item("Sociology", "12.2"), score: null }, item("Sociology", "12.2")], 12);
    expect(d.major).toEqual(["Sociology"]);
  });
});

describe("class 10 data", () => {
  it("does not veto an elective that was also taught in class 10", () => {
    const d = detectMajor([...of("Kelas 10.1", "Physics", "English"), ...of("11.2", "Physics", "English")], 11);
    expect(d.major).toEqual(["Physics"]);
  });

  it("flags a compulsory-looking subject that first appears in the major classes", () => {
    const d = detectMajor([...of("Kelas 10.1", "English"), ...of("11.2", "English", "History")], 11);
    expect(d.reasons).toEqual({ History: "new" });
  });

  it("ignores class 10 itself and items without a class", () => {
    expect(detectMajor(of("Kelas 10.1", "Physics"), 11).major).toEqual([]);
    expect(detectMajor([item("Physics", "")], 11).hasMajorData).toBe(false);
  });

  it("follows the chosen start class", () => {
    const data = [...of("11.2", "Physics"), ...of("12.2", "Physics", "Chemistry")];
    expect(detectMajor(data, 12).major).toEqual(["Chemistry", "Physics"]);
  });
});
