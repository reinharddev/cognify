<script lang="ts">
	import { setContext } from 'svelte';
	import { getTool } from '$lib/tools/registry';
	import { loc, t } from '$lib/i18n.svelte';
	import { ACTIVE_KEY } from '$lib/tools/util';

	// One pane per tool the user has opened. The layout keeps visited panes mounted and
	// only hides them, so files, settings and running jobs survive switching tools.
	let { id, active }: { id: string; active: boolean } = $props();

	setContext(ACTIVE_KEY, () => active);

	const tool = $derived(getTool(id));
</script>

{#if tool}
	{@const Icon = tool.icon}
	<header>
		<span class="icon"><Icon size={22} /></span>
		<div>
			<h1>{loc(tool.name)}</h1>
			<p>{loc(tool.description)}</p>
		</div>
	</header>

	{#if tool.status === 'ready' && tool.load}
		{#await tool.load() then mod}
			{@const Tool = mod.default}
			<Tool {...tool.props} />
		{/await}
	{:else}
		<p class="dim">{t('tool.soon')}</p>
	{/if}
{/if}

<style>
	header {
		display: flex;
		align-items: center;
		gap: 14px;
		margin-bottom: 24px;
	}

	.icon {
		display: grid;
		place-items: center;
		width: 44px;
		height: 44px;
		border-radius: 11px;
		background: var(--accent-soft);
		color: var(--link);
	}

	h1 {
		font-size: 22px;
		font-weight: 650;
	}

	p {
		color: var(--text-dim);
	}

	.dim {
		color: var(--text-dim);
	}
</style>
