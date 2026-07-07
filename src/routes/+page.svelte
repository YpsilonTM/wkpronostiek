<script lang="ts">
	import { onMount } from 'svelte';
	import StatsBar from '$lib/components/StatsBar.svelte';
	import LogPanel from '$lib/components/LogPanel.svelte';
	import MatchList from '$lib/components/MatchList.svelte';
	import { MATCHES_CACHE_TTL_MS } from '$lib/constants';
	import type { EnrichedMatch } from '$lib/types/match';
	import type { AccuracyStats } from '$lib/types/prediction';
	import type LogPanelComponent from '$lib/components/LogPanel.svelte';
	import type { SseEvent } from '$lib/types/sse';

	let connectionStatus = $state('Verbinden met log stream...');
	let authBusy = $state(false);
	let matches = $state<EnrichedMatch[]>([]);
	let matchesLoading = $state(true);
	let matchesError = $state('');
	let accuracyStats = $state<AccuracyStats | null>(null);
	let predictingIds = $state(new Set<number>());
	let logPanel: LogPanelComponent | undefined = $state();

	const isConnected = $derived(connectionStatus.includes('🟢'));

	async function loadAccuracy() {
		try {
			const res = await fetch('/api/stats/accuracy');
			if (!res.ok) return;
			accuracyStats = await res.json();
		} catch {
			// ignore
		}
	}

	async function loadMatches() {
		matchesLoading = true;
		matchesError = '';
		try {
			const res = await fetch('/api/matches/upcoming');
			if (!res.ok) throw new Error('Kon wedstrijden niet laden.');
			matches = await res.json();
		} catch (err) {
			matchesError = err instanceof Error ? err.message : 'Onbekende fout';
			matches = [];
		} finally {
			matchesLoading = false;
		}
	}

	function applyPrediction(data: Extract<SseEvent, { type: 'prediction' }>) {
		const matchId = data.matchId;
		matches = matches.map((m) =>
			m.matchId === matchId
				? {
						...m,
						currentHomeScore: data.homeScore,
						currentAwayScore: data.awayScore,
						submitted: true,
						autoPredictScheduled: false,
						reasoning: data.reasoning || '',
						searchAnalysis: data.searchAnalysis || '',
						tactic: data.tactic ?? null,
						tacticLabel: data.tacticLabel ?? null
					}
				: m
		);
		predictingIds = new Set([...predictingIds].filter((id) => id !== matchId));
	}

	function handlePredictionFailed(data: Extract<SseEvent, { type: 'prediction-failed' }>) {
		const matchId = data.matchId;
		predictingIds = new Set([...predictingIds].filter((id) => id !== matchId));
		const match = matches.find((m) => m.matchId === matchId);
		const label = match ? `${match.homeTeam} vs ${match.awayTeam}` : `wedstrijd ${matchId}`;
		logPanel?.addLog(
			`❌ Voorspelling mislukt voor ${label}${data.reason ? `: ${data.reason}` : ''}`,
			30
		);
	}

	async function predictMatch(matchId: number) {
		predictingIds = new Set([...predictingIds, matchId]);
		try {
			const res = await fetch(`/api/run/predict-match/${matchId}`, { method: 'POST' });
			if (res.status === 202) {
				return;
			}
			if (!res.ok) {
				const text = await res.text();
				let message = 'Voorspelling mislukt.';
				try {
					const errBody = JSON.parse(text) as { error?: string };
					if (errBody.error) message = errBody.error;
				} catch {
					if (text) message = text;
				}
				throw new Error(message);
			}
			const result = await res.json();
			applyPrediction({
				type: 'prediction',
				matchId: result.matchId,
				homeTeam: result.homeTeam,
				awayTeam: result.awayTeam,
				homeScore: result.homeScore,
				awayScore: result.awayScore,
				reasoning: result.reasoning || '',
				searchAnalysis: result.searchAnalysis || '',
				model: result.model || null,
				escalated: Boolean(result.escalated),
				autoPredicted: false
			});
		} catch (err) {
			predictingIds = new Set([...predictingIds].filter((id) => id !== matchId));
			logPanel?.addLog(
				`❌ Voorspelling mislukt: ${err instanceof Error ? err.message : 'onbekende fout'}`,
				30
			);
		}
	}

	async function triggerAuthRefresh() {
		authBusy = true;
		try {
			await fetch('/api/run/auth-refresh', { method: 'POST' });
		} finally {
			setTimeout(() => {
				authBusy = false;
			}, 1500);
		}
	}

	function handleAccuracy(stats: AccuracyStats) {
		if (stats.evaluated) {
			accuracyStats = stats;
		} else {
			loadAccuracy();
		}
	}

	onMount(() => {
		loadMatches();
		loadAccuracy();
		const matchInterval = setInterval(loadMatches, MATCHES_CACHE_TTL_MS);
		const accuracyInterval = setInterval(loadAccuracy, MATCHES_CACHE_TTL_MS);
		return () => {
			clearInterval(matchInterval);
			clearInterval(accuracyInterval);
		};
	});
</script>

<header class="mb-8">
	<div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
		<div>
			<div class="mb-2 inline-flex items-center gap-2 rounded-full bg-emerald-950/60 px-3 py-1 text-xs font-medium text-emerald-300 ring-1 ring-emerald-800/50">
				<span class="size-1.5 rounded-full bg-emerald-400"></span>
				WK 2026 · Automatisering
			</div>
			<h1 class="text-3xl font-bold tracking-tight text-white sm:text-4xl">
				⚽ WK Pronostiek
			</h1>
			<p class="mt-1.5 max-w-xl text-sm text-pitch-400 sm:text-base">
				Automatische voorspelling 20 minuten voor aanvang · Gemini AI + Sporza
			</p>
		</div>

		<div class="flex flex-wrap items-center gap-3">
			<span
				class="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ring-1 {isConnected
					? 'bg-emerald-950/60 text-emerald-300 ring-emerald-800/50'
					: 'bg-red-950/60 text-red-300 ring-red-800/50'}"
			>
				{connectionStatus}
			</span>
			<button class="btn-secondary" type="button" disabled={authBusy} onclick={triggerAuthRefresh}>
				{#if authBusy}
					<span class="spinner" aria-hidden="true"></span>
				{/if}
				🔑 Auth vernieuwen
			</button>
		</div>
	</div>
</header>

<StatsBar stats={accuracyStats} />

<LogPanel
	bind:this={logPanel}
	bind:connectionStatus
	onAccuracy={handleAccuracy}
	onAccuracyRefresh={loadAccuracy}
	onPrediction={applyPrediction}
	onPredictionFailed={handlePredictionFailed}
	onMatchesRefresh={loadMatches}
/>

<section class="mt-8">
	<div class="mb-4 flex items-center justify-between gap-3">
		<h2 class="text-lg font-semibold text-white">Aankomende wedstrijden</h2>
		{#if !matchesLoading && matches.length > 0}
			<span class="text-xs text-pitch-500">{matches.length} wedstrijd{matches.length === 1 ? '' : 'en'}</span>
		{/if}
	</div>
	<MatchList
		{matches}
		loading={matchesLoading}
		error={matchesError}
		{predictingIds}
		onpredict={predictMatch}
	/>
</section>
