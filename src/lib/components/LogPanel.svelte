<script lang="ts">
	import type { SseEvent } from '$lib/types/sse';
	import type { AccuracyStats } from '$lib/types/prediction';

	const CRON_NOISE_PATTERNS = [
		/geen aankomende wedstrijden gevonden/i,
		/skipping overlapping automatic prediction/i,
		/skipping .+: already auto-predicted in this session/i
	];

	interface LogLine {
		id: number;
		message: string;
		level: number;
		cronNoise: boolean;
	}

	let {
		connectionStatus = $bindable('Verbinden met log stream...'),
		onAccuracy = () => {},
		onAccuracyRefresh = () => {},
		onPrediction = () => {},
		onPredictionFailed = () => {},
		onMatchesRefresh = () => {}
	}: {
		connectionStatus?: string;
		onAccuracy?: (stats: AccuracyStats) => void;
		onAccuracyRefresh?: () => void;
		onPrediction?: (data: Extract<SseEvent, { type: 'prediction' }>) => void;
		onPredictionFailed?: (data: Extract<SseEvent, { type: 'prediction-failed' }>) => void;
		onMatchesRefresh?: () => void;
	} = $props();

	let hideCronNoise = $state(true);
	let lines = $state<LogLine[]>([]);
	let nextId = $state(0);
	let logBox: HTMLDivElement | undefined = $state();

	function isCronNoise(message: string): boolean {
		return CRON_NOISE_PATTERNS.some((pattern) => pattern.test(message));
	}

	function appendLogLine(message: string, level = 30) {
		const cronNoise = isCronNoise(message);
		lines = [...lines, { id: nextId++, message, level, cronNoise }];
		queueMicrotask(() => {
			if (logBox) logBox.scrollTop = logBox.scrollHeight;
		});
	}

	function clearLogs() {
		lines = [];
	}

	export function addLog(message: string, level = 30) {
		appendLogLine(message, level);
	}

	$effect(() => {
		const es = new EventSource('/api/logs');

		es.onopen = () => {
			connectionStatus = '🟢 Verbonden';
		};
		es.onerror = () => {
			connectionStatus = '🔴 Verbinding verbroken';
		};
		es.onmessage = (e) => {
			let data: SseEvent;
			try {
				data = JSON.parse(e.data) as SseEvent;
			} catch {
				appendLogLine(e.data, 30);
				return;
			}

			if (data.type === 'log') {
				appendLogLine(data.message, data.level ?? 30);
				if (/pronostiek-accuratesse/i.test(data.message)) {
					onAccuracyRefresh();
				}
				if (/pronostiek ingediend|automatische voorspelling voltooid/i.test(data.message)) {
					onMatchesRefresh();
				}
				return;
			}

			if (data.type === 'prediction') {
				onPrediction(data);
				return;
			}

			if (data.type === 'prediction-failed') {
				onPredictionFailed(data);
				return;
			}

			if (data.type === 'accuracy') {
				onAccuracy(data);
			}
		};

		return () => es.close();
	});
</script>

<section class="glass-panel sticky top-3 z-10 mb-6 overflow-hidden" aria-label="Live logs">
	<div class="flex flex-wrap items-center justify-between gap-3 border-b border-pitch-700/60 px-4 py-3">
		<div class="flex items-center gap-2">
			<span class="size-2 animate-pulse rounded-full bg-emerald-400"></span>
			<h2 class="text-sm font-semibold text-pitch-200">Live logs</h2>
		</div>
		<div class="flex flex-wrap items-center gap-3">
			<label class="inline-flex cursor-pointer select-none items-center gap-2 text-xs text-pitch-400">
				<input
					type="checkbox"
					bind:checked={hideCronNoise}
					class="size-3.5 rounded border-pitch-600 bg-pitch-900 accent-accent-500"
				/>
				Verberg cron-ruis
			</label>
			<button class="btn-ghost" type="button" onclick={clearLogs}>Wissen</button>
		</div>
	</div>
	<div
		bind:this={logBox}
		class="log-scroll h-[min(32vh,280px)] overflow-y-auto bg-pitch-950/50 px-4 py-3 font-mono text-[0.8rem] leading-relaxed"
	>
		{#each lines as line (line.id)}
			<div
				class="py-0.5 break-words {line.level === 20 ? 'text-pitch-500' : 'text-pitch-300'} {hideCronNoise &&
				line.cronNoise
					? 'hidden'
					: ''}"
			>
				{line.message}
			</div>
		{:else}
			<p class="text-pitch-500">Wachten op logberichten…</p>
		{/each}
	</div>
</section>
