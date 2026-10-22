<script lang="ts">
	import Select from '$lib/ui/Select.svelte';
	import { invoke } from '@tauri-apps/api/core';
	import { open, save } from '@tauri-apps/plugin-dialog';
	import { Check, TriangleAlert } from '@lucide/svelte';
	import { t, type DictKey } from '$lib/i18n.svelte';
	import { copyText } from '../clipboard';
	import { formatBytes } from '../util';
	import { JsonParseError, errorExcerpt, formatJson } from './json';

	type Outcome =
		| { kind: 'empty' }
		| { kind: 'ok'; text: string }
		| { kind: 'error'; error: JsonParseError; line: string; caret: string };

	let input = $state('');
	let mode = $state<'pretty' | 'minify'>('pretty');
	let indent = $state('  ');
	let sortKeys = $state(false);
	let outcome = $state<Outcome>({ kind: 'empty' });
	let copied = $state(false);
	let message = $state<string | null>(null);

	// Re-run shortly after typing stops, so a big document does not lag every keystroke.
	$effect(() => {
		const text = input;
		const options = { indent: mode === 'pretty' ? indent : '', sortKeys };
		const timer = setTimeout(() => {
			if (text.trim() === '') {
				outcome = { kind: 'empty' };
				return;
			}
			try {
				outcome = { kind: 'ok', text: formatJson(text, options) };
			} catch (e) {
				if (!(e instanceof JsonParseError)) throw e;
				outcome = { kind: 'error', error: e, ...errorExcerpt(text, e) };
			}
		}, 150);
		return () => clearTimeout(timer);
	});

	const result = $derived(outcome.kind === 'ok' ? outcome.text : '');

	async function openFile() {
		message = null;
		const picked = await open({ multiple: false, filters: [{ name: 'JSON', extensions: ['json', 'txt', 'jsonc', 'geojson'] }] });
		if (typeof picked !== 'string') return;
		try {
			input = await invoke<string>('read_text_file', { path: picked });
		} catch (e) {
			message = String(e);
		}
	}

	async function saveFile() {
		message = null;
		const path = await save({ defaultPath: 'data.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
		if (!path) return;
		try {
			await invoke('write_text_file', { path, content: result + '\n' });
		} catch (e) {
			message = String(e);
		}
	}

	async function copy() {
		if (!(await copyText(result))) return;
		copied = true;
		setTimeout(() => (copied = false), 1500);
	}
</script>

<div class="options">
	<div class="seg" role="radiogroup" aria-label="mode">
		<button class:on={mode === 'pretty'} role="radio" aria-checked={mode === 'pretty'} onclick={() => (mode = 'pretty')}>
			{t('json.mode.pretty')}
		</button>
		<button class:on={mode === 'minify'} role="radio" aria-checked={mode === 'minify'} onclick={() => (mode = 'minify')}>
			{t('json.mode.minify')}
		</button>
	</div>

	{#if mode === 'pretty'}
		<label class="inline">
			<span class="dim">{t('json.indent')}</span>
			<Select bind:value={indent} options={[{ value: '  ', label: '2' }, { value: '    ', label: '4' }, { value: '\t', label: t('json.tab') }]} />
		</label>
	{/if}

	<label class="inline">
		<input type="checkbox" bind:checked={sortKeys} />
		{t('json.sort')}
	</label>
</div>

<div class="panes">
	<section>
		<header>
			<h2>{t('json.input')}</h2>
			<span class="tools">
				<button class="link" onclick={openFile}>{t('json.open')}</button>
				<button class="link" onclick={() => (input = '')} disabled={!input}>{t('json.clear')}</button>
			</span>
		</header>
		<textarea bind:value={input} placeholder={t('json.placeholder')} spellcheck="false" autocomplete="off" autocapitalize="off"></textarea>
	</section>

	<section>
		<header>
			<h2>{t('json.output')}</h2>
			<span class="tools">
				<button class="link" onclick={copy} disabled={!result}>{copied ? t('json.copied') : t('json.copy')}</button>
				<button class="link" onclick={saveFile} disabled={!result}>{t('json.save')}</button>
			</span>
		</header>
		<textarea readonly value={result} spellcheck="false"></textarea>
	</section>
</div>

<div class="status">
	{#if outcome.kind === 'ok'}
		<p class="ok">
			<Check size={16} />
			{t('json.valid')}
			<span class="dim">· {formatBytes(new Blob([input]).size)} → {formatBytes(new Blob([outcome.text]).size)}</span>
		</p>
		<p class="dim">{t('json.keepNote')}</p>
	{:else if outcome.kind === 'error'}
		<p class="bad">
			<TriangleAlert size={16} />
			<strong>{t('json.at')} {outcome.error.line}, {t('json.col')} {outcome.error.column}:</strong>
			{t(`json.err.${outcome.error.code}` as DictKey)}
		</p>
		<pre class="excerpt">{outcome.line}
{outcome.caret}</pre>
	{/if}
	{#if message}<p class="bad">{message}</p>{/if}
</div>

<style>
	.options {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 14px 22px;
		margin-bottom: 16px;
	}

	.seg {
		display: inline-flex;
		border: 1px solid var(--border);
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

	.inline {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}


	.panes {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 14px;
	}

	@media (max-width: 1100px) {
		.panes {
			grid-template-columns: 1fr;
		}
	}

	section {
		display: flex;
		flex-direction: column;
		gap: 8px;
		min-width: 0;
	}

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	h2 {
		font-size: 12px;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--text-dim);
	}

	.tools {
		display: inline-flex;
		gap: 14px;
	}

	.link {
		border: 0;
		background: none;
		padding: 0;
		color: var(--link);
		font-size: 13px;
	}

	textarea {
		height: 340px;
		padding: 10px 12px;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		color: var(--text);
		font: 12.5px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		resize: vertical;
		tab-size: 2;
		white-space: pre;
		user-select: text;
		-webkit-user-select: text;
	}

	.status {
		margin-top: 14px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.status p {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
		margin: 0;
	}

	.ok {
		color: var(--ok);
	}

	.bad {
		color: var(--danger);
	}

	.dim {
		color: var(--text-dim);
		font-size: 13px;
	}

	.excerpt {
		margin: 0;
		padding: 8px 12px;
		border-radius: 6px;
		background: var(--surface-2);
		color: var(--text);
		font: 12.5px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		overflow-x: auto;
		user-select: text;
		-webkit-user-select: text;
	}
</style>
