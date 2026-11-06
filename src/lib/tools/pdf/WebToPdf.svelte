<script lang="ts">
	import { invoke } from '@tauri-apps/api/core';
	import { Check, ExternalLink, Printer, X } from '@lucide/svelte';
	import { tr } from '$lib/i18n.svelte';

	let url = $state('');
	let host = $state<string | null>(null);
	let busy = $state(false);
	let error = $state<string | null>(null);

	/** "id.wikipedia.org/wiki/X" tanpa awalan dilengkapi https://. */
	const normalized = $derived(/^[a-z][a-z0-9+.-]*:\/\//i.test(url.trim()) ? url.trim() : url.trim() ? `https://${url.trim()}` : '');

	async function run<T>(job: () => Promise<T>): Promise<T | undefined> {
		busy = true;
		error = null;
		try {
			return await job();
		} catch (e) {
			error = String(e);
		} finally {
			busy = false;
		}
	}

	async function openPage() {
		const h = await run(() => invoke<string>('webpdf_open', { url: normalized }));
		if (h) host = h;
	}

	const printPage = () => run(() => invoke('webpdf_print'));

	async function closePage() {
		await run(() => invoke('webpdf_close'));
		host = null;
	}
</script>

<form class="row" onsubmit={(e) => { e.preventDefault(); void openPage(); }}>
	<label class="grow">
		<span class="cap">{tr('Alamat halaman web', 'Web page address')}</span>
		<input type="text" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://id.wikipedia.org/wiki/Fotosintesis" bind:value={url} disabled={busy} />
	</label>
	<button class="btn primary" type="submit" disabled={busy || !normalized}><ExternalLink size={15} /> {host ? tr('Buka alamat ini', 'Open this address') : tr('Buka halaman', 'Open page')}</button>
</form>

<ol class="steps">
	<li class:done={host}>
		<b>{tr('1. Buka halamannya.', '1. Open the page.')}</b>
		<span>{tr('Halaman tampil di jendela terpisah. Tutup spanduk cookie, atau masuk dulu bila perlu, lalu gulir sampai bagian yang kamu mau.', 'The page shows up in a separate window. Close cookie banners, or sign in first if needed, then scroll to the part you want.')}</span>
	</li>
	<li class:off={!host}>
		<b>{tr('2. Simpan sebagai PDF.', '2. Save as PDF.')}</b>
		<span>{tr('Tombol di bawah membuka jendela cetak sistem. Pilih "Simpan sebagai PDF" (macOS: menu PDF di kiri bawah; Windows: printer "Microsoft Print to PDF").', 'The button below opens the system print window. Choose "Save as PDF" (macOS: the PDF menu at the bottom left; Windows: the "Microsoft Print to PDF" printer).')}</span>
	</li>
</ol>

<div class="row actions">
	<button class="btn primary" onclick={printPage} disabled={busy || !host}><Printer size={15} /> {tr('Simpan sebagai PDF…', 'Save as PDF…')}</button>
	<button class="btn" onclick={closePage} disabled={busy || !host}><X size={15} /> {tr('Tutup jendela halaman', 'Close the page window')}</button>
	{#if host}<span class="ok"><Check size={15} /> {tr(`Terbuka: ${host}`, `Open: ${host}`)}</span>{/if}
</div>

{#if error}<pre class="error">{error}</pre>{/if}

<p class="hint">{tr('Halaman dibuka dalam mode privat: cookie dan riwayatnya tidak disimpan, dan situsnya tidak bisa mengakses data Cognify. Cognify hanya menghubungi alamat yang kamu ketik. Alat ini tidak menembus paywall atau login. Teks di PDF tetap bisa dipilih dan dicari.', 'The page opens in private mode: its cookies and history are not kept, and the site cannot reach Cognify data. Cognify only contacts the address you type. This tool does not get around paywalls or logins. Text in the PDF stays selectable and searchable.')}</p>

<style>
	.row { display: flex; flex-wrap: wrap; align-items: flex-end; gap: var(--space-3); }
	.row.actions { align-items: center; margin-top: var(--space-4); }
	.grow { flex: 1 1 320px; min-width: 0; }
	.cap { display: block; margin-bottom: var(--space-1); color: var(--text-dim); font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
	input { width: 100%; box-sizing: border-box; padding: var(--space-2) var(--space-3); border: var(--edge-w) solid var(--edge); border-radius: var(--radius-2); background: var(--surface); color: var(--text); font: inherit; }
	input:focus-visible { outline: 2px solid var(--accent-strong); outline-offset: 1px; }
	.steps { list-style: none; margin: var(--space-4) 0 0; padding: 0; display: grid; gap: var(--space-3); }
	.steps li { display: grid; gap: var(--space-1); padding: var(--space-3) var(--space-4); background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-3); }
	.steps li span { color: var(--text-muted); }
	.steps li.done { border-color: var(--accent-strong); }
	.steps li.off { opacity: 0.55; }
	.ok { display: inline-flex; align-items: center; gap: var(--space-1); color: var(--ok); }
	.hint { margin: var(--space-4) 0 0; color: var(--text-dim); font-size: 13px; max-width: 640px; }
	.error { margin: var(--space-3) 0 0; padding: var(--space-2) var(--space-3); border-radius: var(--radius-2); background: var(--surface-2); color: var(--danger); font-size: 12px; white-space: pre-wrap; user-select: text; -webkit-user-select: text; }
</style>
