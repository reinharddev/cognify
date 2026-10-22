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
		{#each ready as tool (tool.id)}
			{@const Icon = tool.icon}
			<a class="card" href="/tools/{tool.id}">
				<span class="icon"><Icon size={20} /></span>
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
		font-size: 26px;
		font-weight: 650;
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
		letter-spacing: 0.04em;
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
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
	}

	.card:hover {
		border-color: var(--accent-strong);
	}

	.icon {
		display: grid;
		place-items: center;
		width: 36px;
		height: 36px;
		margin-bottom: 8px;
		border-radius: 9px;
		background: var(--accent-soft);
		color: var(--link);
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
		border: 1px dashed var(--border);
		border-radius: 999px;
		color: var(--text-dim);
		font-size: 13px;
	}
</style>
