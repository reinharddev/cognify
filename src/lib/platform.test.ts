import { describe, expect, it } from 'vitest';
import { detectMobile } from './platform';

describe('detectMobile', () => {
	it('mengenali iPhone dan Android', () => {
		expect(detectMobile('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 5)).toBe(true);
		expect(detectMobile('Mozilla/5.0 (Linux; Android 14; Pixel Tablet)', 5)).toBe(true);
	});
	it('mengenali iPad yang menyamar sebagai Mac lewat titik sentuh', () => {
		expect(detectMobile('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)).toBe(true);
	});
	it('Mac biasa tetap desktop', () => {
		expect(detectMobile('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0)).toBe(false);
		expect(detectMobile('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 0)).toBe(false);
	});
});
