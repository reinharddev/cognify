<script lang="ts">
	import { tools } from '$lib/tools/registry';
	import { loc, t } from '$lib/i18n.svelte';

	const ready = tools.filter((tool) => tool.status === 'ready');
	const soon = tools.filter((tool) => tool.status === 'soon');
</script>

<header>
	<h1>{t('home.title')}</h1>
	<p>{t('home.subtitle')}</p>
	<p class="hint">{t('search.hint')}</p>
</header>

<section>
	<h2>{t('home.ready')}</h2>
	<div class="grid">
		{#each ready as tool, i (tool.id)}
			{@const Icon = tool.icon}
			<a class="card" href="/tools/{tool.id}">
				<span class="icon" style:--tint="var(--tint-{(i % 6) + 1})"><Icon size={20} /></span>
				<strong>{loc(tool.name)}</strong>
				<span class="desc">{loc(tool.description)}</span>
			</a>
		{/each}
	</div>
</section>

{#if soon.length > 0}
	<section>
		<h2>{t('home.soon')}</h2>
		<div class="chips">
			{#each soon as tool (tool.id)}
				{@const Icon = tool.icon}
				<a class="chip" href="/tools/{tool.id}"><Icon size={14} />{loc(tool.name)}</a>
			{/each}
		</div>
	</section>
{/if}

<style>
	header {
		margin-bottom: 32px;
	}

	h1 {
		font-family: var(--font-display);
		font-size: 30px;
		font-weight: 700;
		letter-spacing: -0.02em;
		margin-bottom: 6px;
	}

	header p {
		color: var(--text-dim);
	}

	.hint {
		margin-top: 4px;
		font-size: 12px;
	}

	section {
		margin-bottom: 32px;
	}

	h2 {
		font-size: 12px;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-dim);
		margin-bottom: 12px;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
		gap: 12px;
	}

	.card {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 16px;
		border: var(--edge-w) solid var(--edge);
		border-radius: var(--radius);
		background: var(--surface);
		box-shadow: var(--lift);
		transition: transform var(--dur-1), box-shadow var(--dur-1);
	}

	.card:hover {
		transform: translate(var(--hop), var(--hop));
		box-shadow: var(--lift-lg);
	}

	.icon {
		display: grid;
		place-items: center;
		width: 36px;
		height: 36px;
		margin-bottom: 8px;
		border: var(--edge-w) solid var(--edge);
		border-radius: 9px;
		background: var(--tint, var(--accent-soft));
		color: var(--text);
	}

	.desc {
		color: var(--text-dim);
		font-size: 13px;
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 5px 11px;
		border: var(--edge-w) dashed var(--edge);
		border-radius: 999px;
		color: var(--text-dim);
		font-size: 13px;
	}
</style>
