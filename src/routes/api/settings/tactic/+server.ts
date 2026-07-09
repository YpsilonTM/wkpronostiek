import { json } from '@sveltejs/kit';
import { jsonError } from '$lib/server/api-response';
import {
	getTacticUiSettings,
	saveTacticUiSettings,
	validateTacticUiSettings,
} from '$lib/server/services/app-settings-service';
import { invalidateTacticStatusCache } from '$lib/server/services/tactic-status-service';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	try {
		return json(await getTacticUiSettings());
	} catch (err) {
		return jsonError(err instanceof Error ? err.message : String(err));
	}
};

export const PUT: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		const settings = validateTacticUiSettings(body);
		const saved = await saveTacticUiSettings(settings);
		invalidateTacticStatusCache();
		return json(saved);
	} catch (err) {
		return jsonError(err instanceof Error ? err.message : String(err), 400);
	}
};
