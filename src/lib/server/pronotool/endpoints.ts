const STANDINGS_FALLBACK_TEMPLATES = [
	'https://api.sporza.be/pronotool/1/groups/{groupId}/standings',
	'https://api.sporza.be/pronotool/1/groups/{groupId}/ranking',
	'https://api.sporza.be/pronotool/1/group/{groupId}/standings',
	'https://api.sporza.be/pronotool/1/minicompetitions/{groupId}/standings',
	'https://api.sporza.be/pronotool/1/minicompetitions/{groupId}/ranking',
] as const;

const RIVAL_PRONOS_FALLBACK_TEMPLATES = [
	'https://api.sporza.be/pronotool/1/user-overview/overview?userId={userId}&groupCode={groupCode}',
	'https://api.sporza.be/pronotool/1/users/{userId}/pronos?groupCode={groupCode}',
	'https://api.sporza.be/pronotool/1/users/{userId}/pronos?groupId={groupId}',
	'https://api.sporza.be/pronotool/1/groups/{groupId}/users/{userId}/pronos',
	'https://api.sporza.be/pronotool/1/users/{userId}/pronos/{groupId}',
	'https://api.sporza.be/pronotool/1/groups/{groupId}/pronos/{userId}',
] as const;

export function expandApiUrl(template: string, params: Record<string, string>): string {
	let url = template;
	for (const [key, value] of Object.entries(params)) {
		url = url.replaceAll(`{${key}}`, encodeURIComponent(value));
	}
	return url;
}

function uniqueUrls(templates: string[], params: Record<string, string>): string[] {
	const seen = new Set<string>();
	const urls: string[] = [];

	for (const template of templates) {
		const url = expandApiUrl(template, params);
		if (!seen.has(url)) {
			seen.add(url);
			urls.push(url);
		}
	}

	return urls;
}

export function getStandingsUrlCandidates(configuredUrl: string, groupId: string): string[] {
	return uniqueUrls([configuredUrl, ...STANDINGS_FALLBACK_TEMPLATES], { groupId });
}

export function getRivalPronosUrlCandidates(
	configuredUrl: string,
	userId: string,
	groupId: string,
	groupCode?: string,
): string[] {
	const params: Record<string, string> = { userId, groupId, groupCode: groupCode ?? groupId };
	return uniqueUrls([configuredUrl, ...RIVAL_PRONOS_FALLBACK_TEMPLATES], params);
}
