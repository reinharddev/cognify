import { describe, expect, it } from "vitest";
import type { Occurrence } from "$lib/calendar/types";
import { AGENDA_DAYS, agendaRange, buildAgenda, taskRange } from "./agenda";

const NOW = new Date(2026, 9, 22, 9, 30).getTime();
const HOUR = 3_600_000;

const occ = (over: Partial<Occurrence>): Occurrence => ({
  key: "k", title: "Acara", start: NOW + HOUR, end: NOW + 2 * HOUR, allDay: false, origin: "local",
  calendar: "Cognify", color: null, eventId: null, meeting: null, notes: "", remindMin: null, ...over,
});

describe("agendaRange", () => {
  it("mulai dari awal hari ini dan mencakup tiga hari", () => {
    const [from, to] = agendaRange(NOW);
    expect(new Date(from).getHours()).toBe(0);
    expect(new Date(from).getDate()).toBe(22);
    expect(new Date(to).getDate()).toBe(22 + AGENDA_DAYS);
  });
});

describe("buildAgenda: pengingat", () => {
  it("membawa remindMin hanya untuk acara buatan pengguna dan tugas Moodle", () => {
    const f = buildAgenda(
      [occ({ key: "a", remindMin: 15 }), occ({ key: "b", remindMin: 0, start: NOW + 2 * HOUR }), occ({ key: "c", origin: "ics", remindMin: 10, start: NOW + 3 * HOUR }), occ({ key: "m", origin: "moodle", remindMin: 1440, start: NOW + 5 * HOUR }), occ({ key: "d", remindMin: null, start: NOW + 4 * HOUR })],
      NOW,
    );
    expect(f.events.map((e) => e.remindMin)).toEqual([15, 0, undefined, undefined, 1440]);
  });
});

describe("buildAgenda", () => {
  it("mengurutkan menurut waktu dan memakai waktu ISO", () => {
    const f = buildAgenda([occ({ key: "b", title: "B", start: NOW + 3 * HOUR, end: null }), occ({ key: "a", title: "A" })], NOW);
    expect(f.schema).toBe(1);
    expect(f.events.map((e) => e.id)).toEqual(["a", "b"]);
    expect(f.events[0].start).toBe(new Date(NOW + HOUR).toISOString());
    expect(f.events[1].end).toBeUndefined();
    expect(f.updatedAt).toBe(new Date(NOW).toISOString());
  });

  it("melewati acara dari Notch dan acara yang sudah selesai", () => {
    const f = buildAgenda([
      occ({ key: "n", origin: "notch" }),
      occ({ key: "lama", start: NOW - 3 * HOUR, end: NOW - 2 * HOUR }),
      occ({ key: "berjalan", start: NOW - HOUR, end: NOW + HOUR }),
      occ({ key: "tanpa-akhir-lewat", start: NOW - HOUR, end: null }),
    ], NOW);
    expect(f.events.map((e) => e.id)).toEqual(["berjalan"]);
  });

  it("membatasi jumlah dan panjang teks", () => {
    const many = Array.from({ length: 150 }, (_, i) => occ({ key: `e${i}`, start: NOW + i * 60_000 + HOUR, end: null, title: "x".repeat(500), calendar: "c".repeat(500) }));
    const f = buildAgenda(many, NOW);
    expect(f.events).toHaveLength(100);
    expect(f.events[0].title).toHaveLength(200);
    expect(f.events[0].calendar).toHaveLength(80);
  });

  it("acara sehari penuh tetap ditandai", () => {
    const day = new Date(2026, 9, 23).getTime();
    const f = buildAgenda([occ({ key: "d", start: day, end: day + 24 * HOUR, allDay: true })], NOW);
    expect(f.events[0].allDay).toBe(true);
  });
});

describe("tugas Moodle di agenda", () => {
  it("ditandai kind task dan tetap ikut walau sudah lewat tenggat", () => {
    const f = buildAgenda([occ({ key: "m1", origin: "moodle", calendar: "Moodle, Fisika", start: NOW - 2 * HOUR, end: null }), occ({ key: "l1", start: NOW - 2 * HOUR, end: NOW - HOUR })], NOW);
    expect(f.events.map((e) => e.id)).toEqual(["m1"]);
    expect(f.events[0].kind).toBe("task");
    expect(f.events[0].calendar).toBe("Moodle, Fisika");
  });

  it("taskRange: 14 hari ke belakang sampai 60 hari ke depan", () => {
    const [from, to] = taskRange(NOW);
    expect(NOW - from).toBe(14 * 24 * HOUR);
    expect(to - NOW).toBe(60 * 24 * HOUR);
  });
});
