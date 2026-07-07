<script lang="ts">
	import type { EnrichedMatch } from '$lib/types/match';
	import { formatMatchDateTime } from '$lib/utils/format';

	function formatCountdown(minutes: number): string {
		if (minutes >= 120) {
			const hours = Math.floor(minutes / 60);
			const mins = minutes % 60;
			return mins > 0 ? `Over ${hours}u ${mins}m` : `Over ${hours}u`;
		}
		if (minutes >= 60) return 'Over 1u';
		if (minutes <= 0) return 'Binnenkort';
		return `Over ${minutes}m`;
	}

	let {
		match,
		predicting = false,
		onpredict
	}: {
		match: EnrichedMatch;
		predicting?: boolean;
		onpredict?: (matchId: number) => void;
	} = $props();

	const hasScore = $derived(
		Number.isInteger(match.currentHomeScore) && Number.isInteger(match.currentAwayScore)
	);
	const startTime = $derived(formatMatchDateTime(match.startTime));
	const reasoning = $derived(match.reasoning ?? '');
	const searchAnalysis = $derived(match.searchAnalysis ?? '');
</script>

<article
	class="glass-panel group flex flex-col overflow-hidden transition hover:border-pitch-600 {predicting
		? 'ring-2 ring-accent-500/40'
		: ''} {match.teamsConfirmed
		? 'border-l-4 border-l-emerald-500'
		: 'border-l-4 border-l-dashed border-l-pitch-600'}"
>
	<div class="flex flex-1 flex-col gap-3 p-4">
		<div>
			<h3
				class="text-base font-semibold leading-snug text-white {match.teamsConfirmed
					? ''
					: 'text-pitch-400'}"
			>
				{match.homeTeam} <span class="font-normal text-pitch-500">vs</span> {match.awayTeam}
			</h3>
			<p class="mt-1 text-xs text-pitch-500">
				{match.phaseName || 'Onbekende fase'} · {startTime}
			</p>
		</div>

		<div class="flex flex-wrap gap-1.5">
			{#if match.teamsConfirmed}
				<span class="chip chip-success" title="Beide teams zijn bekend">Teams bekend</span>
			{:else}
				<span class="chip chip-warning" title="Nog niet alle deelnemers zijn bekend">Nog onbekend</span>
			{/if}
			{#if predicting}
				<span class="chip chip-warning">Bezig…</span>
			{:else if match.submitted}
				<span class="chip chip-success">Ingediend</span>
			{/if}
			{#if match.tacticLabel}
				<span
					class="chip {match.tactic === 'mirror'
						? 'chip-auto'
						: 'chip-success'}"
					title="Actieve eindfase-tactiek"
				>
					{match.tacticLabel}
				</span>
			{/if}
			{#if !predicting && match.autoPredictScheduled}
				<span class="chip chip-auto">Auto gepland</span>
			{/if}
			{#if !predicting && match.minutesUntilStart != null}
				<span class="chip chip-muted">{formatCountdown(match.minutesUntilStart)}</span>
			{/if}
			{#if match.autoPredictScheduled && match.autoPredictAt}
				<span class="chip chip-muted">Auto ~{formatMatchDateTime(match.autoPredictAt)}</span>
			{/if}
		</div>

		<div class="mt-auto flex items-end justify-between gap-3 pt-1">
			<div class="min-w-0 flex-1">
				{#if hasScore}
					<div class="flex items-baseline gap-2">
						<span class="text-3xl font-bold tabular-nums text-score">{match.currentHomeScore}</span>
						<span class="text-lg text-pitch-500">:</span>
						<span class="text-3xl font-bold tabular-nums text-score">{match.currentAwayScore}</span>
					</div>
					<p class="mt-0.5 text-xs text-pitch-500">Huidige voorspelling</p>
				{:else}
					<p class="text-sm font-medium text-pitch-500">Nog geen voorspelling</p>
				{/if}
				{#if predicting}
					<p class="mt-2 text-xs text-amber-400/90">Gemini analyseert… (1–2 min)</p>
				{/if}
			</div>

			<button
				class="btn-primary shrink-0"
				type="button"
				disabled={predicting}
				onclick={() => onpredict?.(match.matchId)}
			>
				{#if predicting}
					<span class="spinner" aria-hidden="true"></span>
					<span class="sr-only">Bezig</span>
				{:else}
					🔮 Voorspel
				{/if}
			</button>
		</div>
	</div>

	{#if reasoning || searchAnalysis}
		<details class="border-t border-pitch-700/60 bg-pitch-950/40">
			<summary
				class="flex cursor-pointer flex-col gap-1 px-4 py-3 text-left transition hover:bg-pitch-800/40"
			>
				<span class="text-[0.65rem] font-semibold uppercase tracking-widest text-accent-300">
					AI-analyse
				</span>
				{#if reasoning}
					<span class="line-clamp-2 text-xs leading-relaxed text-pitch-400">{reasoning}</span>
				{/if}
			</summary>
			<div class="log-scroll max-h-44 space-y-3 overflow-y-auto border-t border-pitch-700/40 px-4 py-3">
				{#if reasoning}
					<div class="border-l-2 border-pitch-600 pl-3 text-xs leading-relaxed text-pitch-400">
						<strong class="text-pitch-300">Reden:</strong>
						{reasoning}
					</div>
				{/if}
				{#if searchAnalysis}
					<div class="border-l-2 border-pitch-600 pl-3 text-xs leading-relaxed text-pitch-400">
						<strong class="text-pitch-300">Analyse:</strong>
						{searchAnalysis}
					</div>
				{/if}
			</div>
		</details>
	{/if}
</article>
