import { describe, expect, it } from "vitest";
import { neoStyle, SHADOW, type El } from "./neo";

const rect = (id: string, extra: Partial<El> = {}): El => ({ id, type: "rectangle", x: 10, y: 20, groupIds: [], version: 1, versionNonce: 1, roughness: 1, ...extra });

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
