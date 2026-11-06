// Fungsi murni untuk Alat Teks dan Kode. Semuanya berjalan di perangkat ini (tanpa jaringan), jadi mudah diuji.

export interface TextCounts {
	chars: number;
	charsNoSpace: number;
	words: number;
	sentences: number;
	paragraphs: number;
	lines: number;
	/** Menit baca dan menit bicara, dibulatkan ke atas; 0 bila teks kosong. */
	readMin: number;
	speakMin: number;
}

export function countText(text: string): TextCounts {
	const trimmed = text.trim();
	if (!trimmed) return { chars: 0, charsNoSpace: 0, words: 0, sentences: 0, paragraphs: 0, lines: 0, readMin: 0, speakMin: 0 };
	// [...text] menghitung per karakter sungguhan (emoji dan huruf bertanda tidak terpecah)
	const chars = [...text].length;
	const words = trimmed.split(/\s+/).length;
	return {
		chars,
		charsNoSpace: [...text.replace(/\s/g, '')].length,
		words,
		sentences: (trimmed.match(/[^.!?…]+[.!?…]+(?=\s|$)|[^.!?…]+$/g) ?? []).filter((s) => s.trim()).length,
		paragraphs: trimmed.split(/\n\s*\n/).filter((p) => p.trim()).length,
		lines: text.split(/\r?\n/).length,
		readMin: Math.ceil(words / 200),
		speakMin: Math.ceil(words / 130)
	};
}

export type CaseMode = 'upper' | 'lower' | 'title' | 'sentence' | 'toggle';

const SMALL = new Set(['dan', 'atau', 'dengan', 'yang', 'untuk', 'di', 'ke', 'dari', 'of', 'and', 'the', 'to', 'in', 'for', 'a', 'an', 'or']);

export function changeCase(text: string, mode: CaseMode): string {
	switch (mode) {
		case 'upper':
			return text.toUpperCase();
		case 'lower':
			return text.toLowerCase();
		case 'title': {
			let first = true;
			return text.toLowerCase().replace(/[\p{L}\p{N}']+/gu, (w) => {
				const keep = !first && SMALL.has(w);
				first = false;
				return keep ? w : w.charAt(0).toUpperCase() + w.slice(1);
			});
		}
		case 'sentence':
			// huruf besar di awal teks dan setelah . ! ? atau baris baru
			return text.toLowerCase().replace(/(^|[.!?]\s+|\n\s*)(\p{L})/gu, (_, pre: string, ch: string) => pre + ch.toUpperCase());
		case 'toggle':
			return [...text].map((c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())).join('');
	}
}

export interface TidyOptions {
	trimLines: boolean;
	collapseSpaces: boolean;
	removeBlank: boolean;
	dedupe: boolean;
	sort: 'none' | 'asc' | 'desc';
	reverse: boolean;
}

export function tidyLines(text: string, o: TidyOptions): string {
	let lines = text.split(/\r?\n/);
	if (o.trimLines) lines = lines.map((l) => l.trim());
	if (o.collapseSpaces) lines = lines.map((l) => l.replace(/[ \t]{2,}/g, ' '));
	if (o.removeBlank) lines = lines.filter((l) => l.trim() !== '');
	if (o.dedupe) {
		const seen = new Set<string>();
		lines = lines.filter((l) => (seen.has(l) ? false : (seen.add(l), true)));
	}
	if (o.sort !== 'none') {
		const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
		lines = [...lines].sort((a, b) => collator.compare(a, b));
		if (o.sort === 'desc') lines.reverse();
	}
	if (o.reverse) lines = [...lines].reverse();
	return lines.join('\n');
}

// ── Base64 dan URL ───────────────────────────────────────────────────────────

export function base64Encode(text: string, urlSafe = false): string {
	const bytes = new TextEncoder().encode(text);
	let binary = '';
	for (const b of bytes) binary += String.fromCharCode(b);
	const out = btoa(binary);
	return urlSafe ? out.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : out;
}

/** null bila bukan Base64 yang sah atau isinya bukan teks UTF-8. */
export function base64Decode(text: string): string | null {
	const clean = text.trim().replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
	if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean) || clean.length % 4 === 1) return null;
	try {
		const binary = atob(clean.padEnd(Math.ceil(clean.length / 4) * 4, '='));
		const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
		return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		return null;
	}
}

export const urlEncode = (text: string) => encodeURIComponent(text);

export function urlDecode(text: string): string | null {
	try {
		return decodeURIComponent(text.replace(/\+/g, ' '));
	} catch {
		return null;
	}
}

// ── Hash ─────────────────────────────────────────────────────────────────────

export type HashAlgo = 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512';
export const HASH_ALGOS: HashAlgo[] = ['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'];

export async function hashText(text: string, algo: HashAlgo): Promise<string> {
	const digest = await crypto.subtle.digest(algo, new TextEncoder().encode(text));
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ── Waktu ────────────────────────────────────────────────────────────────────

export interface TimeInfo {
	/** detik sejak 1970 */
	seconds: number;
	millis: number;
	iso: string;
}

/**
 * Angka 10 digit atau kurang dibaca sebagai detik, lebih dari itu sebagai milidetik. Teks lain dibaca sebagai tanggal.
 * null bila tidak terbaca.
 */
export function parseTime(input: string): TimeInfo | null {
	const t = input.trim();
	if (!t) return null;
	let ms: number;
	if (/^-?\d+(\.\d+)?$/.test(t)) {
		const n = Number(t);
		ms = Math.abs(n) >= 1e11 ? n : n * 1000;
	} else {
		ms = Date.parse(t);
	}
	if (!Number.isFinite(ms) || Math.abs(ms) > 8.64e15) return null;
	const d = new Date(ms);
	return { seconds: Math.floor(ms / 1000), millis: Math.round(ms), iso: d.toISOString() };
}

export function uuids(count: number): string[] {
	return Array.from({ length: Math.min(Math.max(Math.floor(count) || 1, 1), 50) }, () => crypto.randomUUID());
}
