import { json } from '@sveltejs/kit';

export function jsonError(message: string, status = 500) {
	return json({ error: message }, { status });
}
