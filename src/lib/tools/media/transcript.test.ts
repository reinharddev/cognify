import { describe, expect, it } from 'vitest';
import { plainTextOf } from '$lib/workspace/templates';
import { safeName, stamp, toDoc, toParagraphs, toSrt, toText, toVtt, type Segment } from './transcript';

const segs: Segment[] = [
	{ start: 0.5, end: 2.25, text: 'Halo semuanya.' },
	{ start: 2.5, end: 5, text: 'Hari ini kita belajar fisika.' },
	{ start: 12, end: 14.0005, text: 'Bagian kedua dimulai.' }
];

describe('stamp', () => {
	it('uses m:ss and switches to h:mm:ss after an hour', () => {
		expect(stamp(0)).toBe('0:00');
		expect(stamp(75.9)).toBe('1:15');
		expect(stamp(3600)).toBe('1:00:00');
		expect(stamp(3725)).toBe('1:02:05');
		expect(stamp(5, true)).toBe('0:00:05');
		expect(stamp(-3)).toBe('0:00');
	});
});

describe('subtitles', () => {
	it('writes numbered SRT with comma milliseconds', () => {
		const srt = toSrt(segs);
		expect(srt.startsWith('1\n00:00:00,500 --> 00:00:02,250\nHalo semuanya.\n\n2\n')).toBe(true);
		expect(srt).toContain('00:00:12,000 --> 00:00:14,001');
		expect(srt.endsWith('\n')).toBe(true);
	});

	it('writes WebVTT with a header and dot milliseconds', () => {
		const vtt = toVtt(segs);
		expect(vtt.startsWith('WEBVTT\n\n00:00:00.500 --> 00:00:02.250\n')).toBe(true);
	});

	it('never lets a cue end before it starts', () => {
		expect(toSrt([{ start: 5, end: 3, text: 'x' }])).toContain('00:00:05,000 --> 00:00:05,000');
	});

	it('rolls milliseconds over into seconds without printing 1000', () => {
		expect(toSrt([{ start: 0.9996, end: 1, text: 'x' }])).toContain('00:00:01,000 --> 00:00:01,000');
	});
});

describe('paragraphs and text', () => {
	it('joins segments that follow each other and breaks on a long pause', () => {
		const p = toParagraphs(segs);
		expect(p).toEqual([
			{ start: 0.5, text: 'Halo semuanya. Hari ini kita belajar fisika.' },
			{ start: 12, text: 'Bagian kedua dimulai.' }
		]);
	});

	it('starts a new paragraph when one grows too long', () => {
		const many = Array.from({ length: 30 }, (_, i) => ({ start: i * 3, end: i * 3 + 2.9, text: 'kalimat yang cukup panjang untuk mengisi.' }));
		expect(toParagraphs(many, 2.5, 200).length).toBeGreaterThan(1);
	});

	it('skips empty segments', () => {
		expect(toParagraphs([{ start: 0, end: 1, text: '  ' }])).toEqual([]);
	});

	it('renders plain text with or without timestamps', () => {
		expect(toText(segs, false)).toBe('Halo semuanya. Hari ini kita belajar fisika.\n\nBagian kedua dimulai.');
		expect(toText(segs, true)).toBe('[0:00] Halo semuanya. Hari ini kita belajar fisika.\n\n[0:12] Bagian kedua dimulai.');
	});

	it('uses hour format for every stamp when the recording is longer than an hour', () => {
		const long = [{ start: 3700, end: 3702, text: 'akhir' }, { start: 1, end: 2, text: 'awal' }];
		expect(toText(long, true)).toContain('[1:01:40] akhir');
	});
});

describe('document', () => {
	it('builds an info line and one paragraph per block', () => {
		const doc = toDoc(segs, { source: 'Whisper', language: 'id' }, true) as any;
		expect(doc.type).toBe('doc');
		expect(doc.content[0].content[0].text).toBe('Whisper · ID');
		expect(doc.content).toHaveLength(3);
		expect(doc.content[1].content[0]).toEqual({ type: 'text', text: '0:00 ', marks: [{ type: 'bold' }] });
		expect(plainTextOf(doc)).toContain('Hari ini kita belajar fisika.');
	});

	it('leaves out timestamps and the info line when not wanted', () => {
		const doc = toDoc(segs, {}, false) as any;
		expect(doc.content).toHaveLength(2);
		expect(doc.content[0].content).toHaveLength(1);
	});

	it('still returns a valid document for an empty transcript', () => {
		const doc = toDoc([], {}, true) as any;
		expect(doc.content).toEqual([{ type: 'paragraph' }]);
	});
});

describe('safeName', () => {
	it('strips characters the file system refuses and caps the length', () => {
		expect(safeName('Kuliah: Fisika/Bab 1?')).toBe('Kuliah Fisika Bab 1');
		expect(safeName('   ')).toBe('transkrip');
		expect(safeName('a'.repeat(200)).length).toBe(80);
	});
});
