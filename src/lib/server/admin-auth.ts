import { jsonError } from './api-response';

/** Optional defense-in-depth guard for destructive /api/run/* endpoints. */
export function assertAdminAuthorized(request: Request): Response | null {
	const expected = process.env.ADMIN_TOKEN?.trim();
	if (!expected) {
		return null;
	}

	const provided = request.headers.get('x-admin-token')?.trim();
	if (provided !== expected) {
		return jsonError('Unauthorized', 401);
	}

	return null;
}
