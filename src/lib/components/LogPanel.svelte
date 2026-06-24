<script lang="ts">
	import type { SseEvent } from '$lib/types/sse';
	import type { AccuracyStats } from '$lib/types/prediction';

	const CRON_NOISE_PATTERNS = [
		/geen aankomende wedstrijden gevonden/i,
		/skipping overlapping automatic prediction/i,
		/skipping .+: already predicted in this session/i
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
		onPrediction = () => {},
		onMatchesRefresh = () => {}
	}: {
		connectionStatus?: string;
		onAccuracy?: (stats: AccuracyStats) => void;
		onPrediction?: (data: Extract<SseEvent, { type: 'prediction' }>) => void;
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
		lines = [
			...lines,
			{ id: nextId++, message, level, cronNoise }
		];
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
					onAccuracy({} as AccuracyStats);
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

			if (data.type === 'accuracy') {
				onAccuracy(data);
			}
		};

		return () => es.close();
	});
</script>

<section class="log-section" aria-label="Live logs">
	<div class="log-header">
		<h2>Live logs</h2>
		<div class="log-controls">
			<label class="log-toggle">
				<input type="checkbox" bind:checked={hideCronNoise} />
				Verberg cron-ruis
			</label>
			<button class="btn-ghost" type="button" onclick={clearLogs}>Wissen</button>
		</div>
	</div>
	<div class="log-box" bind:this={logBox}>
		{#each lines as line (line.id)}
			<div
				class="log-line"
				class:debug={line.level === 20}
				class:hidden={hideCronNoise && line.cronNoise}
			>
				{line.message}
			</div>
		{/each}
	</div>
</section>
