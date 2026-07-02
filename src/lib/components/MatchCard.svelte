<script lang="ts">
	import type { EnrichedMatch } from '$lib/types/match';

	function formatCountdown(minutes: number): string {
		if (minutes >= 120) {
			const hours = Math.floor(minutes / 60);
			const mins = minutes % 60;
			return mins > 0 ? `Over ${hours} u ${mins} min` : `Over ${hours} u`;
		}
		if (minutes >= 60) return 'Over 1 u';
		if (minutes <= 0) return 'Binnenkort';
		return `Over ${minutes} min`;
	}

	function formatAutoPredictAt(iso: string): string {
		if (!iso) return '';
		return new Date(iso).toLocaleString('nl-BE', {
			day: 'numeric',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	let {
		match,
		predicting = false,
		homeScore = null,
		awayScore = null,
		reasoning = '',
		searchAnalysis = '',
		onpredict
	}: {
		match: EnrichedMatch;
		predicting?: boolean;
		homeScore?: number | null;
		awayScore?: number | null;
		reasoning?: string;
		searchAnalysis?: string;
		onpredict?: (matchId: number) => void;
	} = $props();

	const displayHome = $derived(homeScore ?? match.currentHomeScore);
	const displayAway = $derived(awayScore ?? match.currentAwayScore);
	const hasScore = $derived(Number.isInteger(displayHome) && Number.isInteger(displayAway));
	const scoreText = $derived(
		hasScore ? `Huidig: ${displayHome} - ${displayAway}` : 'Nog geen voorspelling'
	);

	const startTime = $derived(
		new Date(match.startTime).toLocaleString('nl-BE', {
			day: 'numeric',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit'
		})
	);
</script>

<div
	class="match-card"
	class:predicting
	class:teams-confirmed={match.teamsConfirmed}
	class:teams-unconfirmed={!match.teamsConfirmed}
>
	<div class="match-header">
		<div class="match-teams" class:muted-teams={!match.teamsConfirmed}>
			{match.homeTeam} vs {match.awayTeam}
		</div>
		<div class="chip-row">
			{#if match.teamsConfirmed}
				<span class="chip chip-teams-known" title="Beide teams zijn bekend">Teams bekend</span>
			{:else}
				<span class="chip chip-teams-unknown" title="Nog niet alle deelnemers zijn bekend"
					>Nog onbekend</span
				>
			{/if}
			{#if predicting}
				<span class="chip chip-loading">Bezig…</span>
			{:else if match.submitted}
				<span class="chip chip-done">Ingediend</span>
			{/if}
			{#if !predicting && match.autoPredictScheduled}
				<span class="chip chip-auto">Auto gepland</span>
			{/if}
			{#if !predicting && match.minutesUntilStart != null}
				<span class="chip chip-time">{formatCountdown(match.minutesUntilStart)}</span>
			{/if}
			{#if match.autoPredictScheduled && match.autoPredictAt}
				<span class="chip chip-time">Auto ~{formatAutoPredictAt(match.autoPredictAt)}</span>
			{/if}
		</div>
		<div class="match-meta">{match.phaseName || ''} • {startTime}</div>
	</div>
	<div class="match-body">
		<div class="match-score-row">
			<div class="match-score-block">
				<div class="match-result">{scoreText}</div>
				{#if predicting}
					<div class="loading-msg">Bezig… (kan 1–2 min duren)</div>
				{/if}
			</div>
			<button
				class="btn-primary"
				type="button"
				disabled={predicting}
				onclick={() => onpredict?.(Number(match.matchId))}
			>
				{#if predicting}
					<span class="spinner" aria-hidden="true"></span> Bezig…
				{:else}
					🔮 Voorspel
				{/if}
			</button>
		</div>

		{#if reasoning || searchAnalysis}
			<details class="match-analysis-panel">
				<summary class="match-analysis-summary">
					<span class="match-analysis-summary-label">AI-analyse</span>
					{#if reasoning}
						<span class="match-analysis-preview">{reasoning}</span>
					{/if}
				</summary>
				<div class="match-analysis-body">
					{#if reasoning}
						<div class="match-reasoning"><strong>Reden:</strong> {reasoning}</div>
					{/if}
					{#if searchAnalysis}
						<div class="match-reasoning match-analysis"><strong>Analyse:</strong> {searchAnalysis}</div>
					{/if}
				</div>
			</details>
		{/if}
	</div>
</div>
