<script lang="ts">
	import { onMount } from 'svelte';
	import type { GroupSummary } from '$lib/types/standings';
	import type { TacticUiSettings } from '$lib/types/tactic-settings';
	import { TACTIC_UI_MODES } from '$lib/types/tactic-settings';
	import type { TacticStatus } from '$lib/types/tactic-status';

	let {
		status = null,
		loading = false,
		onchange
	}: {
		status?: TacticStatus | null;
		loading?: boolean;
		onchange?: () => void;
	} = $props();

	let uiSettings = $state<TacticUiSettings | null>(null);
	let groups = $state<GroupSummary[]>([]);
	let settingsLoading = $state(true);
	let saving = $state(false);
	let settingsError = $state('');
	let showSettings = $state(false);

	const modeLabels: Record<string, string> = {
		ai: 'Gemini',
		ai_tactic: 'Gemini + klassement',
		mirror: 'Spiegel-tactiek',
		auto: 'Auto'
	};

	const resolvedLabel = $derived(
		status?.resolvedMode === 'mirror'
			? 'Spiegelt rival'
			: status?.resolvedMode === 'ai_tactic'
				? 'AI + klassement'
				: 'Gemini'
	);

	const leadLabel = $derived(
		status?.leadPoints == null
			? '—'
			: status.leadPoints > 0
				? `+${status.leadPoints}`
				: status.leadPoints < 0
					? String(status.leadPoints)
					: '0'
	);

	const standingsWarning = $derived(
		status?.enabled && !status.standingsComplete
			? 'Klassement onvolledig — spiegel-tactiek uitgeschakeld'
			: null
	);

	const mirrorWaitLabel = $derived.by(() => {
		if (status?.resolvedMode !== 'mirror') return null;
		const { withRivalProno, total } = status.mirrorCoverage;
		if (total === 0) return 'Geen wedstrijden in auto-venster';
		if (withRivalProno === total) return 'Rival-pronos beschikbaar';
		return `Wacht op rival-prono (${withRivalProno}/${total})`;
	});

	const dangerLabel = $derived(
		status?.dangerLevel === 'critical'
			? 'Kritiek: achtervolger <20 pt'
			: status?.dangerLevel === 'caution'
				? 'Voorzichtig: achtervolger <40 pt'
				: null
	);

	const selectedGroupKey = $derived(
		uiSettings
			? uiSettings.groupCode || uiSettings.groupId || uiSettings.groupName || ''
			: ''
	);

	async function loadUiSettings() {
		settingsLoading = true;
		settingsError = '';
		try {
			const res = await fetch('/api/settings/tactic');
			if (!res.ok) throw new Error('Kon instellingen niet laden.');
			uiSettings = await res.json();
		} catch (err) {
			settingsError = err instanceof Error ? err.message : 'Onbekende fout';
		} finally {
			settingsLoading = false;
		}
	}

	async function loadGroups() {
		try {
			const res = await fetch('/api/settings/groups');
			if (!res.ok) return;
			groups = await res.json();
		} catch {
			groups = [];
		}
	}

	async function saveSettings(next: TacticUiSettings) {
		saving = true;
		settingsError = '';
		try {
			const res = await fetch('/api/settings/tactic', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(next)
			});
			if (!res.ok) {
				const body = (await res.json().catch(() => null)) as { error?: string } | null;
				throw new Error(body?.error || 'Opslaan mislukt.');
			}
			uiSettings = await res.json();
			showSettings = true;
			onchange?.();
		} catch (err) {
			settingsError = err instanceof Error ? err.message : 'Onbekende fout';
		} finally {
			saving = false;
		}
	}

	function groupKey(group: GroupSummary): string {
		return group.code || group.id || group.name;
	}

	function settingsFromGroup(
		settings: TacticUiSettings,
		group: GroupSummary,
	): TacticUiSettings {
		return {
			...settings,
			groupName: group.name,
			groupId: group.id,
			groupCode: group.code ?? '',
		};
	}

	function hasGroupSelected(settings: TacticUiSettings): boolean {
		return Boolean(settings.groupName || settings.groupId || settings.groupCode);
	}

	function findSelectedGroup(settings: TacticUiSettings): GroupSummary | undefined {
		return groups.find(
			(group) =>
				(settings.groupCode && group.code === settings.groupCode) ||
				(settings.groupId && group.id === settings.groupId) ||
				(settings.groupName && group.name === settings.groupName),
		);
	}

	function applyGroupSelection(key: string) {
		if (!uiSettings || !key) return;
		const group = groups.find((item) => groupKey(item) === key);
		if (!group) return;
		settingsError = '';
		void saveSettings(settingsFromGroup(uiSettings, group));
	}

	async function toggleEnabled(enabled: boolean) {
		if (!uiSettings) return;

		if (!enabled) {
			void saveSettings({ ...uiSettings, enabled: false });
			return;
		}

		if (groups.length === 0) {
			await loadGroups();
		}

		let next = { ...uiSettings, enabled: true };

		if (!hasGroupSelected(next)) {
			if (groups.length === 1) {
				next = settingsFromGroup(next, groups[0]);
			} else {
				settingsError = 'Kies eerst een minicompetitie uit de lijst.';
				return;
			}
		} else if (!findSelectedGroup(next) && groups.length === 1) {
			next = settingsFromGroup(next, groups[0]);
		}

		void saveSettings(next);
	}

	function changeMode(mode: TacticUiSettings['mode']) {
		if (!uiSettings) return;
		void saveSettings({ ...uiSettings, mode });
	}

	async function openSettings() {
		showSettings = !showSettings;
		if (showSettings) {
			await loadGroups();
		}
	}

	async function quickDisable() {
		if (!uiSettings) return;
		showSettings = true;
		await toggleEnabled(false);
	}

	onMount(() => {
		void loadUiSettings();
	});
</script>

<div class="mb-6 glass-panel p-4">
	<div class="mb-4 flex items-center justify-between gap-3">
		<p class="text-[0.65rem] font-semibold uppercase tracking-widest text-pitch-500">
			Eindfase-tactiek
		</p>
		<div class="flex shrink-0 items-center gap-3">
			{#if uiSettings?.enabled}
				<button
					class="text-xs text-pitch-400 underline-offset-2 hover:text-pitch-200 hover:underline"
					type="button"
					disabled={saving}
					onclick={quickDisable}
				>
					Uitschakelen
				</button>
			{/if}
			<button
				class="text-xs text-pitch-400 underline-offset-2 hover:text-pitch-200 hover:underline"
				type="button"
				onclick={openSettings}
			>
				{showSettings ? 'Verberg instellingen' : 'Instellingen'}
			</button>
		</div>
	</div>

	<div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
		<div class="min-w-0 flex-1">
			{#if loading}
				<p class="mt-1 text-sm text-pitch-400">Laden…</p>
			{:else if !status?.enabled}
				<p class="mt-1 text-sm text-pitch-400">Uitgeschakeld</p>
			{:else}
				<div class="mt-1 flex flex-wrap items-center gap-2">
					<span class="chip chip-auto">{modeLabels[status.configuredMode] ?? status.configuredMode}</span>
					<span class="chip {status.resolvedMode === 'mirror' ? 'chip-warning' : 'chip-success'}">
						{resolvedLabel}
					</span>
					{#if dangerLabel}
						<span class="chip chip-warning">{dangerLabel}</span>
					{/if}
					{#if standingsWarning}
						<span class="chip chip-warning" title={standingsWarning}>{standingsWarning}</span>
					{/if}
					{#if mirrorWaitLabel}
						<span class="chip chip-muted">{mirrorWaitLabel}</span>
					{/if}
				</div>
				{#if status.groupName}
					<p class="mt-2 text-xs text-pitch-500">
						{status.groupName}
						{#if status.standingsSource}
							· bron: {status.standingsSource === 'standings-api' ? 'API' : 'overview'}
						{/if}
					</p>
				{/if}
				<p class="mt-1 text-xs text-pitch-600" title="Beslissingsreden">{status.reason}</p>
			{/if}

			{#if showSettings}
				<div class="mt-4 space-y-3 rounded-lg border border-pitch-800/60 bg-pitch-950/40 p-3">
					{#if settingsLoading || !uiSettings}
						<p class="text-xs text-pitch-500">Instellingen laden…</p>
					{:else}
						<label class="block text-xs text-pitch-500">
							Minicompetitie
							<select
								class="mt-1 w-full rounded-md border border-pitch-800 bg-pitch-900 px-2 py-1.5 text-sm text-white"
								value={selectedGroupKey}
								disabled={saving || groups.length === 0}
								onchange={(event) => applyGroupSelection(event.currentTarget.value)}
							>
								<option value="">
									{groups.length === 0 ? 'Geen groepen gevonden' : 'Kies groep…'}
								</option>
								{#each groups as group (groupKey(group))}
									<option value={groupKey(group)}>
										{group.name}
										{#if group.rank != null && group.points != null}
											· #{group.rank} ({group.points} pt)
										{/if}
									</option>
								{/each}
							</select>
						</label>

						<label class="flex items-center gap-2 text-sm text-pitch-300">
							<input
								type="checkbox"
								class="size-4 rounded border-pitch-700 bg-pitch-900"
								checked={uiSettings.enabled}
								disabled={saving || groups.length === 0}
								onchange={(event) => toggleEnabled(event.currentTarget.checked)}
							/>
							Eindfase-tactiek inschakelen
						</label>

						{#if uiSettings.enabled}
							<label class="block text-xs text-pitch-500">
								Modus
								<select
									class="mt-1 w-full rounded-md border border-pitch-800 bg-pitch-900 px-2 py-1.5 text-sm text-white"
									value={uiSettings.mode}
									disabled={saving}
									onchange={(event) =>
										changeMode(event.currentTarget.value as TacticUiSettings['mode'])}
								>
									{#each TACTIC_UI_MODES as mode (mode)}
										<option value={mode}>{modeLabels[mode] ?? mode}</option>
									{/each}
								</select>
							</label>
						{/if}

						{#if saving}
							<p class="text-xs text-pitch-500">Opslaan…</p>
						{/if}
						{#if settingsError}
							<p class="text-xs text-red-400">{settingsError}</p>
						{/if}
					{/if}
				</div>
			{/if}
		</div>

		{#if status?.enabled && !loading}
			<div class="grid shrink-0 grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
				<div>
					<p class="text-[0.65rem] font-semibold uppercase tracking-widest text-pitch-500">Rank</p>
					<p class="mt-1 text-xl font-bold tabular-nums text-white">
						{status.myRank ?? '—'}
					</p>
				</div>
				<div>
					<p class="text-[0.65rem] font-semibold uppercase tracking-widest text-pitch-500">Punten</p>
					<p class="mt-1 text-xl font-bold tabular-nums text-emerald-400">
						{status.myPoints ?? '—'}
					</p>
				</div>
				<div>
					<p class="text-[0.65rem] font-semibold uppercase tracking-widest text-pitch-500">
						Voorsprong
					</p>
					<p class="mt-1 text-xl font-bold tabular-nums text-sky-400">{leadLabel}</p>
				</div>
				<div>
					<p class="text-[0.65rem] font-semibold uppercase tracking-widest text-pitch-500">Rest</p>
					<p class="mt-1 text-xl font-bold tabular-nums text-pitch-300">
						{status.remainingMatches ?? '—'}
					</p>
				</div>
			</div>
		{/if}
	</div>

	{#if status?.chasers && status.chasers.length > 0 && status.enabled && !loading}
		<p class="mt-3 border-t border-pitch-800/60 pt-3 text-xs text-pitch-500">
			Achtervolgers:
			{#each status.chasers as chaser (chaser.userId)}
				#{chaser.rank} {chaser.name} (+{chaser.leadPoints} pt){' '}
			{/each}
			{#if status.maxCatchUpPoints != null}
				· max. inhalen: {status.maxCatchUpPoints} pt
			{/if}
		</p>
	{:else if status?.rivalName && status.enabled && !loading}
		<p class="mt-3 border-t border-pitch-800/60 pt-3 text-xs text-pitch-500">
			Rival (#{status.rivalRank ?? '?'}) {status.rivalName}
			{#if status.rivalPoints != null}
				· {status.rivalPoints} pt
			{/if}
		</p>
	{/if}
</div>
