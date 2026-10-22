<script lang="ts">
	import { onMount } from 'svelte';
	import { invoke } from '@tauri-apps/api/core';
	import { open } from '@tauri-apps/plugin-dialog';
	import { revealItemInDir } from '@tauri-apps/plugin-opener';
	import { X, Check, TriangleAlert, Minus } from '@lucide/svelte';
	import DropZone from '$lib/components/DropZone.svelte';
	import FolderPicker from '$lib/components/FolderPicker.svelte';
	import { t, type DictKey } from '$lib/i18n.svelte';
	import { extOf, fileName, formatBytes, listenFileDrop } from '../util';

	type Level = 'lossless' | 'balanced' | 'strong';
	type Status = 'queued' | 'running' | 'done' | 'nochange' | 'error';
	type Item = {
		id: string;
		path: string;
		name: string;
		status: Status;
		before?: number;
		after?: number;
		output?: string | null;
		considered?: number;
		replaced?: number;
		error?: string;
	};
	type Result = {
		before: number;
		after: number;
		output: string | null;
		imagesConsidered: number;
		imagesReplaced: number;
	};

	const levels: Level[] = ['lossless', 'balanced', 'strong'];

	let items = $state<Item[]>([]);
	let level = $state<Level>('balanced');
	let outDir = $state<string | null>(null);
	let dragging = $state(false);
	let running = $state(false);

	const queued = $derived(items.filter((i) => i.status === 'queued').length);
	const saved = $derived(
		items.reduce((sum, i) => (i.status === 'done' ? sum + (i.before! - i.after!) : sum), 0)
	);

	function addPaths(paths: string[]) {
		const known = new Set(items.map((i) => i.path));
		for (const path of paths) {
			if (known.has(path) || extOf(path) !== 'pdf') continue;
			known.add(path);
			items.push({ id: crypto.randomUUID(), path, name: fileName(path), status: 'queued' });
		}
	}

	async function pick() {
		const picked = await open({ multiple: true, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
		if (picked) addPaths(picked);
	}

	async function start() {
		running = true;
		for (const item of items) {
			if (item.status !== 'queued') continue;
			item.status = 'running';
			try {
				const r = await invoke<Result>('pdf_compress', { req: { input: item.path, outDir, level } });
				item.before = r.before;
				item.after = r.after;
				item.output = r.output;
				item.considered = r.imagesConsidered;
				item.replaced = r.imagesReplaced;
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
	const percent = (i: Item) => Math.round((1 - i.after! / i.before!) * 100);

	onMount(() => listenFileDrop(addPaths, (h) => (dragging = h)));
</script>

<DropZone {dragging} label={t('pdf.drop')} buttonLabel={t('pdf.choose')} onchoose={pick} />

<div class="options">
	<div class="field wide">
		<span class="label">{t('compress.level')}</span>
		<div class="levels" role="radiogroup" aria-label={t('compress.level')}>
			{#each levels as l (l)}
				<button
					class="level"
					class:on={level === l}
					role="radio"
					aria-checked={level === l}
					disabled={running}
					onclick={() => (level = l)}
				>
					<strong>{t(`compress.${l}` as DictKey)}</strong>
					<span>{t(`compress.${l}.desc` as DictKey)}</span>
				</button>
			{/each}
		</div>
		<p class="hint">{t('compress.scope')}</p>
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
				{#if (item.status === 'done' || item.status === 'nochange') && level !== 'lossless'}
					<p class="note">
						{#if item.considered === 0}
							{t('compress.noImages')}
						{:else}
							{item.replaced}/{item.considered} {t('compress.images')}
						{/if}
					</p>
				{/if}
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
		gap: 24px 28px;
		margin: 22px 0;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.field.wide {
		flex-basis: 100%;
	}

	.label {
		font-size: 12px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-dim);
	}

	.levels {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: 10px;
	}

	.level {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 12px 14px;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		text-align: left;
	}

	.level span {
		color: var(--text-dim);
		font-size: 12.5px;
	}

	.level.on {
		border-color: var(--accent-strong);
		background: var(--accent-soft);
	}

	.hint {
		color: var(--text-dim);
		font-size: 13px;
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

	.note {
		margin: 4px 0 0 26px;
		color: var(--text-dim);
		font-size: 12px;
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
