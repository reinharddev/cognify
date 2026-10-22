<script lang="ts">
	import { onMount } from 'svelte';
	import { invoke } from '@tauri-apps/api/core';
	import { listen } from '@tauri-apps/api/event';
	import { open } from '@tauri-apps/plugin-dialog';
	import { revealItemInDir } from '@tauri-apps/plugin-opener';
	import { ArrowUp, ArrowDown, X, Check, TriangleAlert } from '@lucide/svelte';
	import DropZone from '$lib/components/DropZone.svelte';
	import FolderPicker from '$lib/components/FolderPicker.svelte';
	import { t, type DictKey } from '$lib/i18n.svelte';
	import { extOf, fileName, formatClock, listenFileDrop } from '../util';

	type Info = { durationSec: number; width: number; height: number; hasAudio: boolean; videoCodec: string; audioCodec: string | null; fps: number | null };
	type Item = { id: string; path: string; name: string; info?: Info; error?: string };
	type Plan = { compatible: boolean; reasons: string[]; totalSec: number };
	type Result = { output: string; expectedSec: number; actualSec: number; method: 'copy' | 'reencode' };

	const INPUTS = ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'flv', 'wmv', 'mpg', 'mpeg'];

	let items = $state<Item[]>([]);
	let outDir = $state<string | null>(null);
	let dragging = $state(false);
	let running = $state(false);
	let percent = $state(0);
	let plan = $state<Plan | null>(null);
	let planError = $state<string | null>(null);
	let result = $state<Result | null>(null);
	let error = $state<string | null>(null);
	let jobId = '';

	const ready = $derived(items.length >= 2 && items.every((i) => i.info && !i.error));
	const total = $derived(items.reduce((sum, i) => sum + (i.info?.durationSec ?? 0), 0));

	function addPaths(paths: string[]) {
		result = null;
		error = null;
		const known = new Set(items.map((i) => i.path));
		for (const path of paths) {
			if (known.has(path) || !INPUTS.includes(extOf(path))) continue;
			known.add(path);
			const id = crypto.randomUUID();
			items.push({ id, path, name: fileName(path) });
			invoke<Info>('video_info', { path })
				.then((info) => patch(id, { info }))
				.catch((e) => patch(id, { error: String(e) }));
		}
	}

	function patch(id: string, p: Partial<Item>) {
		const item = items.find((i) => i.id === id);
		if (item) Object.assign(item, p);
	}

	async function pick() {
		const picked = await open({ multiple: true, filters: [{ name: 'Video', extensions: INPUTS }] });
		if (picked) addPaths(picked);
	}

	function move(index: number, by: -1 | 1) {
		const target = index + by;
		if (target < 0 || target >= items.length) return;
		[items[index], items[target]] = [items[target], items[index]];
	}

	function remove(id: string) {
		items = items.filter((i) => i.id !== id);
		result = null;
	}

	// Ask whether the clips can be copied together. Reasons do not depend on the
	// order, so the key ignores it and reordering does not re-probe.
	$effect(() => {
		if (!ready) {
			plan = null;
			planError = null;
			return;
		}
		const paths = items.map((i) => i.path);
		const key = [...paths].sort().join('|');
		const timer = setTimeout(async () => {
			try {
				const p = await invoke<Plan>('join_plan', { inputs: paths });
				if ([...items.map((i) => i.path)].sort().join('|') === key) {
					plan = p;
					planError = null;
				}
			} catch (e) {
				plan = null;
				planError = String(e);
			}
		}, 200);
		return () => clearTimeout(timer);
	});

	async function run() {
		running = true;
		percent = 0;
		result = null;
		error = null;
		jobId = crypto.randomUUID();
		try {
			result = await invoke<Result>('join_videos', {
				req: { jobId, inputs: items.map((i) => i.path), outDir }
			});
		} catch (e) {
			if (e !== 'cancelled') error = String(e);
		}
		running = false;
	}

	const cancel = () => invoke('cancel_job', { jobId });
	const drifted = $derived(!!result && Math.abs(result.actualSec - result.expectedSec) > Math.max(1, result.expectedSec * 0.02));

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

<DropZone {dragging} label={t('vid.drop')} buttonLabel={t('convert.choose')} onchoose={pick} />

{#if items.length > 0}
	<p class="hint">{t('pdf.merge.hint')}</p>
	<ol class="list">
		{#each items as item, i (item.id)}
			<li>
				<span class="num">{i + 1}</span>
				<span class="name" title={item.path}>{item.name}</span>
				{#if item.error}
					<span class="err" title={item.error}><TriangleAlert size={14} /> {item.error}</span>
				{:else if item.info}
					<span class="dim">
						{formatClock(item.info.durationSec)} · {item.info.width}×{item.info.height}
					</span>
				{:else}
					<span class="dim">{t('pdf.reading')}</span>
				{/if}
				<button class="icon-btn" aria-label={t('pdf.moveUp')} disabled={i === 0 || running} onclick={() => move(i, -1)}>
					<ArrowUp size={15} />
				</button>
				<button class="icon-btn" aria-label={t('pdf.moveDown')} disabled={i === items.length - 1 || running} onclick={() => move(i, 1)}>
					<ArrowDown size={15} />
				</button>
				<button class="icon-btn" aria-label={t('convert.remove')} disabled={running} onclick={() => remove(item.id)}>
					<X size={15} />
				</button>
			</li>
		{/each}
	</ol>

	{#if items.length < 2}
		<p class="hint">{t('tj.join.need')}</p>
	{:else if planError}
		<p class="plan bad">{planError}</p>
	{:else if plan}
		<div class="plan" class:warn={!plan.compatible}>
			{#if plan.compatible}
				<p>{t('tj.join.copy')}</p>
			{:else}
				<p>
					{t('tj.join.reencode')}
					<strong>{plan.reasons.map((r) => t(`tj.reason.${r}` as DictKey)).join(', ')}.</strong>
					{t('tj.join.reencode2')}
				</p>
			{/if}
		</div>
	{/if}

	<div class="options"><FolderPicker bind:value={outDir} disabled={running} /></div>

	<div class="actions">
		{#if running}
			<button class="btn" onclick={cancel}>{t('convert.cancel')}</button>
			<span class="dim">{percent >= 0 ? `${Math.round(percent)}%` : t('convert.running')}</span>
		{:else}
			<button class="btn primary" onclick={run} disabled={!ready || !!planError}>
				{t('tj.join.start')}{ready ? ` (${formatClock(total)})` : ''}
			</button>
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
			{t('tj.join.done')}: <strong>{formatClock(result.actualSec)}</strong>
			({t('tj.asked')} {formatClock(result.expectedSec)}, {t(result.method === 'copy' ? 'tj.method.copy' : 'tj.method.reencode')})
		</span>
		<button class="link" onclick={() => revealItemInDir(result!.output)}>{t('convert.reveal')}</button>
	</div>
{/if}
{#if error}<pre class="error">{error}</pre>{/if}

<style>
	.hint {
		margin: 12px 0 0;
		color: var(--text-dim);
		font-size: 13px;
	}

	.list {
		list-style: none;
		margin: 12px 0 0;
		padding: 0;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		overflow: hidden;
	}

	li {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 12px;
		border-bottom: 1px solid var(--border);
	}

	li:last-child {
		border-bottom: 0;
	}

	.num {
		width: 20px;
		color: var(--text-dim);
		font-variant-numeric: tabular-nums;
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
		max-width: 45%;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		color: var(--danger);
		font-size: 12px;
	}

	.icon-btn {
		display: inline-grid;
		place-items: center;
		padding: 4px;
		border: 0;
		border-radius: 5px;
		background: none;
		color: var(--text-dim);
	}

	.icon-btn:hover:not(:disabled) {
		background: var(--surface-2);
	}

	.plan {
		margin-top: 14px;
		padding: 10px 14px;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		font-size: 13px;
	}

	.plan.warn {
		border-color: var(--accent-strong);
		background: var(--accent-soft);
	}

	.plan.bad {
		color: var(--danger);
	}

	.options {
		margin: 20px 0;
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
