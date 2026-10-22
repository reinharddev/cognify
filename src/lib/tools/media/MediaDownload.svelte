<script lang="ts">
	import Select from '$lib/ui/Select.svelte';
	import { onMount } from 'svelte';
	import { invoke } from '@tauri-apps/api/core';
	import { listen } from '@tauri-apps/api/event';
	import { revealItemInDir } from '@tauri-apps/plugin-opener';
	import { Check, TriangleAlert } from '@lucide/svelte';
	import FolderPicker from '$lib/components/FolderPicker.svelte';
	import { t, type DictKey } from '$lib/i18n.svelte';
	import { fileName, formatBytes, formatDuration } from '../util';

	type EngineStatus = { id: string; label: string; approxMb: number; supported: boolean; installed: boolean; path: string | null };
	type Info = {
		title: string;
		uploader: string | null;
		durationSec: number | null;
		thumbnail: string | null;
		site: string;
		isPlaylist: boolean;
		entryCount: number | null;
		heights: number[];
	};
	type Progress = { jobId: string; percent: number | null; speed: number | null; eta: number | null; phase: 'download' | 'process'; stream: number };

	const ACK_KEY = 'toolbox.media.acknowledged';
	const read = () => {
		try {
			return localStorage.getItem(ACK_KEY) === '1';
		} catch {
			return false;
		}
	};
	const write = (on: boolean) => {
		try {
			on ? localStorage.setItem(ACK_KEY, '1') : localStorage.removeItem(ACK_KEY);
		} catch {}
	};

	let acknowledged = $state(read());
	let ticked = $state(false);

	let engine = $state<EngineStatus | null>(null);
	let version = $state<string | null>(null);
	let engineJob = '';
	let engineBusy = $state(false);
	let enginePercent = $state(0);
	let engineError = $state<string | null>(null);

	let url = $state('');
	let allowPlaylist = $state(false);
	let info = $state<Info | null>(null);
	let checking = $state(false);
	let mode = $state<'video' | 'audio'>('video');
	let maxHeight = $state<number | null>(null);
	let audioFormat = $state<'mp3' | 'm4a' | 'opus'>('mp3');
	let outDir = $state<string | null>(null);

	let downloading = $state(false);
	let progress = $state<Progress | null>(null);
	let files = $state<string[]>([]);
	let error = $state<{ code: string; raw: string } | null>(null);
	let downloadJob = '';

	/** Backend errors look like "code|last lines of yt-dlp's complaint". */
	function parseError(e: unknown) {
		const [code, ...rest] = String(e).split('|');
		return { code: code || 'failed', raw: rest.join('|').trim() };
	}

	async function refreshEngine() {
		engine = (await invoke<EngineStatus[]>('engine_catalog')).find((e) => e.id === 'yt-dlp') ?? null;
		version = engine?.installed ? await invoke<string | null>('ytdlp_version').catch(() => null) : null;
	}

	async function installEngine() {
		engineBusy = true;
		engineError = null;
		enginePercent = 0;
		engineJob = crypto.randomUUID();
		try {
			await invoke('engine_install', { jobId: engineJob, id: 'yt-dlp' });
			await refreshEngine();
		} catch (e) {
			if (e !== 'cancelled') engineError = String(e);
		}
		engineBusy = false;
	}

	async function removeEngine() {
		engineError = null;
		try {
			await invoke('engine_remove', { id: 'yt-dlp' });
			await refreshEngine();
			info = null;
		} catch (e) {
			engineError = String(e);
		}
	}

	async function check() {
		checking = true;
		info = null;
		files = [];
		error = null;
		try {
			info = await invoke<Info>('media_info', { jobId: crypto.randomUUID(), req: { url, allowPlaylist } });
			maxHeight = null;
		} catch (e) {
			error = parseError(e);
		}
		checking = false;
	}

	async function download() {
		downloading = true;
		progress = null;
		files = [];
		error = null;
		downloadJob = crypto.randomUUID();
		try {
			const r = await invoke<{ files: string[] }>('media_download', {
				req: {
					jobId: downloadJob,
					url,
					outDir,
					mode,
					maxHeight: mode === 'video' ? maxHeight : null,
					audioFormat,
					playlist: allowPlaylist && !!info?.isPlaylist
				}
			});
			files = r.files;
		} catch (e) {
			if (e !== 'cancelled') error = parseError(e);
		}
		downloading = false;
	}

	const cancelDownload = () => invoke('cancel_job', { jobId: downloadJob });
	const cancelEngine = () => invoke('cancel_job', { jobId: engineJob });

	function disable() {
		write(false);
		acknowledged = false;
		ticked = false;
	}

	onMount(() => {
		if (acknowledged) refreshEngine().catch((e) => (engineError = String(e)));
		const unlisten = [
			listen<Progress>('media-progress', (e) => {
				if (e.payload.jobId === downloadJob) progress = e.payload;
			}),
			listen<{ jobId: string; percent: number }>('job-progress', (e) => {
				if (e.payload.jobId === engineJob) enginePercent = e.payload.percent;
			})
		];
		return () => unlisten.forEach((u) => u.then((fn) => fn()));
	});

	$effect(() => {
		if (acknowledged && !engine) refreshEngine().catch((e) => (engineError = String(e)));
	});

	function enable() {
		write(true);
		acknowledged = true;
	}
</script>

{#if !acknowledged}
	<section class="card">
		<h2>{t('media.intro.title')}</h2>
		<ul>
			<li>{t('media.intro.1')}</li>
			<li>{t('media.intro.2')}</li>
			<li>{t('media.intro.3')}</li>
			<li>{t('media.intro.4')}</li>
		</ul>
		<label class="check"><input type="checkbox" bind:checked={ticked} /> {t('media.ack')}</label>
		<button class="btn primary" disabled={!ticked} onclick={enable}>{t('media.enable')}</button>
	</section>
{:else}
	<section class="card">
		<div class="row">
			<h2>{t('media.engine.title')}</h2>
			{#if engine?.installed}
				<span class="dim">{t('media.engine.version')} {version ?? '?'}</span>
			{/if}
		</div>
		{#if engine && !engine.supported}
			<p class="dim">{t('media.engine.unsupported')}</p>
		{:else if engine && !engine.installed}
			<p class="dim">{t('media.engine.missing')}</p>
			{#if engineBusy}
				<div class="bar"><div style:width="{enginePercent}%"></div></div>
				<div class="row">
					<span class="dim">{Math.round(enginePercent)}%</span>
					<button class="btn" onclick={cancelEngine}>{t('convert.cancel')}</button>
				</div>
			{:else}
				<div><button class="btn primary" onclick={installEngine}>{t('media.engine.install')} (≈{engine.approxMb} MB)</button></div>
			{/if}
		{:else if engine}
			<p class="dim">{t('media.engine.hint')}</p>
			{#if engineBusy}
				<div class="bar"><div style:width="{enginePercent}%"></div></div>
			{:else}
				<div class="row">
					<button class="btn" onclick={installEngine} disabled={downloading}>{t('media.engine.update')}</button>
					<button class="btn" onclick={removeEngine} disabled={downloading}>{t('media.engine.remove')}</button>
					<button class="link" onclick={disable} disabled={downloading}>{t('media.disable')}</button>
				</div>
			{/if}
		{/if}
		{#if engineError}<pre class="error">{engineError}</pre>{/if}
	</section>

	{#if engine?.installed}
		<section class="card">
			<label class="field">
				<span class="label">{t('media.url')}</span>
				<div class="row grow">
					<input bind:value={url} placeholder={t('media.url.ph')} spellcheck="false" autocomplete="off" onkeydown={(e) => e.key === 'Enter' && url.trim() && !checking && check()} />
					<button class="btn primary" onclick={check} disabled={!url.trim() || checking || downloading}>
						{checking ? t('media.checking') : t('media.check')}
					</button>
				</div>
			</label>
			<label class="check"><input type="checkbox" bind:checked={allowPlaylist} disabled={downloading} /> {t('media.playlist')}</label>
		</section>

		{#if error && !downloading}
			<div class="problem">
				<p><TriangleAlert size={16} /> {t(`media.err.${error.code}` as DictKey)}</p>
				{#if error.raw}<pre class="error">{error.raw}</pre>{/if}
			</div>
		{/if}

		{#if info}
			<section class="card">
				<div class="media">
					{#if info.thumbnail}<img src={info.thumbnail} alt="" referrerpolicy="no-referrer" />{/if}
					<div>
						<strong>{info.title}</strong>
						<p class="dim">
							{[info.uploader, info.site, info.durationSec ? formatDuration(info.durationSec) : null].filter(Boolean).join(' · ')}
						</p>
						{#if info.isPlaylist}<p class="dim">{info.entryCount ?? '?'} {t('media.entries')}</p>{/if}
					</div>
				</div>

				<div class="options">
					<div class="seg" role="radiogroup">
						<button class:on={mode === 'video'} role="radio" aria-checked={mode === 'video'} disabled={downloading} onclick={() => (mode = 'video')}>
							{t('media.mode.video')}
						</button>
						<button class:on={mode === 'audio'} role="radio" aria-checked={mode === 'audio'} disabled={downloading} onclick={() => (mode = 'audio')}>
							{t('media.mode.audio')}
						</button>
					</div>

					{#if mode === 'video'}
						<label class="inline">
							<span class="dim">{t('media.quality')}</span>
							<Select bind:value={maxHeight} disabled={downloading} options={[{ value: null, label: t('media.quality.best') }, ...info.heights.map((h) => ({ value: h, label: `${h}p` }))]} />
						</label>
					{:else}
						<label class="inline">
							<span class="dim">{t('media.audioFormat')}</span>
							<Select bind:value={audioFormat} disabled={downloading} options={[{ value: 'mp3', label: 'MP3' }, { value: 'm4a', label: 'M4A' }, { value: 'opus', label: 'Opus' }]} />
						</label>
					{/if}
					<FolderPicker bind:value={outDir} disabled={downloading} emptyLabel={t('media.folder.empty')} />
				</div>

				<div class="row">
					{#if downloading}
						<button class="btn" onclick={cancelDownload}>{t('convert.cancel')}</button>
					{:else}
						<button class="btn primary" onclick={download}>{t('media.download')}</button>
					{/if}
				</div>

				{#if downloading}
					<div class="bar" class:indeterminate={progress?.percent == null || progress.phase === 'process'}>
						<div style:width="{progress?.phase === 'process' ? 100 : Math.max(progress?.percent ?? 0, 0)}%"></div>
					</div>
					<p class="dim">
						{#if progress?.phase === 'process'}
							{t('media.processing')}
						{:else if progress}
							{t('media.downloading')}
							{progress.percent != null ? `${Math.round(progress.percent)}%` : ''}
							{progress.speed ? `· ${formatBytes(progress.speed)}/s` : ''}
							{progress.eta != null ? `· ${formatDuration(progress.eta)}` : ''}
							{progress.stream > 0 ? `· ${t('media.part')} ${progress.stream + 1}` : ''}
						{/if}
					</p>
				{/if}
			</section>

			{#if files.length > 0}
				<div class="result">
					<p class="ok"><Check size={16} /> {t('media.done')}: {files.length}</p>
					<ul>
						{#each files as path (path)}
							<li>
								<span class="name" title={path}>{fileName(path)}</span>
								<button class="link" onclick={() => revealItemInDir(path)}>{t('convert.reveal')}</button>
							</li>
						{/each}
					</ul>
				</div>
			{/if}
		{/if}
	{/if}
{/if}

<style>
	.card {
		display: flex;
		flex-direction: column;
		gap: 12px;
		margin-bottom: 14px;
		padding: 16px 18px;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
	}

	h2 {
		font-size: 14px;
		font-weight: 650;
	}

	ul {
		margin: 0;
		padding-left: 18px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.row {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 10px;
	}

	.row.grow input {
		flex: 1;
		min-width: 200px;
	}

	.dim {
		color: var(--text-dim);
		font-size: 13px;
		margin: 0;
	}

	.check {
		display: inline-flex;
		align-items: center;
		gap: 8px;
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

	input:not([type]) {
		padding: 8px 10px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--surface);
		color: var(--text);
		font: inherit;
		user-select: text;
		-webkit-user-select: text;
	}


	.media {
		display: flex;
		gap: 14px;
		align-items: flex-start;
	}

	.media img {
		width: 160px;
		aspect-ratio: 16 / 9;
		object-fit: cover;
		border-radius: 8px;
		background: var(--surface-2);
	}

	.options {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 14px 22px;
	}

	.inline {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}

	.seg {
		display: inline-flex;
		border: 1px solid var(--border);
		border-radius: 8px;
		overflow: hidden;
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

	.bar {
		height: 4px;
		border-radius: 2px;
		background: var(--surface-2);
		overflow: hidden;
	}

	.bar div {
		height: 100%;
		background: var(--accent);
		transition: width 0.2s;
	}

	.bar.indeterminate div {
		width: 35% !important;
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

	.problem {
		margin-bottom: 14px;
		color: var(--danger);
	}

	.problem p {
		display: flex;
		align-items: flex-start;
		gap: 6px;
		margin: 0 0 8px;
	}

	.result .ok {
		display: flex;
		align-items: center;
		gap: 6px;
		margin: 0 0 8px;
		color: var(--ok);
	}

	.result ul {
		list-style: none;
		padding: 0;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		gap: 0;
	}

	.result li {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 12px;
		border-bottom: 1px solid var(--border);
	}

	.result li:last-child {
		border-bottom: 0;
	}

	.name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.error {
		margin: 0;
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
