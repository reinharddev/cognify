// Gaya "neo" untuk papan: garis tinta tegas, isian datar, sudut membulat, dan bayangan bergeser seperti
// kartu di situs Cognify. Excalidraw tidak punya bayangan, jadi tiap bentuk diberi salinan gelap di
// belakangnya yang digabung dalam satu grup, sehingga ikut bergeser, berputar, dan terhapus bersama bentuknya.

export type El = {
  id: string;
  type: string;
  x: number;
  y: number;
  groupIds: string[];
  isDeleted?: boolean;
  version: number;
  versionNonce: number;
  customData?: { neoShadowOf?: string } & Record<string, unknown>;
  [key: string]: unknown;
};

export const INK = "#1e1e1e";
export const SHADOW = 6;
const SHAPES = new Set(["rectangle", "ellipse", "diamond"]);

/** Nilai awal untuk gambar baru: tanpa efek sketsa, garis tebal, isian datar, font Nunito yang membulat. */
export const NEO_DEFAULTS = {
  currentItemRoughness: 0,
  currentItemStrokeWidth: 2,
  currentItemStrokeColor: INK,
  currentItemFillStyle: "solid",
  currentItemBackgroundColor: "#ffec99",
  currentItemRoundness: "round",
  currentItemOpacity: 100,
  currentItemFontFamily: 6,
};

const rand = () => Math.floor(Math.random() * 2 ** 31);
const rid = () => `neo${Date.now().toString(36)}${rand().toString(36)}`;

/** Terapkan gaya neo pada elemen terpilih; kembalikan daftar elemen baru, atau null bila tidak ada yang terpilih. */
export function neoStyle(elements: readonly El[], selected: Record<string, boolean>): El[] | null {
  const picked = elements.filter((e) => selected[e.id] && !e.isDeleted && !e.customData?.neoShadowOf);
  if (!picked.length) return null;
  const ids = new Set(picked.map((e) => e.id));
  // Bayangan lama dari bentuk yang sama diganti; id grupnya dibuang dari bentuk aslinya.
  const oldGroup = new Map<string, string>();
  for (const e of elements) {
    const of = e.customData?.neoShadowOf;
    if (of && ids.has(of) && !e.isDeleted) oldGroup.set(of, e.groupIds[e.groupIds.length - 1]);
  }
  const out: El[] = [];
  for (const e of elements) {
    const of = e.customData?.neoShadowOf;
    if (of && ids.has(of)) {
      out.push({ ...e, isDeleted: true, version: e.version + 1, versionNonce: rand() });
      continue;
    }
    if (!ids.has(e.id)) {
      out.push(e);
      continue;
    }
    const old = oldGroup.get(e.id);
    const keep = e.groupIds.filter((g) => g !== old);
    const shape = SHAPES.has(e.type);
    const group = rid();
    const styled: El = {
      ...e,
      roughness: 0,
      strokeWidth: 2,
      fillStyle: "solid",
      opacity: 100,
      // Isian transparan akan menampakkan bayangan di belakangnya, jadi bentuk diberi isian putih.
      backgroundColor: shape && e.backgroundColor === "transparent" ? "#ffffff" : e.backgroundColor,
      strokeColor: e.type === "text" ? e.strokeColor : INK,
      roundness: shape ? { type: 3 } : e.roundness,
      groupIds: shape ? [...keep, group] : keep,
      version: e.version + 1,
      versionNonce: rand(),
    };
    if (shape) {
      out.push({
        ...styled,
        id: rid(),
        x: e.x + SHADOW,
        y: e.y + SHADOW,
        backgroundColor: INK,
        strokeColor: INK,
        boundElements: null,
        link: null,
        customData: { neoShadowOf: e.id },
        seed: rand(),
        version: 1,
        versionNonce: rand(),
        index: null,
      });
    }
    out.push(styled);
  }
  return out;
}

/** Beri gaya neo pada semua gambar di papan (garis tegas + bayangan). */
export function neoAll(elements: readonly El[]): El[] {
  const all: Record<string, boolean> = {};
  for (const e of elements) if (!e.isDeleted && !e.customData?.neoShadowOf) all[e.id] = true;
  return neoStyle(elements, all) ?? [...elements];
}

/** Kembalikan ke tampilan polos: bayangan dibuang dan garis kembali bergaya sketsa. */
export function plainAll(elements: readonly El[]): El[] {
  const shadowGroups = new Map<string, string>();
  for (const e of elements) {
    const of = e.customData?.neoShadowOf;
    if (of && !e.isDeleted) shadowGroups.set(of, e.groupIds[e.groupIds.length - 1]);
  }
  return elements.map((e) => {
    if (e.customData?.neoShadowOf) return e.isDeleted ? e : { ...e, isDeleted: true, version: e.version + 1, versionNonce: rand() };
    if (e.isDeleted) return e;
    const group = shadowGroups.get(e.id);
    return {
      ...e,
      roughness: 1,
      groupIds: group ? e.groupIds.filter((g) => g !== group) : e.groupIds,
      version: e.version + 1,
      versionNonce: rand(),
    };
  });
}

/** Gaya yang tampaknya dipakai papan: ada bayangan neo = neo. */
export const detectStyle = (elements: readonly El[]): "neo" | "normal" => (elements.some((e) => e.customData?.neoShadowOf && !e.isDeleted) ? "neo" : "normal");
