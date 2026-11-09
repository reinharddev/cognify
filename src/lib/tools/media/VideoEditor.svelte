<script lang="ts">
	import { onMount, tick as nextTick, untrack } from 'svelte';
	import { convertFileSrc, invoke } from '@tauri-apps/api/core';
	import { listen } from '@tauri-apps/api/event';
	import { open } from '@tauri-apps/plugin-dialog';
	import { revealItemInDir } from '@tauri-apps/plugin-opener';
	import { Check, Music, Pause, Play, Plus, Redo2, Scissors, Trash2, TriangleAlert, Undo2, X } from '@lucide/svelte';
	import FolderPicker from '$lib/components/FolderPicker.svelte';
	import Select from '$lib/ui/Select.svelte';
	import { tr } from '$lib/i18n.svelte';
	import { extOf, fileName, formatClock, listenFileDrop } from '../util';
	import { canSplit, lengthOf, locate, moveItem, nearest, offsets, reorderIndex, rulerStep, splitAt, tileTimes, totalOf, trimEnd, trimStart, type Seg } from './timeline';

	type Info = { durationSec: number; width: number; height: number; hasAudio: boolean };
	type Clip = Seg & { path: string; name: string; info: Info };
	type Thumb = { t: number; url: string };
	type Result = { output: string; expectedSec: number; actualSec: number };
	type Drag = { kind: 'scrub'; id?: undefined } | { kind: 'music'; id?: undefined; x0: number; orig: number; moved: boolean } | { kind: 'move'; id: string; x0: number; moved: boolean } | { kind: 'trim'; id: string; side: 'l' | 'r'; x0: number; orig: number; moved: boolean };

	const VIDEO = ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'flv', 'wmv', 'mpg', 'mpeg'];
	const AUDIO = ['mp3', 'm4a', 'wav', 'aac', 'flac', 'ogg', 'opus', 'wma'];
	const TILE = 80;
	const uid = () => crypto.randomUUID();

	let clips = $state<Clip[]>([]);
	let failed = $state<string[]>([]);
	let selId = $state<string | null>(null);
	let playhead = $state(0);
	let playing = $state(false);
	let pps = $state(40);
	let previewOk = $state(true);
	let still = $state<string | null>(null);
	let strips = $state<Record<string, Thumb[]>>({});
	let past = $state<string[]>([]);
	let future = $state<string[]>([]);

	let music = $state<{ path: string; name: string; duration: number | null; error?: string; peaks: number[]; start: number } | null>(null);
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

	let vid: HTMLVideoElement | undefined;
	let aud: HTMLAudioElement | undefined;
	let lane = $state<HTMLDivElement>();
	let scroller = $state<HTMLDivElement>();
	let loadedPath = '';
	let playIdx = 0;
	let settling = false;
	let drag: Drag | null = null;
	let stillTimer: ReturnType<typeof setTimeout> | undefined;
	const loadingStrips = new Set<string>();

	const sizes = $derived<{ value: typeof size; label: string }[]>([
		{ value: 'first', label: tr('Sama dengan klip pertama', 'Same as the first clip') },
		{ value: 'p1080', label: '1080p' },
		{ value: 'p720', label: '720p' },
		{ value: 'p480', label: '480p' }
	]);

	const offs = $derived(offsets(clips));
	const total = $derived(totalOf(clips));
	const here = $derived(locate(clips, playhead));
	const selected = $derived(clips.find((c) => c.id === selId) ?? null);
	const splittable = $derived(!!here && canSplit(clips[here.index], here.local));
	const laneW = $derived(total * pps + TILE);
	const ticks = $derived.by(() => {
		const step = rulerStep(pps);
		return Array.from({ length: Math.floor(Math.max(laneW, 2400) / pps / step) + 1 }, (_, k) => k * step);
	});
	const canExport = $derived(clips.length > 0 && !running && !music?.error);

	// ── Riwayat (urungkan / ulangi) ──
	const snap = () => JSON.stringify({ clips, musicStart: music?.start ?? 0 });
	function commit() {
		past = [...past.slice(-99), snap()];
		future = [];
	}
	function restore(json: string) {
		stopPlay();
		const saved = JSON.parse(json) as { clips: Clip[]; musicStart: number };
		clips = saved.clips;
		if (music) music.start = saved.musicStart;
		if (selId && !clips.some((c) => c.id === selId)) selId = null;
		playhead = Math.min(playhead, totalOf(clips));
		result = null;
		showFrame();
	}
	function undo() {
		if (!past.length) return;
		future = [...future, snap()];
		const last = past[past.length - 1];
		past = past.slice(0, -1);
		restore(last);
	}
	function redo() {
		if (!future.length) return;
		past = [...past, snap()];
		const next = future[future.length - 1];
		future = future.slice(0, -1);
		restore(next);
	}

	// ── Pratinjau ──
	function ensureSrc(path: string) {
		if (!vid || loadedPath === path) return false;
		loadedPath = path;
		previewOk = true;
		vid.src = convertFileSrc(path);
		return true;
	}

	function showFrame() {
		const l = locate(clips, playhead);
		if (!l) {
			if (vid) vid.removeAttribute('src');
			loadedPath = '';
			still = null;
			return;
		}
		const c = clips[l.index];
		if (previewOk) {
			if (!vid) return;
			if (ensureSrc(c.path)) settle();
			vid.currentTime = l.local;
		} else {
			clearTimeout(stillTimer);
			stillTimer = setTimeout(() => {
				invoke<string>('video_frame', { path: c.path, time: l.local, width: 640 }).then((u) => (still = u)).catch(() => (still = null));
			}, 120);
		}
	}

	/** Ignore the old clip's time until the player has finished jumping (with a timeout as a safety net). */
	function settle() {
		settling = true;
		setTimeout(() => (settling = false), 500);
	}

	function stopPlay() {
		playing = false;
		vid?.pause();
		aud?.pause();
	}

	function play() {
		if (!previewOk || !clips.length || !vid) return;
		if (playhead >= total - 0.05) playhead = 0;
		const l = locate(clips, playhead);
		if (!l) return;
		playIdx = l.index;
		if (ensureSrc(clips[l.index].path)) settle();
		vid.currentTime = l.local;
		void vid.play();
		playing = true;
		syncAudio(true);
		requestAnimationFrame(tick);
	}

	function tick() {
		if (!playing || !vid) return;
		const c = clips[playIdx];
		if (!c) return stopPlay();
		const t = vid.currentTime;
		if (!settling && (t >= c.end - 0.04 || vid.ended)) {
			const n = clips[playIdx + 1];
			if (!n) {
				playhead = total;
				return stopPlay();
			}
			playIdx++;
			const contiguous = n.path === loadedPath && Math.abs(n.start - c.end) < 0.1;
			if (!contiguous) {
				if (ensureSrc(n.path) || Math.abs(vid.currentTime - n.start) > 0.01) settle();
				vid.currentTime = n.start;
			}
			void vid.play();
		} else if (!settling) {
			playhead = offs[playIdx] + Math.max(0, t - c.start);
		}
		syncAudio();
		if (scroller) {
			const x = playhead * pps;
			if (x > scroller.scrollLeft + scroller.clientWidth - TILE / 2) scroller.scrollLeft = x - TILE / 2;
		}
		requestAnimationFrame(tick);
	}

	/** Keeps the music preview in step with the playhead: silent before its start, looping or ending like the export. */
	function syncAudio(force = false) {
		if (!aud || !music || music.error || !music.duration) return;
		const rel = playhead - music.start;
		if (rel < 0 || (!loopMusic && rel >= music.duration)) {
			if (!aud.paused) aud.pause();
			return;
		}
		const want = loopMusic ? rel % music.duration : rel;
		if (force || Math.abs(aud.currentTime - want) > 0.3) aud.currentTime = want;
		if (playing && aud.paused) void aud.play();
	}

	function seek(t: number) {
		stopPlay();
		playhead = Math.min(Math.max(t, 0), total);
		showFrame();
	}

	function togglePlay() {
		if (playing) stopPlay();
		else play();
	}

	// ── Bingkai kecil di garis waktu ──
	async function loadStrip(path: string, duration: number) {
		if (strips[path] || loadingStrips.has(path)) return;
		loadingStrips.add(path);
		const n = Math.min(Math.max(Math.round(duration / 3), 6), 24);
		const times = Array.from({ length: n }, (_, i) => (duration * (i + 0.5)) / n);
		const got: Thumb[] = [];
		for (let i = 0; i < times.length; i += 3) {
			const batch = await Promise.all(times.slice(i, i + 3).map((t) => invoke<string>('video_frame', { path, time: t, width: 160 }).then((url) => ({ t, url })).catch(() => null)));
			for (const b of batch) if (b) got.push(b);
			strips[path] = [...got];
		}
		loadingStrips.delete(path);
	}

	function tiles(c: Clip) {
		const strip = strips[c.path];
		if (!strip?.length) return [];
		const tilePx = Math.max(TILE, (lengthOf(c) * pps) / 80);
		const times = strip.map((s) => s.t);
		return tileTimes(c, pps, tilePx).map((t, k) => ({ left: k * tilePx, width: tilePx, url: strip[nearest(times, t)].url }));
	}

	// ── Menyusun klip ──
	async function addClip(path: string) {
		result = null;
		error = null;
		try {
			const info = await invoke<Info>('video_info', { path });
			await invoke('allow_media', { path });
			const first = clips.length === 0;
			commit();
			const clip: Clip = { id: uid(), path, name: fileName(path), info, start: 0, end: info.durationSec, duration: info.durationSec };
			clips = [...clips, clip];
			selId = clip.id;
			if (first) {
				await nextTick(); // the timeline only exists once there is a clip, so its width is known now
				pps = Math.min(Math.max(((scroller?.clientWidth ?? 600) - TILE) / info.durationSec, 8), 120);
				playhead = 0;
				showFrame();
			}
			void loadStrip(path, info.durationSec);
		} catch (e) {
			failed = [...failed, `${fileName(path)}: ${e}`];
		}
	}

	async function setMusic(path: string) {
		result = null;
		music = { path, name: fileName(path), duration: null, peaks: [], start: 0 };
		try {
			const duration = await invoke<number>('audio_info', { path });
			await invoke('allow_media', { path });
			if (music?.path === path) music.duration = duration;
			const peaks = await invoke<number[]>('audio_peaks', { path, buckets: 600 }).catch(() => []);
			if (music?.path === path) music.peaks = peaks;
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

	function split() {
		stopPlay();
		const l = locate(clips, playhead);
		if (!l || !canSplit(clips[l.index], l.local)) return;
		const out = splitAt(clips, l.index, l.local, [uid(), uid()]);
		if (!out) return;
		commit();
		clips = out;
		selId = out[l.index + 1].id;
		result = null;
	}

	function removeSelected() {
		if (!selId) return;
		stopPlay();
		commit();
		clips = clips.filter((c) => c.id !== selId);
		selId = null;
		playhead = Math.min(playhead, totalOf(clips));
		result = null;
		showFrame();
	}

	// ── Menyeret di garis waktu ──
	const xOf = (e: PointerEvent) => e.clientX - (lane?.getBoundingClientRect().left ?? 0);

	function onDown(e: PointerEvent) {
		if (running || !lane || e.button !== 0) return;
		const target = e.target as HTMLElement;
		if (target.closest('button')) return;
		const handle = target.closest<HTMLElement>('[data-handle]');
		const block = target.closest<HTMLElement>('[data-clip]');
		const x = xOf(e);
		lane.focus();
		lane.setPointerCapture(e.pointerId);
		if (music && target.closest('[data-music]')) {
			selId = null;
			drag = { kind: 'music', x0: x, orig: music.start, moved: false };
			return;
		}
		const c = block ? clips.find((k) => k.id === block.dataset.clip) : undefined;
		if (c && handle) {
			selId = c.id;
			const side = handle.dataset.handle as 'l' | 'r';
			drag = { kind: 'trim', id: c.id, side, x0: x, orig: side === 'l' ? c.start : c.end, moved: false };
		} else if (c) {
			selId = c.id;
			drag = { kind: 'move', id: c.id, x0: x, moved: false };
			seek(x / pps);
		} else {
			selId = null;
			drag = { kind: 'scrub' };
			seek(x / pps);
		}
	}

	function onMove(e: PointerEvent) {
		if (!drag) return;
		const x = xOf(e);
		if (drag.kind === 'scrub') return seek(x / pps);
		if (drag.kind === 'music') {
			if (!music) return;
			if (!drag.moved) {
				if (Math.abs(x - drag.x0) < 4) return;
				drag.moved = true;
				commit();
			}
			result = null;
			music.start = Math.min(Math.max(drag.orig + (x - drag.x0) / pps, 0), Math.max(total - 0.1, 0));
			if (playing) syncAudio(true);
			return;
		}
		const i = clips.findIndex((c) => c.id === drag!.id);
		if (i < 0) return;
		if (!drag.moved) {
			if (Math.abs(x - drag.x0) < 4) return;
			drag.moved = true;
			stopPlay();
			commit();
		}
		result = null;
		if (drag.kind === 'move') {
			const to = reorderIndex(clips.map((c) => lengthOf(c) * pps), i, x);
			if (to !== i) clips = moveItem(clips, i, to);
		} else {
			const c = clips[i];
			const delta = (x - drag.x0) / pps;
			if (drag.side === 'l') {
				clips[i].start = trimStart(c, drag.orig + delta);
				playhead = offs[i];
			} else {
				clips[i].end = trimEnd(c, drag.orig + delta);
				playhead = Math.max(offs[i], offs[i] + lengthOf(clips[i]) - 0.05);
			}
			showFrame();
		}
	}

	function onUp() {
		drag = null;
	}

	function onKey(e: KeyboardEvent) {
		const el = e.target as HTMLElement;
		if (el.closest('input, textarea, select, [contenteditable="true"]')) return;
		const mod = e.metaKey || e.ctrlKey;
		if (mod && e.key.toLowerCase() === 'z') {
			e.preventDefault();
			if (e.shiftKey) redo();
			else undo();
		} else if (mod || e.altKey) {
			return;
		} else if (e.key === ' ' && !el.closest('button')) {
			e.preventDefault();
			togglePlay();
		} else if (e.key.toLowerCase() === 's') {
			e.preventDefault();
			split();
		} else if (e.key === 'Delete' || e.key === 'Backspace') {
			e.preventDefault();
			removeSelected();
		} else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
			e.preventDefault();
			seek(playhead + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 1 : 0.1));
		}
	}

	async function run() {
		running = true;
		percent = 0;
		result = null;
		error = null;
		stopPlay();
		jobId = uid();
		try {
			result = await invoke<Result>('export_video_project', {
				req: {
					jobId,
					clips: clips.map((c) => ({ path: c.path, start: c.start, end: c.end })),
					music: music && !music.error ? { path: music.path, mode, musicVolume: musicVolume / 100, videoVolume: videoVolume / 100, loopMusic, fadeOut, musicStart: music.start } : null,
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

	$effect(() => {
		if (vid) vid.volume = !music || music.error || mode === 'mix' ? Math.min(music ? videoVolume / 100 : 1, 1) : 0;
		if (aud) {
			aud.volume = Math.min(musicVolume / 100, 1);
			aud.loop = loopMusic;
		}
	});

	/** Waveform path for the visible part of the music bar (repeats when the music loops). */
	function wave(width: number): string {
		if (!music?.peaks.length || !music.duration || width < 4) return '';
		const n = Math.min(Math.floor(width / 3), 1200);
		const secs = width / pps;
		let d = '';
		for (let i = 0; i < n; i++) {
			const t = (i / n) * secs;
			const peak = music.peaks[Math.min(Math.floor(((t % music.duration) / music.duration) * music.peaks.length), music.peaks.length - 1)];
			const h = Math.max(peak * 100, 4);
			d += `M${i * 3 + 1.5} ${50 - h / 2}V${50 + h / 2}`;
		}
		return d;
	}

	const musicWidth = $derived(music && !music.error ? Math.max(0, (loopMusic || music.duration === null ? total - music.start : Math.min(music.duration, total - music.start)) * pps) : 0);

	onMount(() => {
		const progress = listen<{ jobId: string; percent: number }>('job-progress', (e) => {
			if (e.payload.jobId === jobId) percent = e.payload.percent;
		});
		const stopDrop = listenFileDrop(addPaths, (h) => (dragging = h));
		window.addEventListener('keydown', onKey);
		return () => {
			progress.then((fn) => fn());
			stopDrop();
			window.removeEventListener('keydown', onKey);
			clearTimeout(stillTimer);
			untrack(stopPlay);
		};
	});
</script>

{#each failed as f, i (f)}
	<div class="bad fail"><TriangleAlert size={14} /> <span>{f}</span> <button class="icon-btn" aria-label={tr('Tutup', 'Dismiss')} onclick={() => (failed = failed.filter((_, k) => k !== i))}><X size={14} /></button></div>
{/each}

<audio bind:this={aud} src={music && !music.error ? convertFileSrc(music.path) : undefined} preload="auto"></audio>

<div class="stage" class:empty={!clips.length} class:drop={dragging}>
	<!-- svelte-ignore a11y_media_has_caption -->
	<video
		bind:this={vid}
		class:hidden={!previewOk || !clips.length}
		playsinline
		preload="auto"
		onerror={() => {
			if (!loadedPath) return;
			previewOk = false;
			stopPlay();
			showFrame();
		}}
		onseeked={() => (settling = false)}
	></video>
	{#if clips.length && !previewOk}
		{#if still}<img src={still} alt={tr('Bingkai di kepala putar', 'Frame at the playhead')} />{/if}
		<p class="note">{tr('Format ini tidak bisa diputar di pratinjau, tetapi bingkainya tetap tampil dan ekspor tetap berjalan.', 'This format cannot play in the preview, but frames still show and export still works.')}</p>
	{:else if !clips.length}
		<p class="note">{tr('Klik garis waktu di bawah untuk menambah video, atau seret video ke sini.', 'Click the timeline below to add a video, or drop one here.')}</p>
	{/if}
</div>

<div class="bar-tools">
		<button class="icon-btn big" aria-label={playing ? tr('Jeda', 'Pause') : tr('Putar', 'Play')} disabled={!previewOk || !clips.length || running} onclick={togglePlay}>
			{#if playing}<Pause size={18} />{:else}<Play size={18} />{/if}
		</button>
		<span class="clock">{formatClock(playhead)} <span class="dim">/ {formatClock(total)}</span></span>
		<span class="sep"></span>
		<button class="btn" disabled={!splittable || running} onclick={split} title={tr('Belah di kepala putar (S)', 'Split at the playhead (S)')}><Scissors size={14} /> {tr('Belah', 'Split')}</button>
		<button class="btn" disabled={!selId || running} onclick={removeSelected} title={tr('Hapus klip terpilih (Delete)', 'Delete the selected clip (Delete)')}><Trash2 size={14} /> {tr('Hapus', 'Delete')}</button>
		<button class="icon-btn" aria-label={tr('Urungkan', 'Undo')} disabled={!past.length || running} onclick={undo}><Undo2 size={16} /></button>
		<button class="icon-btn" aria-label={tr('Ulangi', 'Redo')} disabled={!future.length || running} onclick={redo}><Redo2 size={16} /></button>
		<label class="zoom"><span class="dim">{tr('Zoom', 'Zoom')}</span> <input type="range" min="8" max="200" step="2" bind:value={pps} aria-label={tr('Zoom garis waktu', 'Timeline zoom')} /></label>
	</div>

	<div class="scroller" bind:this={scroller}>
		<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
		<div
			class="lane"
			bind:this={lane}
			style:width="{laneW}px"
			role="application"
			tabindex="0"
			aria-label={tr('Garis waktu video', 'Video timeline')}
			onpointerdown={onDown}
			onpointermove={onMove}
			onpointerup={onUp}
			onpointercancel={onUp}
		>
			<div class="ruler">
				{#each ticks as t (t)}
					<span class="tick" style:left="{t * pps}px">{formatClock(t).replace(/\.0$/, '')}</span>
				{/each}
			</div>
			<div class="track">
				{#if !clips.length}
					<button class="add-slot" onclick={pickVideos} disabled={running}><Plus size={16} /> {tr('Klik untuk menambah video', 'Click to add a video')}</button>
				{/if}
				{#each clips as c, i (c.id)}
					<div class="clip" class:sel={c.id === selId} data-clip={c.id} style:left="{offs[i] * pps}px" style:width="{lengthOf(c) * pps}px" title={c.name}>
						<div class="tiles">
							{#each tiles(c) as t (t.left)}<img src={t.url} alt="" draggable="false" style:left="{t.left}px" style:width="{t.width}px" />{/each}
						</div>
						<span class="label">{c.name} · {formatClock(lengthOf(c))}</span>
						<span class="handle l" data-handle="l"></span>
						<span class="handle r" data-handle="r"></span>
					</div>
				{/each}
			</div>
			{#if !music}
				<div class="track music-track"><button class="add-slot" onclick={pickMusic} disabled={running}><Music size={14} /> {tr('Klik untuk menambah musik', 'Click to add music')}</button></div>
			{:else if !music.error}
				<div class="track music-track">
					<div class="mbar" data-music style:left="{music.start * pps}px" style:width="{musicWidth}px" title={music.name}>
						<svg class="wave" viewBox="0 0 {Math.max(Math.min(Math.floor(musicWidth / 3), 1200) * 3, 1)} 100" preserveAspectRatio="none" aria-hidden="true"><path d={wave(musicWidth)} /></svg>
						<span class="mname"><Music size={13} /> {music.name}</span>
					</div>
				</div>
			{/if}
			<div class="playhead" style:left="{playhead * pps}px"></div>
		</div>
	</div>
	<div class="row">
		<button class="btn" onclick={pickVideos} disabled={running}><Plus size={14} /> {tr('Tambah klip', 'Add a clip')}</button>
		{#if selected}<span class="dim">{selected.name}: {formatClock(selected.start)} {tr('sampai', 'to')} {formatClock(selected.end)} ({formatClock(lengthOf(selected))}{selected.info.hasAudio ? '' : `, ${tr('tanpa suara', 'no sound')}`})</span>{/if}
	</div>

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
	</div>
	{#if running}
		<div class="bar" class:indeterminate={percent < 0}><div style:width="{Math.max(percent, 0)}%"></div></div>
		<p class="dim">{percent >= 0 ? `${Math.round(percent)}%` : ''} {tr('Memproses video…', 'Processing the video…')}</p>
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
	h3 { margin: var(--space-5) 0 var(--space-2); font-size: 1em; }
	.dim { color: var(--text-dim); font-size: 13px; font-weight: 400; }
	.bad { display: inline-flex; align-items: center; gap: var(--space-1); color: var(--danger); font-size: 13px; }
	.fail { margin-top: var(--space-2); display: flex; }
	.stage { position: relative; display: grid; place-items: center; height: 300px; margin-top: var(--space-4); background: var(--surface-2); border-radius: var(--radius-3); overflow: hidden; }
	.stage video, .stage img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
	.stage video.hidden { visibility: hidden; }
	.stage.drop { outline: 2px dashed var(--accent-strong); outline-offset: -2px; }
	.add-slot { display: flex; align-items: center; justify-content: center; gap: var(--space-2); position: absolute; inset: 0 var(--space-3); border: 1px dashed var(--border-strong); border-radius: var(--radius-2); background: var(--surface-2); color: var(--text-muted); cursor: pointer; white-space: nowrap; }
	.add-slot:hover:not(:disabled) { color: var(--text); border-color: var(--accent-strong); }
	.note { position: relative; margin: 0; padding: var(--space-2) var(--space-3); color: var(--text-dim); font-size: 13px; text-align: center; max-width: 440px; }
	.stage:not(.empty) .note { align-self: end; margin-bottom: var(--space-2); background: color-mix(in srgb, var(--surface) 85%, transparent); color: var(--text); border-radius: var(--radius-2); }
	.bar-tools { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); margin: var(--space-3) 0; }
	.clock { font-variant-numeric: tabular-nums; font-weight: 600; min-width: 128px; }
	.sep { width: 1px; height: 20px; background: var(--border); margin: 0 var(--space-1); }
	.zoom { display: inline-flex; align-items: center; gap: var(--space-2); margin-left: auto; }
	.zoom input { width: 120px; }
	.scroller { overflow-x: auto; overflow-y: hidden; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-3); }
	.lane { position: relative; min-width: 100%; box-sizing: border-box; padding-bottom: var(--space-3); min-height: 136px; touch-action: none; user-select: none; -webkit-user-select: none; outline: none; cursor: default; }
	.lane:focus-visible { box-shadow: inset 0 0 0 2px var(--accent-strong); }
	.ruler { position: relative; height: 24px; border-bottom: 1px solid var(--border); cursor: pointer; }
	.tick { position: absolute; top: 0; height: 100%; padding-left: var(--space-1); border-left: 1px solid var(--border-strong); color: var(--text-dim); font-size: 11px; line-height: 24px; font-variant-numeric: tabular-nums; white-space: nowrap; }
	.track { position: relative; height: 64px; margin-top: var(--space-2); }
	.clip { position: absolute; top: 0; height: 100%; box-sizing: border-box; overflow: hidden; background: var(--surface-2); border: 1px solid var(--border-strong); border-radius: var(--radius-2); cursor: grab; }
	.clip.sel { border-color: var(--accent-strong); box-shadow: 0 0 0 2px var(--accent-strong); z-index: 1; }
	.tiles { position: absolute; inset: 0; }
	.tiles img { position: absolute; top: 0; height: 100%; object-fit: cover; pointer-events: none; }
	.label { position: absolute; left: var(--space-2); bottom: var(--space-1); max-width: calc(100% - var(--space-4)); padding: 0 var(--space-1); background: color-mix(in srgb, var(--surface) 85%, transparent); color: var(--text); border-radius: var(--radius-1); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; pointer-events: none; }
	.handle { position: absolute; top: 0; bottom: 0; width: 10px; background: var(--accent-strong); opacity: 0; cursor: col-resize; }
	.handle.l { left: 0; }
	.handle.r { right: 0; }
	.clip:hover .handle, .clip.sel .handle { opacity: 0.9; }
	.music-track { height: 28px; }
	.mbar { position: absolute; top: 0; height: 100%; box-sizing: border-box; overflow: hidden; background: var(--surface-2); border: 1px solid var(--border-strong); border-radius: var(--radius-2); font-size: 12px; white-space: nowrap; cursor: grab; }
	.wave { position: absolute; inset: 0; width: 100%; height: 100%; }
	.wave path { stroke: var(--accent-strong); stroke-width: 1.4; fill: none; opacity: 0.7; }
	.mname { position: relative; display: inline-flex; align-items: center; gap: var(--space-1); padding: 0 var(--space-2); pointer-events: none; }
	.playhead { position: absolute; top: 0; bottom: 0; width: 2px; margin-left: -1px; background: var(--danger); pointer-events: none; z-index: 2; }
	.playhead::before { content: ''; position: absolute; top: 0; left: -4px; width: 10px; height: 10px; background: var(--danger); border-radius: var(--radius-1); }
	.name { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-weight: 600; }
	.top { display: flex; align-items: center; gap: var(--space-2); min-width: 0; }
	.icon-btn { display: inline-grid; place-items: center; padding: var(--space-1); border: 0; border-radius: var(--radius-1); background: none; color: var(--text-dim); }
	.icon-btn.big { padding: var(--space-2); background: var(--surface-2); color: var(--text); border-radius: var(--radius-pill); }
	.icon-btn:hover:not(:disabled) { background: var(--surface-2); color: var(--text); }
	.icon-btn:disabled { opacity: 0.4; }
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
