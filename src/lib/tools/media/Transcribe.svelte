<script lang="ts">
	import Select from '$lib/ui/Select.svelte';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { invoke } from '@tauri-apps/api/core';
	import { listen } from '@tauri-apps/api/event';
	import { open, save } from '@tauri-apps/plugin-dialog';
	import { Check, Copy, FileText, FolderOpen, TriangleAlert } from '@lucide/svelte';
	import FfmpegNotice from '../FfmpegNotice.svelte';
	import { tr } from '$lib/i18n.svelte';
	import { ws } from '$lib/stores/workspace.svelte';
	import { plainTextOf } from '$lib/workspace/templates';
	import { fileName, listenFileDrop } from '../util';
	import { safeName, stamp, toDoc, toSrt, toText, toVtt, type Segment } from './transcript';

	type Status = { modelInstalled: boolean; ffmpeg: boolean; ytdlp: boolean; supported: boolean };
	type EngineStatus = { id: string; label: string; approxMb: number; supported: boolean; installed: boolean; path: string | null };
	type Result = { segments: Segment[]; language: string | null; source: 'whisper' | 'captions'; title: string; durationSec: number | null };
	type Phase = 'download' | 'decode' | 'listen';

	const MODEL_ID = 'whisper-small';
	const ACK_KEY = 'toolbox.media.acknowledged';
	const AUDIO = ['mp3', 'm4a', 'wav', 'flac', 'ogg', 'opus', 'aac', 'wma'];
	const VIDEO = ['mp4', 'mkv', 'mov', 'webm', 'avi', 'm4v'];

	const readAck = () => {
		try {
			return localStorage.getItem(ACK_KEY) === '1';
		} catch {
			return false;
		}
	};

	let status = $state<Status | null>(null);
	let engines = $state<EngineStatus[]>([]);
	let acknowledged = $state(readAck());
	let ticked = $state(false);

	let source = $state<'file' | 'url'>('file');
	let path = $state<string | null>(null);
	let url = $state('');
	let mode = $state<'whisper' | 'captions'>('whisper');
	let language = $state('auto');
	let hovering = $state(false);

	let installing = $state<string | null>(null);
	let installPercent = $state(0);
	let installError = $state<string | null>(null);
	let installJob = '';

	let running = $state(false);
	let phase = $state<Phase>('listen');
	let percent = $state(0);
	let live = $state<Segment[]>([]);
	let result = $state<Result | null>(null);
	let error = $state<{ code: string; raw: string } | null>(null);
	let job = '';

	let timestamps = $state(true);
	let exportFormat = $state<'txt' | 'srt' | 'vtt'>('txt');
	let copied = $state(false);
	let notice = $state<string | null>(null);

	const model = $derived(engines.find((e) => e.id === MODEL_ID) ?? null);
	const ytdlp = $derived(engines.find((e) => e.id === 'yt-dlp') ?? null);
	const needsWhisper = $derived(mode === 'whisper' || source === 'file');
	const ready = $derived.by(() => {
		if (!status?.supported || running) return false;
		if (source === 'file' ? !path : !url.trim()) return false;
		if (source === 'url' && (!acknowledged || !ytdlp?.installed)) return false;
		if (needsWhisper && (!status.modelInstalled || !status.ffmpeg)) return false;
		return true;
	});
	const shown = $derived(result?.segments ?? live);

	const languages = [
		{ value: 'auto', label: tr('Otomatis', 'Automatic') },
		{ value: 'id', label: 'Indonesia' },
		{ value: 'en', label: 'English' },
		{ value: 'ms', label: 'Melayu' },
		{ value: 'jw', label: 'Jawa' },
		{ value: 'su', label: 'Sunda' },
		{ value: 'zh', label: '中文' },
		{ value: 'ja', label: '日本語' },
		{ value: 'ko', label: '한국어' },
		{ value: 'ar', label: 'العربية' },
		{ value: 'es', label: 'Español' },
		{ value: 'fr', label: 'Français' },
		{ value: 'de', label: 'Deutsch' }
	];

	const phaseLabel = $derived(
		phase === 'download'
			? tr('Mengambil dari tautan', 'Fetching from the link')
			: phase === 'decode'
				? tr('Menyiapkan suara', 'Preparing the audio')
				: tr('Mendengarkan dan menulis', 'Listening and writing')
	);

	function parseError(e: unknown) {
		const [code, ...rest] = String(e).split('|');
		return { code: code || 'failed', raw: rest.join('|').trim() };
	}

	const errorText = (code: string) =>
		({
			modelMissing: tr('Model Whisper belum dipasang.', 'The Whisper model is not installed.'),
			ffmpegMissing: tr('ffmpeg belum dipasang.', 'ffmpeg is not installed.'),
			noAudio: tr('Berkas ini tidak punya suara.', 'This file has no audio.'),
			noCaptions: tr('Video ini tidak punya caption. Pilih mode Akurat untuk mendengarkan suaranya.', 'This video has no captions. Choose Accurate mode to listen to its audio.'),
			unsupported: tr('Perangkat ini belum bisa menjalankan transkripsi.', 'This device cannot run transcription yet.'),
			invalidUrl: tr('Tautan tidak valid. Gunakan alamat http atau https.', 'Invalid link. Use an http or https address.'),
			engineMissing: tr('yt-dlp belum dipasang.', 'yt-dlp is not installed.'),
			network: tr('Koneksi gagal. Periksa internetmu.', 'Connection failed. Check your internet.'),
			unavailable: tr('Video tidak tersedia.', 'The video is unavailable.'),
			private: tr('Video ini privat.', 'This video is private.'),
			botCheck: tr('Situs meminta bukti bukan robot. Coba lagi nanti atau pakai berkas yang sudah diunduh.', 'The site asked for proof you are not a bot. Try later or use a downloaded file.'),
			timeout: tr('Terlalu lama. Coba lagi.', 'Took too long. Try again.')
		})[code] ?? tr('Transkripsi gagal.', 'Transcription failed.');

	async function refresh() {
		[status, engines] = await Promise.all([invoke<Status>('transcribe_status'), invoke<EngineStatus[]>('engine_catalog')]);
	}

	async function install(id: string) {
		installing = id;
		installError = null;
		installPercent = 0;
		installJob = crypto.randomUUID();
		try {
			await invoke('engine_install', { jobId: installJob, id });
			await refresh();
		} catch (e) {
			if (e !== 'cancelled') installError = String(e);
		}
		installing = null;
	}

	async function remove(id: string) {
		installError = null;
		try {
			await invoke('engine_remove', { id });
			await refresh();
		} catch (e) {
			installError = String(e);
		}
	}

	function enable() {
		try {
			localStorage.setItem(ACK_KEY, '1');
		} catch {}
		acknowledged = true;
	}

	function accept(paths: string[]) {
		const first = paths.find((p) => [...AUDIO, ...VIDEO].includes(p.split('.').pop()?.toLowerCase() ?? ''));
		if (first) {
			path = first;
			source = 'file';
		}
	}

	async function pick() {
		const picked = await open({
			multiple: false,
			filters: [{ name: tr('Audio dan video', 'Audio and video'), extensions: [...AUDIO, ...VIDEO] }]
		});
		if (typeof picked === 'string') path = picked;
	}

	async function start() {
		running = true;
		error = null;
		result = null;
		live = [];
		percent = 0;
		phase = source === 'url' && mode === 'whisper' ? 'download' : 'decode';
		notice = null;
		job = crypto.randomUUID();
		try {
			result = await invoke<Result>('transcribe', {
				req: {
					jobId: job,
					path: source === 'file' ? path : null,
					url: source === 'url' ? url.trim() : null,
					mode: source === 'url' ? mode : 'whisper',
					language
				}
			});
		} catch (e) {
			if (e !== 'cancelled') error = parseError(e);
		}
		running = false;
	}

	const cancel = () => invoke('cancel_job', { jobId: job });
	const cancelInstall = () => invoke('cancel_job', { jobId: installJob });

	const exportText = (format: 'txt' | 'srt' | 'vtt') =>
		format === 'srt' ? toSrt(shown) : format === 'vtt' ? toVtt(shown) : toText(shown, timestamps);

	async function copy() {
		try {
			await navigator.clipboard.writeText(toText(shown, timestamps));
			copied = true;
			setTimeout(() => (copied = false), 1800);
		} catch (e) {
			notice = String(e);
		}
	}

	async function saveFile() {
		if (!result) return;
		const dest = await save({
			defaultPath: `${safeName(result.title)}.${exportFormat}`,
			filters: [{ name: exportFormat.toUpperCase(), extensions: [exportFormat] }]
		});
		if (!dest) return;
		try {
			await invoke('write_text_file', { path: dest, content: exportText(exportFormat) + '\n' });
			notice = tr('Tersimpan.', 'Saved.');
		} catch (e) {
			notice = String(e);
		}
	}

	async function makeDocument() {
		if (!result) return;
		const doc = toDoc(
			result.segments,
			{
				source: result.source === 'whisper' ? 'Whisper' : tr('Caption YouTube', 'YouTube captions'),
				language: result.language
			},
			timestamps
		);
		try {
			const page = await ws.create('doc', null, {
				title: `${tr('Transkrip', 'Transcript')}: ${result.title}`,
				content: JSON.stringify(doc),
				plainText: plainTextOf(doc)
			});
			await goto(`/p/${page.id}`);
		} catch (e) {
			notice = String(e);
		}
	}

	onMount(() => {
		refresh().catch((e) => (installError = String(e)));
		const unlisten = [
			listen<{ jobId: string; phase: Phase; percent: number }>('transcribe-phase', (e) => {
				if (e.payload.jobId !== job) return;
				phase = e.payload.phase;
				percent = e.payload.percent;
			}),
			listen<{ jobId: string; segment: Segment }>('transcribe-segment', (e) => {
				if (e.payload.jobId === job) live.push(e.payload.segment);
			}),
			listen<{ jobId: string; percent: number }>('job-progress', (e) => {
				if (e.payload.jobId === installJob) installPercent = e.payload.percent;
			})
		];
		const stopDrop = listenFileDrop(accept, (h) => (hovering = h));
		return () => {
			unlisten.forEach((u) => u.then((fn) => fn()));
			stopDrop();
		};
	});
</script>

{#if status && !status.supported}
	<section class="card"><p class="dim">{tr('Transkripsi hanya tersedia di versi desktop.', 'Transcription is only available on desktop.')}</p></section>
{:else}
	<section class="card">
		<div class="seg" role="radiogroup" aria-label={tr('Sumber', 'Source')}>
			<button class:on={source === 'file'} role="radio" aria-checked={source === 'file'} disabled={running} onclick={() => (source = 'file')}>
				{tr('Berkas audio atau video', 'Audio or video file')}
			</button>
			<button class:on={source === 'url'} role="radio" aria-checked={source === 'url'} disabled={running} onclick={() => (source = 'url')}>
				{tr('Tautan (YouTube dan lainnya)', 'Link (YouTube and others)')}
			</button>
		</div>

		{#if source === 'file'}
			<button class="drop" class:hover={hovering} disabled={running} onclick={pick}>
				<FolderOpen size={20} />
				{#if path}
					<strong>{fileName(path)}</strong>
					<span class="dim">{tr('Klik untuk ganti', 'Click to change')}</span>
				{:else}
					<strong>{tr('Pilih atau seret berkas ke sini', 'Choose or drop a file here')}</strong>
					<span class="dim">MP3, M4A, WAV, FLAC, MP4, MKV, MOV, WebM</span>
				{/if}
			</button>
		{:else if !acknowledged}
			<div class="problem">
				<p>{tr('Mengambil dari tautan memakai yt-dlp. Pakai hanya untuk konten yang boleh kamu simpan, dan kamu bertanggung jawab atas pemakaiannya.', 'Fetching from a link uses yt-dlp. Use it only for content you may keep, and you are responsible for how you use it.')}</p>
				<label class="check"><input type="checkbox" bind:checked={ticked} /> {tr('Saya mengerti dan bertanggung jawab', 'I understand and take responsibility')}</label>
				<div><button class="btn primary" disabled={!ticked} onclick={enable}>{tr('Aktifkan', 'Enable')}</button></div>
			</div>
		{:else if ytdlp && !ytdlp.installed}
			<div class="problem">
				<p>{tr('Tautan butuh yt-dlp.', 'Links need yt-dlp.')}</p>
				{#if installing === 'yt-dlp'}
					<div class="bar"><div style:width="{installPercent}%"></div></div>
					<div class="row"><span class="dim">{Math.round(installPercent)}%</span><button class="btn" onclick={cancelInstall}>{tr('Batal', 'Cancel')}</button></div>
				{:else}
					<div><button class="btn primary" onclick={() => install('yt-dlp')}>{tr('Pasang yt-dlp', 'Install yt-dlp')} (≈{ytdlp.approxMb} MB)</button></div>
				{/if}
			</div>
		{:else}
			<label class="field">
				<span class="label">{tr('Tautan', 'Link')}</span>
				<input bind:value={url} disabled={running} placeholder="https://www.youtube.com/watch?v=…" spellcheck="false" autocomplete="off" />
			</label>
			<div class="seg" role="radiogroup" aria-label={tr('Cara', 'Method')}>
				<button class:on={mode === 'whisper'} role="radio" aria-checked={mode === 'whisper'} disabled={running} onclick={() => (mode = 'whisper')}>
					{tr('Akurat (dengarkan suaranya)', 'Accurate (listen to audio)')}
				</button>
				<button class:on={mode === 'captions'} role="radio" aria-checked={mode === 'captions'} disabled={running} onclick={() => (mode = 'captions')}>
					{tr('Cepat (caption YouTube)', 'Fast (YouTube captions)')}
				</button>
			</div>
			{#if mode === 'captions'}
				<p class="dim">{tr('Memakai caption yang sudah ada di video, tanpa model. Caption otomatis kadang kurang tepat.', 'Uses the captions already on the video, with no model. Automatic captions can be imprecise.')}</p>
			{/if}
		{/if}

		<div class="options">
			<label class="inline">
				<span class="label">{tr('Bahasa', 'Language')}</span>
				<Select bind:value={language} disabled={running} options={languages} />
			</label>
		</div>
	</section>

	{#if needsWhisper && status}
		{#if !status.ffmpeg}
			<FfmpegNotice onready={refresh} />
		{/if}
		{#if model && !model.installed}
			<section class="card">
				<h2>{tr('Model transkripsi', 'Transcription model')}</h2>
				<p class="dim">
					{tr(
						'Whisper small berjalan di komputer ini dan tidak mengirim suaramu ke mana pun. Sekali pasang, bisa dipakai tanpa internet. Akurat untuk Bahasa Indonesia dan Inggris, dan cukup ringan untuk laptop biasa.',
						'Whisper small runs on this computer and never sends your audio anywhere. Install it once and it works offline. Accurate for Indonesian and English, and light enough for an ordinary laptop.'
					)}
				</p>
				{#if installing === MODEL_ID}
					<div class="bar"><div style:width="{installPercent}%"></div></div>
					<div class="row"><span class="dim">{Math.round(installPercent)}%</span><button class="btn" onclick={cancelInstall}>{tr('Batal', 'Cancel')}</button></div>
				{:else}
					<div><button class="btn primary" onclick={() => install(MODEL_ID)}>{tr('Unduh model', 'Download model')} (≈{model.approxMb} MB)</button></div>
				{/if}
				{#if installError}<pre class="error">{installError}</pre>{/if}
			</section>
		{/if}
	{/if}

	<section class="card">
		{#if running}
			<div class="bar"><div style:width="{Math.max(2, percent)}%"></div></div>
			<div class="row">
				<span class="dim">{phaseLabel}: {Math.round(percent)}%</span>
				<button class="btn" onclick={cancel}>{tr('Batal', 'Cancel')}</button>
			</div>
		{:else}
			<div class="row">
				<button class="btn primary" disabled={!ready} onclick={start}>{tr('Buat transkrip', 'Transcribe')}</button>
				{#if model?.installed && needsWhisper}
					<button class="link" onclick={() => remove(MODEL_ID)}>{tr('Hapus model', 'Remove model')}</button>
				{/if}
			</div>
		{/if}
		{#if error && !running}
			<div class="problem">
				<p><TriangleAlert size={16} /> {errorText(error.code)}</p>
				{#if error.raw && error.code === 'failed'}<pre class="error">{error.raw}</pre>{/if}
			</div>
		{/if}
	</section>

	{#if shown.length > 0}
		<section class="card">
			<div class="row between">
				<h2>{result ? tr('Hasil', 'Result') : tr('Sedang ditulis…', 'Writing…')}</h2>
				{#if result}
					<span class="dim">
						{[result.language ? result.language.toUpperCase() : null, result.source === 'whisper' ? 'Whisper' : tr('Caption', 'Captions'), `${shown.length} ${tr('bagian', 'parts')}`].filter(Boolean).join(' · ')}
					</span>
				{/if}
			</div>

			{#if result}
				<div class="row">
					<label class="check"><input type="checkbox" bind:checked={timestamps} /> {tr('Stempel waktu', 'Timestamps')}</label>
					<button class="btn" onclick={copy}>
						{#if copied}<Check size={14} /> {tr('Tersalin', 'Copied')}{:else}<Copy size={14} /> {tr('Salin', 'Copy')}{/if}
					</button>
					<span class="inline">
						<Select bind:value={exportFormat} options={[{ value: 'txt', label: 'TXT' }, { value: 'srt', label: 'SRT' }, { value: 'vtt', label: 'VTT' }]} />
						<button class="btn" onclick={saveFile}>{tr('Simpan', 'Save')}</button>
					</span>
					<button class="btn primary" onclick={makeDocument}><FileText size={14} /> {tr('Jadikan dokumen', 'Make a document')}</button>
				</div>
				{#if notice}<p class="dim">{notice}</p>{/if}
			{/if}

			<div class="lines" aria-live="off">
				{#each shown as s, i (i)}
					<p><span class="t">{stamp(s.start, shown.some((x) => x.start >= 3600))}</span> {s.text}</p>
				{/each}
			</div>
		</section>
	{/if}
{/if}

{#if installError && !(model && !model.installed)}<pre class="error">{installError}</pre>{/if}

<style>
	.card {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		margin-bottom: var(--space-3);
		padding: var(--space-4) var(--space-4);
		border: var(--edge-w) solid var(--edge);
		border-radius: var(--radius);
		background: var(--surface);
	}

	h2 {
		font-size: 14px;
		font-weight: 650;
		margin: 0;
	}

	.row {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-3);
	}

	.row.between {
		justify-content: space-between;
	}

	.dim {
		color: var(--text-dim);
		font-size: 13px;
		margin: 0;
	}

	.check {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.label {
		font-size: 12px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-dim);
	}

	input:not([type]) {
		padding: var(--space-2) var(--space-3);
		border: var(--edge-w) solid var(--edge);
		border-radius: var(--radius-2);
		background: var(--surface);
		color: var(--text);
		font: inherit;
		user-select: text;
		-webkit-user-select: text;
	}

	.options {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3) var(--space-4);
	}

	.inline {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
	}

	.seg {
		display: inline-flex;
		align-self: flex-start;
		flex-wrap: wrap;
		border: var(--edge-w) solid var(--edge);
		border-radius: var(--radius-2);
		overflow: hidden;
	}

	.seg button {
		padding: var(--space-2) var(--space-4);
		border: 0;
		border-right: 1px solid var(--border);
		background: transparent;
		color: var(--text);
	}

	.seg button:last-child {
		border-right: 0;
	}

	.seg button.on {
		background: var(--accent);
		color: var(--accent-contrast);
	}

	.drop {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-5) var(--space-4);
		border: 1.5px dashed var(--edge);
		border-radius: var(--radius-2);
		background: var(--surface-2);
		color: var(--text);
		text-align: center;
	}

	.drop.hover {
		border-color: var(--accent-strong);
	}

	.problem {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		border: var(--edge-w) solid var(--edge);
		border-radius: var(--radius-2);
		background: var(--surface-2);
	}

	.problem p {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin: 0;
	}

	.error {
		margin: 0;
		white-space: pre-wrap;
		font-family: var(--font-mono);
		font-size: 12px;
		user-select: text;
		-webkit-user-select: text;
	}

	.link {
		border: 0;
		background: transparent;
		color: var(--link);
		text-decoration: underline;
	}

	.lines {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		max-height: 420px;
		overflow-y: auto;
		user-select: text;
		-webkit-user-select: text;
	}

	.lines p {
		margin: 0;
		line-height: 1.5;
	}

	.t {
		display: inline-block;
		min-width: 3.2em;
		margin-right: var(--space-2);
		color: var(--text-dim);
		font-family: var(--font-mono);
		font-size: 12px;
	}
</style>
