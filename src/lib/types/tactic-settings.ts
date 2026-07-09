import type { TacticMode } from './tactic';

/** User-facing tactic settings persisted in the database. */
export interface TacticUiSettings {
	enabled: boolean;
	mode: TacticMode;
	groupName: string;
	groupId: string;
	groupCode: string;
}

export type TacticUiMode = Extract<TacticMode, 'ai_tactic' | 'mirror' | 'auto'>;

export const TACTIC_UI_MODES: TacticUiMode[] = ['auto', 'ai_tactic', 'mirror'];
