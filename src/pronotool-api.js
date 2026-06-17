export class HttpStatusError extends Error {
  constructor(status, message) {
    super(message || `HTTP ${status}`);
    this.name = "HttpStatusError";
    this.status = status;
  }
}

export class PronotoolApiClient {
  constructor(settings) {
    this.settings = settings;
  }

  async fetchUserOverview(authorization) {
    const response = await this.#fetchWithTimeout(this.settings.userOverviewApiUrl, {
      method: "GET",
      headers: this.#authHeaders(authorization)
    });
    await this.#raiseForStatus(response);

    const payload = await response.json();
    const pronosRaw = Array.isArray(payload?.pronos) ? payload.pronos : [];
    const groupsRaw = Array.isArray(payload?.groups) ? payload.groups : [];
    const userRaw = payload?.user && typeof payload.user === "object" ? payload.user : null;

    return {
      pronos: pronosRaw.map((item) => this.#parseProno(item)).filter(Boolean),
      userName: typeof userRaw?.name === "string" ? userRaw.name : null,
      groupNames: groupsRaw
        .map((item) => (item?.group && typeof item.group.name === "string" ? item.group.name.trim() : ""))
        .filter(Boolean)
    };
  }

  async fetchMatches() {
    const response = await this.#fetchWithTimeout(this.settings.matchesApiUrl, {
      method: "GET",
      headers: {
        accept: "*/*",
        origin: "https://wkpronostiek.sporza.be",
        referer: "https://wkpronostiek.sporza.be/"
      }
    });
    await this.#raiseForStatus(response);

    const payload = await response.json();
    const matchdays = Array.isArray(payload) ? payload : [];

    return matchdays.flatMap((day) =>
      (Array.isArray(day.matches) ? day.matches : []).map((m) => ({
        matchId: m.matchId,
        startTime: m.startTime,
        status: m.status,
        phaseName: m.phaseName,
        matchday: m.name,
        homeTeam: m.homeTeam?.name ?? null,
        awayTeam: m.awayTeam?.name ?? null
      }))
    );
  }

  async isAuthorizationValid(authorization) {
    try {
      await this.fetchUserOverview(authorization);
      return true;
    } catch (error) {
      if (error instanceof HttpStatusError && (error.status === 401 || error.status === 403)) {
        return false;
      }
      throw error;
    }
  }

  async setPronos(authorization, pronos) {
    const payload = pronos.map((prono) => ({
      matchId: /^\d+$/.test(String(prono.matchId)) ? Number(prono.matchId) : prono.matchId,
      modifiedTime: prono.modifiedTime ?? null,
      homeScore: Number(prono.homeScore),
      awayScore: Number(prono.awayScore),
      shootoutWinner: null,
      points: prono.points ?? null
    }));

    const response = await this.#fetchWithTimeout(this.settings.pronoApiUrl, {
      method: "POST",
      headers: {
        ...this.#authHeaders(authorization),
        "content-type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    await this.#raiseForStatus(response);
    return payload.length;
  }

  #authHeaders(authorization) {
    return {
      accept: "*/*",
      authorization,
      origin: "https://wkpronostiek.sporza.be",
      referer: "https://wkpronostiek.sporza.be/"
    };
  }

  async #raiseForStatus(response) {
    if (response.ok) {
      return;
    }

    const text = await response.text();
    throw new HttpStatusError(response.status, text || `HTTP ${response.status}`);
  }

  async #fetchWithTimeout(url, options, timeoutMs = 30000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetch(url, {
        ...options,
        signal: controller.signal
      });
    } catch (error) {
      if (error && error.name === "AbortError") {
        throw new Error(`Request timed out after ${timeoutMs}ms: ${url}`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  #parseProno(item) {
    if (!item || typeof item !== "object") {
      return null;
    }

    const homeScore = item.homeScore ?? null;
    const awayScore = item.awayScore ?? null;

    return {
      matchId: String(item.matchId ?? ""),
      homeScore: homeScore === null ? null : Number(homeScore),
      awayScore: awayScore === null ? null : Number(awayScore),
      modifiedTime: typeof item.modifiedTime === "string" ? item.modifiedTime : null,
      points: Number.isInteger(item.points) ? item.points : null
    };
  }
}