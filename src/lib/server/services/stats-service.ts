import { computePredictionAccuracy } from '../prediction-log';
import { fetchMatchesCached } from './pronotool-service';

export async function fetchAccuracyStats() {
	const allMatches = await fetchMatchesCached();
	return computePredictionAccuracy(allMatches);
}
