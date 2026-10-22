<script lang="ts">
	import { onMount } from 'svelte';
	import { invoke } from '@tauri-apps/api/core';
	import { open } from '@tauri-apps/plugin-dialog';
	import { TriangleAlert } from '@lucide/svelte';
	import DropZone from '$lib/components/DropZone.svelte';
	import { t } from '$lib/i18n.svelte';
	import { copyText } from '../clipboard';
	import { extOf, listenFileDrop } from '../util';
	import { decodeRgba } from './qr';

	const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp' };

	let dragging = $state(false);
	let busy = $state(false);
	let result = $state<string | null>(null);
	let problem = $state<'none' | 'bad' | null>(null);
	let copied = $state(false);

	function loadImage(url: string): Promise<HTMLImageElement> {
		return new Promise((resolve, reject) => {
			const img = new Image();
			img.onload = () => resolve(img);
			img.onerror = () => reject(new Error('decode'));
			img.src = url;
		});
	}

	/** Tries the picture at a reduced size first (fast), then at full size. */
	function scan(img: HTMLImageElement): string | null {
		const canvas = document.createElement('canvas');
		const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
		for (const limit of [1600, 4000]) {
			const k = Math.min(1, limit / Math.max(img.naturalWidth, img.naturalHeight));
			canvas.width = Math.max(1, Math.round(img.naturalWidth * k));
			canvas.height = Math.max(1, Math.round(img.naturalHeight * k));
			ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
			const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
			const text = decodeRgba(data.data, data.width, data.height);
			if (text !== null) return text;
			if (k === 1) break; // already at full size
		}
		return null;
	}

	async function readFromUrl(url: string) {
		busy = true;
		result = null;
		problem = null;
		try {
			const text = scan(await loadImage(url));
			if (text === null) problem = 'none';
			else result = text;
		} catch {
			problem = 'bad';
		}
		busy = false;
	}

	async function readFromPath(path: string) {
		const mime = MIME[extOf(path)];
		if (!mime) return;
		try {
			const data = await invoke<string>('read_base64_file', { path });
			await readFromUrl(`data:${mime};base64,${data}`);
		} catch {
			problem = 'bad';
		}
	}

	async function pick() {
		const picked = await open({ multiple: false, filters: [{ name: 'Image', extensions: Object.keys(MIME) }] });
		if (typeof picked === 'string') readFromPath(picked);
	}

	function onPaste(e: ClipboardEvent) {
		const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
		if (!file) return;
		e.preventDefault();
		const reader = new FileReader();
		reader.onload = () => readFromUrl(String(reader.result));
		reader.readAsDataURL(file);
	}

	async function copy() {
		if (result !== null && (await copyText(result))) {
			copied = true;
			setTimeout(() => (copied = false), 1500);
		}
	}

	onMount(() => listenFileDrop((paths) => paths[0] && readFromPath(paths[0]), (h) => (dragging = h)));
</script>

<svelte:window onpaste={onPaste} />

<DropZone {dragging} label={t('qr.read.drop')} buttonLabel={t('qr.read.choose')} onchoose={pick} />

{#if busy}
	<p class="dim">{t('pdf.working')}</p>
{/if}

{#if result !== null}
	<div class="result">
		<div class="head">
			<span class="label">{t('qr.read.result')}</span>
			<button class="link" onclick={copy}>{copied ? t('json.copied') : t('json.copy')}</button>
		</div>
		<pre>{result}</pre>
	</div>
{:else if problem}
	<p class="warn"><TriangleAlert size={15} /> {t(problem === 'none' ? 'qr.read.none' : 'qr.read.bad')}</p>
{/if}

<style>
	.dim {
		margin-top: 16px;
		color: var(--text-dim);
		font-size: 13px;
	}

	.warn {
		display: flex;
		align-items: flex-start;
		gap: 6px;
		margin: 16px 0 0;
		color: var(--danger);
		font-size: 13px;
	}

	.result {
		margin-top: 18px;
	}

	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 8px;
	}

	.label {
		font-size: 12px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-dim);
	}

	.link {
		border: 0;
		background: none;
		padding: 0;
		color: var(--link);
		font-size: 13px;
	}

	pre {
		margin: 0;
		padding: 12px 14px;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		white-space: pre-wrap;
		word-break: break-all;
		user-select: text;
		-webkit-user-select: text;
	}
</style>
