<script lang="ts">
	import { open } from '@tauri-apps/plugin-dialog';
	import { FolderOpen } from '@lucide/svelte';
	import { t } from '$lib/i18n.svelte';
	import { folderName } from '$lib/tools/util';

	let {
		value = $bindable(null),
		disabled = false,
		emptyLabel
	}: { value: string | null; disabled?: boolean; emptyLabel?: string } = $props();

	async function pick() {
		const picked = await open({ directory: true });
		if (typeof picked === 'string') value = picked;
	}
</script>

<div class="field">
	<span class="label">{t('convert.folder')}</span>
	<div class="row">
		<button class="btn" onclick={pick} {disabled}>
			<FolderOpen size={15} />
			{value ? folderName(value) : t('convert.pickFolder')}
		</button>
		<span class="dim">
			{#if value}
				<button class="link" onclick={() => (value = null)} {disabled}>{t('convert.reset')}</button>
			{:else}
				{emptyLabel ?? t('convert.sameFolder')}
			{/if}
		</span>
	</div>
</div>

<style>
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

	.row {
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
</style>
