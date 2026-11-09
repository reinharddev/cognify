// Pure timeline maths for the video editor: no DOM, so it can be tested.
// A segment is a cut of a source file; the timeline is those cuts laid end to end.

export type Seg = { id: string; start: number; end: number; duration: number };

/** Shortest cut we allow (seconds). Keeps every export valid by construction. */
export const MIN_LEN = 0.2;

export const lengthOf = (s: Pick<Seg, 'start' | 'end'>) => s.end - s.start;

/** Start time of each segment on the timeline. */
export function offsets(segs: Pick<Seg, 'start' | 'end'>[]): number[] {
	let at = 0;
	return segs.map((s) => {
		const here = at;
		at += lengthOf(s);
		return here;
	});
}

export const totalOf = (segs: Pick<Seg, 'start' | 'end'>[]) => segs.reduce((sum, s) => sum + lengthOf(s), 0);

/** Which segment a timeline time falls in, and the matching time inside the source file. */
export function locate(segs: Pick<Seg, 'start' | 'end'>[], t: number): { index: number; local: number } | null {
	if (!segs.length) return null;
	const offs = offsets(segs);
	const total = totalOf(segs);
	const at = Math.min(Math.max(t, 0), total);
	for (let i = segs.length - 1; i >= 0; i--) {
		if (at >= offs[i]) {
			const local = segs[i].start + (at - offs[i]);
			return { index: i, local: Math.min(local, segs[i].end) };
		}
	}
	return { index: 0, local: segs[0].start };
}

/** Can the segment be cut at this source time, leaving two pieces of at least MIN_LEN? */
export const canSplit = (s: Pick<Seg, 'start' | 'end'>, local: number) => local - s.start >= MIN_LEN && s.end - local >= MIN_LEN;

/** Cut one segment in two at a source time. Returns null when a piece would be too short. */
export function splitAt<T extends Seg>(segs: T[], index: number, local: number, ids: [string, string]): T[] | null {
	const s = segs[index];
	if (!s || !canSplit(s, local)) return null;
	return [...segs.slice(0, index), { ...s, id: ids[0], end: local }, { ...s, id: ids[1], start: local }, ...segs.slice(index + 1)];
}

/** New start time when the left edge is dragged to `to` (source seconds). */
export const trimStart = (s: Seg, to: number) => Math.min(Math.max(to, 0), s.end - MIN_LEN);

/** New end time when the right edge is dragged to `to` (source seconds). */
export const trimEnd = (s: Seg, to: number) => Math.max(Math.min(to, s.duration), s.start + MIN_LEN);

/**
 * Where a dragged segment should sit, given the pointer's x on the timeline (px).
 * A neighbour is passed only once the pointer crosses its middle, so the order does not flicker.
 */
export function reorderIndex(lengthsPx: number[], from: number, x: number): number {
	const lefts: number[] = [];
	let at = 0;
	for (const w of lengthsPx) {
		lefts.push(at);
		at += w;
	}
	let to = from;
	while (to > 0 && x < lefts[to - 1] + lengthsPx[to - 1] / 2) to--;
	while (to < lengthsPx.length - 1 && x > lefts[to + 1] + lengthsPx[to + 1] / 2) to++;
	return to;
}

export function moveItem<T>(items: T[], from: number, to: number): T[] {
	if (from === to) return items;
	const copy = items.slice();
	const [item] = copy.splice(from, 1);
	copy.splice(to, 0, item);
	return copy;
}

/** Source times for the thumbnail tiles drawn inside a block of the given pixel width. */
export function tileTimes(s: Pick<Seg, 'start' | 'end'>, pxPerSec: number, tilePx: number): number[] {
	const count = Math.max(1, Math.ceil((lengthOf(s) * pxPerSec) / tilePx));
	return Array.from({ length: count }, (_, k) => Math.min(s.start + ((k + 0.5) * tilePx) / pxPerSec, s.end));
}

/** Index of the sampled time closest to t (times are ascending). */
export function nearest(times: number[], t: number): number {
	let best = 0;
	for (let i = 1; i < times.length; i++) if (Math.abs(times[i] - t) < Math.abs(times[best] - t)) best = i;
	return best;
}

const STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800];

/** Distance between ruler labels (seconds) so labels stay at least `minPx` apart. */
export function rulerStep(pxPerSec: number, minPx = 72): number {
	return STEPS.find((s) => s * pxPerSec >= minPx) ?? STEPS[STEPS.length - 1];
}
