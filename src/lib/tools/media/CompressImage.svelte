<script lang="ts">
	import Select from '$lib/ui/Select.svelte';
	import { onMount } from 'svelte';
	import { invoke } from '@tauri-apps/api/core';
	import { open } from '@tauri-apps/plugin-dialog';
	import { revealItemInDir } from '@tauri-apps/plugin-opener';
	import { X, Check, TriangleAlert, Minus } from '@lucide/svelte';
	import DropZone from '$lib/components/DropZone.svelte';
	import FolderPicker from '$lib/components/FolderPicker.svelte';
	import { t } from '$lib/i18n.svelte';
	import { extOf, fileName, formatBytes, listenFileDrop } from '../util';

	type Status = 'queued' | 'running' | 'done' | 'nochange' | 'error';
	type Item = {
		id: string;
		path: string;
		name: string;
		status: Status;
		before?: number;
		after?: number;
		output?: string | null;
		error?: string;
	};
	type Result = { before: number; after: number; output: string | null };

	const INPUTS = ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tiff', 'tif'];
	const SIZES: (number | null)[] = [null, 3840, 2560, 1920, 1600, 1280, 1024, 800];

	let items = $state<Item[]>([]);
	let format = $state<'same' | 'jpg' | 'webp' | 'png'>('same');
	let quality = $state(78);
	let maxSide = $state<number | null>(null);
	let strip = $state(true);
	let outDir = $state<string | null>(null);
	let dragging = $state(false);
	let running = $state(false);
	let supported = $state<string[] | null>(null); // encoders ffmpeg really has

	const formats = $derived(
		(['same', 'jpg', 'webp', 'png'] as const).filter((f) => f === 'same' || !supported || supported.includes(f))
	);
	const queued = $derived(items.filter((i) => i.status === 'queued').length);
	const saved = $derived(
		items.reduce((sum, i) => (i.status === 'done' ? sum + (i.before! - i.after!) : sum), 0)
	);
	const percent = (i: Item) => Math.round((1 - i.after! / i.before!) * 100);

	$effect(() => {
		if (!formats.includes(format)) format = 'same';
	});

	function addPaths(paths: string[]) {
		const known = new Set(items.map((i) => i.path));
		for (const path of paths) {
			if (known.has(path) || !INPUTS.includes(extOf(path))) continue;
			known.add(path);
			items.push({ id: crypto.randomUUID(), path, name: fileName(path), status: 'queued' });
		}
	}

	async function pick() {
		const picked = await open({ multiple: true, filters: [{ name: 'Image', extensions: INPUTS }] });
		if (picked) addPaths(picked);
	}

	async function start() {
		running = true;
		for (const item of items) {
			if (item.status !== 'queued') continue;
			item.status = 'running';
			try {
				const r = await invoke<Result>('compress_image', {
					req: { jobId: item.id, input: item.path, outDir, format, quality, maxSide, stripMetadata: strip }
				});
				item.before = r.before;
				item.after = r.after;
				item.output = r.output;
				item.status = r.output ? 'done' : 'nochange';
			} catch (e) {
				item.status = 'error';
				item.error = String(e);
			}
		}
		running = false;
	}

	const remove = (id: string) => (items = items.filter((i) => i.id !== id));
	const clearFinished = () => (items = items.filter((i) => i.status === 'queued' || i.status === 'running'));

	onMount(() => {
		invoke<string[]>('available_formats')
			.then((f) => (supported = f))
			.catch(() => {});
		return listenFileDrop(addPaths, (h) => (dragging = h));
	});
</script>

<DropZone {dragging} label={t('img.drop')} buttonLabel={t('convert.choose')} onchoose={pick} />

<div class="options">
	<div class="field">
		<span class="label">{t('convert.format')}</span>
		<div class="seg">
			{#each formats as f (f)}
				<button class:on={format === f} disabled={running} onclick={() => (format = f)}>
					{f === 'same' ? t('img.format.same') : f.toUpperCase()}
				</button>
			{/each}
		</div>
	</div>

	<div class="field">
		<label class="label" for="maxside">{t('img.maxside')}</label>
		<Select id="maxside" bind:value={maxSide} disabled={running} options={SIZES.map((s) => ({ value: s, label: s === null ? t('img.original') : `${s} px` }))} />
	</div>

	<div class="field quality" class:off={format === 'png'}>
		<label class="label" for="quality">{t('img.quality')}: <strong>{quality}</strong></label>
		<input id="quality" type="range" min="30" max="95" step="1" bind:value={quality} disabled={running || format === 'png'} />
		{#if format === 'png'}<span class="dim">{t('img.quality.png')}</span>{/if}
	</div>

	<FolderPicker bind:value={outDir} disabled={running} />
</div>

<label class="check">
	<input type="checkbox" bind:checked={strip} disabled={running} />
	{t('img.strip')}
</label>
<p class="hint">{t('img.hint')}</p>

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
						{:else if item.status === 'running'}{t('pdf.working')}
						{:else if item.status === 'done'}
							{formatBytes(item.before!)} → {formatBytes(item.after!)}
							<strong class="gain">-{percent(item)}%</strong>
						{:else if item.status === 'nochange'}{t('compress.nochange')}
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
				{#if item.error}<pre class="error">{item.error}</pre>{/if}
			</li>
		{/each}
	</ul>

	<div class="actions">
		<button class="btn primary" onclick={start} disabled={queued === 0 || running}>
			{running ? t('pdf.working') : `${t('compress.start')}${queued > 0 ? ` (${queued})` : ''}`}
		</button>
		<button class="btn" onclick={clearFinished} disabled={running}>{t('convert.clear')}</button>
		{#if saved > 0}<span class="total">{formatBytes(saved)} {t('compress.saved')}</span>{/if}
	</div>
{/if}

<style>
	.options {
		display: flex;
		flex-wrap: wrap;
		gap: 22px 28px;
		margin: 22px 0 14px;
	}

	.field {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 8px;
	}

	.label {
		font-size: 12px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-dim);
	}

	.seg {
		display: inline-flex;
		border: var(--edge-w) solid var(--edge);
		border-radius: 8px;
		overflow: hidden;
		background: var(--surface);
	}

	.seg button {
		padding: 7px 14px;
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


	.quality {
		min-width: 220px;
	}

	.quality.off {
		opacity: 0.7;
	}

	.quality input[type='range'] {
		width: 100%;
		accent-color: var(--accent-strong);
	}

	.dim {
		color: var(--text-dim);
		font-size: 12px;
		max-width: 300px;
	}

	.check {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 6px;
	}

	.hint {
		margin: 0 0 18px;
		color: var(--text-dim);
		font-size: 13px;
	}

	.list {
		list-style: none;
		margin: 0 0 18px;
		padding: 0;
		border: var(--edge-w) solid var(--edge);
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

	.actions {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.total {
		margin-left: 6px;
		color: var(--ok);
		font-weight: 550;
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
