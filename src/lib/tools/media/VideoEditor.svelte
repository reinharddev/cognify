<script lang="ts">
	import { onMount } from 'svelte';
	import { invoke } from '@tauri-apps/api/core';
	import { listen } from '@tauri-apps/api/event';
	import { open } from '@tauri-apps/plugin-dialog';
	import { revealItemInDir } from '@tauri-apps/plugin-opener';
	import { ArrowDown, ArrowUp, Check, Music, Plus, TriangleAlert, X } from '@lucide/svelte';
	import DropZone from '$lib/components/DropZone.svelte';
	import FolderPicker from '$lib/components/FolderPicker.svelte';
	import Select from '$lib/ui/Select.svelte';
	import { tr } from '$lib/i18n.svelte';
	import { extOf, fileName, formatClock, listenFileDrop, parseTime } from '../util';

	type Info = { durationSec: number; width: number; height: number; hasAudio: boolean };
	type Clip = { id: string; path: string; name: string; info?: Info; error?: string; startText: string; endText: string; startThumb: string | null; endThumb: string | null };
	type Result = { output: string; expectedSec: number; actualSec: number };

	const VIDEO = ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'flv', 'wmv', 'mpg', 'mpeg'];
	const AUDIO = ['mp3', 'm4a', 'wav', 'aac', 'flac', 'ogg', 'opus', 'wma'];

	let clips = $state<Clip[]>([]);
	let music = $state<{ path: string; name: string; duration: number | null; error?: string } | null>(null);
	let mode = $state<'replace' | 'mix'>('mix');
	let musicVolume = $state(70);
	let videoVolume = $state(100);
	let loopMusic = $state(true);
	let fadeOut = $state(true);
	let size = $state<'first' | 'p1080' | 'p720' | 'p480'>('first');
	let outDir = $state<string | null>(null);
	let dragging = $state(false);
	let running = $state(false);
	let percent = $state(0);
	let result = $state<Result | null>(null);
	let error = $state<string | null>(null);
	let jobId = '';

	const sizes = $derived<{ value: typeof size; label: string }[]>([
		{ value: 'first', label: tr('Sama dengan klip pertama', 'Same as the first clip') },
		{ value: 'p1080', label: '1080p' },
		{ value: 'p720', label: '720p' },
		{ value: 'p480', label: '480p' }
	]);

	// ── Potongan tiap klip ──
	const range = (c: Clip) => {
		const start = parseTime(c.startText);
		const endRaw = parseTime(c.endText);
		if (start === null || endRaw === null || !c.info) return { ok: false as const, why: tr('Waktu tidak terbaca', 'Time not readable') };
		const end = Math.min(endRaw, c.info.durationSec);
		if (end - start < 0.1) return { ok: false as const, why: tr('Rentang terlalu pendek atau di luar durasi', 'Range too short or past the end') };
		return { ok: true as const, start, end, length: end - start };
	};
	const total = $derived(clips.reduce((sum, c) => {
		const r = range(c);
		return sum + (r.ok ? r.length : 0);
	}, 0));
	const problem = $derived(clips.some((c) => !c.info || c.error || !range(c).ok));
	const canExport = $derived(clips.length > 0 && !problem && !running && !music?.error);

	async function thumbs(c: Clip) {
		const r = range(c);
		if (!c.info || !r.ok) return;
		const grab = (time: number) => invoke<string>('video_frame', { path: c.path, time, width: 192 }).catch(() => null);
		const [a, b] = await Promise.all([grab(r.start), grab(Math.max(r.start, r.end - 0.1))]);
		c.startThumb = a;
		c.endThumb = b;
	}

	async function addClip(path: string) {
		const clip: Clip = { id: crypto.randomUUID(), path, name: fileName(path), startText: '0:00.0', endText: '', startThumb: null, endThumb: null };
		clips.push(clip);
		result = null;
		error = null;
		const mine = clips[clips.length - 1];
		try {
			mine.info = await invoke<Info>('video_info', { path });
			mine.endText = formatClock(mine.info.durationSec);
			void thumbs(mine);
		} catch (e) {
			mine.error = String(e);
		}
	}

	async function setMusic(path: string) {
		result = null;
		music = { path, name: fileName(path), duration: null };
		try {
			const duration = await invoke<number>('audio_info', { path });
			if (music?.path === path) music.duration = duration;
		} catch (e) {
			if (music?.path === path) music.error = String(e);
		}
	}

	function addPaths(paths: string[]) {
		for (const p of paths) {
			const ext = extOf(p);
			if (VIDEO.includes(ext)) void addClip(p);
			else if (AUDIO.includes(ext)) void setMusic(p);
		}
	}

	async function pickVideos() {
		const picked = await open({ multiple: true, filters: [{ name: 'Video', extensions: VIDEO }] });
		if (picked) addPaths(picked);
	}

	async function pickMusic() {
		const picked = await open({ multiple: false, filters: [{ name: tr('Musik', 'Music'), extensions: AUDIO }] });
		if (typeof picked === 'string') void setMusic(picked);
	}

	function move(i: number, by: -1 | 1) {
		const j = i + by;
		if (j < 0 || j >= clips.length) return;
		[clips[i], clips[j]] = [clips[j], clips[i]];
		result = null;
	}

	function remove(id: string) {
		clips = clips.filter((c) => c.id !== id);
		result = null;
	}

	async function run() {
		running = true;
		percent = 0;
		result = null;
		error = null;
		jobId = crypto.randomUUID();
		try {
			result = await invoke<Result>('export_video_project', {
				req: {
					jobId,
					clips: clips.map((c) => {
						const r = range(c);
						return { path: c.path, start: r.ok ? r.start : 0, end: r.ok ? r.end : 0 };
					}),
					music: music && !music.error ? { path: music.path, mode, musicVolume: musicVolume / 100, videoVolume: videoVolume / 100, loopMusic, fadeOut } : null,
					size,
					outDir
				}
			});
		} catch (e) {
			if (e !== 'cancelled') error = String(e);
		}
		running = false;
	}

	const cancel = () => invoke('cancel_job', { jobId });

	onMount(() => {
		const progress = listen<{ jobId: string; percent: number }>('job-progress', (e) => {
			if (e.payload.jobId === jobId) percent = e.payload.percent;
		});
		const stopDrop = listenFileDrop(addPaths, (h) => (dragging = h));
		return () => {
			progress.then((fn) => fn());
			stopDrop();
		};
	});
</script>

<DropZone {dragging} label={tr('Seret video (dan musik) ke sini, atau', 'Drop videos (and music) here, or')} buttonLabel={tr('Pilih video', 'Choose videos')} onchoose={pickVideos} />
<p class="hint">{tr('Susun beberapa klip menjadi satu video: potong tiap klip, tambahkan musik dari MP3, lalu ekspor sebagai MP4. Klip pertama menentukan ukuran gambar; klip lain diberi bingkai hitam bila bentuknya berbeda.', 'Put several clips together into one video: trim each clip, add music from an MP3, then export as MP4. The first clip sets the picture size; other clips get black bars if their shape differs.')}</p>

{#if clips.length}
	<h3>{tr('Klip', 'Clips')} <span class="dim">· {tr(`${clips.length} klip, total ${formatClock(total)}`, `${clips.length} clips, ${formatClock(total)} in total`)}</span></h3>
	<ol class="clips">
		{#each clips as c, i (c.id)}
			{@const r = range(c)}
			<li>
				<div class="thumbs">
					{#if c.startThumb}<img src={c.startThumb} alt={tr('Awal potongan', 'Cut start')} />{:else}<span class="ph"></span>{/if}
					{#if c.endThumb}<img src={c.endThumb} alt={tr('Akhir potongan', 'Cut end')} />{:else}<span class="ph"></span>{/if}
				</div>
				<div class="body">
					<div class="top">
						<span class="num">{i + 1}</span>
						<span class="name" title={c.path}>{c.name}</span>
						{#if c.info}<span class="dim">{formatClock(c.info.durationSec)} · {c.info.width}×{c.info.height}{c.info.hasAudio ? '' : ` · ${tr('tanpa suara', 'no sound')}`}</span>{/if}
					</div>
					{#if c.error}
						<span class="bad"><TriangleAlert size={14} /> {c.error}</span>
					{:else if !c.info}
						<span class="dim">{tr('Membaca video…', 'Reading the video…')}</span>
					{:else}
						<div class="times">
							<label>{tr('Mulai', 'Start')} <input type="text" bind:value={c.startText} disabled={running} onchange={() => thumbs(c)} aria-label={tr('Mulai potongan', 'Cut start')} /></label>
							<label>{tr('Selesai', 'End')} <input type="text" bind:value={c.endText} disabled={running} onchange={() => thumbs(c)} aria-label={tr('Akhir potongan', 'Cut end')} /></label>
							{#if r.ok}<span class="dim">{tr('Dipakai', 'Used')}: <strong>{formatClock(r.length)}</strong></span>{:else}<span class="bad">{r.why}</span>{/if}
						</div>
					{/if}
				</div>
				<div class="acts">
					<button class="icon-btn" aria-label={tr('Naikkan', 'Move up')} disabled={i === 0 || running} onclick={() => move(i, -1)}><ArrowUp size={15} /></button>
					<button class="icon-btn" aria-label={tr('Turunkan', 'Move down')} disabled={i === clips.length - 1 || running} onclick={() => move(i, 1)}><ArrowDown size={15} /></button>
					<button class="icon-btn" aria-label={tr('Hapus klip', 'Remove clip')} disabled={running} onclick={() => remove(c.id)}><X size={15} /></button>
				</div>
			</li>
		{/each}
	</ol>
	<div class="row"><button class="btn" onclick={pickVideos} disabled={running}><Plus size={14} /> {tr('Tambah klip', 'Add a clip')}</button></div>

	<h3>{tr('Musik', 'Music')}</h3>
	{#if !music}
		<div class="row">
			<button class="btn" onclick={pickMusic} disabled={running}><Music size={14} /> {tr('Tambah musik (MP3 dan lainnya)', 'Add music (MP3 and others)')}</button>
			<span class="dim">{tr('Boleh juga diseret ke sini.', 'You can drop it here too.')}</span>
		</div>
	{:else}
		<div class="music">
			<div class="top">
				<Music size={15} />
				<span class="name" title={music.path}>{music.name}</span>
				{#if music.duration !== null}<span class="dim">{formatClock(music.duration)}</span>{/if}
				<button class="icon-btn" aria-label={tr('Ganti musik', 'Change music')} disabled={running} onclick={pickMusic}><Plus size={15} /></button>
				<button class="icon-btn" aria-label={tr('Hapus musik', 'Remove music')} disabled={running} onclick={() => (music = null)}><X size={15} /></button>
			</div>
			{#if music.error}
				<span class="bad"><TriangleAlert size={14} /> {music.error}</span>
			{:else}
				<div class="seg" role="radiogroup" aria-label={tr('Cara memakai musik', 'How to use the music')}>
					<button class:on={mode === 'mix'} role="radio" aria-checked={mode === 'mix'} onclick={() => (mode = 'mix')} disabled={running}>{tr('Campur dengan suara video', 'Mix with the video sound')}</button>
					<button class:on={mode === 'replace'} role="radio" aria-checked={mode === 'replace'} onclick={() => (mode = 'replace')} disabled={running}>{tr('Ganti suara video', 'Replace the video sound')}</button>
				</div>
				<div class="sliders">
					<label>{tr('Volume musik', 'Music volume')} <input type="range" min="0" max="150" step="5" bind:value={musicVolume} disabled={running} /> <span class="dim">{musicVolume}%</span></label>
					{#if mode === 'mix'}<label>{tr('Volume suara video', 'Video sound volume')} <input type="range" min="0" max="150" step="5" bind:value={videoVolume} disabled={running} /> <span class="dim">{videoVolume}%</span></label>{/if}
				</div>
				<div class="checks">
					<label class="check"><input type="checkbox" bind:checked={loopMusic} disabled={running} /> {tr('Ulangi bila lebih pendek dari video', 'Repeat if shorter than the video')}</label>
					<label class="check"><input type="checkbox" bind:checked={fadeOut} disabled={running} /> {tr('Mengecil pelan di akhir', 'Fade out at the end')}</label>
				</div>
			{/if}
		</div>
	{/if}

	<h3>{tr('Ekspor', 'Export')}</h3>
	<div class="options">
		<label class="field"><span class="dim">{tr('Ukuran gambar', 'Picture size')}</span> <Select bind:value={size} options={sizes} disabled={running} /></label>
		<FolderPicker bind:value={outDir} disabled={running} />
	</div>

	<div class="row">
		{#if running}
			<button class="btn" onclick={cancel}>{tr('Batalkan', 'Cancel')}</button>
		{:else}
			<button class="btn primary" onclick={run} disabled={!canExport}>{tr('Ekspor MP4', 'Export MP4')}</button>
		{/if}
		{#if problem && !running}<span class="bad">{tr('Periksa waktu potong di klip yang bertanda merah.', 'Check the cut times on the clips marked in red.')}</span>{/if}
	</div>
	{#if running}
		<div class="bar" class:indeterminate={percent < 0}><div style:width="{Math.max(percent, 0)}%"></div></div>
		<p class="dim">{percent >= 0 ? `${Math.round(percent)}%` : ''} {tr('Memproses video…', 'Processing the video…')}</p>
	{/if}
{/if}

{#if result}
	<div class="result">
		<Check size={16} />
		<span>{tr('Selesai', 'Done')}: {formatClock(result.actualSec)}</span>
		<button class="link" onclick={() => revealItemInDir(result!.output)}>{tr('Tampilkan di folder', 'Show in folder')}</button>
	</div>
{/if}
{#if error}<pre class="error">{error}</pre>{/if}

<style>
	.hint { margin: var(--space-3) 0 0; color: var(--text-dim); font-size: 13px; max-width: 680px; }
	h3 { margin: var(--space-5) 0 var(--space-2); font-size: 1em; }
	.dim { color: var(--text-dim); font-size: 13px; font-weight: 400; }
	.bad { display: inline-flex; align-items: center; gap: var(--space-1); color: var(--danger); font-size: 13px; }
	.clips { list-style: none; margin: 0 0 var(--space-3); padding: 0; display: grid; gap: var(--space-3); }
	.clips li { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: var(--space-3); align-items: center; padding: var(--space-3); background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-3); }
	.thumbs { display: flex; gap: var(--space-1); }
	.thumbs img, .ph { width: 96px; height: 54px; object-fit: cover; border-radius: var(--radius-1); background: var(--surface-2); display: block; }
	.body { min-width: 0; display: grid; gap: var(--space-2); }
	.top { display: flex; align-items: center; gap: var(--space-2); min-width: 0; }
	.num { width: 20px; color: var(--text-dim); font-variant-numeric: tabular-nums; }
	.name { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-weight: 600; }
	.times { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); }
	.times label { display: inline-flex; align-items: center; gap: var(--space-2); color: var(--text-muted); }
	.times input { width: 84px; padding: var(--space-1) var(--space-2); border: 1px solid var(--border-strong); border-radius: var(--radius-2); background: var(--surface); color: var(--text); font: inherit; font-variant-numeric: tabular-nums; }
	.acts { display: flex; flex-direction: column; gap: var(--space-0); }
	.icon-btn { display: inline-grid; place-items: center; padding: var(--space-1); border: 0; border-radius: var(--radius-1); background: none; color: var(--text-dim); }
	.icon-btn:hover:not(:disabled) { background: var(--surface-2); color: var(--text); }
	.row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); margin-top: var(--space-2); }
	.music { display: grid; gap: var(--space-3); padding: var(--space-3) var(--space-4); background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-3); }
	.seg { display: flex; flex-wrap: wrap; gap: var(--space-1); padding: var(--space-1); width: fit-content; background: var(--surface-2); border-radius: var(--radius-3); }
	.seg button { padding: var(--space-1) var(--space-3); border: 0; border-radius: var(--radius-2); background: none; color: var(--text-muted); cursor: pointer; }
	.seg button.on { background: var(--surface); color: var(--text); font-weight: 600; box-shadow: var(--lift); }
	.sliders { display: grid; gap: var(--space-2); }
	.sliders label { display: grid; grid-template-columns: 160px minmax(0, 220px) 48px; align-items: center; gap: var(--space-3); color: var(--text-muted); }
	.checks { display: flex; flex-wrap: wrap; gap: var(--space-4); }
	.check { display: inline-flex; align-items: center; gap: var(--space-2); color: var(--text-muted); cursor: pointer; }
	.options { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-4); margin-bottom: var(--space-3); }
	.field { display: inline-flex; align-items: center; gap: var(--space-2); }
	.bar { height: var(--space-1); margin-top: var(--space-3); background: var(--surface-2); border-radius: var(--radius-pill); overflow: hidden; }
	.bar div { height: 100%; background: var(--accent-strong); transition: width 0.2s; }
	.bar.indeterminate div { width: 40% !important; animation: slide 1.2s infinite ease-in-out; }
	@keyframes slide { 0% { transform: translateX(-100%); } 100% { transform: translateX(250%); } }
	.result { display: flex; align-items: center; gap: var(--space-2); margin-top: var(--space-4); color: var(--ok); }
	.link { border: 0; background: none; padding: 0; color: var(--link); font-size: 13px; }
	.error { margin: var(--space-3) 0 0; padding: var(--space-2) var(--space-3); border-radius: var(--radius-2); background: var(--surface-2); color: var(--danger); font-size: 12px; white-space: pre-wrap; user-select: text; -webkit-user-select: text; }
	@media (prefers-reduced-motion: reduce) { .bar div, .bar.indeterminate div { animation: none; transition: none; } }
</style>
