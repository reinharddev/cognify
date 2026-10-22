<script lang="ts">
	import Select from '$lib/ui/Select.svelte';
	import { onMount } from 'svelte';
	import { invoke } from '@tauri-apps/api/core';
	import { open } from '@tauri-apps/plugin-dialog';
	import { X, Check, TriangleAlert, ArrowRight } from '@lucide/svelte';
	import DropZone from '$lib/components/DropZone.svelte';
	import { t, type DictKey } from '$lib/i18n.svelte';
	import { fileName, listenFileDrop } from '../util';
	import { computeNames, defaultRules, naturalCompare, type Rules } from './rename';

	type Stat = { path: string; name: string; size: number; mtimeMs: number };
	type Item = { id: string; path: string; name: string; mtimeMs: number };
	type Done = { from: string; to: string };
	type Check = { from: string; to: string; error: string | null };

	let items = $state<Item[]>([]);
	let rules = $state<Rules>({ ...defaultRules });
	let order = $state<'picked' | 'name' | 'date'>('picked');
	let checks = $state<Record<string, string | null>>({}); // item id -> error code
	let working = $state(false);
	let last = $state<{ done: Done[]; undone?: boolean } | null>(null);
	let failure = $state<string | null>(null);
	let dragging = $state(false);

	const computed = $derived(computeNames(items, rules));
	const changed = $derived(items.filter((it, i) => computed.names[i] !== it.name).length);
	const problems = $derived(
		items.filter((it, i) => computed.names[i] !== it.name && checks[it.id]).length + (computed.regexError ? 1 : 0)
	);
	const canApply = $derived(changed > 0 && problems === 0 && !working);

	async function addPaths(paths: string[]) {
		last = null;
		failure = null;
		const known = new Set(items.map((i) => i.path));
		const fresh = paths.filter((p) => !known.has(p));
		if (fresh.length === 0) return;
		const stats = await invoke<({ Ok: Stat } | { Err: string })[]>('file_stats', { paths: fresh });
		for (const s of stats) {
			const ok = (s as { Ok?: Stat }).Ok;
			if (ok) items.push({ id: crypto.randomUUID(), path: ok.path, name: ok.name, mtimeMs: ok.mtimeMs });
		}
		sortItems();
	}

	function sortItems() {
		if (order === 'name') items.sort((a, b) => naturalCompare(a.name, b.name));
		else if (order === 'date') items.sort((a, b) => a.mtimeMs - b.mtimeMs);
	}

	async function pick() {
		const picked = await open({ multiple: true });
		if (picked) addPaths(picked);
	}

	const remove = (id: string) => (items = items.filter((i) => i.id !== id));

	// Ask the backend which renames would collide or break, shortly after any change.
	let token = 0;
	$effect(() => {
		const snapshot = items.map((it, i) => ({ id: it.id, from: it.path, to: computed.names[i] }));
		if (snapshot.length === 0 || computed.regexError) {
			checks = {};
			return;
		}
		const timer = setTimeout(async () => {
			const mine = ++token;
			const result = await invoke<Check[]>('rename_check', { ops: snapshot.map(({ from, to }) => ({ from, to })) });
			if (mine !== token) return;
			const next: Record<string, string | null> = {};
			snapshot.forEach((s, i) => (next[s.id] = result[i]?.error ?? null));
			checks = next;
		}, 200);
		return () => clearTimeout(timer);
	});

	function insertToken(tok: string) {
		rules.template = rules.template === '{name}' && tok !== '{name}' ? `{name}_${tok}` : rules.template + tok;
	}

	/** Backend errors look like "exists:file.txt" or "failed:file.txt:reason". */
	function describe(err: string): string {
		const [code, name, ...rest] = err.split(':');
		if (code === 'failed') return `${t('rn.fail')} ${name} (${rest.join(':')})`;
		const key = `rn.err.${code}` as DictKey;
		return `${name}: ${t(key)}`;
	}

	async function applyOps(ops: { from: string; to: string }[]): Promise<Done[] | null> {
		working = true;
		failure = null;
		try {
			return await invoke<Done[]>('rename_apply', { ops });
		} catch (e) {
			failure = describe(String(e));
			return null;
		} finally {
			working = false;
		}
	}

	async function apply() {
		const ops = items.map((it, i) => ({ from: it.path, to: computed.names[i] })).filter((o, i) => o.to !== items[i].name);
		const done = await applyOps(ops);
		if (!done) return;
		const byFrom = new Map(done.map((d) => [d.from, d.to]));
		for (const it of items) {
			const to = byFrom.get(it.path);
			if (to) {
				it.path = to;
				it.name = fileName(to);
			}
		}
		last = { done };
	}

	async function undo() {
		if (!last) return;
		const ops = last.done.map((d) => ({ from: d.to, to: fileName(d.from) }));
		const restored = await applyOps(ops);
		if (!restored) return;
		const byFrom = new Map(restored.map((d) => [d.from, d.to]));
		for (const it of items) {
			const to = byFrom.get(it.path);
			if (to) {
				it.path = to;
				it.name = fileName(to);
			}
		}
		last = { done: last.done, undone: true };
	}

	onMount(() => listenFileDrop(addPaths, (h) => (dragging = h)));
</script>

<DropZone {dragging} label={t('rn.drop')} buttonLabel={t('convert.choose')} onchoose={pick} />
<p class="hint">{t('rn.note')}</p>

{#if items.length > 0}
	<div class="rules">
		<fieldset>
			<legend>{t('rn.find')}</legend>
			<div class="grid">
				<input bind:value={rules.find} placeholder={t('rn.find')} spellcheck="false" aria-label={t('rn.find')} />
				<input bind:value={rules.replace} placeholder={t('rn.replace')} spellcheck="false" aria-label={t('rn.replace')} />
			</div>
			<div class="line">
				<label><input type="checkbox" bind:checked={rules.regex} /> {t('rn.regex')}</label>
				<label><input type="checkbox" bind:checked={rules.matchCase} /> {t('rn.matchCase')}</label>
				<label class="sel">
					{t('rn.scope')}
					<Select bind:value={rules.scope} options={[{ value: 'stem', label: t('rn.scope.stem') }, { value: 'full', label: t('rn.scope.full') }]} />
				</label>
			</div>
			{#if computed.regexError}<p class="bad">{t('rn.err.regex')}</p>{/if}
		</fieldset>

		<fieldset>
			<legend>{t('rn.template')}</legend>
			<input bind:value={rules.template} spellcheck="false" aria-label={t('rn.template')} />
			<div class="line">
				{#each ['{name}', '{n}', '{date}'] as tok (tok)}
					<button class="chip" onclick={() => insertToken(tok)}>{tok}</button>
				{/each}
				<label class="sel">{t('rn.start')} <input type="number" min="0" bind:value={rules.start} class="num" /></label>
				<label class="sel">{t('rn.step')} <input type="number" min="1" bind:value={rules.step} class="num" /></label>
				<label class="sel">{t('rn.pad')} <input type="number" min="0" max="9" bind:value={rules.pad} class="num" /></label>
			</div>
			<p class="dim">{t('rn.template.hint')}</p>
		</fieldset>

		<fieldset>
			<legend>{t('rn.case')}</legend>
			<div class="line">
				<label class="sel">
					{t('rn.spaces')}
					<Select bind:value={rules.spaces} options={[{ value: '', label: t('rn.spaces.keep') }, { value: '_', label: '_' }, { value: '-', label: '-' }, { value: '.', label: '.' }]} />
				</label>
				<label><input type="checkbox" bind:checked={rules.stripSpecial} /> {t('rn.strip')}</label>
				<label class="sel">
					{t('rn.case')}
					<Select bind:value={rules.letterCase} options={[{ value: 'keep', label: t('rn.case.keep') }, { value: 'lower', label: t('rn.case.lower') }, { value: 'upper', label: t('rn.case.upper') }, { value: 'title', label: t('rn.case.title') }]} />
				</label>
				<label class="sel">
					{t('rn.ext')}
					<Select bind:value={rules.extCase} options={[{ value: 'keep', label: t('rn.case.keep') }, { value: 'lower', label: t('rn.case.lower') }, { value: 'upper', label: t('rn.case.upper') }]} />
				</label>
				<button class="link" onclick={() => (rules = { ...defaultRules })}>{t('rn.reset')}</button>
			</div>
		</fieldset>
	</div>

	<div class="bar">
		<h2>{t('rn.preview')}</h2>
		<label class="sel">
			{t('rn.sort')}
			<Select bind:value={order} onchange={sortItems} options={[{ value: 'picked', label: t('rn.sort.picked') }, { value: 'name', label: t('rn.sort.name') }, { value: 'date', label: t('rn.sort.date') }]} />
		</label>
		<span class="dim">{changed} {t('rn.willChange')} · {items.length - changed} {t('rn.unchanged')}</span>
	</div>

	<ul class="list">
		{#each items as item, i (item.id)}
			{@const next = computed.names[i]}
			{@const isChange = next !== item.name}
			{@const err = isChange ? checks[item.id] : null}
			<li class:err={!!err}>
				<span class="old" title={item.path}>{item.name}</span>
				{#if isChange}
					<ArrowRight size={14} />
					<span class="new">{next}</span>
				{/if}
				<span class="status">
					{#if err}<span class="bad"><TriangleAlert size={14} /> {t(`rn.err.${err}` as DictKey)}</span>{/if}
				</span>
				<button class="icon-btn" aria-label={t('convert.remove')} disabled={working} onclick={() => remove(item.id)}>
					<X size={14} />
				</button>
			</li>
		{/each}
	</ul>

	<div class="actions">
		<button class="btn primary" onclick={apply} disabled={!canApply}>
			{working ? t('pdf.working') : `${t('rn.apply')}${changed > 0 ? ` (${changed})` : ''}`}
		</button>
		{#if last && !last.undone}
			<span class="ok"><Check size={16} /> {last.done.length} {t('rn.done')}</span>
			<button class="btn" onclick={undo} disabled={working}>{t('rn.undo')}</button>
		{:else if last?.undone}
			<span class="ok"><Check size={16} /> {t('rn.undone')}</span>
		{/if}
	</div>
	{#if failure}<p class="bad">{failure}</p>{/if}
{/if}

<style>
	.hint {
		margin: 12px 0 0;
		color: var(--text-dim);
		font-size: 13px;
	}

	.rules {
		display: flex;
		flex-direction: column;
		gap: 12px;
		margin-top: 18px;
	}

	fieldset {
		display: flex;
		flex-direction: column;
		gap: 10px;
		margin: 0;
		padding: 12px 14px;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
	}

	legend {
		padding: 0 6px;
		font-size: 12px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-dim);
	}

	.grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
	}

	.line {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px 18px;
	}

	label {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}

	input:not([type]) {
		padding: 7px 10px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--surface);
		color: var(--text);
		font: inherit;
		user-select: text;
		-webkit-user-select: text;
	}

	input:not([type]) {
		width: 100%;
	}

	.num {
		width: 64px;
		padding: 6px 8px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--surface);
		color: var(--text);
		font: inherit;
	}

	.chip {
		padding: 3px 10px;
		border: 1px solid var(--border);
		border-radius: 999px;
		background: var(--surface-2);
		font: 12.5px ui-monospace, Menlo, monospace;
	}

	.link {
		border: 0;
		background: none;
		padding: 0;
		margin-left: auto;
		color: var(--link);
		font-size: 13px;
	}

	.bar {
		display: flex;
		align-items: center;
		gap: 16px;
		margin: 22px 0 8px;
	}

	h2 {
		font-size: 12px;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--text-dim);
	}

	.dim {
		color: var(--text-dim);
		font-size: 13px;
	}

	.list {
		list-style: none;
		margin: 0 0 16px;
		padding: 0;
		max-height: 340px;
		overflow-y: auto;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
	}

	li {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 7px 12px;
		border-bottom: 1px solid var(--border);
		font-size: 13px;
	}

	li:last-child {
		border-bottom: 0;
	}

	li.err {
		background: color-mix(in srgb, var(--danger) 8%, transparent);
	}

	.old {
		color: var(--text-dim);
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		min-width: 0;
	}

	.new {
		font-weight: 550;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		min-width: 0;
	}

	.status {
		margin-left: auto;
	}

	.bad {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		color: var(--danger);
		font-size: 12.5px;
	}

	p.bad {
		margin: 6px 0 0;
	}

	.ok {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		color: var(--ok);
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
		gap: 12px;
	}
</style>
