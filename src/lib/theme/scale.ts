// Skala ruang dan radius Cognify. Rumusnya dijelaskan di app.css (blok "Skala ruang dan radius") dan
// dijaga oleh scale.test.ts: nilai di sini harus sama dengan token CSS.
//
//   langkah skala  S(n) = 4px × Fibonacci(n)     → 4, 8, 12, 20, 32, 52, 84
//   rasio dua langkah berurutan ≈ φ (1,618); S(n) = S(n-1) + S(n-2)
//   jarak dalam wadah  = satu langkah di bawah padding wadah   (p ÷ φ)
//   jarak antar kelompok = satu langkah di atas padding wadah  (p × φ)
//   radius anak = radius induk − padding induk (konsentris), minimal 4px

export const UNIT = 4;
const FIB = [1, 2, 3, 5, 8, 13, 21] as const;

/** --space-1 … --space-7 */
export const SPACE: readonly number[] = FIB.map((n) => n * UNIT);
/** --radius-1 … --radius-5 (pil = tak terhingga, di luar skala) */
export const RADIUS: readonly number[] = SPACE.slice(0, 5);
export const MIN_RADIUS = SPACE[0];
export const PHI = (1 + Math.sqrt(5)) / 2;

const index = (px: number) => SPACE.indexOf(px);

/** Radius anak yang konsentris dengan induknya. */
export const concentric = (outerRadius: number, padding: number) => Math.max(outerRadius - padding, MIN_RADIUS);

/** Jarak antar isi di dalam wadah berpadding `padding` (satu langkah ke bawah). */
export function gapInside(padding: number): number {
  const i = index(padding);
  if (i < 0) throw new Error(`${padding}px bukan langkah skala`);
  return SPACE[Math.max(i - 1, 0)];
}

/** Jarak antar kelompok untuk wadah berpadding `padding` (satu langkah ke atas). */
export function gapBetween(padding: number): number {
  const i = index(padding);
  if (i < 0) throw new Error(`${padding}px bukan langkah skala`);
  return SPACE[Math.min(i + 1, SPACE.length - 1)];
}
