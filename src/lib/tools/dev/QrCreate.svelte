<script lang="ts">
	import Select from '$lib/ui/Select.svelte';
	import ColorPicker from '$lib/ui/ColorPicker.svelte';
	import { invoke } from '@tauri-apps/api/core';
	import { save } from '@tauri-apps/plugin-dialog';
	import { TriangleAlert } from '@lucide/svelte';
	import { t } from '$lib/i18n.svelte';
	import {
		buildMatrix,
		colourProblem,
		fitScale,
		renderRgba,
		toSvg,
		wifiPayload,
		type Ecc,
		type WifiSecurity
	} from './qr';

	let kind = $state<'text' | 'wifi'>('text');
	let text = $state('');
	let ssid = $state('');
	let password = $state('');
	let security = $state<WifiSecurity>('WPA');
	let hidden = $state(false);
	let ecc = $state<Ecc>('M');
	let size = $state(512);
	let margin = $state(4);
	let fg = $state('#000000');
	let bg = $state('#ffffff');
	let message = $state<string | null>(null);

	const payload = $derived(kind === 'text' ? text : ssid ? wifiPayload({ ssid, password, security, hidden }) : '');
	const built = $derived.by(() => {
		if (!payload) return { kind: 'empty' as const };
		try {
			return { kind: 'ok' as const, matrix: buildMatrix(payload, ecc) };
		} catch {
			return { kind: 'tooLong' as const };
		}
	});
	const options = $derived({ margin, fg, bg });
	const svg = $derived(built.kind === 'ok' ? toSvg(built.matrix, options) : '');
	const pixels = $derived(built.kind === 'ok' ? fitScale(built.matrix, margin, size).pixels : 0);
	const problem = $derived(colourProblem(fg, bg));

	const ECC: { id: Ecc; label: string }[] = [
		{ id: 'L', label: 'L 7%' },
		{ id: 'M', label: 'M 15%' },
		{ id: 'Q', label: 'Q 25%' },
		{ id: 'H', label: 'H 30%' }
	];

	async function savePng() {
		if (built.kind !== 'ok') return;
		message = null;
		const path = await save({ defaultPath: 'qrcode.png', filters: [{ name: 'PNG', extensions: ['png'] }] });
		if (!path) return;
		const { scale } = fitScale(built.matrix, margin, size);
		const img = renderRgba(built.matrix, scale, options);
		const canvas = document.createElement('canvas');
		canvas.width = img.width;
		canvas.height = img.height;
		canvas.getContext('2d')!.putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
		try {
			await invoke('write_base64_file', { path, data: canvas.toDataURL('image/png').split(',')[1] });
		} catch (e) {
			message = String(e);
		}
	}

	async function saveSvg() {
		if (built.kind !== 'ok') return;
		message = null;
		const path = await save({ defaultPath: 'qrcode.svg', filters: [{ name: 'SVG', extensions: ['svg'] }] });
		if (!path) return;
		try {
			await invoke('write_text_file', { path, content: svg });
		} catch (e) {
			message = String(e);
		}
	}
</script>

<div class="layout">
	<div class="form">
		<div class="seg" role="radiogroup">
			<button class:on={kind === 'text'} role="radio" aria-checked={kind === 'text'} onclick={() => (kind = 'text')}>
				{t('qr.type.text')}
			</button>
			<button class:on={kind === 'wifi'} role="radio" aria-checked={kind === 'wifi'} onclick={() => (kind = 'wifi')}>
				{t('qr.type.wifi')}
			</button>
		</div>

		{#if kind === 'text'}
			<label class="field">
				<span class="label">{t('qr.text')}</span>
				<textarea bind:value={text} placeholder={t('qr.text.ph')} rows="4" spellcheck="false"></textarea>
			</label>
		{:else}
			<label class="field">
				<span class="label">{t('qr.wifi.ssid')}</span>
				<input bind:value={ssid} spellcheck="false" autocomplete="off" />
			</label>
			<label class="field">
				<span class="label">{t('qr.wifi.sec')}</span>
				<Select bind:value={security} options={[{ value: 'WPA', label: 'WPA/WPA2/WPA3' }, { value: 'WEP', label: 'WEP' }, { value: 'nopass', label: t('qr.wifi.open') }]} />
			</label>
			{#if security !== 'nopass'}
				<label class="field">
					<span class="label">{t('qr.wifi.pass')}</span>
					<input bind:value={password} spellcheck="false" autocomplete="off" />
				</label>
			{/if}
			<label class="check"><input type="checkbox" bind:checked={hidden} /> {t('qr.wifi.hidden')}</label>
		{/if}

		<div class="field">
			<span class="label">{t('qr.ecc')}</span>
			<div class="seg">
				{#each ECC as e (e.id)}
					<button class:on={ecc === e.id} onclick={() => (ecc = e.id)}>{e.label}</button>
				{/each}
			</div>
			<span class="dim">{t('qr.ecc.hint')}</span>
		</div>

		<div class="row">
			<label class="field">
				<span class="label">{t('qr.size')}</span>
				<Select bind:value={size} options={[256, 512, 1024, 2048].map((s) => ({ value: s, label: `${s} px` }))} />
			</label>
			<label class="field">
				<span class="label">{t('qr.margin')}: {margin}</span>
				<input type="range" min="0" max="8" bind:value={margin} />
			</label>
		</div>

		<div class="row">
			<label class="field">
				<span class="label">{t('qr.fg')}</span>
				<ColorPicker bind:value={fg} label={t('qr.fg')} />
			</label>
			<label class="field">
				<span class="label">{t('qr.bg')}</span>
				<ColorPicker bind:value={bg} label={t('qr.bg')} />
			</label>
		</div>
		{#if problem}
			<p class="warn"><TriangleAlert size={15} /> {t(problem === 'inverted' ? 'qr.problem.inverted' : 'qr.problem.lowContrast')}</p>
		{/if}
	</div>

	<div class="preview">
		<div class="canvas">
			{#if built.kind === 'ok'}
				{@html svg}
			{:else if built.kind === 'tooLong'}
				<p class="warn"><TriangleAlert size={15} /> {t('qr.tooLong')}</p>
			{:else}
				<p class="dim">{t('qr.empty')}</p>
			{/if}
		</div>
		{#if built.kind === 'ok'}
			<p class="dim">{t('qr.actual')} {pixels}×{pixels} px</p>
			<div class="actions">
				<button class="btn primary" onclick={savePng}>{t('qr.save.png')}</button>
				<button class="btn" onclick={saveSvg}>{t('qr.save.svg')}</button>
			</div>
		{/if}
		{#if message}<p class="warn">{message}</p>{/if}
	</div>
</div>

<style>
	.layout {
		display: grid;
		grid-template-columns: minmax(280px, 1fr) minmax(260px, 340px);
		gap: 28px;
		align-items: start;
	}

	@media (max-width: 980px) {
		.layout {
			grid-template-columns: 1fr;
		}
	}

	.form {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.seg {
		display: inline-flex;
		align-self: flex-start;
		border: 1px solid var(--border);
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

	.field {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.label {
		font-size: 12px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-dim);
	}

	input:not([type]),
	textarea {
		padding: 8px 10px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--surface);
		color: var(--text);
		font: inherit;
		user-select: text;
		-webkit-user-select: text;
	}

	textarea {
		resize: vertical;
	}

	input[type='range'] {
		accent-color: var(--accent-strong);
	}


	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 22px;
	}

	.check {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}

	.dim {
		color: var(--text-dim);
		font-size: 13px;
	}

	.warn {
		display: flex;
		align-items: flex-start;
		gap: 6px;
		margin: 0;
		color: var(--danger);
		font-size: 13px;
	}

	.preview {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.canvas {
		display: grid;
		place-items: center;
		aspect-ratio: 1;
		padding: 12px;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		overflow: hidden;
	}

	.canvas :global(svg) {
		width: 100%;
		height: 100%;
	}

	.actions {
		display: flex;
		gap: 10px;
	}
</style>
