<script lang="ts">
	import type { AccuracyStats } from '$lib/types/prediction';

	let { stats = null }: { stats?: AccuracyStats | null } = $props();
</script>

<div class="stats-bar">
	<div class="stat-item">
		<span class="stat-label">Exacte score</span>
		<span class="stat-value" class:muted={!stats?.evaluated}>
			{#if stats?.evaluated}
				{stats.exactHits}/{stats.evaluated} ({stats.exactPct}%)
			{:else}
				—
			{/if}
		</span>
	</div>
	<div class="stat-item">
		<span class="stat-label">Juiste uitslag</span>
		<span class="stat-value" class:muted={!stats?.evaluated}>
			{#if stats?.evaluated}
				{stats.outcomeHits}/{stats.evaluated} ({stats.outcomePct}%)
			{:else}
				—
			{/if}
		</span>
	</div>
	<div class="stat-item">
		<span class="stat-label">Geëvalueerd</span>
		<span class="stat-value" class:muted={!stats?.evaluated}>
			{stats?.evaluated ?? '—'}
		</span>
	</div>
</div>
