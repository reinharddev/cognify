<script lang="ts">
	import { t } from '$lib/i18n.svelte';
	import TabPane from '$lib/components/TabPane.svelte';
	import TrimPanel from './TrimPanel.svelte';
	import JoinPanel from './JoinPanel.svelte';

	let tab = $state<'trim' | 'join'>('trim');
</script>

<div class="tabs" role="tablist">
	<button role="tab" aria-selected={tab === 'trim'} class:on={tab === 'trim'} onclick={() => (tab = 'trim')}>
		{t('tj.tab.trim')}
	</button>
	<button role="tab" aria-selected={tab === 'join'} class:on={tab === 'join'} onclick={() => (tab = 'join')}>
		{t('tj.tab.join')}
	</button>
</div>

<TabPane active={tab === 'trim'}><TrimPanel /></TabPane>
<TabPane active={tab === 'join'}><JoinPanel /></TabPane>

<style>
	.tabs {
		display: inline-flex;
		margin-bottom: 18px;
		border: 1px solid var(--border);
		border-radius: 8px;
		overflow: hidden;
		background: var(--surface);
	}

	.tabs button {
		padding: 7px 22px;
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
