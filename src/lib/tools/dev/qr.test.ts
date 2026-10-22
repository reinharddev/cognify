import { describe, expect, it } from 'vitest';
import { buildMatrix, colourProblem, contrastRatio, decodeRgba, fitScale, renderRgba, toSvg, wifiPayload, type Ecc } from './qr';

const black = { margin: 4, fg: '#000000', bg: '#ffffff' };

function roundTrip(text: string, ecc: Ecc = 'M', opts = black, scale = 6) {
	const m = buildMatrix(text, ecc);
	const img = renderRgba(m, scale, opts);
	return decodeRgba(img.data, img.width, img.height);
}

describe('generate then read back', () => {
	it.each([
		['plain text', 'hello'],
		['a URL', 'https://example.com/path?q=1&r=%20two#frag'],
		['unicode', 'Kopi susu ☕ 日本語'],
		['a Wi-Fi payload', 'WIFI:T:WPA;S:Rumah;P:rahasia;;'],
		['long text', 'x'.repeat(900)]
	])('%s survives', (_name, text) => {
		expect(roundTrip(text)).toBe(text);
	});

	it.each(['L', 'M', 'Q', 'H'] as const)('works at error correction %s', (ecc) => {
		expect(roundTrip('error correction test', ecc)).toBe('error correction test');
	});

	it('works with custom colours and with inverted ones', () => {
		expect(roundTrip('colours', 'M', { margin: 4, fg: '#1a3d7c', bg: '#fff7e0' })).toBe('colours');
		// light-on-dark: the reader tries inversion too
		expect(roundTrip('inverted', 'M', { margin: 4, fg: '#ffffff', bg: '#000000' })).toBe('inverted');
	});

	it('stays readable at a small scale and with a thin quiet zone', () => {
		expect(roundTrip('small', 'M', { ...black, margin: 2 }, 3)).toBe('small');
	});

	it('refuses text that cannot fit instead of producing a broken code', () => {
		expect(() => buildMatrix('x'.repeat(4000), 'L')).toThrow();
	});
});

describe('sizing', () => {
	it('picks whole pixels per module and reports the real size', () => {
		const m = buildMatrix('hello', 'M'); // 21 modules
		expect(m.size).toBe(21);
		expect(fitScale(m, 4, 512)).toEqual({ scale: 17, pixels: 17 * 29 }); // floor(512 / 29) = 17, so 493 px
		expect(fitScale(m, 4, 512).pixels).toBeLessThanOrEqual(512);
		expect(fitScale(m, 4, 10)).toEqual({ scale: 1, pixels: 29 }); // never below 1 px per module
	});
});

describe('wifi payload', () => {
	it('builds the standard string', () => {
		expect(wifiPayload({ ssid: 'Home', password: 'pw', security: 'WPA', hidden: false })).toBe('WIFI:T:WPA;S:Home;P:pw;;');
		expect(wifiPayload({ ssid: 'Open', password: 'ignored', security: 'nopass', hidden: true })).toBe('WIFI:T:nopass;S:Open;H:true;;');
	});

	it('escapes the characters that would break the format', () => {
		expect(wifiPayload({ ssid: 'a;b,c:d"e\\f', password: 'p;w', security: 'WPA', hidden: false })).toBe(
			'WIFI:T:WPA;S:a\\;b\\,c\\:d\\"e\\\\f;P:p\\;w;;'
		);
	});

	it('still decodes after a round trip through a code', () => {
		const text = wifiPayload({ ssid: 'Kantor; Lt.2', password: 'pa:ss', security: 'WPA', hidden: false });
		expect(roundTrip(text)).toBe(text);
	});
});

describe('colour checks', () => {
	it('computes the WCAG ratio', () => {
		expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
		expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 5);
	});

	it('flags what scanners struggle with', () => {
		expect(colourProblem('#000000', '#ffffff')).toBeNull();
		expect(colourProblem('#ffffff', '#000000')).toBe('inverted');
		expect(colourProblem('#888888', '#999999')).toBe('lowContrast');
	});

	it('rejects anything that is not #rrggbb before it can reach SVG markup', () => {
		const m = buildMatrix('x', 'L');
		expect(() => toSvg(m, { margin: 2, fg: '"/><script>', bg: '#ffffff' })).toThrow();
	});
});

describe('svg', () => {
	it('draws exactly the dark modules', () => {
		const m = buildMatrix('svg check', 'M');
		const svg = toSvg(m, black);
		expect(svg).toContain(`viewBox="0 0 ${m.size + 8} ${m.size + 8}"`);
		// area of all rectangles in the path equals the number of dark modules
		const path = /<path d="([^"]*)"/.exec(svg)![1];
		const area = [...path.matchAll(/h(\d+)v1/g)].reduce((sum, r) => sum + Number(r[1]), 0);
		expect(area).toBe(m.data.reduce((sum, v) => sum + v, 0));
	});
});
