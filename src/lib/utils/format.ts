const MATCH_DATETIME_OPTIONS: Intl.DateTimeFormatOptions = {
	day: 'numeric',
	month: 'short',
	hour: '2-digit',
	minute: '2-digit',
};

export function formatMatchDateTime(iso: string): string {
	if (!iso) return '';
	return new Date(iso).toLocaleString('nl-BE', MATCH_DATETIME_OPTIONS);
}
