import path from 'node:path';

/** Resolve SQLite DATABASE_URL from env or data directory. Shared by runtime and Prisma CLI. */
export function resolveDatabaseUrl(options?: { dataDir?: string; cwd?: string }): string {
	const fromEnv = process.env.DATABASE_URL?.trim();
	if (fromEnv) {
		return fromEnv;
	}

	const dataDir = options?.dataDir?.trim() || process.env.DATA_DIR?.trim();
	const base = dataDir
		? path.resolve(dataDir)
		: options?.cwd
			? path.resolve(options.cwd)
			: process.cwd();
	return `file:${path.join(base, 'wkpronostiek.db')}`;
}
