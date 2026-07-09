import { json } from '@sveltejs/kit';
import { jsonError } from '$lib/server/api-response';
import { getSettings } from '$lib/server/config';
import { resolveApiAuthorization } from '$lib/server/auth';
import { PronotoolApiClient } from '$lib/server/pronotool-api';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	try {
		const settings = getSettings();
		const api = new PronotoolApiClient(settings);
		const authorization = await resolveApiAuthorization(settings);
		const overview = await api.fetchUserOverview(authorization);
		return json(overview.groups ?? []);
	} catch (err) {
		return jsonError(err instanceof Error ? err.message : String(err));
	}
};
