import { describe, expect, it } from "vitest";
import type { Occurrence } from "$lib/calendar/types";
import { buildHub } from "./hub";

const NOW = new Date(2026, 10, 9, 10, 0).getTime();
const occ = (key: string, origin: Occurrence["origin"], h: number, day = 9): Occurrence => ({
  key, title: key, start: new Date(2026, 10, day, h).getTime(), end: new Date(2026, 10, day, h + 1).getTime(), allDay: false,
  origin, calendar: "Lab", color: null, eventId: null, meeting: null, notes: "", remindMin: null,
});

describe("buildHub", () => {
  it("keeps only today's lessons, in time order", () => {
    const hub = buildHub({ now: NOW, occurrences: [occ("b", "lesson", 13), occ("a", "lesson", 8), occ("tomorrow", "lesson", 8, 10), occ("event", "local", 9)], favorites: [], recent: [], tools: [] });
    expect(hub.lessons.map((l) => l.id)).toEqual(["a", "b"]);
    expect(hub.lessons[0].room).toBe("Lab");
  });

  it("lists pinned docs, then recent ones without repeating or including folders", () => {
    const d = (id: string, kind = "doc") => ({ id, title: id, kind });
    const hub = buildHub({ now: NOW, occurrences: [], favorites: [d("1"), d("f", "folder")], recent: [d("1"), d("2"), d("g", "folder")], tools: [{ id: "pdf", name: "PDF" }] });
    expect(hub.docs.pinned.map((x) => x.id)).toEqual(["1"]);
    expect(hub.docs.recent.map((x) => x.id)).toEqual(["2"]);
    expect(hub.tools).toEqual([{ id: "pdf", name: "PDF" }]);
  });

  it("names an untitled doc", () => {
    const hub = buildHub({ now: NOW, occurrences: [], favorites: [{ id: "x", title: " ", kind: "doc" }], recent: [], tools: [] });
    expect(hub.docs.pinned[0].title).toBe("Tanpa judul");
  });
});
