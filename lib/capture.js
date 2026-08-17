/**
 * Playwright access to LCR.
 *
 *  - login()   opens a real browser window for interactive sign-in and
 *              saves the session when it detects you're through.
 *  - capture() runs headless with that saved session and returns parsed data.
 */

const fs = require("fs");
const path = require("path");
const { extractLine1, parse } = require("./parse");

const SESSION_PATH = path.join(__dirname, "..", "lcr-session.json");
const REPORT_URL =
  "https://lcr.churchofjesuschrist.org/mlt/report/class-and-quorum-attendance?lang=eng";
const ROUTE = "class-and-quorum-attendance";
const CAPTURE_TIMEOUT = 60000;
const LOGIN_TIMEOUT = 10 * 60 * 1000;

class SessionExpiredError extends Error {
  constructor() {
    super("Session expired");
    this.code = "SESSION_EXPIRED";
  }
}
class NoSessionError extends Error {
  constructor() {
    super("No saved session");
    this.code = "NO_SESSION";
  }
}
class LoginTimeoutError extends Error {
  constructor() {
    super("Sign-in was not completed");
    this.code = "LOGIN_TIMEOUT";
  }
}

const hasSession = () => fs.existsSync(SESSION_PATH);

const onIdentityProvider = (url) =>
  /id\.churchofjesuschrist\.org|okta|signin|login|auth/i.test(url);

const onReport = (url) =>
  url.includes("lcr.churchofjesuschrist.org") && !onIdentityProvider(url);

/**
 * Opens a visible browser, waits for the person to finish signing in,
 * then writes the session to disk. Resolves once the report is reachable.
 */
async function login(onProgress = () => {}) {
  const { chromium } = require("playwright");
  const browser = await chromium.launch({
    headless: false,
    args: ["--window-size=1180,900"],
  });
  const ctx = await browser.newContext({ viewport: null });
  const page = await ctx.newPage();

  try {
    onProgress("Opening the sign-in window");
    await page.goto(REPORT_URL, { waitUntil: "domcontentloaded" });

    const deadline = Date.now() + LOGIN_TIMEOUT;
    let settled = 0;

    // Poll rather than waitForURL: the flow bounces through several hosts
    // and we want the report itself, not just any LCR URL.
    while (Date.now() < deadline) {
      if (page.isClosed()) throw new LoginTimeoutError();

      const url = page.url();
      if (onReport(url)) {
        // Require it to hold steady, so we don't save mid-redirect.
        settled++;
        if (settled >= 3) break;
      } else {
        settled = 0;
        if (onIdentityProvider(url)) onProgress("Waiting for you to sign in");
      }
      await page.waitForTimeout(1000);
    }

    if (!onReport(page.url())) throw new LoginTimeoutError();

    onProgress("Saving the session");
    await ctx.storageState({ path: SESSION_PATH });
  } finally {
    await browser.close().catch(() => {});
  }
}

async function capture() {
  if (!hasSession()) throw new NoSessionError();

  const { chromium } = require("playwright");
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ storageState: SESSION_PATH });
  const page = await ctx.newPage();

  let payload = null;
  let resolvePayload;
  const captured = new Promise((r) => (resolvePayload = r));

  page.on("response", async (res) => {
    if (payload || !res.url().includes(ROUTE)) return;
    try {
      const body = await res.text();
      if (body.includes("weekOptions") && body.includes("members")) {
        payload = body;
        resolvePayload();
      }
    } catch (_) {
      /* body consumed or navigation raced */
    }
  });

  try {
    await page.goto(REPORT_URL, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);

    if (onIdentityProvider(page.url())) throw new SessionExpiredError();

    if (!payload) {
      await page
        .waitForSelector("table, [role=table]", { timeout: 20000 })
        .catch(() => {});
      if (!payload) await page.reload({ waitUntil: "domcontentloaded" });
    }

    const timeout = new Promise((_, rej) =>
      setTimeout(
        () => rej(new Error("LCR did not return the report in time")),
        CAPTURE_TIMEOUT
      )
    );
    await Promise.race([captured, timeout]);
  } finally {
    await browser.close().catch(() => {});
  }

  return parse(extractLine1(payload));
}

module.exports = {
  login,
  capture,
  hasSession,
  SessionExpiredError,
  NoSessionError,
  LoginTimeoutError,
};
