<script lang="ts">
	import { onMount } from 'svelte';
	import { invoke } from '@tauri-apps/api/core';
	import { open } from '@tauri-apps/plugin-dialog';
	import { revealItemInDir } from '@tauri-apps/plugin-opener';
	import { ArrowUp, ArrowDown, X, Check } from '@lucide/svelte';
	import DropZone from '$lib/components/DropZone.svelte';
	import FolderPicker from '$lib/components/FolderPicker.svelte';
	import Select from '$lib/ui/Select.svelte';
	import { tr } from '$lib/i18n.svelte';
	import { extOf, fileName, listenFileDrop } from '../util';

	const EXTS = ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tif', 'tiff'];
	type Item = { id: string; path: string; name: string };
	type PageChoice = 'fit' | 'a4' | 'letter';

	let items = $state<Item[]>([]);
	let outDir = $state<string | null>(null);
	let page = $state<PageChoice>('a4');
	let margin = $state(true);
	let dragging = $state(false);
	let working = $state(false);
	let result = $state<{ output: string; pages: number } | null>(null);
	let error = $state<string | null>(null);

	const sizes = $derived<{ value: PageChoice; label: string }[]>([
		{ value: 'a4', label: 'A4' },
		{ value: 'letter', label: 'Letter' },
		{ value: 'fit', label: tr('Sesuai ukuran gambar', 'Match the image size') }
	]);

	function addPaths(paths: string[]) {
		result = null;
		error = null;
		const known = new Set(items.map((i) => i.path));
		for (const path of paths) {
			if (known.has(path) || !EXTS.includes(extOf(path))) continue;
			known.add(path);
			items.push({ id: crypto.randomUUID(), path, name: fileName(path) });
		}
	}

	async function pick() {
		const picked = await open({ multiple: true, filters: [{ name: tr('Gambar', 'Images'), extensions: EXTS }] });
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

	async function make() {
		working = true;
		result = null;
		error = null;
		try {
			result = await invoke('images_to_pdf_cmd', { req: { inputs: items.map((i) => i.path), outDir, page, margin: margin && page !== 'fit' } });
		} catch (e) {
			error = String(e);
		}
		working = false;
	}

	onMount(() => listenFileDrop(addPaths, (h) => (dragging = h)));
</script>

<DropZone {dragging} label={tr('Seret gambar ke sini, atau', 'Drop images here, or')} buttonLabel={tr('Pilih gambar', 'Choose images')} onchoose={pick} />
<p class="hint">{tr('JPG, PNG, WebP, BMP, dan TIFF. Satu gambar jadi satu halaman, sesuai urutan di bawah. JPG dimasukkan apa adanya, jadi kualitasnya tidak turun.', 'JPG, PNG, WebP, BMP and TIFF. One image per page, in the order below. JPGs are embedded as they are, so quality does not drop.')}</p>

{#if items.length > 0}
	<ol class="list">
		{#each items as item, i (item.id)}
			<li>
				<span class="num">{i + 1}</span>
				<span class="name" title={item.path}>{item.name}</span>
				<button class="icon-btn" aria-label={tr('Naikkan', 'Move up')} disabled={i === 0 || working} onclick={() => move(i, -1)}><ArrowUp size={15} /></button>
				<button class="icon-btn" aria-label={tr('Turunkan', 'Move down')} disabled={i === items.length - 1 || working} onclick={() => move(i, 1)}><ArrowDown size={15} /></button>
				<button class="icon-btn" aria-label={tr('Hapus dari daftar', 'Remove from list')} disabled={working} onclick={() => remove(item.id)}><X size={15} /></button>
			</li>
		{/each}
	</ol>

	<div class="options">
		<label class="field">
			<span class="dim">{tr('Ukuran halaman', 'Page size')}</span>
			<Select bind:value={page} options={sizes} disabled={working} />
		</label>
		<label class="check" class:off={page === 'fit'}>
			<input type="checkbox" bind:checked={margin} disabled={working || page === 'fit'} />
			<span>{tr('Beri tepi kosong', 'Add a margin')}</span>
		</label>
		<FolderPicker bind:value={outDir} disabled={working} />
	</div>

	<div class="actions">
		<button class="btn primary" onclick={make} disabled={working}>
			{working ? tr('Membuat PDF…', 'Making the PDF…') : tr(`Buat PDF (${items.length} halaman)`, `Make PDF (${items.length} pages)`)}
		</button>
	</div>
{/if}

{#if result}
	<div class="result">
		<Check size={16} />
		<span>{tr(`PDF jadi: ${result.pages} halaman`, `PDF ready: ${result.pages} pages`)}</span>
		<button class="link" onclick={() => revealItemInDir(result!.output)}>{tr('Tampilkan di folder', 'Show in folder')}</button>
	</div>
{/if}
{#if error}<pre class="error">{error}</pre>{/if}

<style>
	.hint { margin: var(--space-3) 0 0; color: var(--text-dim); font-size: 13px; }
	.list { list-style: none; margin: var(--space-3) 0 0; padding: 0; border: var(--edge-w) solid var(--edge); border-radius: var(--radius); background: var(--surface); overflow: hidden; }
	li { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-2) var(--space-3); border-bottom: 1px solid var(--border); }
	li:last-child { border-bottom: 0; }
	.num { width: 20px; color: var(--text-dim); font-variant-numeric: tabular-nums; }
	.name { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
	.dim { color: var(--text-dim); font-size: 13px; }
	.icon-btn { display: inline-grid; place-items: center; padding: var(--space-1); border: 0; border-radius: var(--radius-1); background: none; color: var(--text-dim); }
	.icon-btn:hover:not(:disabled) { background: var(--surface-2); }
	.options { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-4); margin: var(--space-4) 0; }
	.field { display: inline-flex; align-items: center; gap: var(--space-2); }
	.check { display: inline-flex; align-items: center; gap: var(--space-2); cursor: pointer; }
	.check.off { opacity: 0.5; cursor: default; }
	.actions { display: flex; align-items: center; gap: var(--space-3); }
	.result { display: flex; align-items: center; gap: var(--space-2); margin-top: var(--space-4); color: var(--ok); }
	.link { border: 0; background: none; padding: 0; color: var(--link); font-size: 13px; }
	.error { margin: var(--space-3) 0 0; padding: var(--space-2) var(--space-3); border-radius: var(--radius-2); background: var(--surface-2); color: var(--danger); font-size: 12px; white-space: pre-wrap; user-select: text; -webkit-user-select: text; }
</style>
