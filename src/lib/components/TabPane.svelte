<script lang="ts">
	import { getContext, setContext, type Snippet } from 'svelte';
	import { ACTIVE_KEY } from '$lib/tools/util';

	// A tab inside a tool. Inactive tabs stay mounted (hidden) so their files and jobs survive
	// switching tabs; they just stop reacting to dropped files.
	let { active, children }: { active: boolean; children: Snippet } = $props();

	const parent = getContext<(() => boolean) | undefined>(ACTIVE_KEY);
	setContext(ACTIVE_KEY, () => (parent ? parent() : true) && active);
</script>

<div hidden={!active}>{@render children()}</div>

<style>
	div[hidden] {
		display: none;
	}
</style>
