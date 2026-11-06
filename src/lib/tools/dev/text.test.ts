import { describe, expect, it } from 'vitest';
import { base64Decode, base64Encode, changeCase, countText, hashText, parseTime, tidyLines, urlDecode, urlEncode, uuids } from './text';

describe('countText', () => {
	it('menghitung kata, karakter, kalimat, paragraf, dan baris', () => {
		const c = countText('Halo dunia. Apa kabar?\n\nBaik sekali!');
		expect(c).toMatchObject({ words: 6, sentences: 3, paragraphs: 2, lines: 3 });
		expect(c.chars).toBe(36); // 11 + 1 + 10 + 2 baris baru + 12
		expect(c.charsNoSpace).toBe(30); // tanpa 4 spasi dan 2 baris baru
		expect(c.readMin).toBe(1);
	});
	it('teks kosong semuanya nol, emoji dihitung satu karakter', () => {
		expect(countText('   ')).toMatchObject({ chars: 0, words: 0, readMin: 0 });
		expect(countText('a😀b').chars).toBe(3);
	});
});

describe('changeCase', () => {
	it('semua mode', () => {
		expect(changeCase('Halo Dunia', 'upper')).toBe('HALO DUNIA');
		expect(changeCase('Halo Dunia', 'lower')).toBe('halo dunia');
		expect(changeCase('belajar dan bermain di sekolah', 'title')).toBe('Belajar dan Bermain di Sekolah');
		expect(changeCase('ini kalimat. ini lagi! dan ini?\nbaris baru', 'sentence')).toBe('Ini kalimat. Ini lagi! Dan ini?\nBaris baru');
		expect(changeCase('aBc', 'toggle')).toBe('AbC');
	});
});

describe('tidyLines', () => {
	const base = { trimLines: false, collapseSpaces: false, removeBlank: false, dedupe: false, sort: 'none' as const, reverse: false };
	it('merapikan spasi, baris kosong, dan baris ganda dengan urutan pertama dipertahankan', () => {
		expect(tidyLines('  b  b \n\n a\nb b\n a', { ...base, trimLines: true, collapseSpaces: true, removeBlank: true, dedupe: true })).toBe('b b\na');
	});
	it('mengurutkan secara alami (angka) dan membalik', () => {
		expect(tidyLines('b10\nb2\na', { ...base, sort: 'asc' })).toBe('a\nb2\nb10');
		expect(tidyLines('b10\nb2\na', { ...base, sort: 'desc' })).toBe('b10\nb2\na');
		expect(tidyLines('1\n2\n3', { ...base, reverse: true })).toBe('3\n2\n1');
	});
});

describe('base64 dan url', () => {
	it('bolak-balik termasuk huruf bukan latin', () => {
		for (const s of ['Halo dunia', 'Ünïcödé 日本語 😀', '', 'a']) expect(base64Decode(base64Encode(s))).toBe(s);
		expect(base64Encode('Halo')).toBe('SGFsbw==');
		expect(base64Encode('??>>', true)).toBe('Pz8-Pg');
		expect(base64Decode('Pz8-Pg')).toBe('??>>');
	});
	it('masukan tidak sah menghasilkan null, bukan galat', () => {
		expect(base64Decode('***')).toBeNull();
		expect(base64Decode('A')).toBeNull();
		expect(base64Decode('/w==')).toBeNull(); // byte 0xFF bukan UTF-8
	});
	it('url', () => {
		expect(urlEncode('a b&c=ü')).toBe('a%20b%26c%3D%C3%BC');
		expect(urlDecode('a%20b+c')).toBe('a b c');
		expect(urlDecode('%E0%A4%A')).toBeNull();
	});
});

describe('hash, waktu, uuid', () => {
	it('SHA-256 dan SHA-1 dari "abc" cocok dengan nilai baku', async () => {
		expect(await hashText('abc', 'SHA-256')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
		expect(await hashText('abc', 'SHA-1')).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
	});
	it('waktu: detik, milidetik, dan tanggal', () => {
		expect(parseTime('0')).toEqual({ seconds: 0, millis: 0, iso: '1970-01-01T00:00:00.000Z' });
		expect(parseTime('1700000000')?.iso).toBe('2023-11-14T22:13:20.000Z');
		expect(parseTime('1700000000000')?.seconds).toBe(1700000000);
		expect(parseTime('2023-11-14T22:13:20Z')?.millis).toBe(1700000000000);
		expect(parseTime('bukan waktu')).toBeNull();
		expect(parseTime('')).toBeNull();
	});
	it('uuid unik dan jumlahnya dibatasi', () => {
		const list = uuids(5);
		expect(new Set(list).size).toBe(5);
		expect(list[0]).toMatch(/^[0-9a-f-]{36}$/);
		expect(uuids(1000)).toHaveLength(50);
		expect(uuids(0)).toHaveLength(1);
	});
});
