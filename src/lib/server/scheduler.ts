import { Cron } from 'croner';
import { pinoLogger } from './logger';
import { runMirrorFinalRecheck, runPredictUpcoming } from './services/prediction-service';

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
			pinoLogger.error({ err }, 'Fout tijdens automatische run');
		}
	});

	pinoLogger.info('🪞 Laatste mirror-check ingepland (elke minuut - * * * * *).');
	new Cron('* * * * *', async () => {
		try {
			await runMirrorFinalRecheck();
		} catch (err) {
			pinoLogger.error({ err }, 'Fout tijdens laatste mirror-check');
		}
	});
}
