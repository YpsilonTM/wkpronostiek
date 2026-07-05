export interface Settings {
	vrtEmail: string;
	vrtPassword: string;
	pronotoolAuthorization: string;
	headless: boolean;
	vrtLoginUrl: string;
	vrtDashboardUrl: string;
	sporzaSsoLoginUrl: string;
	userOverviewApiUrl: string;
	pronoApiUrl: string;
	matchesApiUrl: string;
	pronotoolAuthCacheFile: string;
	slowMoMs: number;
	timezone: string;
}

export interface AuthCachePayload {
	authorization: string;
	updated_at: string;
}
