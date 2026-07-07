export interface GroupSummary {
	id: string;
	name: string;
	rank: number | null;
	points: number | null;
}

export interface GroupMember {
	userId: string;
	name: string;
	rank: number;
	points: number;
}

export interface GroupStandings {
	groupId: string;
	groupName: string;
	members: GroupMember[];
}

export interface UserOverviewExtended {
	userId: string | null;
	pronos: import('./match').UserProno[];
	groups: GroupSummary[];
}
