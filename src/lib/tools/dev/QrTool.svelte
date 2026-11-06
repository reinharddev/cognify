<script lang="ts">
	import { t } from '$lib/i18n.svelte';
	import TabPane from '$lib/components/TabPane.svelte';
	import QrCreate from './QrCreate.svelte';
	import QrRead from './QrRead.svelte';

	let tab = $state<'create' | 'read'>('create');
</script>

<div class="tabs" role="tablist">
	<button role="tab" aria-selected={tab === 'create'} class:on={tab === 'create'} onclick={() => (tab = 'create')}>
		{t('qr.tab.create')}
	</button>
	<button role="tab" aria-selected={tab === 'read'} class:on={tab === 'read'} onclick={() => (tab = 'read')}>
		{t('qr.tab.read')}
	</button>
</div>

<TabPane active={tab === 'create'}><QrCreate /></TabPane>
<TabPane active={tab === 'read'}><QrRead /></TabPane>

<style>
	.tabs {
		display: inline-flex;
		margin-bottom: var(--space-4);
		border: var(--edge-w) solid var(--edge);
		border-radius: var(--radius-2);
		overflow: hidden;
		background: var(--surface);
	}

	.tabs button {
		padding: var(--space-2) var(--space-4);
		border: 0;
		border-right: 1px solid var(--border);
		background: transparent;
	}

	.tabs button:last-child {
		border-right: 0;
	}

	.tabs button.on {
		background: var(--accent);
		color: var(--accent-text);
	}
</style>
