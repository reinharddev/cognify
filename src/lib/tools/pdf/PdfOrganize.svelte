<script lang="ts">
	import { onMount } from 'svelte';
	import { invoke } from '@tauri-apps/api/core';
	import { open } from '@tauri-apps/plugin-dialog';
	import { revealItemInDir } from '@tauri-apps/plugin-opener';
	import { ArrowLeft, ArrowRight, Check, Copy, RotateCcw, RotateCw, Trash2, TriangleAlert } from '@lucide/svelte';
	import DropZone from '$lib/components/DropZone.svelte';
	import FolderPicker from '$lib/components/FolderPicker.svelte';
	import { tr } from '$lib/i18n.svelte';
	import { extOf, fileName, listenFileDrop } from '../util';

	/** Satu kotak = satu halaman di hasil akhir: nomor halaman asli dan putaran tambahan. */
	type Tile = { id: string; page: number; rotate: number };

	let path = $state<string | null>(null);
	let total = $state(0);
	let tiles = $state<Tile[]>([]);
	let outDir = $state<string | null>(null);
	let dragging = $state(false);
	let loading = $state(false);
	let working = $state(false);
	let result = $state<{ output: string; pages: number } | null>(null);
	let text = $state<{ output: string; pages: number; chars: number } | null>(null);
	let error = $state<string | null>(null);

	const changed = $derived(tiles.length !== total || tiles.some((t, i) => t.page !== i + 1 || t.rotate !== 0));

	const fresh = (page: number): Tile => ({ id: crypto.randomUUID(), page, rotate: 0 });

	async function load(p: string) {
		loading = true;
		result = null;
		text = null;
		error = null;
		try {
			total = await invoke<number>('pdf_info', { path: p });
			path = p;
			tiles = Array.from({ length: total }, (_, i) => fresh(i + 1));
		} catch (e) {
			path = null;
			total = 0;
			tiles = [];
			error = String(e);
		}
		loading = false;
	}

	function addPaths(paths: string[]) {
		const pdf = paths.find((p) => extOf(p) === 'pdf');
		if (pdf) void load(pdf);
	}

	async function pick() {
		const picked = await open({ multiple: false, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
		if (typeof picked === 'string') void load(picked);
	}

	const touch = () => {
		result = null;
	};
	function move(i: number, by: -1 | 1) {
		const j = i + by;
		if (j < 0 || j >= tiles.length) return;
		[tiles[i], tiles[j]] = [tiles[j], tiles[i]];
		touch();
	}
	function rotate(i: number, by: 90 | -90) {
		tiles[i].rotate = (((tiles[i].rotate + by) % 360) + 360) % 360;
		touch();
	}
	function remove(i: number) {
		tiles.splice(i, 1);
		touch();
	}
	function duplicate(i: number) {
		tiles.splice(i + 1, 0, { ...tiles[i], id: crypto.randomUUID() });
		touch();
	}
	const reverse = () => {
		tiles.reverse();
		touch();
	};
	const rotateAll = () => {
		for (const t of tiles) t.rotate = (t.rotate + 90) % 360;
		touch();
	};
	const reset = () => {
		tiles = Array.from({ length: total }, (_, i) => fresh(i + 1));
		touch();
	};

	async function save() {
		if (!path) return;
		working = true;
		result = null;
		error = null;
		try {
			result = await invoke('pdf_organize', { req: { input: path, outDir, ops: tiles.map((t) => ({ page: t.page, rotate: t.rotate })) } });
		} catch (e) {
			error = String(e);
		}
		working = false;
	}

	async function extractText() {
		if (!path) return;
		working = true;
		text = null;
		error = null;
		try {
			text = await invoke('pdf_text', { input: path, outDir });
		} catch (e) {
			error = String(e);
		}
		working = false;
	}

	onMount(() => listenFileDrop(addPaths, (h) => (dragging = h)));
</script>

<DropZone {dragging} label={tr('Seret satu PDF ke sini, atau', 'Drop one PDF here, or')} buttonLabel={tr('Pilih PDF', 'Choose a PDF')} onchoose={pick} />
<p class="hint">{tr('PDF yang diberi password belum didukung. Bookmark tidak ikut terbawa.', 'Password-protected PDFs are not supported yet. Bookmarks are not carried over.')}</p>

{#if loading}<p class="dim">{tr('Membaca PDF…', 'Reading the PDF…')}</p>{/if}

{#if path && tiles.length >= 0 && !loading}
	<div class="file"><strong title={path}>{fileName(path)}</strong> <span class="dim">· {tr(`${total} halaman`, `${total} pages`)}</span></div>

	<div class="bulk">
		<button class="btn" onclick={rotateAll} disabled={working || !tiles.length}><RotateCw size={14} /> {tr('Putar semua', 'Rotate all')}</button>
		<button class="btn" onclick={reverse} disabled={working || tiles.length < 2}>{tr('Balik urutan', 'Reverse order')}</button>
		<button class="btn" onclick={reset} disabled={working || !changed}>{tr('Kembalikan semua', 'Reset all')}</button>
		<span class="dim">{tr(`${tiles.length} dari ${total} halaman dipakai`, `${tiles.length} of ${total} pages kept`)}</span>
	</div>

	{#if tiles.length === 0}
		<p class="warn"><TriangleAlert size={14} /> {tr('Semua halaman dihapus. Tekan "Kembalikan semua" untuk mulai lagi.', 'Every page was removed. Press "Reset all" to start again.')}</p>
	{/if}

	<ol class="grid">
		{#each tiles as tile, i (tile.id)}
			<li class="tile">
				<div class="paper" style:--turn="{tile.rotate}deg" title={tr(`Halaman asli ${tile.page}`, `Original page ${tile.page}`)}>
					<span class="n">{tile.page}</span>
				</div>
				<span class="pos dim">{tr(`ke-${i + 1}`, `#${i + 1}`)}{tile.rotate ? ` · ${tile.rotate}°` : ''}</span>
				<div class="ctl">
					<button class="icon-btn" aria-label={tr('Geser ke kiri', 'Move left')} disabled={i === 0 || working} onclick={() => move(i, -1)}><ArrowLeft size={14} /></button>
					<button class="icon-btn" aria-label={tr('Geser ke kanan', 'Move right')} disabled={i === tiles.length - 1 || working} onclick={() => move(i, 1)}><ArrowRight size={14} /></button>
					<button class="icon-btn" aria-label={tr('Putar kiri', 'Rotate left')} disabled={working} onclick={() => rotate(i, -90)}><RotateCcw size={14} /></button>
					<button class="icon-btn" aria-label={tr('Putar kanan', 'Rotate right')} disabled={working} onclick={() => rotate(i, 90)}><RotateCw size={14} /></button>
					<button class="icon-btn" aria-label={tr('Gandakan halaman', 'Duplicate page')} disabled={working} onclick={() => duplicate(i)}><Copy size={14} /></button>
					<button class="icon-btn danger" aria-label={tr('Hapus halaman', 'Delete page')} disabled={working} onclick={() => remove(i)}><Trash2 size={14} /></button>
				</div>
			</li>
		{/each}
	</ol>

	<div class="options"><FolderPicker bind:value={outDir} disabled={working} /></div>

	<div class="actions">
		<button class="btn primary" onclick={save} disabled={working || !tiles.length || !changed}>{working ? tr('Memproses…', 'Working…') : tr('Simpan PDF baru', 'Save a new PDF')}</button>
		<button class="btn" onclick={extractText} disabled={working}>{tr('Ambil teks ke .txt', 'Extract text to .txt')}</button>
		{#if !changed}<span class="dim">{tr('Ubah urutan, putar, atau hapus halaman dulu.', 'Reorder, rotate or delete pages first.')}</span>{/if}
	</div>
{/if}

{#if result}
	<div class="result">
		<Check size={16} />
		<span>{tr(`PDF baru: ${result.pages} halaman`, `New PDF: ${result.pages} pages`)}</span>
		<button class="link" onclick={() => revealItemInDir(result!.output)}>{tr('Tampilkan di folder', 'Show in folder')}</button>
	</div>
{/if}
{#if text}
	<div class="result" class:warn-result={text.chars === 0}>
		{#if text.chars === 0}<TriangleAlert size={16} />{:else}<Check size={16} />{/if}
		<span>
			{#if text.chars === 0}{tr('Tidak ada teks yang bisa diambil. PDF ini kemungkinan hasil pindai (isinya gambar).', 'No text could be extracted. This PDF is probably a scan (it holds images).')}
			{:else}{tr(`Teks dari ${text.pages} halaman tersimpan (${text.chars} karakter). Pada font khusus hasilnya bisa berantakan.`, `Text from ${text.pages} pages saved (${text.chars} characters). With unusual fonts the result may look garbled.`)}{/if}
		</span>
		<button class="link" onclick={() => revealItemInDir(text!.output)}>{tr('Tampilkan di folder', 'Show in folder')}</button>
	</div>
{/if}
{#if error}<pre class="error">{error}</pre>{/if}

<style>
	.hint { margin: var(--space-3) 0 0; color: var(--text-dim); font-size: 13px; }
	.dim { color: var(--text-dim); font-size: 13px; }
	.file { margin: var(--space-4) 0 var(--space-2); }
	.bulk { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); margin-bottom: var(--space-3); }
	.warn { display: inline-flex; align-items: center; gap: var(--space-2); color: var(--danger); }
	.grid { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(132px, 1fr)); gap: var(--space-3); }
	.tile { display: flex; flex-direction: column; align-items: center; gap: var(--space-1); padding: var(--space-3); background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); }
	.paper { width: 52px; height: 68px; display: grid; place-items: center; background: var(--surface-2); border: var(--edge-w) solid var(--edge); border-radius: var(--radius-1); transform: rotate(var(--turn)); transition: transform var(--dur-1) var(--ease-out); }
	.n { font-weight: 700; font-variant-numeric: tabular-nums; transform: rotate(calc(var(--turn) * -1)); }
	.pos { margin: var(--space-1) 0; }
	.ctl { display: flex; flex-wrap: wrap; justify-content: center; gap: var(--space-0); }
	.icon-btn { display: inline-grid; place-items: center; padding: var(--space-1); border: 0; border-radius: var(--radius-1); background: none; color: var(--text-dim); }
	.icon-btn:hover:not(:disabled) { background: var(--surface-2); color: var(--text); }
	.icon-btn.danger:hover:not(:disabled) { color: var(--danger); }
	.icon-btn:disabled { opacity: 0.35; }
	.options { margin: var(--space-4) 0; }
	.actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); }
	.result { display: flex; align-items: center; gap: var(--space-2); margin-top: var(--space-4); color: var(--ok); }
	.result.warn-result { color: var(--text-muted); }
	.link { border: 0; background: none; padding: 0; color: var(--link); font-size: 13px; }
	.error { margin: var(--space-3) 0 0; padding: var(--space-2) var(--space-3); border-radius: var(--radius-2); background: var(--surface-2); color: var(--danger); font-size: 12px; white-space: pre-wrap; user-select: text; -webkit-user-select: text; }
	@media (prefers-reduced-motion: reduce) { .paper { transition: none; } }
</style>
