import { json } from '@sveltejs/kit';
import { jsonError } from '$lib/server/api-response';
import { getTacticStatus } from '$lib/server/services/tactic-status-service';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	try {
		return json(await getTacticStatus());
	} catch (err) {
		return jsonError(err instanceof Error ? err.message : String(err));
	}
};
