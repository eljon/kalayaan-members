/**
 * Playwright access to LCR.
 *
 *  - login()   opens a real browser window for interactive sign-in and
 *              saves the session when it detects you're through.
 *  - capture() runs headless with that saved session and returns parsed data.
 */

const fs = require("fs");
const path = require("path");
const { extractReportData, parse, mergeMonths } = require("./parse");

const SESSION_PATH = path.join(__dirname, "..", "lcr-session.json");
const REPORT_URL =
  "https://lcr.churchofjesuschrist.org/mlt/report/class-and-quorum-attendance?lang=eng";
const ROUTE = "class-and-quorum-attendance";
const CAPTURE_TIMEOUT = 60000;
const LOGIN_TIMEOUT = 10 * 60 * 1000;

// How many months to pull, most recent first. The month rides in the
// server-action body; the year does not, so a span is only reliable
// within one calendar year (see MONTHS_LIMIT handling in captureMonths).
const DEFAULT_MONTHS = Number(process.env.LCR_MONTHS) || 3;

// Server-action coordinates for switching months. These are Next.js
// internals with NO stability guarantee. If multi-month stops working
// after an LCR deploy, refresh the action id with
// dev/console/6-dump-post.js and set LCR_MONTH_ACTION (or edit here).
// The router state tree is captured live at runtime, so it is not pinned.
const MONTH_ACTION_ID =
  process.env.LCR_MONTH_ACTION || "701d40279f0c62fef304125fd988e954306118496c";

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

/** The N most recent months ending at (year, month), most recent first. */
function monthsBackList(year, month, n) {
  let y = parseInt(year, 10);
  let m = parseInt(month, 10);
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({ year: String(y), month: String(m).padStart(2, "0") });
    m -= 1;
    if (m < 1) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

/**
 * Replay the month-switch server action for one month and return its raw
 * flight text. Uses the browser context's cookie jar, so the saved
 * session authenticates it. `stateTree` is the router state tree observed
 * on this route at runtime; the action id is pinned (see MONTH_ACTION_ID).
 */
async function postMonth(ctx, unitNumber, month, stateTree, onProgress) {
  onProgress(`Reading ${month}`);
  const headers = {
    accept: "text/x-component",
    "content-type": "text/plain;charset=UTF-8",
    "next-action": MONTH_ACTION_ID,
  };
  if (stateTree) headers["next-router-state-tree"] = stateTree;

  const res = await ctx.request.post(REPORT_URL, {
    headers,
    data: `[${unitNumber},"${month}","eng"]`,
    timeout: CAPTURE_TIMEOUT,
  });
  if (!res.ok()) {
    throw new Error(`Month ${month} returned HTTP ${res.status()}`);
  }
  return res.text();
}

/**
 * Pull the report and return a parsed roll. Loads the report page to get
 * the current ("anchor") month by the proven passive path, then replays
 * the month-switch action for each earlier month and merges them.
 *
 * Multi-month is additive: if an earlier month fails to load, it is left
 * out with a warning rather than failing the whole pull. With months = 1
 * (or every earlier month failing) the result equals the old single-month
 * behavior.
 */
async function capture(opts = {}) {
  if (!hasSession()) throw new NoSessionError();
  const months = opts.months || DEFAULT_MONTHS;
  const onProgress = opts.onProgress || (() => {});

  const { chromium } = require("playwright");
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ storageState: SESSION_PATH });
  const page = await ctx.newPage();

  let anchorFlight = null;
  let resolveAnchor;
  const gotAnchor = new Promise((r) => (resolveAnchor = r));

  // The router state tree the month-switch action needs, observed live off
  // the page's own RSC requests so it is never transcribed or guessed.
  let stateTree = null;
  page.on("request", (req) => {
    if (stateTree) return;
    const h = req.headers();
    if (h["next-router-state-tree"] && req.url().includes(ROUTE)) {
      stateTree = h["next-router-state-tree"];
    }
  });

  page.on("response", async (res) => {
    if (anchorFlight || !res.url().includes(ROUTE)) return;
    try {
      const body = await res.text();
      if (body.includes("weekOptions") && body.includes("members")) {
        anchorFlight = body;
        resolveAnchor();
      }
    } catch (_) {
      /* body consumed or navigation raced */
    }
  });

  const warnings = [];
  try {
    await page.goto(REPORT_URL, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);

    if (onIdentityProvider(page.url())) throw new SessionExpiredError();

    if (!anchorFlight) {
      await page
        .waitForSelector("table, [role=table]", { timeout: 20000 })
        .catch(() => {});
      if (!anchorFlight) await page.reload({ waitUntil: "domcontentloaded" });
    }

    const timeout = new Promise((_, rej) =>
      setTimeout(
        () => rej(new Error("LCR did not return the report in time")),
        CAPTURE_TIMEOUT
      )
    );
    await Promise.race([gotAnchor, timeout]);

    const anchor = extractReportData(anchorFlight);
    const payloads = [anchor];

    // Anchor the span on the month LCR itself considers current, read from
    // the data, not the clock.
    const latest = (anchor.weekOptions || []).reduce(
      (m, w) => (w.date > m ? w.date : m),
      ""
    );
    const [anchorYear, anchorMonth] = latest.split("-");

    if (anchorYear && anchorMonth && months > 1) {
      for (const { year, month } of monthsBackList(anchorYear, anchorMonth, months)) {
        if (year === anchorYear && month === anchorMonth) continue;
        // The action body carries no year, so a prior-year month would come
        // back as the wrong year. Skip and flag rather than pull bad data.
        if (year !== anchorYear) {
          warnings.push(
            `Skipped ${year}-${month}: months before ${anchorYear} need a year parameter that has not been observed`
          );
          continue;
        }
        try {
          const flight = await postMonth(ctx, anchor.unitNumber, month, stateTree, onProgress);
          payloads.push(extractReportData(flight));
        } catch (err) {
          warnings.push(`Skipped ${year}-${month}: ${err.message}`);
        }
      }
    }

    const result = parse(mergeMonths(payloads));
    result.months = payloads.length;
    if (warnings.length) result.warnings = warnings;
    return result;
  } finally {
    await browser.close().catch(() => {});
  }
}

module.exports = {
  login,
  capture,
  hasSession,
  monthsBackList,
  SessionExpiredError,
  NoSessionError,
  LoginTimeoutError,
};
