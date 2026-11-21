// Format hasil transkrip: SRT, WebVTT, teks, dan isi dokumen Tiptap. Semua fungsi murni.

export type Segment = { start: number; end: number; text: string };

type Json = Record<string, unknown>;

/** Detik jadi "m:ss", atau "h:mm:ss" bila lewat satu jam. */
export function stamp(seconds: number, forceHours = false): string {
	const total = Math.max(0, Math.floor(seconds));
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	const ss = String(s).padStart(2, '0');
	return h > 0 || forceHours ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

function clock(seconds: number, sep: ',' | '.'): string {
	const ms = Math.round(Math.max(0, seconds) * 1000);
	const h = Math.floor(ms / 3_600_000);
	const m = Math.floor((ms % 3_600_000) / 60_000);
	const s = Math.floor((ms % 60_000) / 1000);
	const pad = (n: number, w = 2) => String(n).padStart(w, '0');
	return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(ms % 1000, 3)}`;
}

export function toSrt(segments: Segment[]): string {
	return (
		segments
			.map((s, i) => `${i + 1}\n${clock(s.start, ',')} --> ${clock(Math.max(s.end, s.start), ',')}\n${s.text}`)
			.join('\n\n') + '\n'
	);
}

export function toVtt(segments: Segment[]): string {
	return (
		'WEBVTT\n\n' +
		segments.map((s) => `${clock(s.start, '.')} --> ${clock(Math.max(s.end, s.start), '.')}\n${s.text}`).join('\n\n') +
		'\n'
	);
}

export type Paragraph = { start: number; text: string };

/**
 * Menyatukan segmen pendek jadi paragraf yang enak dibaca: paragraf baru bila jedanya panjang
 * atau paragraf sudah terlalu panjang. Segmen pertama tiap paragraf memberi stempel waktunya.
 */
export function toParagraphs(segments: Segment[], gap = 2.5, maxChars = 420): Paragraph[] {
	const out: Paragraph[] = [];
	let prevEnd = -Infinity;
	for (const s of segments) {
		const text = s.text.trim();
		if (!text) continue;
		const last = out[out.length - 1];
		if (last && s.start - prevEnd <= gap && last.text.length < maxChars) last.text += ` ${text}`;
		else out.push({ start: s.start, text });
		prevEnd = s.end;
	}
	return out;
}

export function toText(segments: Segment[], timestamps: boolean): string {
	const forceHours = segments.some((s) => s.start >= 3600);
	return toParagraphs(segments)
		.map((p) => (timestamps ? `[${stamp(p.start, forceHours)}] ${p.text}` : p.text))
		.join('\n\n');
}

const text = (t: string, marks?: Json[]): Json => (marks ? { type: 'text', text: t, marks } : { type: 'text', text: t });
const para = (...content: Json[]): Json => (content.length ? { type: 'paragraph', content } : { type: 'paragraph' });

export type DocMeta = { source?: string; language?: string | null };

/** Dokumen Tiptap: satu baris keterangan (judulnya sudah di halaman), lalu paragraf transkrip (dengan stempel waktu bila diminta). */
export function toDoc(segments: Segment[], meta: DocMeta, timestamps: boolean): Json {
	const forceHours = segments.some((s) => s.start >= 3600);
	const info = [meta.source, meta.language ? meta.language.toUpperCase() : null].filter(Boolean).join(' · ');
	const body = toParagraphs(segments).map((p) =>
		timestamps ? para(text(`${stamp(p.start, forceHours)} `, [{ type: 'bold' }]), text(p.text)) : para(text(p.text))
	);
	return {
		type: 'doc',
		content: [
			...(info ? [para(text(info, [{ type: 'italic' }]))] : []),
			...(body.length ? body : [para()])
		]
	};
}

/** Nama berkas aman dari judul: tanpa karakter yang dilarang sistem berkas, maksimal 80 huruf. */
export function safeName(title: string): string {
	const cleaned = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80).trim();
	return cleaned || 'transkrip';
}
