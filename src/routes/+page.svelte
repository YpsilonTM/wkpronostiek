<script lang="ts">
	import { onMount } from 'svelte';
	import StatsBar from '$lib/components/StatsBar.svelte';
	import LogPanel from '$lib/components/LogPanel.svelte';
	import MatchList from '$lib/components/MatchList.svelte';
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
	let overlays = $state(new Map<number, { homeScore?: number; awayScore?: number; reasoning?: string }>());
	let logPanel: LogPanelComponent | undefined = $state();

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
		const matchId = Number(data.matchId);
		overlays = new Map(overlays).set(matchId, {
			homeScore: data.homeScore,
			awayScore: data.awayScore,
			reasoning: data.reasoning || ''
		});
		matches = matches.map((m) =>
			Number(m.matchId) === matchId
				? {
						...m,
						currentHomeScore: data.homeScore,
						currentAwayScore: data.awayScore,
						submitted: true,
						autoPredictScheduled: false
					}
				: m
		);
		predictingIds = new Set([...predictingIds].filter((id) => id !== matchId));
	}

	async function predictMatch(matchId: number) {
		predictingIds = new Set([...predictingIds, matchId]);
		try {
			const res = await fetch(`/api/run/predict-match/${matchId}`, { method: 'POST' });
			if (!res.ok) {
				const errBody = await res.json().catch(() => ({}));
				throw new Error((errBody as { error?: string }).error || 'Voorspelling mislukt.');
			}
			const result = await res.json();
			applyPrediction({
				type: 'prediction',
				matchId: Number(result.matchId),
				homeTeam: result.homeTeam,
				awayTeam: result.awayTeam,
				homeScore: result.homeScore,
				awayScore: result.awayScore,
				reasoning: result.reasoning || '',
				searchAnalysis: result.searchAnalysis || '',
				model: result.model || null,
				escalated: Boolean(result.escalated)
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
		const matchInterval = setInterval(loadMatches, 5 * 60 * 1000);
		const accuracyInterval = setInterval(loadAccuracy, 5 * 60 * 1000);
		return () => {
			clearInterval(matchInterval);
			clearInterval(accuracyInterval);
		};
	});
</script>

<h1>⚽ WK Pronostiek</h1>
<p class="subtitle">Automatische run 1 uur voor aanvang van elke wedstrijd</p>

<div class="top-controls">
	<button class="btn-secondary" type="button" disabled={authBusy} onclick={triggerAuthRefresh}>
		🔑 Auth vernieuwen
	</button>
	<p class="status">{connectionStatus}</p>
</div>

<StatsBar stats={accuracyStats} />

<LogPanel
	bind:this={logPanel}
	bind:connectionStatus
	onAccuracy={handleAccuracy}
	onPrediction={applyPrediction}
	onMatchesRefresh={loadMatches}
/>

<h2 class="section-title">Aankomende wedstrijden</h2>
<MatchList
	{matches}
	loading={matchesLoading}
	error={matchesError}
	{predictingIds}
	{overlays}
	onpredict={predictMatch}
/>
