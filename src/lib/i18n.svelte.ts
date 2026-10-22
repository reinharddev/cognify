import type { Category, Localized } from './tools/types';

export type Lang = 'id' | 'en';

const STORAGE_KEY = 'cognify.lang';

function initialLang(): Lang {
	try {
		const saved = localStorage.getItem(STORAGE_KEY);
		if (saved === 'id' || saved === 'en') return saved;
	} catch {}
	return 'id';
}

export const i18n = $state<{ lang: Lang }>({ lang: initialLang() });

export function setLang(lang: Lang) {
	i18n.lang = lang;
	try {
		localStorage.setItem(STORAGE_KEY, lang);
	} catch {}
}

export function loc(text: Localized): string {
	return text[i18n.lang];
}

const dict = {
	'search.placeholder': { id: 'Cari tool… (mis. "kecilkan pdf")', en: 'Search tools… (e.g. "compress pdf")' },
	'search.empty': { id: 'Tidak ada tool yang cocok', en: 'No matching tools' },
	'search.hint': { id: 'Tekan Ctrl/⌘ + K di mana saja', en: 'Press Ctrl/⌘ + K anywhere' },
	'home.title': { id: 'Mau ngapain hari ini?', en: 'What do you want to do today?' },
	'home.subtitle': {
		id: 'Semua diproses di komputermu. Tanpa upload, tanpa iklan, tanpa batas.',
		en: 'Everything runs on your computer. No uploads, no ads, no limits.'
	},
	'home.ready': { id: 'Siap dipakai', en: 'Ready to use' },
	'home.soon': { id: 'Segera hadir', en: 'Coming soon' },
	'badge.soon': { id: 'Segera', en: 'Soon' },
	'tool.notfound': { id: 'Tool tidak ditemukan', en: 'Tool not found' },
	'tool.soon': { id: 'Tool ini belum tersedia.', en: 'This tool is not available yet.' },
	'convert.drop': { id: 'Seret file ke sini, atau', en: 'Drop files here, or' },
	'convert.choose': { id: 'Pilih file', en: 'Choose files' },
	'convert.format': { id: 'Format hasil', en: 'Output format' },
	'convert.folder': { id: 'Simpan ke', en: 'Save to' },
	'convert.sameFolder': { id: 'Folder yang sama dengan file asli', en: 'Same folder as the source' },
	'convert.pickFolder': { id: 'Pilih folder', en: 'Choose folder' },
	'convert.reset': { id: 'Pakai folder asli', en: 'Use source folder' },
	'convert.start': { id: 'Mulai konversi', en: 'Start converting' },
	'convert.cancel': { id: 'Batalkan', en: 'Cancel' },
	'convert.clear': { id: 'Kosongkan daftar', en: 'Clear list' },
	'convert.remove': { id: 'Hapus', en: 'Remove' },
	'convert.reveal': { id: 'Tampilkan', en: 'Show' },
	'convert.queued': { id: 'Menunggu', en: 'Queued' },
	'convert.running': { id: 'Memproses', en: 'Converting' },
	'convert.done': { id: 'Selesai', en: 'Done' },
	'convert.error': { id: 'Gagal', en: 'Failed' },
	'convert.cancelled': { id: 'Dibatalkan', en: 'Cancelled' },
	'pdf.drop': { id: 'Seret PDF ke sini, atau', en: 'Drop PDFs here, or' },
	'pdf.choose': { id: 'Pilih PDF', en: 'Choose PDFs' },
	'pdf.chooseOne': { id: 'Pilih satu PDF', en: 'Choose a PDF' },
	'pdf.dropOne': { id: 'Seret satu PDF ke sini, atau', en: 'Drop a PDF here, or' },
	'pdf.pages': { id: 'halaman', en: 'pages' },
	'pdf.reading': { id: 'Membaca…', en: 'Reading…' },
	'pdf.working': { id: 'Memproses…', en: 'Working…' },
	'pdf.moveUp': { id: 'Naikkan', en: 'Move up' },
	'pdf.moveDown': { id: 'Turunkan', en: 'Move down' },
	'pdf.limits': {
		id: 'PDF yang diberi password belum didukung. Bookmark tidak ikut tergabung.',
		en: 'Password-protected PDFs are not supported yet. Bookmarks are not carried over.'
	},
	'pdf.merge.hint': {
		id: 'Urutan di daftar sama dengan urutan di hasil.',
		en: 'The order in the list is the order in the result.'
	},
	'pdf.merge.start': { id: 'Gabungkan', en: 'Merge' },
	'pdf.merge.need': { id: 'Tambahkan minimal 2 PDF.', en: 'Add at least 2 PDFs.' },
	'pdf.merge.done': { id: 'Berhasil digabung', en: 'Merged successfully' },
	'pdf.split.ranges': { id: 'Halaman yang diambil', en: 'Pages to extract' },
	'pdf.split.placeholder': { id: 'mis. 1-3, 5, 8-', en: 'e.g. 1-3, 5, 8-' },
	'pdf.split.hint': {
		id: 'Pisahkan dengan koma. "8-" berarti sampai halaman terakhir. Urutan halaman tetap seperti aslinya.',
		en: 'Separate with commas. "8-" means through the last page. Pages keep their original order.'
	},
	'pdf.split.mode': { id: 'Hasil', en: 'Output' },
	'pdf.split.single': { id: 'Satu file', en: 'One file' },
	'pdf.split.perRange': { id: 'Satu file per rentang', en: 'One file per range' },
	'pdf.split.all': { id: 'Setiap halaman jadi file sendiri', en: 'Every page as its own file' },
	'pdf.split.start': { id: 'Pisahkan', en: 'Split' },
	'pdf.split.done': { id: 'File dihasilkan', en: 'Files created' },
	'pdf.replace': { id: 'Ganti file', en: 'Change file' },
	'compress.level': { id: 'Tingkat kompresi', en: 'Compression level' },
	'compress.lossless': { id: 'Tanpa kehilangan', en: 'Lossless' },
	'compress.lossless.desc': {
		id: 'Aman: hanya merapikan struktur file, gambar tidak diubah sama sekali. Penghematan biasanya kecil (sekitar 3-10%).',
		en: 'Safe: only tidies the file structure, images are not touched at all. Savings are usually small (about 3-10%).'
	},
	'compress.balanced': { id: 'Seimbang', en: 'Balanced' },
	'compress.balanced.desc': {
		id: 'Gambar dibatasi maks. 2000 px dan kualitas JPEG 75. Di layar biasanya tidak terlihat bedanya.',
		en: 'Images capped at 2000 px and JPEG quality 75. Usually indistinguishable on screen.'
	},
	'compress.strong': { id: 'Maksimal', en: 'Maximum' },
	'compress.strong.desc': {
		id: 'Maks. 1400 px dan kualitas JPEG 55. Paling kecil, tapi foto bisa terlihat agak buram saat di-zoom atau dicetak.',
		en: 'Max 1400 px and JPEG quality 55. Smallest, but photos can look slightly soft when zoomed or printed.'
	},
	'compress.scope': {
		id: 'Hanya gambar yang diproses. Teks, font, dan gambar vektor tidak pernah diubah. PDF yang isinya kebanyakan teks hampir tidak akan mengecil.',
		en: 'Only images are processed. Text, fonts and vector drawings are never changed. A mostly-text PDF will barely shrink.'
	},
	'compress.start': { id: 'Kompres', en: 'Compress' },
	'compress.saved': { id: 'hemat', en: 'saved' },
	'compress.nochange': { id: 'Tidak bisa lebih kecil, file tidak dibuat', en: 'Cannot get smaller, no file created' },
	'compress.noImages': {
		id: 'Tidak ada gambar yang cocok dikompres di PDF ini.',
		en: 'No image in this PDF was suitable for compression.'
	},
	'compress.images': { id: 'gambar diproses', en: 'images processed' },
	'img.drop': { id: 'Seret gambar ke sini, atau', en: 'Drop images here, or' },
	'img.format.same': { id: 'Sama seperti asli', en: 'Same as original' },
	'img.quality': { id: 'Kualitas', en: 'Quality' },
	'img.quality.png': {
		id: 'PNG selalu lossless, jadi kualitas tidak berpengaruh. Hemat hanya dari memperkecil ukuran, atau pilih JPG/WebP.',
		en: 'PNG is always lossless, so quality has no effect. Savings only come from resizing, or pick JPG/WebP.'
	},
	'img.maxside': { id: 'Ukuran maksimal (sisi terpanjang)', en: 'Maximum size (longest side)' },
	'img.original': { id: 'Asli', en: 'Original' },
	'img.strip': {
		id: 'Hapus metadata (EXIF, termasuk lokasi GPS)',
		en: 'Remove metadata (EXIF, including GPS location)'
	},
	'img.hint': {
		id: 'Gambar tidak pernah diperbesar. Jika hasil berformat JPG, bagian transparan diisi putih. Jika hasilnya tidak lebih kecil, file tidak dibuat.',
		en: 'Images are never enlarged. If the result is JPG, transparent areas become white. If the result is not smaller, no file is created.'
	},
	'vid.drop': { id: 'Seret video ke sini, atau', en: 'Drop videos here, or' },
	'vid.target': { id: 'Ukuran target per video', en: 'Target size per video' },
	'vid.custom': { id: 'Lainnya', en: 'Custom' },
	'vid.hint': {
		id: 'Batas umum: WhatsApp sekitar 16 MB, email sekitar 25 MB. Dikompres dua tahap agar ukurannya mendekati target; sekitar dua kali lebih lama dari satu tahap.',
		en: 'Common limits: WhatsApp about 16 MB, email about 25 MB. Encoded in two passes so the size lands close to the target; about twice as slow as one pass.'
	},
	'vid.resolution': { id: 'Resolusi (sisi terpendek)', en: 'Resolution (shorter side)' },
	'vid.auto': { id: 'Otomatis (disarankan)', en: 'Automatic (recommended)' },
	'vid.original': { id: 'Asli', en: 'Original' },
	'vid.resolution.hint': {
		id: 'Ukuran kecil dengan resolusi tinggi membuat gambar pecah. Otomatis menurunkan resolusi secukupnya agar gambar tetap bersih; resolusi tidak pernah dinaikkan.',
		en: 'A small size at high resolution looks blocky. Automatic lowers the resolution just enough to stay clean; it never upscales.'
	},
	'vid.plan.duration': { id: 'Durasi', en: 'Length' },
	'vid.plan.video': { id: 'video', en: 'video' },
	'vid.plan.audio': { id: 'audio', en: 'audio' },
	'vid.plan.res': { id: 'resolusi', en: 'resolution' },
	'vid.plan.keep': { id: 'tetap', en: 'unchanged' },
	'vid.plan.toosmall': {
		id: 'Target terlalu kecil untuk video ini. Minimal sekitar',
		en: 'Target is too small for this video. At least about'
	},
	'vid.plan.already': {
		id: 'Sudah lebih kecil dari target, tidak perlu dikompres.',
		en: 'Already smaller than the target, no need to compress.'
	},
	'vid.notSmaller': { id: 'Hasil tidak lebih kecil, file tidak dibuat', en: 'Result was not smaller, no file created' },
	'vid.ofTarget': { id: 'dari target', en: 'of target' },
	'tj.tab.trim': { id: 'Potong', en: 'Trim' },
	'tj.tab.join': { id: 'Gabung', en: 'Join' },
	'tj.drop1': { id: 'Seret satu video ke sini, atau', en: 'Drop one video here, or' },
	'tj.pick1': { id: 'Pilih video', en: 'Choose a video' },
	'tj.start': { id: 'Mulai', en: 'Start' },
	'tj.end': { id: 'Selesai', en: 'End' },
	'tj.timeHint': { id: 'Format: 90, 1:30, atau 0:01:30.5', en: 'Format: 90, 1:30, or 0:01:30.5' },
	'tj.invalidTime': { id: 'Format waktu tidak dikenali', en: 'Time format not recognised' },
	'tj.outOfRange': { id: 'Rentang di luar durasi video', en: 'Range is outside the video' },
	'tj.length': { id: 'Panjang potongan', en: 'Clip length' },
	'tj.mode': { id: 'Cara memotong', en: 'How to cut' },
	'tj.fast': { id: 'Cepat', en: 'Fast' },
	'tj.fast.desc': {
		id: 'Tanpa encode ulang: instan dan kualitas tidak turun. Tapi potongan dimulai dari keyframe terdekat sebelum waktu awal, jadi hasilnya bisa lebih panjang beberapa detik.',
		en: 'No re-encoding: instant and no quality loss. But the clip starts at the nearest keyframe before your start time, so it can run a few seconds longer.'
	},
	'tj.precise': { id: 'Presisi', en: 'Precise' },
	'tj.precise.desc': {
		id: 'Encode ulang: tepat sampai ke frame, tapi lebih lama dan kualitas turun sedikit (H.264, MP4).',
		en: 'Re-encodes: frame-accurate, but slower and slightly lossy (H.264, MP4).'
	},
	'tj.cut': { id: 'Potong', en: 'Cut' },
	'tj.frameStart': { id: 'Frame awal', en: 'Start frame' },
	'tj.frameEnd': { id: 'Frame akhir', en: 'End frame' },
	'tj.noFrame': { id: 'Tidak ada pratinjau', en: 'No preview' },
	'tj.asked': { id: 'diminta', en: 'asked' },
	'tj.got': { id: 'hasil', en: 'got' },
	'tj.join.copy': {
		id: 'Semua klip cocok, jadi digabung tanpa encode ulang: instan dan kualitas tidak turun.',
		en: 'All clips match, so they are joined without re-encoding: instant and no quality loss.'
	},
	'tj.join.reencode': {
		id: 'Klip berbeda pada:',
		en: 'Clips differ in:'
	},
	'tj.join.reencode2': {
		id: 'Akan di-encode ulang ke ukuran dan frame rate klip pertama (letterbox jika rasio berbeda). Lebih lama dan kualitas turun sedikit.',
		en: 'They will be re-encoded to the first clip’s size and frame rate (letterboxed if the aspect differs). Slower and slightly lossy.'
	},
	'tj.reason.videoCodec': { id: 'codec video', en: 'video codec' },
	'tj.reason.resolution': { id: 'resolusi', en: 'resolution' },
	'tj.reason.pixFmt': { id: 'format piksel', en: 'pixel format' },
	'tj.reason.fps': { id: 'frame rate', en: 'frame rate' },
	'tj.reason.audioMissing': { id: 'ada yang tanpa audio', en: 'some have no audio' },
	'tj.reason.audio': { id: 'format audio', en: 'audio format' },
	'tj.join.start': { id: 'Gabungkan', en: 'Join' },
	'tj.join.need': { id: 'Tambahkan minimal 2 video.', en: 'Add at least 2 videos.' },
	'tj.join.done': { id: 'Berhasil digabung', en: 'Joined successfully' },
	'tj.trim.done': { id: 'Berhasil dipotong', en: 'Trimmed successfully' },
	'tj.method.copy': { id: 'tanpa encode ulang', en: 'no re-encode' },
	'tj.method.reencode': { id: 'dengan encode ulang', en: 're-encoded' },
	'json.input': { id: 'JSON masukan', en: 'JSON input' },
	'json.output': { id: 'Hasil', en: 'Result' },
	'json.mode.pretty': { id: 'Rapikan', en: 'Prettify' },
	'json.mode.minify': { id: 'Padatkan', en: 'Minify' },
	'json.indent': { id: 'Indentasi', en: 'Indent' },
	'json.tab': { id: 'Tab', en: 'Tab' },
	'json.sort': { id: 'Urutkan kunci A-Z', en: 'Sort keys A-Z' },
	'json.open': { id: 'Buka file', en: 'Open file' },
	'json.save': { id: 'Simpan', en: 'Save' },
	'json.copy': { id: 'Salin', en: 'Copy' },
	'json.copied': { id: 'Tersalin', en: 'Copied' },
	'json.clear': { id: 'Kosongkan', en: 'Clear' },
	'json.valid': { id: 'JSON valid', en: 'Valid JSON' },
	'json.placeholder': { id: 'Tempel atau ketik JSON di sini…', en: 'Paste or type JSON here…' },
	'json.at': { id: 'Baris', en: 'Line' },
	'json.col': { id: 'kolom', en: 'column' },
	'json.keepNote': {
		id: 'Angka besar, urutan kunci, dan teks string tidak diubah (kecuali kamu memilih urutkan kunci).',
		en: 'Big numbers, key order and string text are left as written (unless you sort keys).'
	},
	'json.err.empty': { id: 'Belum ada JSON', en: 'No JSON yet' },
	'json.err.unexpectedEnd': {
		id: 'JSON berakhir sebelum selesai (ada kurung atau tanda kutip yang belum ditutup)',
		en: 'JSON ended too early (an unclosed bracket or quote)'
	},
	'json.err.unexpectedChar': { id: 'Karakter tidak terduga', en: 'Unexpected character' },
	'json.err.expectedValue': {
		id: 'Diharapkan sebuah nilai (string, angka, true, false, null, objek, atau array)',
		en: 'Expected a value (string, number, true, false, null, object or array)'
	},
	'json.err.expectedKey': {
		id: 'Diharapkan nama kunci dalam tanda kutip ganda (koma di akhir tidak diperbolehkan)',
		en: 'Expected a key in double quotes (a trailing comma is not allowed)'
	},
	'json.err.expectedColon': { id: "Diharapkan ':' setelah nama kunci", en: "Expected ':' after the key" },
	'json.err.expectedCommaOrEnd': {
		id: "Diharapkan ',' atau penutup (} atau ])",
		en: "Expected ',' or a closing } or ]"
	},
	'json.err.badString': { id: 'String tidak ditutup', en: 'Unterminated string' },
	'json.err.badEscape': { id: 'Escape tidak valid di dalam string', en: 'Invalid escape inside a string' },
	'json.err.controlChar': {
		id: 'Karakter kontrol (mis. Tab atau Enter) harus ditulis sebagai escape di dalam string',
		en: 'Control characters (such as Tab or Enter) must be escaped inside a string'
	},
	'json.err.badNumber': { id: 'Angka tidak valid', en: 'Invalid number' },
	'json.err.trailingData': { id: 'Ada teks tambahan setelah JSON selesai', en: 'Extra text after the JSON ended' },
	'json.err.tooDeep': { id: 'Terlalu dalam bersarang (maksimal 512 tingkat)', en: 'Nested too deeply (512 levels max)' },
	'qr.tab.create': { id: 'Buat', en: 'Create' },
	'qr.tab.read': { id: 'Baca', en: 'Read' },
	'qr.type.text': { id: 'Teks / tautan', en: 'Text / link' },
	'qr.type.wifi': { id: 'Wi-Fi', en: 'Wi-Fi' },
	'qr.text': { id: 'Isi QR code', en: 'QR code content' },
	'qr.text.ph': { id: 'Ketik teks atau tempel tautan…', en: 'Type text or paste a link…' },
	'qr.wifi.ssid': { id: 'Nama jaringan (SSID)', en: 'Network name (SSID)' },
	'qr.wifi.pass': { id: 'Kata sandi', en: 'Password' },
	'qr.wifi.sec': { id: 'Keamanan', en: 'Security' },
	'qr.wifi.open': { id: 'Terbuka (tanpa sandi)', en: 'Open (no password)' },
	'qr.wifi.hidden': { id: 'Jaringan tersembunyi', en: 'Hidden network' },
	'qr.ecc': { id: 'Koreksi kesalahan', en: 'Error correction' },
	'qr.ecc.hint': {
		id: 'Lebih tinggi = tetap terbaca meski sebagian rusak atau tertutup, tapi kodenya lebih padat.',
		en: 'Higher = still readable when partly damaged or covered, but the code gets denser.'
	},
	'qr.size': { id: 'Ukuran gambar', en: 'Image size' },
	'qr.margin': { id: 'Margin', en: 'Margin' },
	'qr.fg': { id: 'Warna kode', en: 'Code colour' },
	'qr.bg': { id: 'Warna latar', en: 'Background' },
	'qr.problem.inverted': {
		id: 'Kode lebih terang dari latarnya. Banyak pemindai gagal membaca yang seperti ini.',
		en: 'The code is lighter than its background. Many scanners cannot read that.'
	},
	'qr.problem.lowContrast': {
		id: 'Kontras rendah, kode mungkin sulit dipindai.',
		en: 'Low contrast, the code may be hard to scan.'
	},
	'qr.tooLong': {
		id: 'Teks terlalu panjang untuk QR code pada tingkat koreksi ini. Pendekkan teks atau turunkan koreksi kesalahan.',
		en: 'This text is too long for a QR code at this error correction level. Shorten it or lower the correction.'
	},
	'qr.empty': { id: 'Isi sesuatu untuk membuat QR code.', en: 'Enter something to create a QR code.' },
	'qr.save.png': { id: 'Simpan PNG', en: 'Save PNG' },
	'qr.save.svg': { id: 'Simpan SVG', en: 'Save SVG' },
	'qr.actual': { id: 'PNG akan berukuran', en: 'PNG will be' },
	'qr.read.drop': {
		id: 'Seret gambar berisi QR code ke sini, tempel (Ctrl/⌘+V), atau',
		en: 'Drop an image with a QR code here, paste (Ctrl/⌘+V), or'
	},
	'qr.read.choose': { id: 'Pilih gambar', en: 'Choose an image' },
	'qr.read.result': { id: 'Isi QR code', en: 'QR code content' },
	'qr.read.none': {
		id: 'Tidak ada QR code yang terbaca di gambar ini. Coba gambar yang lebih tajam, atau potong hingga hanya QR-nya.',
		en: 'No QR code could be read in this image. Try a sharper image, or crop it to just the code.'
	},
	'qr.read.bad': { id: 'Gambar tidak bisa dibuka', en: 'The image could not be opened' },
	'rn.drop': { id: 'Seret file ke sini, atau', en: 'Drop files here, or' },
	'rn.sort': { id: 'Urutan', en: 'Order' },
	'rn.sort.picked': { id: 'Sesuai pilihan', en: 'As picked' },
	'rn.sort.name': { id: 'Nama A-Z', en: 'Name A-Z' },
	'rn.sort.date': { id: 'Tanggal diubah', en: 'Date modified' },
	'rn.find': { id: 'Cari', en: 'Find' },
	'rn.replace': { id: 'Ganti dengan', en: 'Replace with' },
	'rn.regex': { id: 'Regex', en: 'Regex' },
	'rn.matchCase': { id: 'Bedakan huruf besar/kecil', en: 'Match case' },
	'rn.scope': { id: 'Cari di', en: 'Search in' },
	'rn.scope.stem': { id: 'Nama saja (tanpa ekstensi)', en: 'Name only (no extension)' },
	'rn.scope.full': { id: 'Seluruh nama file', en: 'Whole file name' },
	'rn.template': { id: 'Pola nama baru', en: 'New name pattern' },
	'rn.template.hint': {
		id: '{name} = nama (setelah diganti), {n} = nomor urut, {date} = tanggal file diubah (YYYY-MM-DD)',
		en: '{name} = name (after replacing), {n} = counter, {date} = date modified (YYYY-MM-DD)'
	},
	'rn.start': { id: 'Mulai dari', en: 'Start at' },
	'rn.step': { id: 'Selisih', en: 'Step' },
	'rn.pad': { id: 'Jumlah digit', en: 'Digits' },
	'rn.spaces': { id: 'Spasi jadi', en: 'Spaces become' },
	'rn.spaces.keep': { id: 'Biarkan', en: 'Keep' },
	'rn.strip': { id: 'Hapus karakter khusus', en: 'Remove special characters' },
	'rn.case': { id: 'Huruf', en: 'Letter case' },
	'rn.case.keep': { id: 'Biarkan', en: 'Keep' },
	'rn.case.lower': { id: 'huruf kecil', en: 'lowercase' },
	'rn.case.upper': { id: 'HURUF BESAR', en: 'UPPERCASE' },
	'rn.case.title': { id: 'Awal Kata Kapital', en: 'Title Case' },
	'rn.ext': { id: 'Ekstensi', en: 'Extension' },
	'rn.reset': { id: 'Atur ulang aturan', en: 'Reset rules' },
	'rn.preview': { id: 'Pratinjau', en: 'Preview' },
	'rn.willChange': { id: 'file akan diganti namanya', en: 'files will be renamed' },
	'rn.unchanged': { id: 'tidak berubah', en: 'unchanged' },
	'rn.apply': { id: 'Ganti nama', en: 'Rename' },
	'rn.undo': { id: 'Batalkan', en: 'Undo' },
	'rn.done': { id: 'file berhasil diganti namanya', en: 'files renamed' },
	'rn.undone': { id: 'Dikembalikan ke nama semula', en: 'Restored the original names' },
	'rn.note': {
		id: 'File tidak pernah ditimpa. Jika satu saja gagal, seluruh perubahan dibatalkan.',
		en: 'Files are never overwritten. If one fails, the whole batch is rolled back.'
	},
	'rn.fail': { id: 'Gagal, tidak ada nama yang diubah:', en: 'Failed, no names were changed:' },
	'rn.err.missing': { id: 'File tidak ditemukan', en: 'File not found' },
	'rn.err.invalidName': {
		id: 'Nama tidak valid (kosong, karakter terlarang, atau diakhiri titik/spasi)',
		en: 'Invalid name (empty, forbidden character, or ends with a dot/space)'
	},
	'rn.err.tooLong': { id: 'Nama terlalu panjang (maks. 255 byte)', en: 'Name too long (255 bytes max)' },
	'rn.err.duplicate': { id: 'Nama sama dengan file lain di daftar', en: 'Same name as another file in the list' },
	'rn.err.exists': { id: 'Sudah ada file dengan nama ini di folder yang sama', en: 'A file with this name already exists in that folder' },
	'rn.err.regex': { id: 'Pola regex tidak valid', en: 'Invalid regex pattern' },
	'media.intro.title': { id: 'Sebelum memakai modul unduhan', en: 'Before you use the download module' },
	'media.intro.1': {
		id: 'Modul ini memakai yt-dlp (open source) untuk mengunduh video atau audio dari tautan yang kamu berikan.',
		en: 'This module uses yt-dlp (open source) to download video or audio from a link you give it.'
	},
	'media.intro.2': {
		id: 'Gunakan hanya untuk konten milikmu sendiri, berlisensi bebas, atau yang kamu punya izin mengunduhnya. Mengunduh dari beberapa situs, termasuk YouTube, dapat melanggar ketentuan layanan mereka. Kamu yang bertanggung jawab atas apa yang kamu unduh.',
		en: 'Use it only for your own content, freely licensed content, or content you have permission to download. Downloading from some sites, including YouTube, can violate their terms of service. You are responsible for what you download.'
	},
	'media.intro.3': {
		id: 'App ini tidak menembus DRM, login, atau pembatasan akses. Jika sebuah situs menolak, kamu akan melihat alasannya dan unduhan berhenti.',
		en: 'This app does not bypass DRM, logins or access restrictions. If a site refuses, you will see why and the download stops.'
	},
	'media.intro.4': {
		id: 'Modul ini mati sampai kamu mengaktifkannya, dan satu-satunya akses internet yang dilakukan adalah ke tautan yang kamu masukkan serta pemasangan engine.',
		en: 'The module is off until you turn it on, and the only network access is to the link you enter and the engine install.'
	},
	'media.ack': { id: 'Saya mengerti dan bertanggung jawab atas unduhan saya', en: 'I understand and take responsibility for my downloads' },
	'media.enable': { id: 'Aktifkan modul', en: 'Enable module' },
	'media.engine.title': { id: 'Engine yt-dlp', en: 'yt-dlp engine' },
	'media.engine.missing': {
		id: 'Engine belum terpasang. Ukurannya sekitar 36 MB, diunduh dari rilis resmi yt-dlp di GitHub dan diperiksa checksum-nya sebelum dipakai.',
		en: 'The engine is not installed. It is about 36 MB, downloaded from the official yt-dlp release on GitHub and checksum-verified before use.'
	},
	'media.engine.install': { id: 'Pasang engine', en: 'Install engine' },
	'media.engine.update': { id: 'Perbarui engine', en: 'Update engine' },
	'media.engine.remove': { id: 'Hapus engine', en: 'Remove engine' },
	'media.engine.version': { id: 'Versi', en: 'Version' },
	'media.engine.hint': {
		id: 'Situs sering berubah. Jika unduhan mulai gagal, perbarui engine dulu.',
		en: 'Sites change often. If downloads start failing, update the engine first.'
	},
	'media.engine.unsupported': { id: 'Engine ini belum tersedia untuk sistem operasimu.', en: 'This engine is not available for your system yet.' },
	'media.url': { id: 'Tautan', en: 'Link' },
	'media.url.ph': { id: 'Tempel tautan video atau audio…', en: 'Paste a video or audio link…' },
	'media.playlist': { id: 'Jika tautan berupa playlist, unduh semuanya', en: 'If the link is a playlist, download all of it' },
	'media.check': { id: 'Cek tautan', en: 'Check link' },
	'media.checking': { id: 'Memeriksa…', en: 'Checking…' },
	'media.mode.video': { id: 'Video', en: 'Video' },
	'media.mode.audio': { id: 'Audio saja', en: 'Audio only' },
	'media.quality': { id: 'Kualitas gambar', en: 'Picture quality' },
	'media.quality.best': { id: 'Terbaik yang tersedia', en: 'Best available' },
	'media.audioFormat': { id: 'Format audio', en: 'Audio format' },
	'media.folder.empty': { id: 'Folder Unduhan', en: 'Downloads folder' },
	'media.download': { id: 'Unduh', en: 'Download' },
	'media.downloading': { id: 'Mengunduh', en: 'Downloading' },
	'media.processing': { id: 'Memproses (menggabung/mengonversi)…', en: 'Processing (merging/converting)…' },
	'media.part': { id: 'bagian', en: 'part' },
	'media.done': { id: 'Selesai', en: 'Done' },
	'media.entries': { id: 'item di playlist', en: 'items in playlist' },
	'media.disable': { id: 'Matikan modul', en: 'Turn module off' },
	'media.err.engineMissing': { id: 'Engine yt-dlp belum terpasang.', en: 'The yt-dlp engine is not installed.' },
	'media.err.invalidUrl': { id: 'Tautan tidak valid. Harus diawali http:// atau https://.', en: 'Invalid link. It must start with http:// or https://.' },
	'media.err.botCheck': {
		id: 'Situs meminta bukti bahwa kamu bukan bot. Ini tidak bisa dilewati dari app ini. Coba lagi nanti, atau perbarui engine.',
		en: 'The site wants proof you are not a bot. This cannot be bypassed from this app. Try again later, or update the engine.'
	},
	'media.err.private': { id: 'Video ini privat.', en: 'This video is private.' },
	'media.err.unavailable': { id: 'Video tidak tersedia atau sudah dihapus.', en: 'The video is unavailable or has been removed.' },
	'media.err.forbidden': { id: 'Server menolak permintaan (403). Coba perbarui engine.', en: 'The server refused the request (403). Try updating the engine.' },
	'media.err.unsupported': { id: 'Situs atau tautan ini tidak didukung.', en: 'This site or link is not supported.' },
	'media.err.noFfmpeg': { id: 'ffmpeg tidak ditemukan, padahal dibutuhkan untuk menggabung atau mengonversi.', en: 'ffmpeg was not found but is needed to merge or convert.' },
	'media.err.network': { id: 'Koneksi internet bermasalah. Periksa jaringanmu.', en: 'Network problem. Check your connection.' },
	'media.err.ageGate': { id: 'Video ini dibatasi usia dan butuh login. Tidak bisa diunduh di sini.', en: 'This video is age-restricted and needs a login. It cannot be downloaded here.' },
	'media.err.members': { id: 'Konten khusus anggota. Tidak bisa diunduh di sini.', en: 'Members-only content. It cannot be downloaded here.' },
	'media.err.drm': { id: 'Konten dilindungi DRM dan tidak bisa diunduh.', en: 'This content is DRM-protected and cannot be downloaded.' },
	'media.err.timeout': { id: 'Terlalu lama tidak ada jawaban dari situs.', en: 'The site took too long to answer.' },
	'media.err.failed': { id: 'Gagal.', en: 'Failed.' },
	'office.drop': { id: 'Seret PPTX, DOCX, XLSX, atau dokumen lain ke sini, atau', en: 'Drop PPTX, DOCX, XLSX or other documents here, or' },
	'office.status.title': { id: 'LibreOffice', en: 'LibreOffice' },
	'office.status.found': { id: 'LibreOffice ditemukan, siap dipakai.', en: 'LibreOffice found and ready.' },
	'office.status.missing': {
		id: 'Konversi ini memakai LibreOffice (gratis dan open source), yang belum terpasang di komputermu. Pasang dulu, lalu tekan "Cek lagi". LibreOffice tidak dibawa di dalam app karena ukurannya ratusan MB.',
		en: 'This conversion uses LibreOffice (free and open source), which is not installed on your computer. Install it, then press "Check again". It is not bundled in the app because it is hundreds of MB.'
	},
	'office.install': { id: 'Pasang LibreOffice', en: 'Install LibreOffice' },
	'office.installing': { id: 'mengunduh dan memasang', en: 'downloading and installing' },
	'office.install.missing': {
		id: 'Konversi ini memakai LibreOffice (gratis dan open source), yang belum ada di komputermu. App bisa memasangkannya sendiri.',
		en: 'This conversion uses LibreOffice (free and open source), which is not on your computer yet. The app can install it for you.'
	},
	'office.install.note': {
		id: 'Diunduh dari situs resmi LibreOffice, diperiksa checksum-nya, lalu disimpan di folder data app ini. Tidak perlu password admin dan tidak menyentuh sistemmu; bisa dihapus kapan saja.',
		en: 'Downloaded from the official LibreOffice site, checksum-verified, then kept in this app\'s data folder. No admin password and nothing touches your system; you can remove it any time.'
	},
	'office.install.manual': { id: 'Pasang sendiri lewat situsnya', en: 'Install it yourself from the website' },
	'office.install.remove': { id: 'Hapus LibreOffice yang dipasang app', en: 'Remove the LibreOffice this app installed' },
	'office.status.open': { id: 'Buka halaman unduh LibreOffice', en: 'Open the LibreOffice download page' },
	'office.status.recheck': { id: 'Cek lagi', en: 'Check again' },
	'office.note': {
		id: 'Hasilnya mengikuti LibreOffice: slide dengan font khusus atau animasi rumit bisa tampil sedikit berbeda dari PowerPoint asli. Konversi pertama bisa lebih lama (sekitar setengah menit) karena LibreOffice menyiapkan dirinya. File tetap di komputermu.',
		en: 'The result follows LibreOffice: slides with special fonts or complex animations can look slightly different from real PowerPoint. The first conversion can take longer (about half a minute) while LibreOffice sets itself up. Your files stay on your computer.'
	},
	'office.start': { id: 'Ubah ke PDF', en: 'Convert to PDF' },
	'office.converting': { id: 'Mengonversi…', en: 'Converting…' },
	'office.pages': { id: 'halaman', en: 'pages' },
	'office.err.libreofficeMissing': { id: 'LibreOffice belum terpasang.', en: 'LibreOffice is not installed.' },
	'office.err.unsupported': { id: 'Jenis file ini tidak didukung.', en: 'This file type is not supported.' },
	'office.err.timeout': { id: 'Konversi terlalu lama dan dihentikan.', en: 'The conversion took too long and was stopped.' },
	'office.err.noOutput': {
		id: 'LibreOffice tidak menghasilkan PDF. File ini mungkin dilindungi password atau rusak.',
		en: 'LibreOffice produced no PDF. The file may be password-protected or damaged.'
	},
	'office.err.failed': { id: 'Gagal.', en: 'Failed.' },
	'engine.missing': { id: 'ffmpeg tidak ditemukan.', en: 'ffmpeg was not found.' },
	'engine.install': {
		id: 'Build resmi sudah membawa ffmpeg sendiri. Untuk development, jalankan "pnpm engines" atau "brew install ffmpeg".',
		en: 'Release builds ship their own ffmpeg. For development, run "pnpm engines" or "brew install ffmpeg".'
	},
	'lang.label': { id: 'Bahasa', en: 'Language' }
} satisfies Record<string, Localized>;

export type DictKey = keyof typeof dict;

export function t(key: DictKey): string {
	return dict[key][i18n.lang];
}

export const categories: Record<Category, Localized> = {
	video: { id: 'Video', en: 'Video' },
	audio: { id: 'Audio', en: 'Audio' },
	image: { id: 'Gambar', en: 'Images' },
	pdf: { id: 'PDF', en: 'PDF' },
	document: { id: 'Dokumen & File', en: 'Documents & Files' },
	download: { id: 'Download', en: 'Download' },
	developer: { id: 'Developer', en: 'Developer' }
};

export const categoryOrder: Category[] = [
	'video',
	'audio',
	'image',
	'pdf',
	'document',
	'download',
	'developer'
];
