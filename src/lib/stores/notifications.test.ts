import { describe, expect, it } from "vitest";
import { MAX, sanitizeList } from "./notifications.svelte";

describe("sanitizeList", () => {
  it("drops broken entries and sorts newest first", () => {
    const out = sanitizeList([
      { id: "a", title: "A", at: 1 },
      { id: "b", title: "B", at: 5, kind: "moodle", read: true, href: "/moodle" },
      { title: "no id", at: 2 },
      null,
    ]);
    expect(out.map((n) => n.id)).toEqual(["b", "a"]);
    expect(out[0]).toMatchObject({ kind: "moodle", read: true, href: "/moodle" });
    expect(out[1]).toMatchObject({ kind: "info", read: false, href: null, body: "" });
  });

  it("caps the history", () => {
    const many = Array.from({ length: MAX + 20 }, (_, i) => ({ id: String(i), title: "t", at: i }));
    expect(sanitizeList(many)).toHaveLength(MAX);
  });

  it("returns empty for non-arrays", () => {
    expect(sanitizeList("x")).toEqual([]);
  });
});
