<script lang="ts">
	import { tr, i18n } from '$lib/i18n.svelte';
	import { copyText } from '../clipboard';
	import {
		HASH_ALGOS,
		base64Decode,
		base64Encode,
		changeCase,
		countText,
		hashText,
		parseTime,
		tidyLines,
		urlDecode,
		urlEncode,
		uuids,
		type CaseMode,
		type TidyOptions
	} from './text';

	type Tab = 'count' | 'case' | 'tidy' | 'base64' | 'url' | 'hash' | 'time' | 'uuid';

	let tab = $state<Tab>('count');
	let input = $state('');
	let copied = $state<string | null>(null);

	const TABS = $derived<{ id: Tab; label: string }[]>([
		{ id: 'count', label: tr('Hitung', 'Count') },
		{ id: 'case', label: tr('Huruf', 'Case') },
		{ id: 'tidy', label: tr('Rapikan baris', 'Tidy lines') },
		{ id: 'base64', label: 'Base64' },
		{ id: 'url', label: 'URL' },
		{ id: 'hash', label: 'Hash' },
		{ id: 'time', label: tr('Waktu', 'Time') },
		{ id: 'uuid', label: 'UUID' }
	]);

	// ── Hitung ──
	const counts = $derived(countText(input));

	// ── Huruf ──
	let caseMode = $state<CaseMode>('title');
	const CASES = $derived<{ id: CaseMode; label: string }[]>([
		{ id: 'title', label: tr('Setiap Kata', 'Title Case') },
		{ id: 'sentence', label: tr('Awal kalimat', 'Sentence case') },
		{ id: 'upper', label: tr('HURUF BESAR', 'UPPERCASE') },
		{ id: 'lower', label: tr('huruf kecil', 'lowercase') },
		{ id: 'toggle', label: tr('bALIK hURUF', 'tOGGLE cASE') }
	]);
	const caseOut = $derived(changeCase(input, caseMode));

	// ── Rapikan ──
	let tidy = $state<TidyOptions>({ trimLines: true, collapseSpaces: true, removeBlank: false, dedupe: false, sort: 'none', reverse: false });
	const tidyOut = $derived(tidyLines(input, tidy));

	// ── Base64 ──
	let b64Mode = $state<'encode' | 'decode'>('encode');
	let urlSafe = $state(false);
	const b64 = $derived(b64Mode === 'encode' ? { ok: true, text: base64Encode(input, urlSafe) } : (() => { const d = input.trim() ? base64Decode(input) : ''; return d === null ? { ok: false, text: '' } : { ok: true, text: d }; })());

	// ── URL ──
	let urlMode = $state<'encode' | 'decode'>('encode');
	const urlOut = $derived(urlMode === 'encode' ? { ok: true, text: urlEncode(input) } : (() => { const d = input.trim() ? urlDecode(input) : ''; return d === null ? { ok: false, text: '' } : { ok: true, text: d }; })());

	// ── Hash ──
	let hashes = $state<Record<string, string>>({});
	$effect(() => {
		const text = input;
		let stale = false;
		void Promise.all(HASH_ALGOS.map(async (a) => [a, text ? await hashText(text, a) : ''] as const)).then((pairs) => {
			if (!stale) hashes = Object.fromEntries(pairs);
		});
		return () => (stale = true);
	});

	// ── Waktu ──
	const timeInfo = $derived(parseTime(input));
	const localTime = $derived(timeInfo ? new Date(timeInfo.millis).toLocaleString(i18n.lang === 'en' ? 'en-US' : 'id-ID', { dateStyle: 'full', timeStyle: 'long' }) : '');

	// ── UUID ──
	let uuidCount = $state(5);
	let uuidList = $state<string[]>(uuids(5));

	async function copy(key: string, text: string) {
		if (!text || !(await copyText(text))) return;
		copied = key;
		setTimeout(() => (copied = copied === key ? null : copied), 1500);
	}
</script>

<div class="seg" role="tablist" aria-label={tr('Pilih alat teks', 'Pick a text tool')}>
	{#each TABS as t (t.id)}
		<button role="tab" aria-selected={tab === t.id} class:on={tab === t.id} onclick={() => (tab = t.id)}>{t.label}</button>
	{/each}
</div>

{#if tab !== 'uuid'}
	<label class="block">
		<span class="cap">
			{#if tab === 'time'}{tr('Angka waktu (detik atau milidetik) atau tanggal', 'Timestamp (seconds or milliseconds) or a date')}{:else}{tr('Teks', 'Text')}{/if}
		</span>
		<textarea rows={tab === 'time' ? 2 : 8} bind:value={input} spellcheck="false" placeholder={tab === 'time' ? '1700000000' : tr('Tempel atau ketik di sini…', 'Paste or type here…')}></textarea>
	</label>
{/if}

{#if tab === 'count'}
	<dl class="stats">
		<div><dt>{tr('Kata', 'Words')}</dt><dd>{counts.words}</dd></div>
		<div><dt>{tr('Karakter', 'Characters')}</dt><dd>{counts.chars}</dd></div>
		<div><dt>{tr('Tanpa spasi', 'No spaces')}</dt><dd>{counts.charsNoSpace}</dd></div>
		<div><dt>{tr('Kalimat', 'Sentences')}</dt><dd>{counts.sentences}</dd></div>
		<div><dt>{tr('Paragraf', 'Paragraphs')}</dt><dd>{counts.paragraphs}</dd></div>
		<div><dt>{tr('Baris', 'Lines')}</dt><dd>{counts.lines}</dd></div>
		<div><dt>{tr('Waktu baca', 'Reading time')}</dt><dd>{counts.readMin ? tr(`${counts.readMin} mnt`, `${counts.readMin} min`) : '–'}</dd></div>
		<div><dt>{tr('Waktu bicara', 'Speaking time')}</dt><dd>{counts.speakMin ? tr(`${counts.speakMin} mnt`, `${counts.speakMin} min`) : '–'}</dd></div>
	</dl>
{:else if tab === 'case'}
	<div class="opts" role="radiogroup" aria-label={tr('Gaya huruf', 'Letter case')}>
		{#each CASES as c (c.id)}
			<button class="chip" class:on={caseMode === c.id} role="radio" aria-checked={caseMode === c.id} onclick={() => (caseMode = c.id)}>{c.label}</button>
		{/each}
	</div>
	{@render output('case', caseOut)}
{:else if tab === 'tidy'}
	<div class="opts">
		<label class="check"><input type="checkbox" bind:checked={tidy.trimLines} /> {tr('Buang spasi di tepi baris', 'Trim each line')}</label>
		<label class="check"><input type="checkbox" bind:checked={tidy.collapseSpaces} /> {tr('Satukan spasi ganda', 'Collapse double spaces')}</label>
		<label class="check"><input type="checkbox" bind:checked={tidy.removeBlank} /> {tr('Hapus baris kosong', 'Remove blank lines')}</label>
		<label class="check"><input type="checkbox" bind:checked={tidy.dedupe} /> {tr('Hapus baris ganda', 'Remove duplicate lines')}</label>
		<label class="check"><input type="checkbox" bind:checked={tidy.reverse} /> {tr('Balik urutan', 'Reverse order')}</label>
	</div>
	<div class="opts" role="radiogroup" aria-label={tr('Urutkan', 'Sort')}>
		{#each [['none', tr('Tanpa urut', 'No sort')], ['asc', 'A → Z'], ['desc', 'Z → A']] as const as [id, label] (id)}
			<button class="chip" class:on={tidy.sort === id} role="radio" aria-checked={tidy.sort === id} onclick={() => (tidy.sort = id)}>{label}</button>
		{/each}
	</div>
	{@render output('tidy', tidyOut)}
{:else if tab === 'base64'}
	<div class="opts" role="radiogroup" aria-label="Base64">
		<button class="chip" class:on={b64Mode === 'encode'} role="radio" aria-checked={b64Mode === 'encode'} onclick={() => (b64Mode = 'encode')}>{tr('Ke Base64', 'To Base64')}</button>
		<button class="chip" class:on={b64Mode === 'decode'} role="radio" aria-checked={b64Mode === 'decode'} onclick={() => (b64Mode = 'decode')}>{tr('Dari Base64', 'From Base64')}</button>
		{#if b64Mode === 'encode'}<label class="check"><input type="checkbox" bind:checked={urlSafe} /> {tr('Aman untuk URL', 'URL-safe')}</label>{/if}
	</div>
	{#if !b64.ok}<p class="bad">{tr('Bukan Base64 yang sah, atau isinya bukan teks.', 'Not valid Base64, or it does not hold text.')}</p>{/if}
	{@render output('b64', b64.text)}
{:else if tab === 'url'}
	<div class="opts" role="radiogroup" aria-label="URL">
		<button class="chip" class:on={urlMode === 'encode'} role="radio" aria-checked={urlMode === 'encode'} onclick={() => (urlMode = 'encode')}>{tr('Kodekan', 'Encode')}</button>
		<button class="chip" class:on={urlMode === 'decode'} role="radio" aria-checked={urlMode === 'decode'} onclick={() => (urlMode = 'decode')}>{tr('Terjemahkan', 'Decode')}</button>
	</div>
	{#if !urlOut.ok}<p class="bad">{tr('Kode URL-nya rusak.', 'That URL encoding is broken.')}</p>{/if}
	{@render output('url', urlOut.text)}
{:else if tab === 'hash'}
	<p class="hint">{tr('Hash dihitung di perangkat ini; teksnya tidak dikirim ke mana pun.', 'Hashes are computed on this device; the text is not sent anywhere.')}</p>
	<div class="hashes">
		{#each HASH_ALGOS as a (a)}
			<div class="hash">
				<span class="cap">{a}</span>
				<code>{hashes[a] ?? ''}</code>
				<button class="link" disabled={!hashes[a]} onclick={() => copy(a, hashes[a])}>{copied === a ? tr('Tersalin', 'Copied') : tr('Salin', 'Copy')}</button>
			</div>
		{/each}
	</div>
{:else if tab === 'time'}
	<div class="opts">
		<button class="chip" onclick={() => (input = String(Math.floor(Date.now() / 1000)))}>{tr('Sekarang', 'Now')}</button>
	</div>
	{#if input.trim() && !timeInfo}
		<p class="bad">{tr('Tidak terbaca sebagai waktu.', 'Not readable as a time.')}</p>
	{:else if timeInfo}
		<dl class="stats wide">
			<div><dt>{tr('Detik', 'Seconds')}</dt><dd>{timeInfo.seconds}</dd></div>
			<div><dt>{tr('Milidetik', 'Milliseconds')}</dt><dd>{timeInfo.millis}</dd></div>
			<div><dt>UTC (ISO)</dt><dd>{timeInfo.iso}</dd></div>
			<div><dt>{tr('Waktu setempat', 'Local time')}</dt><dd>{localTime}</dd></div>
		</dl>
	{/if}
{:else if tab === 'uuid'}
	<div class="opts">
		<label class="field">{tr('Jumlah', 'How many')} <input type="number" min="1" max="50" bind:value={uuidCount} /></label>
		<button class="btn primary" onclick={() => (uuidList = uuids(uuidCount))}>{tr('Buat UUID', 'Generate UUIDs')}</button>
	</div>
	{@render output('uuid', uuidList.join('\n'))}
{/if}

{#snippet output(key: string, text: string)}
	<label class="block">
		<span class="cap cap-row">
			{tr('Hasil', 'Result')}
			<button class="link" disabled={!text} onclick={() => copy(key, text)}>{copied === key ? tr('Tersalin', 'Copied') : tr('Salin', 'Copy')}</button>
		</span>
		<textarea rows="8" readonly value={text} spellcheck="false"></textarea>
	</label>
{/snippet}

<style>
	.seg { display: flex; flex-wrap: wrap; gap: var(--space-1); padding: var(--space-1); width: fit-content; max-width: 100%; background: var(--surface-2); border-radius: var(--radius-3); margin-bottom: var(--space-4); }
	.seg button { padding: var(--space-1) var(--space-3); border: 0; border-radius: var(--radius-2); background: none; color: var(--text-muted); cursor: pointer; }
	.seg button.on { background: var(--surface); color: var(--text); font-weight: 600; box-shadow: var(--lift); }
	.seg button:focus-visible, .chip:focus-visible { outline: 2px solid var(--accent-strong); outline-offset: 2px; }
	.block { display: block; margin-bottom: var(--space-4); }
	.cap { display: block; margin-bottom: var(--space-1); color: var(--text-dim); font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
	.cap-row { display: flex; justify-content: space-between; align-items: center; }
	textarea { width: 100%; box-sizing: border-box; padding: var(--space-3); border: var(--edge-w) solid var(--edge); border-radius: var(--radius-3); background: var(--surface); color: var(--text); font: 13px/1.5 var(--font-mono); resize: vertical; }
	textarea:focus-visible { outline: 2px solid var(--accent-strong); outline-offset: 1px; }
	.opts { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-3); margin-bottom: var(--space-4); }
	.chip { padding: var(--space-1) var(--space-3); border: 1px solid var(--border-strong); border-radius: var(--radius-pill); background: none; color: var(--text); cursor: pointer; }
	.chip.on { background: var(--accent); color: var(--accent-contrast); border-color: var(--accent-strong); font-weight: 600; }
	.check, .field { display: inline-flex; align-items: center; gap: var(--space-2); color: var(--text-muted); cursor: pointer; }
	.field input { width: 72px; padding: var(--space-1) var(--space-2); border: 1px solid var(--border-strong); border-radius: var(--radius-2); background: var(--surface); color: var(--text); font: inherit; }
	.stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: var(--space-3); margin: 0 0 var(--space-4); }
	.stats.wide { grid-template-columns: 1fr; }
	.stats div { padding: var(--space-3); background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-3); }
	.stats dt { color: var(--text-dim); font-size: 12px; }
	.stats dd { margin: var(--space-1) 0 0; font-weight: 700; font-size: 1.25em; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
	.stats.wide dd { font-size: 1em; font-weight: 600; font-family: var(--font-mono); }
	.hashes { display: grid; gap: var(--space-3); }
	.hash { display: grid; grid-template-columns: 80px minmax(0, 1fr) auto; align-items: center; gap: var(--space-3); padding: var(--space-3); background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-3); }
	.hash .cap { margin: 0; }
	.hash code { overflow-wrap: anywhere; font: 12px/1.4 var(--font-mono); user-select: text; -webkit-user-select: text; }
	.hint { margin: 0 0 var(--space-3); color: var(--text-dim); font-size: 13px; }
	.bad { margin: 0 0 var(--space-3); color: var(--danger); }
	.link { border: 0; background: none; padding: 0; color: var(--link); font-size: 13px; cursor: pointer; text-transform: none; letter-spacing: 0; }
	.link:disabled { opacity: 0.4; cursor: default; }
</style>
