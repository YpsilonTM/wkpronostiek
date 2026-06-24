import type { RequestHandler } from './$types';
import { runAuthRefresh } from '$lib/server/jobs';

export const POST: RequestHandler = async () => {
	runAuthRefresh().catch(console.error);
	return new Response('ok');
};
