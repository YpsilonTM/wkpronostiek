<script lang="ts">
	import type { AccuracyStats } from '$lib/types/prediction';

	let { stats = null }: { stats?: AccuracyStats | null } = $props();

	const items = $derived([
		{
			label: 'Exacte score',
			value: stats?.evaluated
				? `${stats.exactHits}/${stats.evaluated}`
				: '—',
			sub: stats?.evaluated ? `${stats.exactPct}%` : null,
			accent: 'text-emerald-400'
		},
		{
			label: 'Juiste uitslag',
			value: stats?.evaluated
				? `${stats.outcomeHits}/${stats.evaluated}`
				: '—',
			sub: stats?.evaluated ? `${stats.outcomePct}%` : null,
			accent: 'text-sky-400'
		},
		{
			label: 'Geëvalueerd',
			value: stats?.evaluated != null ? String(stats.evaluated) : '—',
			sub: stats?.evaluated ? 'wedstrijden' : null,
			accent: 'text-pitch-300'
		}
	]);
</script>

<div class="mb-6 grid gap-3 sm:grid-cols-3">
	{#each items as item (item.label)}
		<div class="glass-panel p-4">
			<p class="text-[0.65rem] font-semibold uppercase tracking-widest text-pitch-500">
				{item.label}
			</p>
			<div class="mt-1 flex items-baseline gap-2">
				<span class="text-2xl font-bold tabular-nums {item.accent}">{item.value}</span>
				{#if item.sub}
					<span class="text-sm text-pitch-500">{item.sub}</span>
				{/if}
			</div>
		</div>
	{/each}
</div>
