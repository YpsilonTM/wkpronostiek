import { spawn } from 'node:child_process';
import path from 'node:path';
import { captureAuthorizationWithPlaywright, normalizeAuthorization } from './auth-browser';
import { prisma } from './db';
import { PronotoolApiClient } from './pronotool-api';
import type { Settings } from '$lib/types/settings';

export { normalizeAuthorization } from './auth-browser';

const AUTH_TOKEN_ID = 'pronotool';

export function getConfiguredAuthorization(settings: Settings): string | null {
	const authorization = normalizeAuthorization(settings.pronotoolAuthorization);
	return authorization || null;
}

export async function getCachedAuthorization(_settings: Settings): Promise<string | null> {
	try {
		const row = await prisma.authToken.findUnique({ where: { id: AUTH_TOKEN_ID } });
		if (!row?.authorization) {
			return null;
		}
		return normalizeAuthorization(row.authorization) || null;
	} catch {
		return null;
	}
}

export async function storeCachedAuthorization(
	_settings: Settings,
	authorization: string
): Promise<void> {
	const normalized = normalizeAuthorization(authorization);
	await prisma.authToken.upsert({
		where: { id: AUTH_TOKEN_ID },
		create: { id: AUTH_TOKEN_ID, authorization: normalized },
		update: { authorization: normalized }
	});
}

export async function clearCachedAuthorization(_settings: Settings): Promise<void> {
	try {
		await prisma.authToken.delete({ where: { id: AUTH_TOKEN_ID } });
	} catch {
		// ignore missing row
	}
}

async function resolveValidAuthorization(
	settings: Settings,
	candidates: (string | null | undefined)[]
): Promise<string | null> {
	const api = new PronotoolApiClient(settings);

	for (const candidate of candidates) {
		const normalized = normalizeAuthorization(candidate || '');
		if (!normalized) {
			continue;
		}
		if (await api.isAuthorizationValid(normalized)) {
			return normalized;
		}
	}

	return null;
}

async function loginViaNodeHelper(settings: Settings): Promise<string> {
	const helperPath = path.resolve('scripts/node-auth-login.mjs');

	return await new Promise((resolve, reject) => {
		const child = spawn('node', [helperPath], {
			cwd: process.cwd(),
			env: {
				...process.env,
				WKP_SETTINGS_JSON: JSON.stringify(settings)
			},
			stdio: ['ignore', 'pipe', 'pipe']
		});

		let stdout = '';
		let stderr = '';

		const timeout = setTimeout(() => {
			child.kill('SIGKILL');
			reject(new Error('Node auth helper timed out after 180000ms'));
		}, 180000);

		child.stdout.on('data', (chunk: Buffer) => {
			stdout += chunk.toString();
		});

		child.stderr.on('data', (chunk: Buffer) => {
			stderr += chunk.toString();
		});

		child.on('error', (error) => {
			clearTimeout(timeout);
			reject(new Error(`Failed to start Node auth helper: ${error.message}`));
		});

		child.on('close', (code) => {
			clearTimeout(timeout);
			if (code !== 0) {
				const message = stderr.trim() || `Node auth helper failed with exit code ${code}`;
				reject(new Error(message));
				return;
			}

			const authorization = normalizeAuthorization(stdout.trim());
			if (!authorization) {
				reject(new Error('Node auth helper returned empty authorization'));
				return;
			}

			resolve(authorization);
		});
	});
}

export async function loginAndCaptureAuthorization(settings: Settings): Promise<string> {
	if (typeof Bun !== 'undefined') {
		return await loginViaNodeHelper(settings);
	}
	return await captureAuthorizationWithPlaywright(settings);
}

export async function resolveApiAuthorization(
	settings: Settings,
	options: { forceRefresh?: boolean } = {}
): Promise<string> {
	const forceRefresh = Boolean(options.forceRefresh);

	if (!forceRefresh) {
		const configured = getConfiguredAuthorization(settings);
		const cached = await getCachedAuthorization(settings);
		const resolved = await resolveValidAuthorization(settings, [configured, cached]);
		if (resolved) {
			return resolved;
		}
	}

	await clearCachedAuthorization(settings);
	const loginSettings = forceRefresh ? { ...settings, pronotoolAuthorization: '' } : settings;
	const authorization = await loginAndCaptureAuthorization(loginSettings);
	await storeCachedAuthorization(settings, authorization);
	return authorization;
}
