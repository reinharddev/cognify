<script lang="ts">
	import { onMount } from 'svelte';
	import { invoke } from '@tauri-apps/api/core';
	import { listen } from '@tauri-apps/api/event';
	import { TriangleAlert } from '@lucide/svelte';
	import { t } from '$lib/i18n.svelte';

	/** Dipanggil setelah ffmpeg selesai dipasang, supaya alat yang memakainya memuat ulang. */
	let { onready }: { onready?: () => void } = $props();

	type EngineStatus = { id: string; label: string; approxMb: number; supported: boolean; installed: boolean; path: string | null };

	let missing = $state(false);
	let engine = $state<EngineStatus | null>(null);
	let busy = $state(false);
	let percent = $state(0);
	let error = $state<string | null>(null);
	let job = '';

	/** ffmpeg dan ffprobe dua-duanya dibutuhkan; true bila keduanya ada. */
	async function check(): Promise<boolean> {
		const [ffmpeg, ffprobe] = await Promise.all([
			invoke<string | null>('engine_status', { name: 'ffmpeg' }),
			invoke<string | null>('engine_status', { name: 'ffprobe' })
		]);
		missing = !ffmpeg || !ffprobe;
		if (missing) engine = (await invoke<EngineStatus[]>('engine_catalog')).find((e) => e.id === 'ffmpeg') ?? null;
		return !missing;
	}

	async function install() {
		busy = true;
		error = null;
		percent = 0;
		job = crypto.randomUUID();
		try {
			await invoke('engine_install', { jobId: job, id: 'ffmpeg' });
			if (await check()) onready?.();
		} catch (e) {
			if (e !== 'cancelled') error = String(e);
		}
		busy = false;
	}

	const cancel = () => invoke('cancel_job', { jobId: job });

	onMount(() => {
		check().catch(() => {});
		const unlisten = listen<{ jobId: string; percent: number }>('job-progress', (e) => {
			if (e.payload.jobId === job) percent = e.payload.percent;
		});
		return () => unlisten.then((fn) => fn());
	});
</script>

{#if missing}
	<div class="notice">
		<TriangleAlert size={18} />
		<div class="body">
			<strong>{t('ffmpeg.missing')}</strong>
			{#if engine && !engine.supported}
				<p>{t('ffmpeg.unsupported')}</p>
			{:else}
				<p>{t('ffmpeg.explain')}</p>
				{#if busy}
					<div class="bar"><div style:width="{percent}%"></div></div>
					<div class="row">
						<span>{Math.round(percent)}%</span>
						<button class="btn" onclick={cancel}>{t('convert.cancel')}</button>
					</div>
				{:else if engine}
					<div class="row">
						<button class="btn primary" onclick={install}>{t('ffmpeg.install')} (≈{engine.approxMb} MB)</button>
					</div>
				{/if}
				{#if error}<p class="err">{error}</p>{/if}
			{/if}
		</div>
	</div>
{/if}

<style>
	.notice {
		display: flex;
		gap: var(--space-3);
		padding: var(--space-3);
		margin-bottom: var(--space-4);
		border: 1px solid var(--danger);
		border-radius: var(--radius);
		color: var(--danger);
	}

	.body {
		flex: 1;
		min-width: 0;
	}

	.notice p {
		color: var(--text-dim);
		margin: var(--space-1) 0 0;
	}

	.notice p.err {
		color: var(--danger);
	}

	.row {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		margin-top: var(--space-2);
		color: var(--text-dim);
	}

	.bar {
		height: var(--space-1);
		margin-top: var(--space-2);
		border-radius: var(--radius-1);
		background: var(--surface-2);
		overflow: hidden;
	}

	.bar div {
		height: 100%;
		background: var(--accent);
		transition: width 0.2s;
	}
</style>
