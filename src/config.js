import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

export function getSettings() {
  return {
    vrtEmail: process.env.VRT_EMAIL || "",
    vrtPassword: process.env.VRT_PASSWORD || "",
    pronotoolAuthorization: process.env.PRONOTOOL_AUTHORIZATION || "",
    headless: (process.env.HEADLESS || "true").toLowerCase() !== "false",
    vrtLoginUrl: "https://wkpronostiek.sporza.be/login",
    vrtDashboardUrl: "https://wkpronostiek.sporza.be/",
    sporzaSsoLoginUrl: "https://sporza.be/sso/login?scope=openid,mid&resumePage=https%3A%2F%2Fwkpronostiek.sporza.be%2Flogin",
    userOverviewApiUrl: "https://api.sporza.be/pronotool/1/user-overview/overview",
    pronoApiUrl: "https://api.sporza.be/pronotool/1/prono",
    matchesApiUrl: "https://api.sporza.be/spapp/1/matchdays/soccer/competition/8",
    pronotoolAuthCacheFile: ".pronotool_auth.json",
    slowMoMs: 0,
    timezone: "Europe/Brussels"
  };
}

export function getAuthCachePath(settings) {
  return path.resolve(settings.pronotoolAuthCacheFile);
}