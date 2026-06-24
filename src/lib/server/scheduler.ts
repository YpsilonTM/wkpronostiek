import { Cron } from 'croner';
import { pinoLogger } from './logger';
import { runPredictUpcoming } from './jobs';

let started = false;

export function startScheduler(): void {
	if (started) {
		return;
	}
	started = true;

	pinoLogger.info('🕐 Automatische check ingepland via Cron (elke 5 minuten - */5 * * * *).');
	new Cron('*/5 * * * *', async () => {
		try {
			await runPredictUpcoming();
		} catch (err) {
			pinoLogger.info(
				`❌ Fout tijdens automatische run: ${err instanceof Error ? err.message : String(err)}`
			);
		}
	});
}
