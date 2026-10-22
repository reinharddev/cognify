// QR helpers kept free of the DOM so they can be tested in Node.

import QRCode from 'qrcode';
import jsQR from 'jsqr';

export type Ecc = 'L' | 'M' | 'Q' | 'H';

export interface Matrix {
	/** Modules per side. */
	size: number;
	/** size*size entries, 1 = dark. */
	data: Uint8Array;
}

/** Throws if the text does not fit in a QR code at this error correction level. */
export function buildMatrix(text: string, ecc: Ecc): Matrix {
	const { modules } = QRCode.create(text, { errorCorrectionLevel: ecc });
	return { size: modules.size, data: Uint8Array.from(modules.data) };
}

export interface RenderOptions {
	margin: number; // quiet zone, in modules
	fg: string; // #rrggbb
	bg: string;
}

export function hexToRgb(hex: string): [number, number, number] {
	const m = /^#([0-9a-f]{6})$/i.exec(hex);
	if (!m) throw new Error(`not a #rrggbb colour: ${hex}`);
	const n = parseInt(m[1], 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance([r, g, b]: [number, number, number]): number {
	const f = (c: number) => {
		const s = c / 255;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** WCAG contrast ratio, 1 (none) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
	const [la, lb] = [luminance(hexToRgb(a)), luminance(hexToRgb(b))];
	return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Scanners expect a dark code on a light background with enough contrast. */
export function colourProblem(fg: string, bg: string): 'inverted' | 'lowContrast' | null {
	if (luminance(hexToRgb(fg)) > luminance(hexToRgb(bg))) return 'inverted';
	return contrastRatio(fg, bg) < 3 ? 'lowContrast' : null;
}

/** Pixels per module for a requested image size, and the exact size that gives. */
export function fitScale(matrix: Matrix, margin: number, requested: number): { scale: number; pixels: number } {
	const total = matrix.size + margin * 2;
	const scale = Math.max(1, Math.floor(requested / total));
	return { scale, pixels: scale * total };
}

/** Whole-pixel-per-module RGBA image, so edges stay sharp. */
export function renderRgba(matrix: Matrix, scale: number, { margin, fg, bg }: RenderOptions) {
	const total = matrix.size + margin * 2;
	const width = total * scale;
	const data = new Uint8ClampedArray(width * width * 4);
	const [fr, fgc, fb] = hexToRgb(fg);
	const [br, bgc, bb] = hexToRgb(bg);
	for (let y = 0; y < width; y++) {
		const my = Math.floor(y / scale) - margin;
		for (let x = 0; x < width; x++) {
			const mx = Math.floor(x / scale) - margin;
			const dark = mx >= 0 && my >= 0 && mx < matrix.size && my < matrix.size && matrix.data[my * matrix.size + mx] === 1;
			const i = (y * width + x) * 4;
			data[i] = dark ? fr : br;
			data[i + 1] = dark ? fgc : bgc;
			data[i + 2] = dark ? fb : bb;
			data[i + 3] = 255;
		}
	}
	return { width, height: width, data };
}

/** Vector output: one rectangle for the background and one path for all dark modules. */
export function toSvg(matrix: Matrix, { margin, fg, bg }: RenderOptions): string {
	hexToRgb(fg);
	hexToRgb(bg); // validate, so nothing but a colour ever reaches the markup
	const total = matrix.size + margin * 2;
	let path = '';
	for (let y = 0; y < matrix.size; y++) {
		let x = 0;
		while (x < matrix.size) {
			if (matrix.data[y * matrix.size + x] === 1) {
				let run = 1;
				while (x + run < matrix.size && matrix.data[y * matrix.size + x + run] === 1) run++;
				path += `M${x + margin} ${y + margin}h${run}v1h-${run}z`;
				x += run;
			} else {
				x++;
			}
		}
	}
	return (
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges">` +
		`<rect width="${total}" height="${total}" fill="${bg}"/><path d="${path}" fill="${fg}"/></svg>`
	);
}

export type WifiSecurity = 'WPA' | 'WEP' | 'nopass';

/** Characters that must be backslash-escaped inside WIFI: fields. */
const wifiEscape = (s: string) => s.replace(/([\\;,:"])/g, '\\$1');

export function wifiPayload(o: { ssid: string; password: string; security: WifiSecurity; hidden: boolean }): string {
	const parts = [`WIFI:T:${o.security};S:${wifiEscape(o.ssid)};`];
	if (o.security !== 'nopass') parts.push(`P:${wifiEscape(o.password)};`);
	if (o.hidden) parts.push('H:true;');
	return parts.join('') + ';';
}

/** Decodes a QR code from raw RGBA pixels. Tries inverted colours too. */
export function decodeRgba(data: Uint8ClampedArray, width: number, height: number): string | null {
	return jsQR(data, width, height, { inversionAttempts: 'attemptBoth' })?.data ?? null;
}
