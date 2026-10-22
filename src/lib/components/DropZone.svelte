<script lang="ts">
	import { Upload } from '@lucide/svelte';

	let {
		dragging,
		label,
		buttonLabel,
		onchoose
	}: { dragging: boolean; label: string; buttonLabel: string; onchoose: () => void } = $props();
</script>

<div class="drop" class:dragging>
	<Upload size={22} />
	<p>{label}</p>
	<button class="btn" onclick={onchoose}>{buttonLabel}</button>
</div>

<style>
	.drop {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		padding: 32px 16px;
		border: 2px dashed var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		color: var(--text-dim);
		transition: border-color 0.12s, background 0.12s;
	}

	.drop.dragging {
		border-color: var(--accent-strong);
		background: var(--accent-soft);
		color: var(--link);
	}
</style>
