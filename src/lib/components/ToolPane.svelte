<script lang="ts">
	import { setContext } from 'svelte';
	import { getTool } from '$lib/tools/registry';
	import { loc, t } from '$lib/i18n.svelte';
	import { ACTIVE_KEY } from '$lib/tools/util';
	import { goto } from '$app/navigation';
	import { ArrowLeft } from '@lucide/svelte';

	// One pane per tool the user has opened. The layout keeps visited panes mounted and
	// only hides them, so files, settings and running jobs survive switching tools.
	let { id, active }: { id: string; active: boolean } = $props();

	setContext(ACTIVE_KEY, () => active);

	const tool = $derived(getTool(id));
</script>

{#if tool}
	{@const Icon = tool.icon}
	<button class="back btn" type="button" onclick={() => goto('/tools')}>
		<ArrowLeft size={16} />{t('tool.back')}
	</button>
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
	.back {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		margin-bottom: 16px;
	}

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
		border: var(--edge-w) solid var(--edge);
		border-radius: 11px;
		background: var(--tint-1);
		box-shadow: var(--lift);
		color: var(--text);
	}

	h1 {
		font-family: var(--font-display);
		font-size: 26px;
		font-weight: 700;
		letter-spacing: -0.02em;
	}

	p {
		color: var(--text-dim);
	}

	.dim {
		color: var(--text-dim);
	}
</style>
