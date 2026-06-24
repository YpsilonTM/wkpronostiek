import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fetchAccuracyStats } from '$lib/server/jobs';

export const GET: RequestHandler = async () => {
	try {
		const stats = await fetchAccuracyStats();
		return json(stats);
	} catch (err) {
		return json(
			{ error: err instanceof Error ? err.message : String(err) },
			{ status: 500 }
		);
	}
};
