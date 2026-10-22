<script lang="ts">
	import { onMount } from 'svelte';
	import { invoke } from '@tauri-apps/api/core';
	import { listen } from '@tauri-apps/api/event';
	import { open } from '@tauri-apps/plugin-dialog';
	import { openUrl, revealItemInDir } from '@tauri-apps/plugin-opener';
	import { X, Check, TriangleAlert } from '@lucide/svelte';
	import DropZone from '$lib/components/DropZone.svelte';
	import FolderPicker from '$lib/components/FolderPicker.svelte';
	import { t, type DictKey } from '$lib/i18n.svelte';
	import { extOf, fileName, listenFileDrop } from '../util';

	type Status = 'queued' | 'running' | 'done' | 'error' | 'cancelled';
	type Item = { id: string; path: string; name: string; status: Status; output?: string; pages?: number | null; error?: string };

	const EXTENSIONS = ['pptx', 'ppt', 'pps', 'ppsx', 'odp', 'docx', 'doc', 'dotx', 'odt', 'rtf', 'txt', 'xlsx', 'xls', 'ods', 'csv'];
	const DOWNLOAD_PAGE = 'https://www.libreoffice.org/download/download-libreoffice/';

	let found = $state<boolean | null>(null);
	let location = $state<string | null>(null);
	let items = $state<Item[]>([]);
	let outDir = $state<string | null>(null);
	let dragging = $state(false);
	let running = $state(false);
	let currentJob: string | null = null;
	let stopRequested = false;
	let openError = $state<string | null>(null);

	// LibreOffice can be installed from here (macOS); elsewhere the download page is the fallback.
	type EngineStatus = { id: string; supported: boolean; installed: boolean };
	let canInstall = $state(false);
	let ownInstall = $state(false);
	let installing = $state(false);
	let installPercent = $state(0);
	let installError = $state<string | null>(null);
	let installJob = '';

	const queued = $derived(items.filter((i) => i.status === 'queued').length);

	async function check() {
		const s = await invoke<{ found: boolean; path: string | null }>('office_status');
		found = s.found;
		location = s.path;
		const all = await invoke<EngineStatus[]>('engine_catalog');
		const office = all.find((e) => e.id === 'libreoffice');
		canInstall = !!office?.supported;
		ownInstall = !!office?.installed;
	}

	async function install() {
		installing = true;
		installError = null;
		installPercent = 0;
		installJob = crypto.randomUUID();
		const stop = await listen<{ jobId: string; percent: number }>('job-progress', (e) => {
			if (e.payload.jobId === installJob) installPercent = e.payload.percent;
		});
		try {
			await invoke('engine_install', { jobId: installJob, id: 'libreoffice' });
			await check();
		} catch (e) {
			if (e !== 'cancelled') installError = String(e);
		} finally {
			stop();
			installing = false;
		}
	}

	async function removeInstalled() {
		await invoke('engine_remove', { id: 'libreoffice' });
		await check();
	}

	async function openDownload() {
		openError = null;
		try {
			await openUrl(DOWNLOAD_PAGE);
		} catch (e) {
			openError = String(e);
		}
	}

	function addPaths(paths: string[]) {
		const known = new Set(items.map((i) => i.path));
		for (const path of paths) {
			if (known.has(path) || !EXTENSIONS.includes(extOf(path))) continue;
			known.add(path);
			items.push({ id: crypto.randomUUID(), path, name: fileName(path), status: 'queued' });
		}
	}

	async function pick() {
		const picked = await open({ multiple: true, filters: [{ name: 'Documents', extensions: EXTENSIONS }] });
		if (picked) addPaths(picked);
	}

	function describe(e: unknown): string {
		const [code, ...rest] = String(e).split('|');
		const detail = rest.join('|').trim();
		if (code === 'failed' && detail) return detail;
		return `${t(`office.err.${code}` as DictKey)}${detail ? ' ' + detail : ''}`;
	}

	async function start() {
		running = true;
		stopRequested = false;
		for (const item of items) {
			if (stopRequested) break;
			if (item.status !== 'queued') continue;
			item.status = 'running';
			currentJob = item.id;
			try {
				const r = await invoke<{ output: string; pages: number | null }>('office_to_pdf', {
					req: { jobId: item.id, input: item.path, outDir }
				});
				Object.assign(item, { output: r.output, pages: r.pages });
				item.status = 'done';
			} catch (e) {
				if (e === 'cancelled') item.status = 'cancelled';
				else {
					item.status = 'error';
					item.error = describe(e);
				}
			}
			currentJob = null;
		}
		running = false;
	}

	function cancel() {
		stopRequested = true;
		if (currentJob) invoke('cancel_job', { jobId: currentJob });
	}

	const remove = (id: string) => (items = items.filter((i) => i.id !== id));
	const clearFinished = () => (items = items.filter((i) => i.status === 'queued' || i.status === 'running'));

	onMount(() => {
		check().catch(() => (found = false));
		return listenFileDrop(addPaths, (h) => (dragging = h));
	});
</script>

<section class="card">
	<h2>{t('office.status.title')}</h2>
	{#if found === false}
		<p class="dim">{canInstall ? t('office.install.missing') : t('office.status.missing')}</p>
		{#if installing}
			<div class="bar"><div class="fill" style:width="{installPercent}%"></div></div>
			<div class="row">
				<span class="dim">{Math.round(installPercent)}% · {t('office.installing')}</span>
				<button class="btn" onclick={() => invoke('cancel_job', { jobId: installJob })}>{t('convert.cancel')}</button>
			</div>
		{:else if canInstall}
			<div class="row">
				<button class="btn primary" onclick={install}>{t('office.install')} (≈300 MB)</button>
				<button class="btn" onclick={check}>{t('office.status.recheck')}</button>
			</div>
			<p class="dim">{t('office.install.note')} <button class="link" onclick={openDownload}>{t('office.install.manual')}</button></p>
		{:else}
			<div class="row">
				<button class="btn primary" onclick={openDownload}>{t('office.status.open')}</button>
				<button class="btn" onclick={check}>{t('office.status.recheck')}</button>
			</div>
		{/if}
		{#if installError}<pre class="error">{installError}</pre>{/if}
		{#if openError}<pre class="error">{openError}</pre>{/if}
	{:else if found}
		<p class="ok"><Check size={16} /> {t('office.status.found')}</p>
		{#if location}<p class="dim path" title={location}>{location}</p>{/if}
		{#if ownInstall}
			<div><button class="link" onclick={removeInstalled} disabled={running}>{t('office.install.remove')}</button></div>
		{/if}
	{/if}
</section>

{#if found}
	<DropZone {dragging} label={t('office.drop')} buttonLabel={t('convert.choose')} onchoose={pick} />
	<p class="dim note">{t('office.note')}</p>

	<div class="options"><FolderPicker bind:value={outDir} disabled={running} /></div>

	{#if items.length > 0}
		<ul class="list">
			{#each items as item (item.id)}
				<li class={item.status}>
					<div class="head">
						<span class="status-icon">
							{#if item.status === 'done'}<Check size={16} />{:else if item.status === 'error'}<TriangleAlert size={16} />{/if}
						</span>
						<span class="name" title={item.path}>{item.name}</span>
						<span class="state">
							{#if item.status === 'queued'}{t('convert.queued')}
							{:else if item.status === 'running'}{t('office.converting')}
							{:else if item.status === 'done'}{item.pages ?? '?'} {t('office.pages')}
							{:else if item.status === 'cancelled'}{t('convert.cancelled')}{/if}
						</span>
						{#if item.status === 'done' && item.output}
							<button class="link" onclick={() => revealItemInDir(item.output!)}>{t('convert.reveal')}</button>
						{/if}
						{#if item.status !== 'running'}
							<button class="icon-btn" aria-label={t('convert.remove')} onclick={() => remove(item.id)}><X size={15} /></button>
						{/if}
					</div>
					{#if item.status === 'running'}
						<div class="bar indeterminate"><div></div></div>
					{/if}
					{#if item.error}<pre class="error">{item.error}</pre>{/if}
				</li>
			{/each}
		</ul>

		<div class="actions">
			{#if running}
				<button class="btn" onclick={cancel}>{t('convert.cancel')}</button>
			{:else}
				<button class="btn primary" onclick={start} disabled={queued === 0}>{t('office.start')}{queued > 0 ? ` (${queued})` : ''}</button>
				<button class="btn" onclick={clearFinished}>{t('convert.clear')}</button>
			{/if}
		</div>
	{/if}
{/if}

<style>
	.card {
		display: flex;
		flex-direction: column;
		gap: 10px;
		margin-bottom: 16px;
		padding: 14px 16px;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
	}

	h2 {
		font-size: 14px;
		font-weight: 650;
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
	}

	.dim {
		margin: 0;
		color: var(--text-dim);
		font-size: 13px;
	}

	.path {
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.note {
		margin-top: 12px;
	}

	.ok {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		margin: 0;
		color: var(--ok);
	}

	.options {
		margin: 18px 0;
	}

	.list {
		list-style: none;
		margin: 0 0 16px;
		padding: 0;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		overflow: hidden;
	}

	li {
		padding: 10px 14px;
		border-bottom: 1px solid var(--border);
	}

	li:last-child {
		border-bottom: 0;
	}

	.head {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.status-icon {
		display: inline-flex;
		width: 16px;
	}

	li.done .status-icon {
		color: var(--ok);
	}

	li.error .status-icon {
		color: var(--danger);
	}

	.name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.state {
		font-size: 13px;
		color: var(--text-dim);
	}

	.bar {
		height: 4px;
		margin-top: 8px;
		border-radius: 2px;
		background: var(--surface-2);
		overflow: hidden;
	}

	.bar div.fill {
		width: auto;
		animation: none;
		transition: width 0.2s;
	}

	.bar div {
		height: 100%;
		width: 35%;
		background: var(--accent);
		animation: slide 1.1s ease-in-out infinite;
	}

	@keyframes slide {
		from {
			transform: translateX(-100%);
		}
		to {
			transform: translateX(300%);
		}
	}

	.link {
		border: 0;
		background: none;
		padding: 0;
		color: var(--link);
		font-size: 13px;
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
		gap: 10px;
	}

	pre.error {
		margin: 8px 0 0;
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
