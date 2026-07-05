import { json } from '@sveltejs/kit';
import { jsonError } from '$lib/server/api-response';
import { fetchAccuracyStats } from '$lib/server/services/stats-service';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	try {
		const stats = await fetchAccuracyStats();
		return json(stats);
	} catch (err) {
		return jsonError(err instanceof Error ? err.message : String(err));
	}
};
