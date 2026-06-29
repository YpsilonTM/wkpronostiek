import path from 'node:path';
import { defineConfig } from 'prisma/config';

function defaultDatabaseUrl(): string {
	const fromEnv = process.env.DATABASE_URL?.trim();
	if (fromEnv) {
		return fromEnv;
	}
	const dataDir = process.env.DATA_DIR?.trim();
	const base = dataDir ? path.resolve(dataDir) : process.cwd();
	return `file:${path.join(base, 'wkpronostiek.db')}`;
}

export default defineConfig({
	schema: 'prisma/schema.prisma',
	migrations: {
		path: 'prisma/migrations'
	},
	datasource: {
		url: process.env.DATABASE_URL || defaultDatabaseUrl()
	}
});
