import { ensureDataDir } from '../src/lib/server/config';
import { importLegacyDataIfNeeded, runDatabaseMigrations } from '../src/lib/server/migrate';

async function main() {
	await ensureDataDir();
	await runDatabaseMigrations();
	await importLegacyDataIfNeeded();
	console.log('Legacy import finished');
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
