<script lang="ts">
	import { onMount } from 'svelte';
	import { invoke } from '@tauri-apps/api/core';
	import { listen } from '@tauri-apps/api/event';
	import { getCurrentWebview } from '@tauri-apps/api/webview';
	import { open } from '@tauri-apps/plugin-dialog';
	import { revealItemInDir } from '@tauri-apps/plugin-opener';
	import { FolderOpen, Upload, X, Check, TriangleAlert } from '@lucide/svelte';
	import { t } from '$lib/i18n.svelte';

	type Kind = 'video' | 'audio' | 'image';
	type Status = 'queued' | 'running' | 'done' | 'error' | 'cancelled';
	type Item = {
		id: string;
		path: string;
		name: string;
		status: Status;
		percent: number;
		output?: string;
		error?: string;
	};

	let { kind }: { kind: Kind } = $props();

	const VIDEO_IN = ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'flv', 'wmv', 'mpg', 'mpeg'];
	const AUDIO_IN = ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'opus', 'wma'];
	const IMAGE_IN = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tiff', 'tif'];

	const config = {
		video: { formats: ['mp4', 'mkv', 'webm', 'gif'], inputs: VIDEO_IN },
		// Audio tool also accepts video files, to pull the sound track out.
		audio: { formats: ['mp3', 'm4a', 'wav', 'flac'], inputs: [...AUDIO_IN, ...VIDEO_IN] },
		image: { formats: ['jpg', 'png', 'webp'], inputs: IMAGE_IN }
	} as const;

	const cfg = $derived(config[kind]);

	let items = $state<Item[]>([]);
	// The tool page remounts this component per tool ({#key}), so reading the
	// initial `kind` once is intentional.
	// svelte-ignore state_referenced_locally
	let format = $state<string>(config[kind].formats[0]);
	let outDir = $state<string | null>(null);
	let running = $state(false);
	let dragging = $state(false);
	let ffmpegPath = $state<string | null | undefined>(undefined); // undefined = still checking
	let currentJobId: string | null = null;
	let stopRequested = false;

	// Formats this ffmpeg can actually encode; null until the check returns.
	let supported = $state<string[] | null>(null);
	const formats = $derived<string[]>(
		supported ? cfg.formats.filter((f) => supported!.includes(f)) : [...cfg.formats]
	);

	$effect(() => {
		if (formats.length > 0 && !formats.includes(format)) format = formats[0];
	});

	const queued = $derived(items.filter((i) => i.status === 'queued').length);

	const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;
	const extOf = (path: string) => fileName(path).split('.').pop()?.toLowerCase() ?? '';
	const folderName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

	function addPaths(paths: string[]) {
		const known = new Set(items.map((i) => i.path));
		for (const path of paths) {
			if (known.has(path) || !(cfg.inputs as readonly string[]).includes(extOf(path))) continue;
			known.add(path);
			items.push({ id: crypto.randomUUID(), path, name: fileName(path), status: 'queued', percent: 0 });
		}
	}

	async function pickFiles() {
		const picked = await open({
			multiple: true,
			filters: [{ name: kind, extensions: [...cfg.inputs] }]
		});
		if (picked) addPaths(picked);
	}

	async function pickFolder() {
		const picked = await open({ directory: true });
		if (typeof picked === 'string') outDir = picked;
	}

	async function start() {
		if (running) return;
		running = true;
		stopRequested = false;

		for (const item of items) {
			if (stopRequested) break;
			if (item.status !== 'queued') continue;

			item.status = 'running';
			item.percent = 0;
			currentJobId = item.id;
			try {
				item.output = await invoke<string>('convert_media', {
					req: { jobId: item.id, input: item.path, outDir, format }
				});
				item.status = 'done';
				item.percent = 100;
			} catch (e) {
				if (e === 'cancelled') {
					item.status = 'cancelled';
				} else {
					item.status = 'error';
					item.error = String(e);
				}
			}
			currentJobId = null;
		}
		running = false;
	}

	function cancel() {
		stopRequested = true;
		if (currentJobId) invoke('cancel_job', { jobId: currentJobId });
	}

	function remove(id: string) {
		items = items.filter((i) => i.id !== id);
	}

	function clearFinished() {
		items = items.filter((i) => i.status === 'queued' || i.status === 'running');
	}

	onMount(() => {
		invoke<string | null>('engine_status', { name: 'ffmpeg' }).then((p) => {
			ffmpegPath = p;
			if (p) invoke<string[]>('available_formats').then((f) => (supported = f));
		});

		const unlisteners: Promise<() => void>[] = [
			listen<{ jobId: string; percent: number }>('job-progress', (e) => {
				const item = items.find((i) => i.id === e.payload.jobId);
				if (item) item.percent = e.payload.percent;
			}),
			getCurrentWebview().onDragDropEvent((e) => {
				const type = e.payload.type;
				if (type === 'enter' || type === 'over') dragging = true;
				else if (type === 'leave') dragging = false;
				else if (type === 'drop') {
					dragging = false;
					addPaths(e.payload.paths);
				}
			})
		];
		return () => unlisteners.forEach((u) => u.then((fn) => fn()));
	});
</script>

{#if ffmpegPath === null}
	<div class="notice">
		<TriangleAlert size={18} />
		<div>
			<strong>{t('engine.missing')}</strong>
			<p>{t('engine.install')}</p>
		</div>
	</div>
{/if}

<div class="drop" class:dragging>
	<Upload size={22} />
	<p>{t('convert.drop')}</p>
	<button class="btn" onclick={pickFiles}>{t('convert.choose')}</button>
</div>

<div class="options">
	<div class="field">
		<span class="label">{t('convert.format')}</span>
		<div class="seg">
			{#each formats as f (f)}
				<button class:on={format === f} onclick={() => (format = f)} disabled={running}>
					{f.toUpperCase()}
				</button>
			{/each}
		</div>
	</div>

	<div class="field">
		<span class="label">{t('convert.folder')}</span>
		<div class="folder">
			<button class="btn" onclick={pickFolder} disabled={running}>
				<FolderOpen size={15} />
				{outDir ? folderName(outDir) : t('convert.pickFolder')}
			</button>
			<span class="dim">
				{#if outDir}
					<button class="link" onclick={() => (outDir = null)} disabled={running}>{t('convert.reset')}</button>
				{:else}
					{t('convert.sameFolder')}
				{/if}
			</span>
		</div>
	</div>
</div>

{#if items.length > 0}
	<ul class="list">
		{#each items as item (item.id)}
			<li class={item.status}>
				<div class="row">
					<span class="status-icon">
						{#if item.status === 'done'}<Check size={16} />{:else if item.status === 'error'}<TriangleAlert size={16} />{/if}
					</span>
					<span class="name" title={item.path}>{item.name}</span>
					<span class="state">
						{#if item.status === 'running' && item.percent >= 0}
							{Math.round(item.percent)}%
						{:else}
							{t(`convert.${item.status}` as 'convert.queued')}
						{/if}
					</span>
					{#if item.status === 'done' && item.output}
						<button class="link" onclick={() => revealItemInDir(item.output!)}>{t('convert.reveal')}</button>
					{/if}
					{#if item.status !== 'running'}
						<button class="icon-btn" aria-label={t('convert.remove')} onclick={() => remove(item.id)}>
							<X size={15} />
						</button>
					{/if}
				</div>
				{#if item.status === 'running'}
					<div class="bar" class:indeterminate={item.percent < 0}>
						<div style:width="{Math.max(item.percent, 0)}%"></div>
					</div>
				{/if}
				{#if item.error}<pre class="error">{item.error}</pre>{/if}
			</li>
		{/each}
	</ul>

	<div class="actions">
		{#if running}
			<button class="btn" onclick={cancel}>{t('convert.cancel')}</button>
		{:else}
			<button class="btn primary" onclick={start} disabled={queued === 0 || ffmpegPath === null}>
				{t('convert.start')}{queued > 0 ? ` (${queued})` : ''}
			</button>
			<button class="btn" onclick={clearFinished}>{t('convert.clear')}</button>
		{/if}
	</div>
{/if}

<style>
	.notice {
		display: flex;
		gap: 12px;
		padding: 12px 14px;
		margin-bottom: 16px;
		border: 1px solid var(--danger);
		border-radius: var(--radius);
		color: var(--danger);
	}

	.notice p {
		color: var(--text-dim);
	}

	.drop {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		padding: 36px 16px;
		border: var(--edge-w) dashed var(--edge);
		border-radius: var(--radius);
		background: var(--surface);
		color: var(--text-dim);
		transition: border-color 0.12s, background 0.12s;
	}

	.drop.dragging {
		border-color: var(--accent-strong);
		background: var(--accent-soft);
		color: var(--link);
	}

	.options {
		display: flex;
		flex-wrap: wrap;
		gap: 28px;
		margin: 22px 0;
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

	.seg {
		display: inline-flex;
		border: var(--edge-w) solid var(--edge);
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

	.folder {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.dim {
		color: var(--text-dim);
		font-size: 13px;
	}

	.link {
		border: 0;
		background: none;
		padding: 0;
		color: var(--link);
		font-size: 13px;
	}

	.list {
		list-style: none;
		margin: 0 0 18px;
		padding: 0;
		border: var(--edge-w) solid var(--edge);
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

	.row {
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
		font-size: 12px;
		color: var(--text-dim);
		font-variant-numeric: tabular-nums;
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

	.bar {
		height: 4px;
		margin-top: 8px;
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

	.error {
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

	.actions {
		display: flex;
		gap: 10px;
	}
</style>
