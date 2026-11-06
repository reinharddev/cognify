import { describe, expect, it } from "vitest";
import { neoStyle, syncShadows, SHADOW, type El } from "./neo";

const rect = (id: string, extra: Partial<El> = {}): El => ({ id, type: "rectangle", x: 10, y: 20, groupIds: [], version: 1, versionNonce: 1, roughness: 1, width: 100, height: 50, angle: 0, ...extra });

describe("neoStyle", () => {
  it("tidak melakukan apa-apa bila tidak ada yang terpilih", () => {
    expect(neoStyle([rect("a")], {})).toBeNull();
  });

  it("memberi bentuk garis tegas dan bayangan yang digabung satu grup", () => {
    const out = neoStyle([rect("a")], { a: true })!;
    expect(out).toHaveLength(2);
    const [shadow, shape] = out;
    expect(shape.id).toBe("a");
    expect(shape.roughness).toBe(0);
    expect(shape.strokeWidth).toBe(2);
    expect(shadow.x).toBe(10 + SHADOW);
    expect(shadow.y).toBe(20 + SHADOW);
    expect(shadow.customData?.neoShadowOf).toBe("a");
    expect(shadow.groupIds).toEqual(shape.groupIds);
    expect(shape.groupIds).toHaveLength(1);
  });

  it("menerapkan ulang mengganti bayangan lama, bukan menumpuk", () => {
    const first = neoStyle([rect("a")], { a: true })!;
    const second = neoStyle(first, { a: true })!;
    const live = second.filter((e) => !e.isDeleted);
    expect(live.filter((e) => e.customData?.neoShadowOf)).toHaveLength(1);
    expect(live.find((e) => e.id === "a")!.groupIds).toHaveLength(1);
  });

  it("garis dan teks hanya dipertegas tanpa bayangan", () => {
    const out = neoStyle([{ ...rect("l"), type: "arrow" }], { l: true })!;
    expect(out).toHaveLength(1);
    expect(out[0].roughness).toBe(0);
  });
});

describe("syncShadows", () => {
  const made = () => neoStyle([rect("a")], { a: true })!;

  it("tidak mengubah apa pun bila bayangan masih menempel", () => {
    expect(syncShadows(made())).toBeNull();
  });

  it("mengembalikan bayangan yang digeser sendiri", () => {
    const els = made().map((e) => (e.customData?.neoShadowOf ? { ...e, x: 300, y: 300 } : e));
    const fixed = syncShadows(els)!;
    const shadow = fixed.find((e) => e.customData?.neoShadowOf)!;
    expect(shadow.x).toBe(10 + SHADOW);
    expect(shadow.y).toBe(20 + SHADOW);
    expect(syncShadows(fixed)).toBeNull();
  });

  it("mengikuti ukuran dan putaran bentuk, dan grup yang dilepas", () => {
    const els = made().map((e) => (e.id === "a" ? { ...e, width: 200, angle: 1, groupIds: [] } : { ...e, groupIds: [] }));
    const fixed = syncShadows(els)!;
    const shadow = fixed.find((e) => e.customData?.neoShadowOf)!;
    const shape = fixed.find((e) => e.id === "a")!;
    expect(shadow.width).toBe(200);
    expect(shadow.angle).toBe(1);
    expect(shape.groupIds).toHaveLength(1);
    expect(shadow.groupIds).toEqual(shape.groupIds);
  });

  it("menghapus bayangan bila bentuknya terhapus", () => {
    const els = made().map((e) => (e.id === "a" ? { ...e, isDeleted: true } : e));
    const fixed = syncShadows(els)!;
    expect(fixed.find((e) => e.customData?.neoShadowOf)!.isDeleted).toBe(true);
  });
});
