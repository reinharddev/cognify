<script lang="ts">
	import { onMount } from 'svelte';
	import { invoke } from '@tauri-apps/api/core';
	import { open } from '@tauri-apps/plugin-dialog';
	import { revealItemInDir } from '@tauri-apps/plugin-opener';
	import { Check, TriangleAlert } from '@lucide/svelte';
	import DropZone from '$lib/components/DropZone.svelte';
	import FolderPicker from '$lib/components/FolderPicker.svelte';
	import { t } from '$lib/i18n.svelte';
	import { extOf, fileName, listenFileDrop } from '../util';

	type Mode = 'single' | 'perRange';

	let file = $state<{ path: string; name: string; pages: number | null; error?: string } | null>(null);
	let ranges = $state('');
	let mode = $state<Mode>('single');
	let outDir = $state<string | null>(null);
	let dragging = $state(false);
	let working = $state(false);
	let results = $state<string[]>([]);
	let error = $state<string | null>(null);

	const canRun = $derived(!!file && file.pages !== null && !file.error && ranges.trim() !== '' && !working);

	function setFile(path: string) {
		if (extOf(path) !== 'pdf') return;
		results = [];
		error = null;
		ranges = '';
		file = { path, name: fileName(path), pages: null };
		invoke<number>('pdf_info', { path })
			.then((pages) => {
				if (file?.path === path) file.pages = pages;
			})
			.catch((e) => {
				if (file?.path === path) file.error = String(e);
			});
	}

	async function pick() {
		const picked = await open({ multiple: false, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
		if (typeof picked === 'string') setFile(picked);
	}

	function everyPage() {
		if (!file?.pages) return;
		ranges = Array.from({ length: file.pages }, (_, i) => i + 1).join(', ');
		mode = 'perRange';
	}

	async function split() {
		if (!file) return;
		working = true;
		results = [];
		error = null;
		try {
			results = await invoke<string[]>('pdf_split', {
				req: { input: file.path, outDir, ranges, mode }
			});
		} catch (e) {
			error = String(e);
		}
		working = false;
	}

	onMount(() => listenFileDrop((paths) => paths[0] && setFile(paths[0]), (h) => (dragging = h)));
</script>

<DropZone {dragging} label={t('pdf.dropOne')} buttonLabel={file ? t('pdf.replace') : t('pdf.chooseOne')} onchoose={pick} />
<p class="hint">{t('pdf.limits')}</p>

{#if file}
	<div class="file">
		<span class="name" title={file.path}>{file.name}</span>
		{#if file.error}
			<span class="err"><TriangleAlert size={14} /> {file.error}</span>
		{:else}
			<span class="dim">
				{file.pages === null ? t('pdf.reading') : `${file.pages} ${t('pdf.pages')}`}
			</span>
		{/if}
	</div>

	<div class="options">
		<div class="field wide">
			<label class="label" for="ranges">{t('pdf.split.ranges')}</label>
			<input id="ranges" bind:value={ranges} placeholder={t('pdf.split.placeholder')} disabled={working} />
			<span class="dim">{t('pdf.split.hint')}</span>
			<button class="link" onclick={everyPage} disabled={!file.pages || working}>{t('pdf.split.all')}</button>
		</div>

		<div class="field">
			<span class="label">{t('pdf.split.mode')}</span>
			<div class="seg">
				<button class:on={mode === 'single'} onclick={() => (mode = 'single')} disabled={working}>
					{t('pdf.split.single')}
				</button>
				<button class:on={mode === 'perRange'} onclick={() => (mode = 'perRange')} disabled={working}>
					{t('pdf.split.perRange')}
				</button>
			</div>
		</div>

		<FolderPicker bind:value={outDir} disabled={working} />
	</div>

	<div class="actions">
		<button class="btn primary" onclick={split} disabled={!canRun}>
			{working ? t('pdf.working') : t('pdf.split.start')}
		</button>
	</div>
{/if}

{#if results.length > 0}
	<div class="results">
		<div class="ok"><Check size={16} /> {t('pdf.split.done')}: {results.length}</div>
		<ul>
			{#each results as path (path)}
				<li>
					<span class="name" title={path}>{fileName(path)}</span>
					<button class="link" onclick={() => revealItemInDir(path)}>{t('convert.reveal')}</button>
				</li>
			{/each}
		</ul>
	</div>
{/if}
{#if error}<pre class="error">{error}</pre>{/if}

<style>
	.hint {
		margin: 12px 0 0;
		color: var(--text-dim);
		font-size: 13px;
	}

	.file {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-top: 16px;
		padding: 10px 14px;
		border: var(--edge-w) solid var(--edge);
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
	}

	.err {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		color: var(--danger);
		font-size: 12px;
	}

	.options {
		display: flex;
		flex-wrap: wrap;
		gap: 24px 28px;
		margin: 20px 0;
	}

	.field {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
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

	input {
		width: min(480px, 100%);
		padding: 8px 12px;
		border: var(--edge-w) solid var(--edge);
		border-radius: 8px;
		background: var(--surface);
		color: var(--text);
		font: inherit;
		user-select: text;
		-webkit-user-select: text;
	}

	.seg {
		display: inline-flex;
		border: var(--edge-w) solid var(--edge);
		border-radius: 8px;
		overflow: hidden;
		background: var(--surface);
	}

	.seg button {
		padding: 7px 16px;
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

	.link {
		border: 0;
		background: none;
		padding: 0;
		color: var(--link);
		font-size: 13px;
	}

	.results {
		margin-top: 18px;
	}

	.ok {
		display: flex;
		align-items: center;
		gap: 8px;
		color: var(--ok);
		margin-bottom: 8px;
	}

	.results ul {
		list-style: none;
		margin: 0;
		padding: 0;
		border: var(--edge-w) solid var(--edge);
		border-radius: var(--radius);
		background: var(--surface);
		overflow: hidden;
	}

	.results li {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 12px;
		border-bottom: 1px solid var(--border);
	}

	.results li:last-child {
		border-bottom: 0;
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
