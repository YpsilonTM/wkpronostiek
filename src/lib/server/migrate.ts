import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { PredictionLogEntry } from '$lib/types/prediction';
import type { AuthCachePayload } from '$lib/types/settings';
import { ensureDataDir, getAuthCachePath, getDataPath, getSettings } from './config';
import { getDatabaseUrl, prisma } from './db';
import { pinoLogger } from './logger';

const LEGACY_META_ID = 'legacy';
const DEFAULT_LOG_FILENAME = '.prediction_log.jsonl';

function getLegacyPredictionLogPath(): string {
	const file = process.env.PREDICTION_LOG_FILE?.trim() || DEFAULT_LOG_FILENAME;
	if (path.isAbsolute(file)) {
		return file;
	}
	return getDataPath(path.basename(file));
}

function getLegacyPredictionLogBackupPath(): string {
	return `${getLegacyPredictionLogPath()}.bak`;
}

async function readLegacyPredictionLogLines(): Promise<PredictionLogEntry[]> {
	const logPath = getLegacyPredictionLogPath();
	let raw: string;

	try {
		raw = await fs.readFile(logPath, 'utf8');
	} catch {
		return [];
	}

	const entries: PredictionLogEntry[] = [];
	const lines = raw.trim().split('\n').filter(Boolean);

	for (const [index, line] of lines.entries()) {
		try {
			entries.push(JSON.parse(line) as PredictionLogEntry);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			pinoLogger.warn(`Legacy import: skip invalid JSONL line ${index + 1}: ${message}`);
		}
	}

	return entries;
}

async function importLegacyAuthToken(): Promise<boolean> {
	const existing = await prisma.authToken.findUnique({ where: { id: 'pronotool' } });
	if (existing?.authorization) {
		return false;
	}

	const cachePath = getAuthCachePath(getSettings());
	let raw: string;

	try {
		raw = await fs.readFile(cachePath, 'utf8');
	} catch {
		return false;
	}

	let payload: AuthCachePayload;
	try {
		payload = JSON.parse(raw) as AuthCachePayload;
	} catch {
		pinoLogger.warn('Legacy import: invalid auth cache JSON, skipping auth import');
		return false;
	}

	const authorization = String(payload.authorization || '').trim();
	if (!authorization) {
		return false;
	}

	await prisma.authToken.upsert({
		where: { id: 'pronotool' },
		create: { id: 'pronotool', authorization },
		update: { authorization },
	});

	return true;
}

async function archiveLegacyPredictionLog(): Promise<void> {
	const logPath = getLegacyPredictionLogPath();
	const backupPath = getLegacyPredictionLogBackupPath();

	try {
		await fs.access(logPath);
	} catch {
		return;
	}

	try {
		await fs.access(backupPath);
		pinoLogger.info(`Legacy import: keeping existing backup at ${backupPath}`);
		return;
	} catch {
		// no backup yet
	}

	await fs.rename(logPath, backupPath);
	pinoLogger.info(`Legacy import: archived ${logPath} -> ${backupPath}`);
}

export async function importLegacyDataIfNeeded(): Promise<void> {
	const existingMeta = await prisma.migrationMeta.findUnique({
		where: { id: LEGACY_META_ID },
	});
	if (existingMeta) {
		return;
	}

	const predictionCount = await prisma.prediction.count();
	if (predictionCount > 0) {
		pinoLogger.warn(
			'Legacy import: predictions already in database without migration meta; marking import complete',
		);
		await prisma.migrationMeta.create({
			data: {
				id: LEGACY_META_ID,
				predictionsImported: predictionCount,
				authImported: Boolean(await prisma.authToken.findUnique({ where: { id: 'pronotool' } })),
			},
		});
		return;
	}

	await ensureDataDir();

	const entries = await readLegacyPredictionLogLines();
	let predictionsImported = 0;

	if (entries.length > 0) {
		await prisma.$transaction(
			entries.map((entry) =>
				prisma.prediction.create({
					data: {
						matchId: Number(entry.matchId),
						homeTeam: entry.homeTeam,
						awayTeam: entry.awayTeam,
						phaseName: entry.phaseName,
						startTime: entry.startTime,
						homeScore: entry.predictedHome,
						awayScore: entry.predictedAway,
						shootoutWinner: null,
						reasoning: '',
						searchAnalysis: '',
						model: entry.model,
						escalated: Boolean(entry.escalated),
						submittedAt: new Date(entry.loggedAt),
					},
				}),
			),
		);
		predictionsImported = entries.length;
		await archiveLegacyPredictionLog();
	}

	const authImported = await importLegacyAuthToken();

	await prisma.migrationMeta.create({
		data: {
			id: LEGACY_META_ID,
			predictionsImported,
			authImported,
		},
	});

	pinoLogger.info(
		`Legacy import: ${predictionsImported} predictions imported${authImported ? ', auth token imported' : ''}`,
	);
}

export async function runDatabaseMigrations(): Promise<void> {
	const databaseUrl = getDatabaseUrl();

	await new Promise<void>((resolve, reject) => {
		const child = spawn('bunx', ['--bun', 'prisma', 'migrate', 'deploy'], {
			cwd: process.cwd(),
			env: {
				...process.env,
				DATABASE_URL: databaseUrl,
			},
			stdio: ['ignore', 'pipe', 'pipe'],
		});

		let stderr = '';

		child.stderr.on('data', (chunk: Buffer) => {
			stderr += chunk.toString();
		});

		child.on('error', (error) => {
			reject(new Error(`Failed to run prisma migrate deploy: ${error.message}`));
		});

		child.on('close', (code) => {
			if (code !== 0) {
				reject(new Error(stderr.trim() || `prisma migrate deploy failed with exit code ${code}`));
				return;
			}
			resolve();
		});
	});
}
