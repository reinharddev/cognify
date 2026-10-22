<script lang="ts">
	import { onMount } from 'svelte';
	import { invoke } from '@tauri-apps/api/core';
	import { listen } from '@tauri-apps/api/event';
	import { open } from '@tauri-apps/plugin-dialog';
	import { revealItemInDir } from '@tauri-apps/plugin-opener';
	import { X, Check, TriangleAlert, Minus } from '@lucide/svelte';
	import DropZone from '$lib/components/DropZone.svelte';
	import FolderPicker from '$lib/components/FolderPicker.svelte';
	import { t } from '$lib/i18n.svelte';
	import { extOf, fileName, formatBytes, formatDuration, listenFileDrop } from '../util';

	type Status = 'queued' | 'running' | 'done' | 'nochange' | 'error' | 'cancelled';
	type Plan = {
		durationSec: number;
		sourceBytes: number;
		targetBytes: number;
		audioKbps: number;
		videoKbps: number;
		sourceShortSide: number;
		capShortSide: number | null;
		feasible: boolean;
		minTargetBytes: number;
		alreadySmaller: boolean;
	};
	type Item = {
		id: string;
		path: string;
		name: string;
		status: Status;
		percent: number;
		plan?: Plan;
		planKey?: string;
		planError?: string;
		before?: number;
		after?: number;
		target?: number;
		output?: string | null;
		reason?: 'alreadySmaller' | 'notSmaller' | null;
		error?: string;
	};
	type Result = {
		before: number;
		after: number;
		target: number;
		output: string | null;
		reason: 'alreadySmaller' | 'notSmaller' | null;
	};

	const INPUTS = ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'flv', 'wmv', 'mpg', 'mpeg'];
	const PRESETS = [10, 16, 25, 50, 100];
	const RESOLUTIONS = ['auto', 'original', '1080', '720', '480', '360'];

	let items = $state<Item[]>([]);
	let targetMb = $state(16);
	let resolution = $state('auto');
	let outDir = $state<string | null>(null);
	let dragging = $state(false);
	let running = $state(false);
	let ffmpegMissing = $state(false);
	let currentJobId: string | null = null;
	let stopRequested = false;

	const queued = $derived(items.filter((i) => i.status === 'queued').length);
	const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);

	function addPaths(paths: string[]) {
		const known = new Set(items.map((i) => i.path));
		for (const path of paths) {
			if (known.has(path) || !INPUTS.includes(extOf(path))) continue;
			known.add(path);
			items.push({ id: crypto.randomUUID(), path, name: fileName(path), status: 'queued', percent: 0 });
		}
	}

	async function pick() {
		const picked = await open({ multiple: true, filters: [{ name: 'Video', extensions: INPUTS }] });
		if (picked) addPaths(picked);
	}

	// Preview what each file would get, re-asked (debounced) whenever the target,
	// resolution or file list changes. Answers for an outdated key are dropped.
	async function refreshPlans(targetMbNow: number, resolutionNow: string) {
		const key = `${targetMbNow}|${resolutionNow}`;
		for (const item of items.filter((i) => i.status === 'queued')) {
			if (item.planKey === key) continue;
			try {
				const plan = await invoke<Plan>('video_plan', {
					req: { input: item.path, targetMb: targetMbNow, resolution: resolutionNow }
				});
				if (`${targetMb}|${resolution}` === key) {
					item.plan = plan;
					item.planKey = key;
					item.planError = undefined;
				}
			} catch (e) {
				item.plan = undefined;
				item.planKey = key;
				item.planError = String(e);
			}
		}
	}

	$effect(() => {
		const targetNow = targetMb;
		const resolutionNow = resolution;
		items.filter((i) => i.status === 'queued').map((i) => i.id); // re-run when files change
		if (!(targetNow >= 0.1)) return;
		const timer = setTimeout(() => refreshPlans(targetNow, resolutionNow), 250);
		return () => clearTimeout(timer);
	});

	async function start() {
		running = true;
		stopRequested = false;
		for (const item of items) {
			if (stopRequested) break;
			if (item.status !== 'queued') continue;
			item.status = 'running';
			item.percent = 0;
			currentJobId = item.id;
			try {
				const r = await invoke<Result>('compress_video', {
					req: { jobId: item.id, input: item.path, outDir, targetMb, resolution }
				});
				Object.assign(item, { before: r.before, after: r.after, target: r.target, output: r.output, reason: r.reason });
				item.status = r.output ? 'done' : 'nochange';
				item.percent = 100;
			} catch (e) {
				if (e === 'cancelled') {
					item.status = 'cancelled';
				} else {
					item.status = 'error';
					item.error = String(e);
				}
			}
			currentJobId = null;
		}
		running = false;
	}

	function cancel() {
		stopRequested = true;
		if (currentJobId) invoke('cancel_job', { jobId: currentJobId });
	}

	const remove = (id: string) => (items = items.filter((i) => i.id !== id));
	const clearFinished = () => (items = items.filter((i) => i.status === 'queued' || i.status === 'running'));

	onMount(() => {
		invoke<string | null>('engine_status', { name: 'ffprobe' }).then((p) => (ffmpegMissing = !p));
		const unlistenProgress = listen<{ jobId: string; percent: number }>('job-progress', (e) => {
			const item = items.find((i) => i.id === e.payload.jobId);
			if (item) item.percent = e.payload.percent;
		});
		const stopDrop = listenFileDrop(addPaths, (h) => (dragging = h));
		return () => {
			unlistenProgress.then((fn) => fn());
			stopDrop();
		};
	});
</script>

{#if ffmpegMissing}
	<div class="notice">
		<TriangleAlert size={18} />
		<div>
			<strong>{t('engine.missing')}</strong>
			<p>{t('engine.install')}</p>
		</div>
	</div>
{/if}

<DropZone {dragging} label={t('vid.drop')} buttonLabel={t('convert.choose')} onchoose={pick} />

<div class="options">
	<div class="field">
		<span class="label">{t('vid.target')}</span>
		<div class="target">
			<div class="seg">
				{#each PRESETS as p (p)}
					<button class:on={targetMb === p} disabled={running} onclick={() => (targetMb = p)}>{p} MB</button>
				{/each}
			</div>
			<label class="custom">
				<span class="dim">{t('vid.custom')}</span>
				<input type="number" min="0.5" step="0.5" bind:value={targetMb} disabled={running} />
				<span class="dim">MB</span>
			</label>
		</div>
		<span class="dim wide">{t('vid.hint')}</span>
	</div>

	<div class="field">
		<label class="label" for="res">{t('vid.resolution')}</label>
		<select id="res" bind:value={resolution} disabled={running}>
			{#each RESOLUTIONS as r (r)}
				<option value={r}>
					{r === 'auto' ? t('vid.auto') : r === 'original' ? t('vid.original') : `${r}p`}
				</option>
			{/each}
		</select>
		<span class="dim wide">{t('vid.resolution.hint')}</span>
	</div>

	<FolderPicker bind:value={outDir} disabled={running} />
</div>

{#if items.length > 0}
	<ul class="list">
		{#each items as item (item.id)}
			<li class={item.status}>
				<div class="row">
					<span class="status-icon">
						{#if item.status === 'done'}<Check size={16} />
						{:else if item.status === 'error'}<TriangleAlert size={16} />
						{:else if item.status === 'nochange'}<Minus size={16} />{/if}
					</span>
					<span class="name" title={item.path}>{item.name}</span>
					<span class="state">
						{#if item.status === 'queued'}{t('convert.queued')}
						{:else if item.status === 'running'}
							{item.percent >= 0 ? `${Math.round(item.percent)}%` : t('convert.running')}
						{:else if item.status === 'done'}
							{formatBytes(item.before!)} → {formatBytes(item.after!)}
							<strong class="gain">{Math.round((item.after! / item.target!) * 100)}% {t('vid.ofTarget')}</strong>
						{:else if item.status === 'nochange'}
							{item.reason === 'alreadySmaller' ? t('vid.plan.already') : t('vid.notSmaller')}
						{:else if item.status === 'cancelled'}{t('convert.cancelled')}
						{/if}
					</span>
					{#if item.status === 'done' && item.output}
						<button class="link" onclick={() => revealItemInDir(item.output!)}>{t('convert.reveal')}</button>
					{/if}
					{#if item.status !== 'running'}
						<button class="icon-btn" aria-label={t('convert.remove')} onclick={() => remove(item.id)}>
							<X size={15} />
						</button>
					{/if}
				</div>

				{#if item.status === 'running'}
					<div class="bar" class:indeterminate={item.percent < 0}>
						<div style:width="{Math.max(item.percent, 0)}%"></div>
					</div>
				{/if}

				{#if item.status === 'queued'}
					{#if item.planError}
						<p class="plan bad">{item.planError}</p>
					{:else if item.plan}
						{@const p = item.plan}
						{#if p.alreadySmaller}
							<p class="plan">{t('vid.plan.already')}</p>
						{:else if !p.feasible}
							<p class="plan bad">{t('vid.plan.toosmall')} {mb(p.minTargetBytes)} MB.</p>
						{:else}
							<p class="plan">
								{t('vid.plan.duration')} {formatDuration(p.durationSec)} · {t('vid.plan.video')} ≈{p.videoKbps} kbps ·
								{t('vid.plan.audio')} {p.audioKbps} kbps · {t('vid.plan.res')}
								{p.capShortSide ? `${p.sourceShortSide}p → ${p.capShortSide}p` : `${p.sourceShortSide}p (${t('vid.plan.keep')})`}
							</p>
						{/if}
					{/if}
				{/if}

				{#if item.error}<pre class="error">{item.error}</pre>{/if}
			</li>
		{/each}
	</ul>

	<div class="actions">
		{#if running}
			<button class="btn" onclick={cancel}>{t('convert.cancel')}</button>
		{:else}
			<button class="btn primary" onclick={start} disabled={queued === 0 || ffmpegMissing || !(targetMb >= 0.1)}>
				{t('compress.start')}{queued > 0 ? ` (${queued})` : ''}
			</button>
			<button class="btn" onclick={clearFinished}>{t('convert.clear')}</button>
		{/if}
	</div>
{/if}

<style>
	.notice {
		display: flex;
		gap: 12px;
		padding: 12px 14px;
		margin-bottom: 16px;
		border: 1px solid var(--danger);
		border-radius: var(--radius);
		color: var(--danger);
	}

	.notice p {
		color: var(--text-dim);
	}

	.options {
		display: flex;
		flex-wrap: wrap;
		gap: 22px 32px;
		margin: 22px 0;
	}

	.field {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 8px;
		max-width: 420px;
	}

	.label {
		font-size: 12px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-dim);
	}

	.target {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 12px;
	}

	.seg {
		display: inline-flex;
		border: 1px solid var(--border);
		border-radius: 8px;
		overflow: hidden;
		background: var(--surface);
	}

	.seg button {
		padding: 7px 12px;
		border: 0;
		border-right: 1px solid var(--border);
		background: transparent;
	}

	.seg button:last-child {
		border-right: 0;
	}

	.seg button.on {
		background: var(--accent);
		color: var(--accent-text);
	}

	.custom {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}

	input[type='number'] {
		width: 80px;
		padding: 6px 8px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--surface);
		color: var(--text);
		font: inherit;
		user-select: text;
		-webkit-user-select: text;
	}

	select {
		padding: 7px 10px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--surface);
		color: var(--text);
		font: inherit;
	}

	.dim {
		color: var(--text-dim);
		font-size: 13px;
	}

	.dim.wide {
		font-size: 12.5px;
	}

	.list {
		list-style: none;
		margin: 0 0 18px;
		padding: 0;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		overflow: hidden;
	}

	li {
		padding: 10px 14px;
		border-bottom: 1px solid var(--border);
	}

	li:last-child {
		border-bottom: 0;
	}

	.row {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.status-icon {
		display: inline-flex;
		width: 16px;
	}

	li.done .status-icon {
		color: var(--ok);
	}

	li.error .status-icon {
		color: var(--danger);
	}

	li.nochange .status-icon {
		color: var(--text-dim);
	}

	.name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.state {
		font-size: 13px;
		color: var(--text-dim);
		font-variant-numeric: tabular-nums;
	}

	.gain {
		color: var(--ok);
		margin-left: 4px;
	}

	.plan {
		margin: 4px 0 0 26px;
		color: var(--text-dim);
		font-size: 12.5px;
	}

	.plan.bad {
		color: var(--danger);
	}

	.link {
		border: 0;
		background: none;
		padding: 0;
		color: var(--link);
		font-size: 13px;
	}

	.icon-btn {
		display: inline-grid;
		place-items: center;
		padding: 3px;
		border: 0;
		border-radius: 5px;
		background: none;
		color: var(--text-dim);
	}

	.icon-btn:hover {
		background: var(--surface-2);
	}

	.bar {
		height: 4px;
		margin-top: 8px;
		border-radius: 2px;
		background: var(--surface-2);
		overflow: hidden;
	}

	.bar div {
		height: 100%;
		background: var(--accent);
		transition: width 0.2s;
	}

	.bar.indeterminate div {
		width: 35% !important;
		animation: slide 1.1s ease-in-out infinite;
	}

	@keyframes slide {
		from {
			transform: translateX(-100%);
		}
		to {
			transform: translateX(300%);
		}
	}

	.actions {
		display: flex;
		gap: 10px;
	}

	.error {
		margin: 8px 0 0;
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
