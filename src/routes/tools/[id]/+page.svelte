<script lang="ts">
	import { page } from '$app/state';
	import { getTool } from '$lib/tools/registry';
	import { t } from '$lib/i18n.svelte';

	// The tool itself is rendered (and kept alive) by the layout; this page only reports unknown ids.
	const known = $derived(!!getTool(page.params.id ?? ''));
</script>

{#if !known}
	<p class="dim">{t('tool.notfound')}</p>
{/if}

<style>
	.dim {
		color: var(--text-dim);
	}
</style>
