import {
	Video,
	Music,
	Image,
	Minimize2,
	Scissors,
	FileText,
	Merge,
	Split,
	Download,
	Files,
	Braces,
	QrCode,
	Presentation,
	Images,
	LayoutGrid,
	CaseSensitive,
	Globe,
	Film
} from '@lucide/svelte';
import type { ToolManifest } from './types';

const convert = () => import('./convert/ConvertTool.svelte');

const all: ToolManifest[] = [
	// Ready
	{
		id: 'video-convert',
		category: 'video',
		icon: Video,
		name: { id: 'Konversi Video', en: 'Convert Video' },
		description: {
			id: 'Ubah video ke MP4, MKV, WebM, atau GIF.',
			en: 'Turn videos into MP4, MKV, WebM or GIF.'
		},
		keywords: ['mp4', 'mkv', 'webm', 'gif', 'ubah', 'convert', 'ganti format', 'mov', 'avi'],
		status: 'ready',
		load: convert,
		props: { kind: 'video' }
	},
	{
		id: 'audio-convert',
		category: 'audio',
		icon: Music,
		name: { id: 'Konversi Audio', en: 'Convert Audio' },
		description: {
			id: 'Ubah audio atau ambil suara dari video: MP3, M4A, WAV, FLAC.',
			en: 'Convert audio or pull the sound out of a video: MP3, M4A, WAV, FLAC.'
		},
		keywords: ['mp3', 'm4a', 'wav', 'flac', 'jadikan mp3', 'ekstrak audio', 'extract audio', 'suara'],
		status: 'ready',
		load: convert,
		props: { kind: 'audio' }
	},
	{
		id: 'image-convert',
		category: 'image',
		icon: Image,
		name: { id: 'Konversi Gambar', en: 'Convert Images' },
		description: {
			id: 'Ubah gambar ke JPG, PNG, atau WebP, banyak file sekaligus.',
			en: 'Turn images into JPG, PNG or WebP, many at once.'
		},
		keywords: ['jpg', 'jpeg', 'png', 'webp', 'foto', 'photo', 'ubah', 'convert'],
		status: 'ready',
		load: convert,
		props: { kind: 'image' }
	},

	// Planned (shown dimmed so the roadmap is visible)
	{
		id: 'video-compress',
		category: 'video',
		icon: Minimize2,
		name: { id: 'Kompres Video', en: 'Compress Video' },
		description: { id: 'Kecilkan ukuran video sampai target tertentu.', en: 'Shrink a video to a target size.' },
		keywords: ['kecilkan', 'compress', 'ukuran', 'whatsapp', 'shrink', 'email', 'target', 'mb'],
		status: 'ready',
		load: () => import('./media/CompressVideo.svelte')
	},
	{
		id: 'video-trim',
		category: 'video',
		icon: Scissors,
		name: { id: 'Potong & Gabung Video', en: 'Trim & Join Video' },
		description: { id: 'Potong bagian video atau gabungkan beberapa klip.', en: 'Cut a section or join several clips.' },
		keywords: ['trim', 'potong', 'gabung', 'merge', 'cut', 'join', 'sambung', 'klip', 'clip'],
		status: 'ready',
		load: () => import('./media/TrimJoin.svelte')
	},
	{
		id: 'video-editor',
		category: 'video',
		icon: Film,
		name: { id: 'Editor Video Sederhana', en: 'Simple Video Editor' },
		description: { id: 'Potong klip, sambung beberapa video, tambah musik dari MP3, lalu ekspor.', en: 'Cut clips, join several videos, add music from an MP3, then export.' },
		keywords: ['edit', 'editor', 'potong', 'cut', 'trim', 'gabung', 'sambung', 'join', 'musik', 'music', 'mp3', 'audio', 'tambah suara', 'add audio', 'ekspor', 'export', 'video editor', 'klip'],
		status: 'ready',
		load: () => import('./media/VideoEditor.svelte')
	},
	{
		id: 'image-compress',
		category: 'image',
		icon: Minimize2,
		name: { id: 'Kompres & Resize Gambar', en: 'Compress & Resize Images' },
		description: { id: 'Kecilkan ukuran dan dimensi gambar.', en: 'Reduce image size and dimensions.' },
		keywords: ['kecilkan', 'resize', 'compress', 'ukuran', 'foto', 'photo', 'perkecil', 'exif'],
		status: 'ready',
		load: () => import('./media/CompressImage.svelte')
	},
	{
		id: 'pdf-merge',
		category: 'pdf',
		icon: Merge,
		name: { id: 'Gabung PDF', en: 'Merge PDF' },
		description: { id: 'Satukan beberapa PDF jadi satu.', en: 'Combine several PDFs into one.' },
		keywords: ['gabung', 'merge', 'satukan', 'combine'],
		status: 'ready',
		load: () => import('./pdf/MergePdf.svelte')
	},
	{
		id: 'pdf-split',
		category: 'pdf',
		icon: Split,
		name: { id: 'Pisah PDF', en: 'Split PDF' },
		description: { id: 'Ambil halaman tertentu dari PDF.', en: 'Extract pages from a PDF.' },
		keywords: ['pisah', 'split', 'ekstrak', 'halaman', 'extract'],
		status: 'ready',
		load: () => import('./pdf/SplitPdf.svelte')
	},
	{
		id: 'pdf-compress',
		category: 'pdf',
		icon: FileText,
		name: { id: 'Kompres PDF', en: 'Compress PDF' },
		description: { id: 'Kecilkan ukuran file PDF.', en: 'Reduce PDF file size.' },
		keywords: ['kecilkan', 'compress', 'ukuran', 'shrink', 'perkecil', 'reduce'],
		status: 'ready',
		load: () => import('./pdf/CompressPdf.svelte')
	},
	{
		id: 'office-to-pdf',
		category: 'pdf',
		icon: Presentation,
		name: { id: 'Dokumen ke PDF', en: 'Documents to PDF' },
		description: {
			id: 'Ubah PPTX, DOCX, XLSX, dan dokumen sejenisnya menjadi PDF (memakai LibreOffice).',
			en: 'Turn PPTX, DOCX, XLSX and similar documents into PDF (uses LibreOffice).'
		},
		keywords: ['pptx', 'powerpoint', 'ppt', 'docx', 'word', 'xlsx', 'excel', 'odp', 'odt', 'slide', 'presentasi', 'presentation', 'dokumen', 'ke pdf', 'to pdf', 'libreoffice'],
		status: 'ready',
		load: () => import('./pdf/OfficeToPdf.svelte')
	},
	{
		id: 'web-to-pdf',
		category: 'pdf',
		icon: Globe,
		name: { id: 'Web ke PDF', en: 'Web to PDF' },
		description: { id: 'Simpan halaman web sebagai PDF yang teksnya bisa dipilih.', en: 'Save a web page as a PDF with selectable text.' },
		keywords: ['web', 'halaman web', 'website', 'situs', 'url', 'artikel', 'cetak', 'print', 'simpan halaman', 'save page', 'web to pdf', 'html'],
		status: 'ready',
		load: () => import('./pdf/WebToPdf.svelte')
	},
	{
		id: 'image-to-pdf',
		category: 'pdf',
		icon: Images,
		name: { id: 'Gambar ke PDF', en: 'Images to PDF' },
		description: { id: 'Gabungkan foto atau hasil pindai jadi satu PDF.', en: 'Combine photos or scans into one PDF.' },
		keywords: ['gambar', 'foto', 'jpg', 'png', 'pindai', 'scan', 'image', 'photo', 'images to pdf', 'jpg ke pdf', 'png ke pdf'],
		status: 'ready',
		load: () => import('./pdf/ImagesToPdf.svelte')
	},
	{
		id: 'pdf-organize',
		category: 'pdf',
		icon: LayoutGrid,
		name: { id: 'Atur Halaman PDF', en: 'Organize PDF pages' },
		description: { id: 'Hapus, putar, urutkan halaman PDF, atau ambil teksnya.', en: 'Delete, rotate and reorder PDF pages, or extract the text.' },
		keywords: ['atur', 'urutkan', 'putar', 'hapus halaman', 'rotate', 'reorder', 'delete pages', 'organize', 'teks', 'text', 'extract text', 'pdf ke teks'],
		status: 'ready',
		load: () => import('./pdf/PdfOrganize.svelte')
	},
	{
		id: 'text-tools',
		category: 'developer',
		icon: CaseSensitive,
		name: { id: 'Alat Teks & Kode', en: 'Text & Code tools' },
		description: { id: 'Hitung kata, ubah huruf, rapikan baris, Base64, URL, hash, waktu, UUID.', en: 'Count words, change case, tidy lines, Base64, URL, hash, time, UUID.' },
		keywords: ['hitung kata', 'word count', 'huruf besar', 'uppercase', 'lowercase', 'base64', 'url encode', 'hash', 'sha256', 'timestamp', 'unix', 'uuid', 'baris ganda', 'duplicate lines', 'sort'],
		status: 'ready',
		load: () => import('./dev/TextTools.svelte')
	},
	{
		id: 'bulk-rename',
		category: 'document',
		icon: Files,
		name: { id: 'Rename Massal', en: 'Bulk Rename' },
		description: { id: 'Ganti nama banyak file sekaligus.', en: 'Rename many files at once.' },
		keywords: ['rename', 'ganti nama', 'massal', 'batch', 'nomor', 'numbering', 'regex', 'huruf'],
		status: 'ready',
		load: () => import('./files/BulkRename.svelte')
	},
	{
		id: 'media-download',
		category: 'download',
		icon: Download,
		name: { id: 'Unduh Media', en: 'Download Media' },
		description: { id: 'Unduh video atau audio dari tautan.', en: 'Download video or audio from a link.' },
		keywords: ['unduh', 'download', 'yt-dlp', 'link', 'tautan', 'video', 'audio', 'mp3', 'playlist'],
		status: 'ready',
		load: () => import('./media/MediaDownload.svelte')
	},
	{
		id: 'json-format',
		category: 'developer',
		icon: Braces,
		name: { id: 'Format JSON', en: 'JSON Formatter' },
		description: { id: 'Rapikan dan validasi JSON.', en: 'Prettify and validate JSON.' },
		keywords: ['json', 'format', 'rapikan', 'validate', 'minify', 'padatkan', 'prettify', 'validasi'],
		status: 'ready',
		load: () => import('./dev/JsonFormat.svelte')
	},
	{
		id: 'qr',
		category: 'developer',
		icon: QrCode,
		name: { id: 'QR Code', en: 'QR Code' },
		description: { id: 'Buat QR code dari teks atau tautan.', en: 'Generate a QR code from text or a link.' },
		keywords: ['qr', 'barcode', 'kode', 'wifi', 'scan', 'pindai', 'baca'],
		status: 'ready',
		load: () => import('./dev/QrTool.svelte')
	}
];

export const tools: ToolManifest[] = all.filter((t) => !t.hidden);

export function getTool(id: string): ToolManifest | undefined {
	return tools.find((t) => t.id === id);
}

export function searchTools(query: string, lang: 'id' | 'en'): ToolManifest[] {
	const q = query.trim().toLowerCase();
	if (!q) return tools;
	return tools.filter((tool) => {
		const haystack = [tool.name.id, tool.name.en, tool.description[lang], ...tool.keywords]
			.join(' ')
			.toLowerCase();
		return q.split(/\s+/).every((word) => haystack.includes(word));
	});
}
