export interface GroupSummary {
	id: string;
	name: string;
	/** Sporza minicompetitie code (used for rival-pronos queries) */
	code?: string | null;
	rank: number | null;
	points: number | null;
}

export interface GroupMember {
	userId: string;
	name: string;
	rank: number;
	points: number;
}

export type GroupStandingsSource = 'standings-api' | 'overview-embedded' | 'overview-fallback';

export interface GroupStandings {
	groupId: string;
	groupName: string;
	groupCode?: string | null;
	members: GroupMember[];
	/** True when we have a full klassement (≥2 members) — required for mirror tactic */
	complete: boolean;
	source: GroupStandingsSource;
}

export interface UserOverviewExtended {
	userId: string | null;
	pronos: import('./match').UserProno[];
	groups: GroupSummary[];
}
