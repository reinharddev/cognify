// Panah tulisan tangan dari teks ke catatan melayang. Ada 10 rancangan; tiap tautan memakai satu secara acak.
export interface Pt {
  x: number;
  y: number;
}

export interface ArrowShape {
  /** Path SVG badan panah (tanpa kepala). */
  d: string;
  /** Arah panah di ujung (radian), untuk menggambar kepalanya. */
  angle: number;
  dash?: string;
}

type Gen = (a: Pt, b: Pt, len: number, u: Pt, n: Pt) => ArrowShape;

const at = (a: Pt, u: Pt, n: Pt, along: number, side: number): Pt => ({ x: a.x + u.x * along + n.x * side, y: a.y + u.y * along + n.y * side });
const P = (p: Pt) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
const dir = (from: Pt, to: Pt) => Math.atan2(to.y - from.y, to.x - from.x);

/** Garis bergelombang: titik-titik di sepanjang garis digeser bergantian ke kiri-kanan. */
function wave(a: Pt, b: Pt, len: number, u: Pt, n: Pt, steps: number, amp: number, smooth: boolean): ArrowShape {
  const pts: Pt[] = [a];
  for (let i = 1; i < steps; i++) pts.push(at(a, u, n, (len * i) / steps, i % 2 ? amp : -amp));
  pts.push(b);
  if (!smooth) return { d: `M ${P(a)} ` + pts.slice(1).map((p) => `L ${P(p)}`).join(" "), angle: dir(pts[pts.length - 2], b) };
  let d = `M ${P(a)}`;
  for (let i = 1; i < pts.length; i++) d += ` Q ${P(at(pts[i - 1], u, n, len / steps / 2, i % 2 ? -amp * 1.6 : amp * 1.6))} ${P(pts[i])}`;
  return { d, angle: dir(pts[pts.length - 2], b) };
}

export const ARROWS: Gen[] = [
  // 0 lurus
  (a, b) => ({ d: `M ${P(a)} L ${P(b)}`, angle: dir(a, b) }),
  // 1 lengkung halus
  (a, b, L, u, n) => {
    const c = at(a, u, n, L / 2, L * 0.22);
    return { d: `M ${P(a)} Q ${P(c)} ${P(b)}`, angle: dir(c, b) };
  },
  // 2 huruf S
  (a, b, L, u, n) => {
    const c1 = at(a, u, n, L * 0.3, L * 0.25);
    const c2 = at(a, u, n, L * 0.7, -L * 0.25);
    return { d: `M ${P(a)} C ${P(c1)} ${P(c2)} ${P(b)}`, angle: dir(c2, b) };
  },
  // 3 busur tinggi
  (a, b, L, u, n) => {
    const c = at(a, u, n, L / 2, -L * 0.45);
    return { d: `M ${P(a)} Q ${P(c)} ${P(b)}`, angle: dir(c, b) };
  },
  // 4 simpul (ada gelungan kecil)
  (a, b, L, u, n) => {
    const c1 = at(a, u, n, L * 0.95, L * 0.5);
    const c2 = at(a, u, n, L * 0.05, L * 0.5);
    return { d: `M ${P(a)} C ${P(c1)} ${P(c2)} ${P(b)}`, angle: dir(c2, b) };
  },
  // 5 bergelombang halus
  (a, b, L, u, n) => wave(a, b, L, u, n, 6, Math.min(9, L * 0.05), true),
  // 6 zigzag
  (a, b, L, u, n) => wave(a, b, L, u, n, 5, Math.min(11, L * 0.06), false),
  // 7 kait (tiba tegak lurus)
  (a, b, L, u, n) => {
    const c1 = at(a, u, n, 0, L * 0.6);
    const c2 = at(b, u, n, 0, L * 0.6);
    return { d: `M ${P(a)} C ${P(c1)} ${P(c2)} ${P(b)}`, angle: dir(c2, b) };
  },
  // 8 S terbalik
  (a, b, L, u, n) => {
    const c1 = at(a, u, n, L * 0.3, -L * 0.25);
    const c2 = at(a, u, n, L * 0.7, L * 0.25);
    return { d: `M ${P(a)} C ${P(c1)} ${P(c2)} ${P(b)}`, angle: dir(c2, b) };
  },
  // 9 putus-putus melengkung
  (a, b, L, u, n) => {
    const c = at(a, u, n, L / 2, L * 0.15);
    return { d: `M ${P(a)} Q ${P(c)} ${P(b)}`, angle: dir(c, b), dash: "7 7" };
  },
];

export const ARROW_COUNT = ARROWS.length;

export function arrowShape(index: number, a: Pt, b: Pt): ArrowShape {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.max(1, Math.hypot(dx, dy));
  const u = { x: dx / len, y: dy / len };
  const n = { x: -u.y, y: u.x };
  return ARROWS[((index % ARROW_COUNT) + ARROW_COUNT) % ARROW_COUNT](a, b, len, u, n);
}

/** Dua garis pendek kepala panah di titik `b` untuk arah `angle`. */
export function arrowHead(b: Pt, angle: number, size = 11): string {
  const spread = 0.5;
  const l = { x: b.x - size * Math.cos(angle - spread), y: b.y - size * Math.sin(angle - spread) };
  const r = { x: b.x - size * Math.cos(angle + spread), y: b.y - size * Math.sin(angle + spread) };
  return `M ${P(l)} L ${P(b)} L ${P(r)}`;
}

/** Bilangan acak tetap dari teks (supaya panah yang sama selalu tergambar sama). */
export function seedOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

/** Geser titik-titik jalur sedikit ke kiri-kanan dengan gelombang acak yang halus, seperti digambar tangan. */
export function roughen(points: Pt[], seed: number, amp = 2.2): Pt[] {
  const n = points.length;
  const p1 = seed * 6.28, p2 = seed * 17.3 + 1.7, p3 = seed * 41.1 + 4.1;
  return points.map((p, i) => {
    if (i === 0 || i === n - 1) return p; // ujung tetap di tempatnya
    const a = points[i - 1], b = points[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
    const t = i / (n - 1);
    const off = (Math.sin(t * 9 + p1) * 0.6 + Math.sin(t * 23 + p2) * 0.3 + Math.sin(t * 51 + p3) * 0.1) * amp;
    return { x: p.x + nx * off, y: p.y + ny * off };
  });
}

/** Jalur halus melalui titik-titik (lengkung kuadrat lewat titik tengah). */
export function smoothPath(pts: Pt[]): string {
  if (pts.length < 3) return `M ${P(pts[0])} L ${P(pts[pts.length - 1])}`;
  let d = `M ${P(pts[0])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mid = { x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2 };
    d += ` Q ${P(pts[i])} ${P(i === pts.length - 2 ? pts[i + 1] : mid)}`;
  }
  return d;
}
