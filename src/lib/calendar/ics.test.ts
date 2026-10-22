process.env.TZ = process.env.TEST_TZ ?? "Asia/Jakarta";
import { describe, expect, it } from "vitest";
import { meetingUrl, parseIcs } from "./ics";

const FROM = Date.UTC(2026, 9, 1);
const TO = Date.UTC(2026, 11, 31);
const cal = (...events: string[]) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${events.map((e) => `BEGIN:VEVENT\r\n${e}\r\nEND:VEVENT`).join("\r\n")}\r\nEND:VCALENDAR\r\n`;
const parse = (text: string) => parseIcs(text, FROM, TO);

describe("single events", () => {
  it("reads a UTC time and its duration", () => {
    const [e] = parse(cal("UID:a\r\nDTSTART:20261022T080000Z\r\nDTEND:20261022T090000Z\r\nSUMMARY:Kelas Fisika"));
    expect(e.title).toBe("Kelas Fisika");
    expect(e.start).toBe(Date.UTC(2026, 9, 22, 8));
    expect(e.end).toBe(Date.UTC(2026, 9, 22, 9));
    expect(e.allDay).toBe(false);
  });

  it("converts a named time zone to the real instant", () => {
    const [e] = parse(cal("UID:a\r\nDTSTART;TZID=Asia/Jakarta:20261022T150000\r\nSUMMARY:x"));
    expect(e.start).toBe(Date.UTC(2026, 9, 22, 8)); // 15.00 WIB = 08.00 UTC
    const [ny] = parse(cal("UID:b\r\nDTSTART;TZID=America/New_York:20261022T090000\r\nSUMMARY:x"));
    expect(ny.start).toBe(Date.UTC(2026, 9, 22, 13)); // EDT = UTC-4 pada 22 Oktober
  });

  it("reads all-day events as local dates lasting one day", () => {
    const [e] = parse(cal("UID:a\r\nDTSTART;VALUE=DATE:20261023\r\nSUMMARY:Ujian"));
    expect(e.allDay).toBe(true);
    expect(e.start).toBe(new Date(2026, 9, 23).getTime());
    expect(e.end).toBe(new Date(2026, 9, 24).getTime());
  });

  it("unescapes text, unfolds long lines, and defaults a missing title", () => {
    const [a] = parse(cal("UID:a\r\nDTSTART:20261022T080000Z\r\nSUMMARY:Rapat\\, kelas\\; lanjut\r\n panjang"));
    expect(a.title).toBe("Rapat, kelas; lanjutpanjang");
    const [b] = parse(cal("UID:b\r\nDTSTART:20261023T080000Z"));
    expect(b.title).toBe("(tanpa judul)");
  });

  it("skips cancelled events and events outside the range", () => {
    expect(parse(cal("UID:a\r\nDTSTART:20261022T080000Z\r\nSTATUS:CANCELLED\r\nSUMMARY:batal"))).toHaveLength(0);
    expect(parse(cal("UID:a\r\nDTSTART:20250101T080000Z\r\nSUMMARY:lama"))).toHaveLength(0);
    expect(parse(cal("UID:a\r\nDTSTART:20270101T080000Z\r\nSUMMARY:nanti"))).toHaveLength(0);
  });

  it("returns events sorted by start", () => {
    const out = parse(cal("UID:b\r\nDTSTART:20261024T080000Z\r\nSUMMARY:b", "UID:a\r\nDTSTART:20261022T080000Z\r\nSUMMARY:a"));
    expect(out.map((e) => e.title)).toEqual(["a", "b"]);
  });

  it("ignores garbage without throwing", () => {
    expect(parse("bukan kalender")).toEqual([]);
    expect(parse("")).toEqual([]);
    expect(parse(cal("UID:a\r\nDTSTART:bukan-tanggal\r\nSUMMARY:x"))).toEqual([]);
  });
});

describe("repeating events", () => {
  const dayOf = (ms: number) => new Date(ms).getDate();

  it("daily with COUNT", () => {
    const out = parse(cal("UID:a\r\nDTSTART:20261022T080000Z\r\nRRULE:FREQ=DAILY;COUNT=3\r\nSUMMARY:x"));
    expect(out.map((e) => e.start)).toEqual([Date.UTC(2026, 9, 22, 8), Date.UTC(2026, 9, 23, 8), Date.UTC(2026, 9, 24, 8)]);
  });

  it("weekly on chosen weekdays with INTERVAL", () => {
    const out = parse(cal("UID:a\r\nDTSTART:20261026T080000Z\r\nRRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4\r\nSUMMARY:x"));
    expect(out.map((e) => dayOf(e.start))).toEqual([26, 28, 2, 4]);
    const biweekly = parse(cal("UID:b\r\nDTSTART:20261026T080000Z\r\nRRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=3\r\nSUMMARY:x"));
    expect(biweekly.map((e) => dayOf(e.start))).toEqual([26, 9, 23]);
  });

  it("monthly and yearly", () => {
    const m = parse(cal("UID:a\r\nDTSTART:20261015T080000Z\r\nRRULE:FREQ=MONTHLY;COUNT=3\r\nSUMMARY:x"));
    expect(m.map((e) => new Date(e.start).getMonth())).toEqual([9, 10, 11]);
    const y = parseIcs(cal("UID:b\r\nDTSTART:20261015T080000Z\r\nRRULE:FREQ=YEARLY;COUNT=3\r\nSUMMARY:x"), Date.UTC(2026, 0, 1), Date.UTC(2030, 0, 1));
    expect(y.map((e) => new Date(e.start).getFullYear())).toEqual([2026, 2027, 2028]);
  });

  it("UNTIL stops the series and EXDATE removes one occurrence", () => {
    const until = parse(cal("UID:a\r\nDTSTART:20261022T080000Z\r\nRRULE:FREQ=DAILY;UNTIL=20261024T080000Z\r\nSUMMARY:x"));
    expect(until).toHaveLength(3);
    const ex = parse(cal("UID:b\r\nDTSTART:20261022T080000Z\r\nRRULE:FREQ=DAILY;COUNT=3\r\nEXDATE:20261023T080000Z\r\nSUMMARY:x"));
    expect(ex.map((e) => dayOf(e.start))).toEqual([22, 24]);
  });

  it("an unsupported rule yields only the first occurrence", () => {
    const out = parse(cal("UID:a\r\nDTSTART:20261022T080000Z\r\nRRULE:FREQ=SECONDLY;COUNT=5\r\nSUMMARY:x"));
    expect(out).toHaveLength(1);
  });

  it("gives every occurrence a unique id", () => {
    const out = parse(cal("UID:a\r\nDTSTART:20261022T080000Z\r\nRRULE:FREQ=DAILY;COUNT=5\r\nSUMMARY:x"));
    expect(new Set(out.map((e) => e.id)).size).toBe(5);
  });
});

describe("meeting links", () => {
  it("finds Zoom, Meet, and Teams links in URL, location, or description", () => {
    expect(meetingUrl("https://zoom.us/j/123456789?pwd=abc")).toBe("https://zoom.us/j/123456789?pwd=abc");
    expect(meetingUrl(undefined, "Link: https://meet.google.com/abc-defg-hij.")).toBe("https://meet.google.com/abc-defg-hij");
    expect(meetingUrl("", "Ruang 3")).toBeNull();
    expect(meetingUrl("http://zoom.us/j/1")).toBeNull();
  });

  it("is attached to the parsed event", () => {
    const [e] = parse(cal("UID:a\r\nDTSTART:20261022T080000Z\r\nLOCATION:https://meet.google.com/abc-defg-hij\r\nSUMMARY:x"));
    expect(e.meeting).toBe("https://meet.google.com/abc-defg-hij");
  });
});
