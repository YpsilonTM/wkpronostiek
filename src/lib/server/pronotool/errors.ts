export class HttpStatusError extends Error {
	status: number;
	url?: string;

	constructor(status: number, message?: string, url?: string) {
		super(message || `HTTP ${status}`);
		this.name = 'HttpStatusError';
		this.status = status;
		this.url = url;
	}
}

export class PronotoolParseError extends Error {
	url?: string;

	constructor(message: string, url?: string) {
		super(message);
		this.name = 'PronotoolParseError';
		this.url = url;
	}
}

export function isUnauthorizedHttpError(error: unknown): boolean {
	return error instanceof HttpStatusError && error.status === 401;
}

export function isForbiddenHttpError(error: unknown): boolean {
	return error instanceof HttpStatusError && error.status === 403;
}

/** True when the session/token is invalid (401). 403 is often "not allowed yet" for rival pronos. */
export function isAuthHttpError(error: unknown): boolean {
	return isUnauthorizedHttpError(error);
}

export function isRetryableHttpError(error: unknown): boolean {
	return (
		error instanceof HttpStatusError &&
		(error.status === 429 || error.status === 502 || error.status === 503 || error.status === 504)
	);
}
