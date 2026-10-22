<script lang="ts">
	import { onMount } from 'svelte';
	import { invoke } from '@tauri-apps/api/core';
	import { open } from '@tauri-apps/plugin-dialog';
	import { revealItemInDir } from '@tauri-apps/plugin-opener';
	import { ArrowUp, ArrowDown, X, Check, TriangleAlert } from '@lucide/svelte';
	import DropZone from '$lib/components/DropZone.svelte';
	import FolderPicker from '$lib/components/FolderPicker.svelte';
	import { t } from '$lib/i18n.svelte';
	import { extOf, fileName, listenFileDrop } from '../util';

	type Item = { id: string; path: string; name: string; pages: number | null; error?: string };

	let items = $state<Item[]>([]);
	let outDir = $state<string | null>(null);
	let dragging = $state(false);
	let working = $state(false);
	let result = $state<{ output: string; pages: number } | null>(null);
	let error = $state<string | null>(null);

	const ready = $derived(items.length >= 2 && items.every((i) => i.pages !== null && !i.error));
	const totalPages = $derived(items.reduce((sum, i) => sum + (i.pages ?? 0), 0));

	function addPaths(paths: string[]) {
		result = null;
		error = null;
		const known = new Set(items.map((i) => i.path));
		for (const path of paths) {
			if (known.has(path) || extOf(path) !== 'pdf') continue;
			known.add(path);
			const id = crypto.randomUUID();
			items.push({ id, path, name: fileName(path), pages: null });
			invoke<number>('pdf_info', { path })
				.then((pages) => update(id, { pages }))
				.catch((e) => update(id, { error: String(e) }));
		}
	}

	function update(id: string, patch: Partial<Item>) {
		const item = items.find((i) => i.id === id);
		if (item) Object.assign(item, patch);
	}

	async function pick() {
		const picked = await open({ multiple: true, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
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

	async function merge() {
		working = true;
		result = null;
		error = null;
		try {
			result = await invoke('pdf_merge', {
				req: { inputs: items.map((i) => i.path), outDir }
			});
		} catch (e) {
			error = String(e);
		}
		working = false;
	}

	onMount(() => listenFileDrop(addPaths, (h) => (dragging = h)));
</script>

<DropZone {dragging} label={t('pdf.drop')} buttonLabel={t('pdf.choose')} onchoose={pick} />
<p class="hint">{t('pdf.limits')}</p>

{#if items.length > 0}
	<p class="hint">{t('pdf.merge.hint')}</p>
	<ol class="list">
		{#each items as item, i (item.id)}
			<li>
				<span class="num">{i + 1}</span>
				<span class="name" title={item.path}>{item.name}</span>
				{#if item.error}
					<span class="err" title={item.error}><TriangleAlert size={14} /> {item.error}</span>
				{:else}
					<span class="dim">
						{item.pages === null ? t('pdf.reading') : `${item.pages} ${t('pdf.pages')}`}
					</span>
				{/if}
				<button class="icon-btn" aria-label={t('pdf.moveUp')} disabled={i === 0 || working} onclick={() => move(i, -1)}>
					<ArrowUp size={15} />
				</button>
				<button
					class="icon-btn"
					aria-label={t('pdf.moveDown')}
					disabled={i === items.length - 1 || working}
					onclick={() => move(i, 1)}
				>
					<ArrowDown size={15} />
				</button>
				<button class="icon-btn" aria-label={t('convert.remove')} disabled={working} onclick={() => remove(item.id)}>
					<X size={15} />
				</button>
			</li>
		{/each}
	</ol>

	<div class="options">
		<FolderPicker bind:value={outDir} disabled={working} />
	</div>

	<div class="actions">
		<button class="btn primary" onclick={merge} disabled={!ready || working}>
			{working ? t('pdf.working') : `${t('pdf.merge.start')}${ready ? ` (${totalPages} ${t('pdf.pages')})` : ''}`}
		</button>
		{#if items.length < 2}<span class="dim">{t('pdf.merge.need')}</span>{/if}
	</div>
{/if}

{#if result}
	<div class="result">
		<Check size={16} />
		<span>{t('pdf.merge.done')}: {result.pages} {t('pdf.pages')}</span>
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
		border: var(--edge-w) solid var(--edge);
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

	.options {
		margin: 20px 0;
	}

	.actions {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.result {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 16px;
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
