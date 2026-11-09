import { describe, expect, it } from 'vitest';
import { canSplit, locate, moveItem, nearest, offsets, reorderIndex, rulerStep, splitAt, tileTimes, totalOf, trimEnd, trimStart, MIN_LEN, type Seg } from './timeline';

const seg = (id: string, start: number, end: number, duration = 20): Seg => ({ id, start, end, duration });

describe('garis waktu video', () => {
	const segs = [seg('a', 2, 6), seg('b', 0, 3), seg('c', 10, 15)];

	it('menghitung awal tiap klip dan total', () => {
		expect(offsets(segs)).toEqual([0, 4, 7]);
		expect(totalOf(segs)).toBe(12);
	});

	it('mencari klip dan waktu di berkas sumber', () => {
		expect(locate(segs, 1)).toEqual({ index: 0, local: 3 });
		expect(locate(segs, 5)).toEqual({ index: 1, local: 1 });
		expect(locate(segs, 7)).toEqual({ index: 2, local: 10 });
		expect(locate(segs, 99)).toEqual({ index: 2, local: 15 });
		expect(locate(segs, -3)).toEqual({ index: 0, local: 2 });
		expect(locate([], 1)).toBeNull();
	});

	it('memotong satu klip jadi dua dengan id baru', () => {
		const out = splitAt(segs, 0, 4, ['x', 'y'])!;
		expect(out.map((s) => [s.id, s.start, s.end])).toEqual([['x', 2, 4], ['y', 4, 6], ['b', 0, 3], ['c', 10, 15]]);
		expect(totalOf(out)).toBe(totalOf(segs));
	});

	it('menolak potongan yang terlalu pendek', () => {
		expect(splitAt(segs, 0, 2.1, ['x', 'y'])).toBeNull();
		expect(splitAt(segs, 0, 5.9, ['x', 'y'])).toBeNull();
		expect(canSplit(segs[0], 2 + MIN_LEN)).toBe(true);
		expect(splitAt(segs, 9, 1, ['x', 'y'])).toBeNull();
	});

	it('menjaga tepi potong tetap di dalam durasi dan tidak terlalu pendek', () => {
		const s = seg('a', 2, 6, 20);
		expect(trimStart(s, -5)).toBe(0);
		expect(trimStart(s, 9)).toBeCloseTo(6 - MIN_LEN);
		expect(trimEnd(s, 99)).toBe(20);
		expect(trimEnd(s, 1)).toBeCloseTo(2 + MIN_LEN);
	});

	it('menentukan urutan baru hanya setelah penunjuk melewati tengah tetangga', () => {
		const w = [100, 200, 100];
		expect(reorderIndex(w, 0, 50)).toBe(0);
		expect(reorderIndex(w, 0, 190)).toBe(0);
		expect(reorderIndex(w, 0, 210)).toBe(1);
		expect(reorderIndex(w, 0, 390)).toBe(2);
		expect(reorderIndex(w, 2, 150)).toBe(1);
		expect(reorderIndex(w, 2, 190)).toBe(1);
		expect(reorderIndex(w, 2, 10)).toBe(0);
	});

	it('memindahkan butir tanpa mengubah larik asli', () => {
		const a = [1, 2, 3, 4];
		expect(moveItem(a, 0, 2)).toEqual([2, 3, 1, 4]);
		expect(moveItem(a, 3, 1)).toEqual([1, 4, 2, 3]);
		expect(a).toEqual([1, 2, 3, 4]);
		expect(moveItem(a, 1, 1)).toBe(a);
	});

	it('membuat waktu bingkai kecil dan memilih yang terdekat', () => {
		const t = tileTimes(seg('a', 10, 14), 40, 80);
		expect(t.length).toBe(2);
		expect(t[0]).toBeCloseTo(11);
		expect(tileTimes(seg('a', 0, 0.2), 40, 80)).toHaveLength(1);
		expect(nearest([0, 5, 10], 6)).toBe(1);
		expect(nearest([0, 5, 10], 9)).toBe(2);
	});

	it('memilih jarak label penggaris yang cukup lebar', () => {
		expect(rulerStep(200)).toBe(0.5);
		expect(rulerStep(40)).toBe(2);
		expect(rulerStep(8)).toBe(10);
	});
});
