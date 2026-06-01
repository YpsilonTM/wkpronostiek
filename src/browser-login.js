import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const CONSENT_SELECTORS = [
  'button:has-text("Alles accepteren")',
  'button:has-text("Alles weigeren")',
  'button:has-text("Mijn instellingen beheren")'
];

const CONSENT_TEXTS = ["Alles accepteren", "Alles weigeren", "Accepteer", "Akkoord"];
const CONNECT_BUTTON_SELECTOR =
  'button:has-text("Aanmelden met VRT-profiel"), [role="button"]:has-text("Aanmelden met VRT-profiel"), flt-semantics:has-text("Aanmelden met VRT-profiel")';
const EMAIL_SELECTOR = 'input[type="email"], input[name="email"]';
const PASSWORD_SELECTOR = 'input[type="password"], input[name="password"]';
const LOGIN_SUBMIT_SELECTOR = 'button:has-text("Aanmelden"), button:has-text("Inloggen"), button[type="submit"]';

export function normalizeAuthorization(value) {
  const token = String(value || "").trim();
  if (!token) {
    return "";
  }
  if (token.toLowerCase().startsWith("bearer ")) {
    return `Bearer ${token.slice(7).trim()}`;
  }
  return `Bearer ${token}`;
}

export async function loginAndCaptureAuthorization(settings) {
  if (typeof Bun !== "undefined") {
    return await loginViaNodeHelper(settings);
  }

  if (!settings.vrtEmail || !settings.vrtPassword) {
    throw new Error("VRT_EMAIL and VRT_PASSWORD must be set in .env");
  }

  const browser = await chromium.launch({
    headless: settings.headless,
    slowMo: settings.slowMoMs
  });
  const context = await browser.newContext({
    locale: "nl-BE",
    timezoneId: settings.timezone
  });
  const page = await context.newPage();

  let capturedAuthorization = "";
  page.on("request", (request) => {
    if (capturedAuthorization) {
      return;
    }
    if (!request.url().includes("api.sporza.be/pronotool/")) {
      return;
    }
    const headers = request.headers();
    if (headers.authorization) {
      capturedAuthorization = headers.authorization;
    }
  });

  try {
    await page.goto(settings.vrtLoginUrl, { waitUntil: "domcontentloaded" });
    await dismissConsent(page);

    if (!(await isDashboardLoaded(page, settings.vrtDashboardUrl))) {
      if (!(await hasVisibleAuthForm(page))) {
        for (let i = 0; i < 3; i += 1) {
          await goToAuthForm(page, settings);
          await dismissConsent(page);
          if ((await hasVisibleAuthForm(page)) || (await isDashboardLoaded(page, settings.vrtDashboardUrl))) {
            break;
          }
        }
      }

      if (!(await isDashboardLoaded(page, settings.vrtDashboardUrl))) {
        if (!(await hasVisibleAuthForm(page))) {
          throw new Error("Could not reach the VRT authentication form");
        }

        await page.locator(EMAIL_SELECTOR).first().fill(settings.vrtEmail);
        await page.locator(PASSWORD_SELECTOR).first().fill(settings.vrtPassword);
        await page.locator(LOGIN_SUBMIT_SELECTOR).first().click();

        await page.waitForLoadState("networkidle");
        await page.goto(settings.vrtDashboardUrl, { waitUntil: "networkidle" });
      }
    }

    if (!capturedAuthorization) {
      await page.goto(settings.vrtDashboardUrl, { waitUntil: "networkidle" }).catch(() => { });
      await page.waitForTimeout(1500);
    }

    if (!capturedAuthorization) {
      capturedAuthorization = await captureAuthorizationFromCookies(context);
    }

    const normalized = normalizeAuthorization(capturedAuthorization);
    if (!normalized) {
      throw new Error("No pronotool authorization captured after login");
    }

    return normalized;
  } finally {
    await context.close();
    await browser.close();
  }
}

async function goToAuthForm(page, settings) {
  try {
    await page.goto(settings.sporzaSsoLoginUrl, { waitUntil: "domcontentloaded" });
    await dismissConsent(page);
    if ((await hasVisibleAuthForm(page)) || page.url().includes("login.vrt.be")) {
      return;
    }
  } catch {
    // fallback below
  }

  await clickFirstVisible(page, CONNECT_BUTTON_SELECTOR, "Aanmelden met VRT-profiel");
  await page.waitForLoadState("domcontentloaded");
}

async function dismissConsent(page) {
  for (const frame of page.frames()) {
    for (const text of CONSENT_TEXTS) {
      const byRole = frame.getByRole("button", { name: new RegExp(text, "i") }).first();
      try {
        if (await byRole.isVisible()) {
          await byRole.click({ force: true });
          await page.waitForTimeout(700);
          return true;
        }
      } catch {
        // next option
      }

      const byText = frame.getByText(new RegExp(text, "i")).first();
      try {
        if (await byText.isVisible()) {
          await byText.click({ force: true });
          await page.waitForTimeout(700);
          return true;
        }
      } catch {
        // next option
      }
    }
  }

  for (const selector of CONSENT_SELECTORS) {
    const locator = page.locator(selector).first();
    try {
      if (await locator.isVisible()) {
        await locator.click({ force: true });
        await page.waitForTimeout(700);
        return true;
      }
    } catch {
      // next selector
    }
  }

  return false;
}

async function clickFirstVisible(page, selector, fallbackText) {
  const locator = page.locator(selector);
  try {
    await locator.first().waitFor({ state: "visible", timeout: 10000 });
  } catch {
    // continue
  }

  const count = await locator.count();
  for (let i = 0; i < count; i += 1) {
    const candidate = locator.nth(i);
    try {
      if (await candidate.isVisible()) {
        await candidate.click();
        return;
      }
    } catch {
      // continue
    }
  }

  if (fallbackText) {
    const fallback = page.getByText(fallbackText, { exact: true }).first();
    try {
      await fallback.waitFor({ state: "visible", timeout: 5000 });
      await fallback.click({ force: true });
      return;
    } catch {
      // continue to error
    }
  }

  throw new Error(`No visible element found for selector: ${selector}`);
}

async function hasVisibleAuthForm(page) {
  for (const selector of [EMAIL_SELECTOR, PASSWORD_SELECTOR]) {
    const locator = page.locator(selector).first();
    try {
      if (await locator.isVisible()) {
        return true;
      }
    } catch {
      // continue
    }
  }
  return false;
}

async function isDashboardLoaded(page, dashboardUrl) {
  if (page.url().replace(/\/$/, "") === dashboardUrl.replace(/\/$/, "")) {
    return true;
  }

  try {
    const text = await page.locator("body").innerText({ timeout: 1000 });
    return text.includes("PRONOSTIEKEN");
  } catch {
    return false;
  }
}

async function captureAuthorizationFromCookies(context) {
  try {
    const cookies = await context.cookies();
    const cookie = cookies.find((item) => item.name === "sporza-site_profile_at");
    return cookie?.value || "";
  } catch {
    return "";
  }
}

async function loginViaNodeHelper(settings) {
  const helperPath = fileURLToPath(new URL("./node-auth-login.mjs", import.meta.url));

  return await new Promise((resolve, reject) => {
    const child = spawn("node", [helperPath], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        WKP_SETTINGS_JSON: JSON.stringify(settings)
      },
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Node auth helper timed out after 180000ms"));
    }, 180000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(new Error(`Failed to start Node auth helper: ${error.message}`));
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        const message = stderr.trim() || `Node auth helper failed with exit code ${code}`;
        reject(new Error(message));
        return;
      }

      const authorization = normalizeAuthorization(stdout.trim());
      if (!authorization) {
        reject(new Error("Node auth helper returned empty authorization"));
        return;
      }

      resolve(authorization);
    });
  });
}