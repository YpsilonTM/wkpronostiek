<script lang="ts">
	import MatchCard from './MatchCard.svelte';
	import type { EnrichedMatch } from '$lib/types/match';

	let {
		matches = [],
		loading = false,
		error = '',
		predictingIds = new Set<number>(),
		onpredict
	}: {
		matches?: EnrichedMatch[];
		loading?: boolean;
		error?: string;
		predictingIds?: Set<number>;
		onpredict?: (matchId: number) => void;
	} = $props();
</script>

{#if loading}
	<div class="glass-panel col-span-full flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
		<span class="spinner size-6" aria-hidden="true"></span>
		<p class="font-medium text-pitch-200">Wedstrijden laden…</p>
	</div>
{:else if error}
	<div class="glass-panel col-span-full border-red-900/50 px-6 py-12 text-center">
		<p class="font-semibold text-red-300">Fout bij laden</p>
		<p class="mt-2 text-sm text-pitch-400">{error}</p>
	</div>
{:else if matches.length === 0}
	<div class="glass-panel col-span-full border-dashed px-6 py-16 text-center">
		<p class="text-3xl">🏟️</p>
		<p class="mt-3 font-semibold text-pitch-200">Geen aankomende wedstrijden</p>
		<p class="mt-2 max-w-sm mx-auto text-sm text-pitch-400">
			Er staan momenteel geen wedstrijden gepland. Kom later terug of controleer de logs.
		</p>
	</div>
{:else}
	<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
		{#each matches as match (match.matchId)}
			<MatchCard {match} predicting={predictingIds.has(match.matchId)} {onpredict} />
		{/each}
	</div>
{/if}
