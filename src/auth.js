import fs from "node:fs/promises";

import { getAuthCachePath } from "./config.js";
import { loginAndCaptureAuthorization, normalizeAuthorization } from "./browser-login.js";
import { PronotoolApiClient } from "./pronotool-api.js";

export function getConfiguredAuthorization(settings) {
  const authorization = normalizeAuthorization(settings.pronotoolAuthorization);
  return authorization || null;
}

export async function getCachedAuthorization(settings) {
  const path = getAuthCachePath(settings);

  try {
    const raw = await fs.readFile(path, "utf8");
    const payload = JSON.parse(raw);
    if (!payload || typeof payload !== "object") {
      return null;
    }
    return normalizeAuthorization(payload.authorization || "") || null;
  } catch {
    return null;
  }
}

export async function storeCachedAuthorization(settings, authorization) {
  const path = getAuthCachePath(settings);
  const payload = {
    authorization: normalizeAuthorization(authorization),
    updated_at: new Date().toISOString()
  };
  await fs.writeFile(path, JSON.stringify(payload, null, 2), "utf8");
}

export async function clearCachedAuthorization(settings) {
  const path = getAuthCachePath(settings);
  try {
    await fs.unlink(path);
  } catch {
    // ignore
  }
}

async function resolveValidAuthorization(settings, candidates) {
  const api = new PronotoolApiClient(settings);

  for (const candidate of candidates) {
    const normalized = normalizeAuthorization(candidate || "");
    if (!normalized) {
      continue;
    }
    if (await api.isAuthorizationValid(normalized)) {
      return normalized;
    }
  }

  return null;
}

export async function resolveApiAuthorization(settings, options = {}) {
  const forceRefresh = Boolean(options.forceRefresh);

  if (!forceRefresh) {
    const configured = getConfiguredAuthorization(settings);
    const cached = await getCachedAuthorization(settings);
    const resolved = await resolveValidAuthorization(settings, [configured, cached]);
    if (resolved) {
      return resolved;
    }
  }

  await clearCachedAuthorization(settings);
  const loginSettings = forceRefresh
    ? { ...settings, pronotoolAuthorization: "" }
    : settings;
  const authorization = await loginAndCaptureAuthorization(loginSettings);
  await storeCachedAuthorization(settings, authorization);
  return authorization;
}