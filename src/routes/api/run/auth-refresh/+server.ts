import { assertAdminAuthorized } from '$lib/server/admin-auth';
import { runAuthRefresh } from '$lib/server/services/prediction-service';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const denied = assertAdminAuthorized(request);
	if (denied) return denied;

	runAuthRefresh().catch(console.error);
	return new Response('ok');
};
