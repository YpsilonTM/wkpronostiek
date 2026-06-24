<script lang="ts">
	import MatchCard from './MatchCard.svelte';
	import type { EnrichedMatch } from '$lib/types/match';

	interface MatchOverlay {
		homeScore?: number | null;
		awayScore?: number | null;
		reasoning?: string;
	}

	let {
		matches = [],
		loading = false,
		error = '',
		predictingIds = new Set<number>(),
		overlays = new Map<number, MatchOverlay>(),
		onpredict
	}: {
		matches?: EnrichedMatch[];
		loading?: boolean;
		error?: string;
		predictingIds?: Set<number>;
		overlays?: Map<number, MatchOverlay>;
		onpredict?: (matchId: number) => void;
	} = $props();
</script>

<div class="match-grid">
	{#if loading}
		<div class="empty-state"><strong>Laden...</strong></div>
	{:else if error}
		<div class="empty-state">
			<strong>Fout bij laden</strong>
			{error}
		</div>
	{:else if matches.length === 0}
		<div class="empty-state">
			<strong>Geen aankomende wedstrijden</strong>
			Er staan momenteel geen wedstrijden gepland. Kom later terug of controleer de logs.
		</div>
	{:else}
		{#each matches as match (match.matchId)}
			{@const overlay = overlays.get(Number(match.matchId)) ?? {}}
			<MatchCard
				{match}
				predicting={predictingIds.has(Number(match.matchId))}
				homeScore={overlay.homeScore}
				awayScore={overlay.awayScore}
				reasoning={overlay.reasoning}
				{onpredict}
			/>
		{/each}
	{/if}
</div>
