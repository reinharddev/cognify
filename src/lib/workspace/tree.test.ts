import { describe, expect, it } from "vitest";
import { ancestors, buildTree, planMove, visibleRows } from "./tree";
import type { PageNode } from "./types";

const n = (id: string, parentId: string | null = null): PageNode => ({
  id, parentId, kind: "doc", title: id, icon: null, position: 0, favorite: false, updatedAt: "",
});

describe("buildTree", () => {
  const nodes = [n("a"), n("b"), n("a1", "a"), n("a2", "a"), n("a11", "a1")];

  it("nests children under their parent and keeps the given order", () => {
    const tree = buildTree(nodes);
    expect(tree.map((t) => t.id)).toEqual(["a", "b"]);
    expect(tree[0].children.map((c) => c.id)).toEqual(["a1", "a2"]);
    expect(tree[0].children[0].children.map((c) => c.id)).toEqual(["a11"]);
  });

  it("puts a page whose parent is missing at the top level", () => {
    expect(buildTree([n("x", "hilang"), n("y")]).map((t) => t.id)).toEqual(["x", "y"]);
  });

  it("does not mutate the input", () => {
    buildTree(nodes);
    expect(nodes[0]).not.toHaveProperty("children");
  });
});

describe("ancestors", () => {
  it("returns the chain from the top to the page", () => {
    expect(ancestors([n("a"), n("a1", "a"), n("a11", "a1")], "a11").map((x) => x.id)).toEqual(["a", "a1", "a11"]);
  });
  it("returns an empty chain for an unknown id and survives a cycle", () => {
    expect(ancestors([n("a")], "zzz")).toEqual([]);
    expect(ancestors([n("p", "q"), n("q", "p")], "p").length).toBe(2);
  });
});

describe("visibleRows", () => {
  it("lists only the descendants of expanded nodes, with depth", () => {
    const tree = buildTree([n("a"), n("a1", "a"), n("a11", "a1"), n("b")]);
    expect(visibleRows(tree, new Set()).map((r) => r.node.id)).toEqual(["a", "b"]);
    const rows = visibleRows(tree, new Set(["a", "a1"]));
    expect(rows.map((r) => [r.node.id, r.depth])).toEqual([["a", 0], ["a1", 1], ["a11", 2], ["b", 0]]);
  });
});

describe("planMove", () => {
  // a, b, c di akar; a1, a2 di dalam a; a1x di dalam a1. Urutan = urutan saudara.
  const nodes = [n("a"), n("b"), n("c"), n("a1", "a"), n("a2", "a"), n("a1x", "a1")];

  it("sebelum dan sesudah saudara menentukan acuan urutan", () => {
    expect(planMove(nodes, "c", "a", "before")).toEqual({ parentId: null, beforeId: "a" });
    expect(planMove(nodes, "a", "c", "after")).toEqual({ parentId: null, beforeId: null });
    expect(planMove(nodes, "a", "b", "after")).toEqual({ parentId: null, beforeId: "c" });
  });

  it("di dalam menaruh halaman di akhir turunan target", () => {
    expect(planMove(nodes, "c", "a", "inside")).toEqual({ parentId: "a", beforeId: null });
    expect(planMove(nodes, "c", "b", "inside")).toEqual({ parentId: "b", beforeId: null });
  });

  it("naik ke tingkat lain lewat sebelum atau sesudah saudara di sana", () => {
    expect(planMove(nodes, "a2", "b", "before")).toEqual({ parentId: null, beforeId: "b" });
    expect(planMove(nodes, "c", "a2", "after")).toEqual({ parentId: "a", beforeId: null });
    expect(planMove(nodes, "c", "a1", "before")).toEqual({ parentId: "a", beforeId: "a1" });
  });

  it("tidak melakukan apa pun bila posisinya tidak berubah", () => {
    expect(planMove(nodes, "b", "a", "after")).toBeNull();
    expect(planMove(nodes, "b", "c", "before")).toBeNull();
    expect(planMove(nodes, "a2", "a", "inside")).toBeNull();
    expect(planMove(nodes, "a", "a", "inside")).toBeNull();
  });

  it("menolak pemindahan ke dalam diri sendiri atau turunannya", () => {
    expect(planMove(nodes, "a", "a1", "inside")).toBeNull();
    expect(planMove(nodes, "a", "a1x", "before")).toBeNull();
    expect(planMove(nodes, "a1", "a1x", "after")).toBeNull();
  });

  it("menolak id yang tidak dikenal", () => {
    expect(planMove(nodes, "x", "a", "before")).toBeNull();
    expect(planMove(nodes, "a", "x", "before")).toBeNull();
  });
});
