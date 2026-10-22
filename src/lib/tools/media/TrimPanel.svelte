<script lang="ts">
	import { onMount } from 'svelte';
	import { invoke } from '@tauri-apps/api/core';
	import { listen } from '@tauri-apps/api/event';
	import { open } from '@tauri-apps/plugin-dialog';
	import { revealItemInDir } from '@tauri-apps/plugin-opener';
	import { Check, TriangleAlert } from '@lucide/svelte';
	import DropZone from '$lib/components/DropZone.svelte';
	import FolderPicker from '$lib/components/FolderPicker.svelte';
	import { t } from '$lib/i18n.svelte';
	import { extOf, fileName, formatClock, listenFileDrop, parseTime } from '../util';

	type Info = { durationSec: number; width: number; height: number; hasAudio: boolean; videoCodec: string; audioCodec: string | null; fps: number | null };
	type Result = { output: string; expectedSec: number; actualSec: number; method: 'copy' | 'reencode' };

	const INPUTS = ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'flv', 'wmv', 'mpg', 'mpeg'];

	let file = $state<{ path: string; name: string; info?: Info; error?: string } | null>(null);
	let startText = $state('0:00.0');
	let endText = $state('');
	let mode = $state<'fast' | 'precise'>('fast');
	let outDir = $state<string | null>(null);
	let dragging = $state(false);
	let running = $state(false);
	let percent = $state(0);
	let result = $state<Result | null>(null);
	let error = $state<string | null>(null);
	let startThumb = $state<string | null>(null);
	let endThumb = $state<string | null>(null);
	let jobId = '';

	const duration = $derived(file?.info?.durationSec ?? null);
	const start = $derived(parseTime(startText));
	const end = $derived(parseTime(endText));
	const effectiveEnd = $derived(end !== null && duration !== null ? Math.min(end, duration) : end);
	const problem = $derived.by(() => {
		if (start === null || end === null) return 'tj.invalidTime' as const;
		if (effectiveEnd !== null && effectiveEnd - start < 0.1) return 'tj.outOfRange' as const;
		return null;
	});
	const length = $derived(!problem && start !== null && effectiveEnd !== null ? effectiveEnd - start : null);
	const canRun = $derived(!!file?.info && !problem && !running);

	async function setFile(path: string) {
		if (!INPUTS.includes(extOf(path))) return;
		result = null;
		error = null;
		startThumb = endThumb = null;
		startText = '0:00.0';
		endText = '';
		file = { path, name: fileName(path) };
		try {
			const info = await invoke<Info>('video_info', { path });
			if (file?.path !== path) return;
			file.info = info;
			endText = formatClock(info.durationSec);
		} catch (e) {
			if (file?.path === path) file.error = String(e);
		}
	}

	async function pick() {
		const picked = await open({ multiple: false, filters: [{ name: 'Video', extensions: INPUTS }] });
		if (typeof picked === 'string') setFile(picked);
	}

	// Thumbnails of both cut points, so a wrong time is obvious before cutting.
	let thumbToken = 0;
	$effect(() => {
		const f = file;
		const s = start;
		const e = effectiveEnd;
		if (!f?.info || problem || s === null || e === null) return;
		const timer = setTimeout(async () => {
			const token = ++thumbToken;
			const grab = (time: number) =>
				invoke<string>('video_frame', { path: f.path, time, width: 320 }).catch(() => null);
			const [a, b] = await Promise.all([grab(s), grab(Math.max(s, e - 0.1))]);
			if (token === thumbToken) {
				startThumb = a;
				endThumb = b;
			}
		}, 350);
		return () => clearTimeout(timer);
	});

	async function run() {
		if (!file || start === null || end === null) return;
		running = true;
		percent = 0;
		result = null;
		error = null;
		jobId = crypto.randomUUID();
		try {
			result = await invoke<Result>('trim_video', {
				req: { jobId, input: file.path, outDir, start, end, mode }
			});
		} catch (e) {
			if (e !== 'cancelled') error = String(e);
		}
		running = false;
	}

	const cancel = () => invoke('cancel_job', { jobId });
	const drifted = $derived(!!result && Math.abs(result.actualSec - result.expectedSec) > 0.5);

	onMount(() => {
		const progress = listen<{ jobId: string; percent: number }>('job-progress', (e) => {
			if (e.payload.jobId === jobId) percent = e.payload.percent;
		});
		const stopDrop = listenFileDrop((paths) => paths[0] && setFile(paths[0]), (h) => (dragging = h));
		return () => {
			progress.then((fn) => fn());
			stopDrop();
		};
	});
</script>

<DropZone {dragging} label={t('tj.drop1')} buttonLabel={file ? t('pdf.replace') : t('tj.pick1')} onchoose={pick} />

{#if file}
	<div class="file">
		<span class="name" title={file.path}>{file.name}</span>
		{#if file.error}
			<span class="err"><TriangleAlert size={14} /> {file.error}</span>
		{:else if file.info}
			<span class="dim">
				{formatClock(file.info.durationSec)} · {file.info.width}×{file.info.height} · {file.info.videoCodec}
			</span>
		{:else}
			<span class="dim">{t('pdf.reading')}</span>
		{/if}
	</div>
{/if}

{#if file?.info}
	<div class="times">
		<div class="time">
			<label class="label" for="t-start">{t('tj.start')}</label>
			<input id="t-start" bind:value={startText} disabled={running} class:bad={start === null} spellcheck="false" />
			<div class="thumb">
				{#if startThumb}<img src={startThumb} alt={t('tj.frameStart')} />{:else}<span>{t('tj.noFrame')}</span>{/if}
			</div>
		</div>
		<div class="time">
			<label class="label" for="t-end">{t('tj.end')}</label>
			<input id="t-end" bind:value={endText} disabled={running} class:bad={end === null} spellcheck="false" />
			<div class="thumb">
				{#if endThumb}<img src={endThumb} alt={t('tj.frameEnd')} />{:else}<span>{t('tj.noFrame')}</span>{/if}
			</div>
		</div>
	</div>
	<p class="hint">
		{#if problem}<span class="bad-text">{t(problem)}</span>{:else}{t('tj.length')}: <strong>{formatClock(length!)}</strong> ·{/if}
		{t('tj.timeHint')}
	</p>

	<div class="options">
		<div class="field wide">
			<span class="label">{t('tj.mode')}</span>
			<div class="modes" role="radiogroup" aria-label={t('tj.mode')}>
				{#each ['fast', 'precise'] as const as m (m)}
					<button class="mode" class:on={mode === m} role="radio" aria-checked={mode === m} disabled={running} onclick={() => (mode = m)}>
						<strong>{t(m === 'fast' ? 'tj.fast' : 'tj.precise')}</strong>
						<span>{t(m === 'fast' ? 'tj.fast.desc' : 'tj.precise.desc')}</span>
					</button>
				{/each}
			</div>
		</div>
		<FolderPicker bind:value={outDir} disabled={running} />
	</div>

	<div class="actions">
		{#if running}
			<button class="btn" onclick={cancel}>{t('convert.cancel')}</button>
			<span class="dim">{percent >= 0 ? `${Math.round(percent)}%` : t('convert.running')}</span>
		{:else}
			<button class="btn primary" onclick={run} disabled={!canRun}>{t('tj.cut')}</button>
		{/if}
	</div>
	{#if running}
		<div class="bar"><div style:width="{Math.max(percent, 0)}%"></div></div>
	{/if}
{/if}

{#if result}
	<div class="result" class:drift={drifted}>
		<Check size={16} />
		<span>
			{t('tj.trim.done')}: {formatClock(result.expectedSec)} {t('tj.asked')} → <strong>{formatClock(result.actualSec)}</strong>
			{t('tj.got')} ({t(result.method === 'copy' ? 'tj.method.copy' : 'tj.method.reencode')})
		</span>
		<button class="link" onclick={() => revealItemInDir(result!.output)}>{t('convert.reveal')}</button>
	</div>
{/if}
{#if error}<pre class="error">{error}</pre>{/if}

<style>
	.file {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-top: 16px;
		padding: 10px 14px;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
	}

	.name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.dim {
		color: var(--text-dim);
		font-size: 13px;
		font-variant-numeric: tabular-nums;
	}

	.err {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		color: var(--danger);
		font-size: 12px;
	}

	.times {
		display: flex;
		flex-wrap: wrap;
		gap: 20px;
		margin-top: 20px;
	}

	.time {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.label {
		font-size: 12px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-dim);
	}

	input {
		width: 140px;
		padding: 8px 10px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--surface);
		color: var(--text);
		font: inherit;
		font-variant-numeric: tabular-nums;
		user-select: text;
		-webkit-user-select: text;
	}

	input.bad {
		border-color: var(--danger);
	}

	.thumb {
		display: grid;
		place-items: center;
		width: 240px;
		aspect-ratio: 16 / 9;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--surface-2);
		overflow: hidden;
		color: var(--text-dim);
		font-size: 12px;
	}

	.thumb img {
		width: 100%;
		height: 100%;
		object-fit: contain;
	}

	.hint {
		margin: 12px 0 0;
		color: var(--text-dim);
		font-size: 13px;
	}

	.bad-text {
		color: var(--danger);
	}

	.options {
		display: flex;
		flex-wrap: wrap;
		gap: 22px 28px;
		margin: 20px 0;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.field.wide {
		flex-basis: 100%;
	}

	.modes {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
		gap: 10px;
	}

	.mode {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 12px 14px;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		text-align: left;
	}

	.mode span {
		color: var(--text-dim);
		font-size: 12.5px;
	}

	.mode.on {
		border-color: var(--accent-strong);
		background: var(--accent-soft);
	}

	.actions {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.bar {
		height: 4px;
		margin-top: 12px;
		border-radius: 2px;
		background: var(--surface-2);
		overflow: hidden;
	}

	.bar div {
		height: 100%;
		background: var(--accent);
		transition: width 0.2s;
	}

	.result {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 16px;
		color: var(--ok);
	}

	.result.drift {
		color: var(--text);
	}

	.result.drift :global(svg) {
		color: var(--ok);
	}

	.link {
		border: 0;
		background: none;
		padding: 0;
		color: var(--link);
		font-size: 13px;
	}

	.error {
		margin: 12px 0 0;
		padding: 8px 10px;
		border-radius: 6px;
		background: var(--surface-2);
		color: var(--danger);
		font-size: 12px;
		white-space: pre-wrap;
		user-select: text;
		-webkit-user-select: text;
	}
</style>
