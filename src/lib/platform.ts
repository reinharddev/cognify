/**
 * Deteksi perangkat sentuh (iPad, iPhone, tablet Android). Cognify di sana berjalan tanpa
 * program luar (ffmpeg, yt-dlp, LibreOffice), tanpa menu bar, dan tanpa ekstensi browser.
 * iPadOS melaporkan dirinya "Macintosh", jadi titik sentuh ikut diperiksa.
 */
export function detectMobile(ua: string, touchPoints: number): boolean {
	if (/iPhone|iPad|iPod|Android/i.test(ua)) return true;
	return /Macintosh/i.test(ua) && touchPoints > 1;
}

export const isMobile: boolean =
	typeof navigator !== 'undefined' && detectMobile(navigator.userAgent, navigator.maxTouchPoints ?? 0);
