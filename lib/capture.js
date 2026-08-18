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
  process.env.LCR_REPORT_URL ||
  "https://lcr.churchofjesuschrist.org/mlt/report/class-and-quorum-attendance?lang=eng";
const ROUTE = "class-and-quorum-attendance";
const CAPTURE_TIMEOUT = 60000;
const LOGIN_TIMEOUT = 10 * 60 * 1000;

// Earliest month to pull, as a two-digit string ("04" = April). The span
// runs from this month through the current (anchor) month, inclusive. Set
// LCR_START_MONTH to change it. The month rides in the server-action body
// but the year does not, so a span is only reliable within one calendar
// year — an earliest month later than the anchor is treated as prior-year
// and refused.
const DEFAULT_START_MONTH = process.env.LCR_START_MONTH || "04";

// Fallback when no start month is set: how many months back to pull.
const DEFAULT_MONTHS = Number(process.env.LCR_MONTHS) || 3;

// Server-action coordinates for switching months. These are Next.js
// internals with NO stability guarantee. If multi-month stops working
// after an LCR deploy, refresh the action id (see DISCOVERY.md) and set
// LCR_MONTH_ACTION, or edit here. The router state tree is captured live
// at runtime, so it is not pinned.
const MONTH_ACTION_ID =
  process.env.LCR_MONTH_ACTION || "701d40279f0c62fef304125fd988e954306118496c";

// Diagnostic log to stderr, so `npm run pull` and the server terminal show
// which months LCR actually returned. Never prints member data.
const log = (msg) => console.error(`[pull] ${msg}`);

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
 * Months from `startMonth` through the anchor month, inclusive, most
 * recent first, all within the anchor's year. A start later than the
 * anchor would fall in a prior year, which the month-only action body
 * cannot express, so it yields just the anchor month.
 */
function monthsFromStart(year, anchorMonth, startMonth) {
  const a = parseInt(anchorMonth, 10);
  const s = parseInt(startMonth, 10);
  const out = [];
  for (let m = a; m >= s && m >= 1; m--) {
    out.push({ year: String(year), month: String(m).padStart(2, "0") });
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
  // A start month wins if given; otherwise fall back to a months-back count.
  const startMonth =
    opts.startMonth !== undefined ? opts.startMonth : DEFAULT_START_MONTH;
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

    // Fingerprint = the week dates a payload actually contains. Dates only,
    // no member data, so it is safe to share when diagnosing. This is how
    // we tell whether a month-switch POST returned the month we asked for
    // or just echoed the default window.
    const weeksOf = (d) => (d.weekOptions || []).map((w) => w.date).join(", ");
    log(`anchor (${anchorYear}-${anchorMonth}) returned weeks: ${weeksOf(anchor)}`);

    if (anchorYear && anchorMonth) {
      // Earliest-month mode runs April..anchor; count mode runs N months back.
      const targets = startMonth
        ? monthsFromStart(anchorYear, anchorMonth, startMonth)
        : monthsBackList(anchorYear, anchorMonth, months);

      if (startMonth && parseInt(startMonth, 10) > parseInt(anchorMonth, 10)) {
        warnings.push(
          `Start month ${startMonth} is after the current month ${anchorMonth}; a prior-year start needs a year parameter that has not been observed. Pulled ${anchorMonth} only.`
        );
      }

      for (const { year, month } of targets) {
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
          const data = extractReportData(flight);
          log(`requested ${year}-${month} returned weeks: ${weeksOf(data)}`);
          // If the POST just echoed the anchor window, it did not honor the
          // month. Flag it loudly instead of silently merging a duplicate.
          if (weeksOf(data) === weeksOf(anchor)) {
            warnings.push(
              `Month ${month}: LCR returned the default window, not ${year}-${month}. The month-switch request is not selecting the month.`
            );
          }
          payloads.push(data);
        } catch (err) {
          log(`requested ${year}-${month} FAILED: ${err.message}`);
          warnings.push(`Skipped ${year}-${month}: ${err.message}`);
        }
      }
    }

    const merged = mergeMonths(payloads);

    // Drop Sundays that have not happened yet. The current month's payload
    // includes its future weeks as all-zero, which would otherwise make
    // "every week" impossible and drag the average down with blank columns.
    const today = new Date().toISOString().slice(0, 10);
    const kept = merged.weekOptions.filter((w) => w.date <= today);
    const droppedFuture = merged.weekOptions.length - kept.length;
    merged.weekOptions = kept;

    const result = parse(merged);
    result.months = payloads.length;
    if (droppedFuture) log(`dropped ${droppedFuture} future week(s) after ${today}`);
    log(`merged into ${result.weekOptions.length} weeks from ${payloads.length} payload(s)`);
    if (warnings.length) result.warnings = warnings;
    return result;
  } finally {
    await browser.close().catch(() => {});
  }
}

// ------------------------------------------------------ returned missionaries
// Same mechanism as attendance: the page fetches its own data from the
// report route, and we intercept that response on load. Confirmed from the
// browser's own resource log — a ~75 KB fetch to this route, separate from
// the document. No console, no reload, no DOM scraping.
const RETURNED_URL =
  process.env.LCR_RETURNED_URL ||
  "https://lcr.churchofjesuschrist.org/mlt/report/create-a-report/custom-reports-details/384867c5-82d3-4824-a45a-0cb53a8576b3?lang=eng";
const RETURNED_ROUTE = "custom-reports-details";

// Column headers, confirmed from the live report. LCR renders either its
// i18n keys ("record.preferred.name") or translated labels ("Preferred
// Name"), so each pattern matches both. Matching by header keeps the data
// aligned even if the columns are reordered.
const RM_COLUMNS = [
  [/preferred.?name/i, "name"],
  [/mission.?country/i, "missionCountry"],
  [/mission.?language/i, "missionLanguage"],
  [/^age$/i, "age"],
  [/recommend.*status/i, "trStatus"],
  [/recommend.*expiration/i, "trExpiration"],
  [/calling/i, "callings"],
];

/**
 * Read the report's rendered table. Confirmed against the live report:
 * 47 data rows in a table[role=grid], headers carrying LCR's i18n keys.
 * The DOM is the source because the rows are not in the page's flight
 * payload — that carries only unit/session context.
 */
async function captureReturned(opts = {}) {
  log(`returned: pull starting — ${RETURNED_URL}`);
  if (!hasSession()) {
    log("returned: no saved session");
    throw new NoSessionError();
  }
  const onProgress = opts.onProgress || (() => {});

  const { chromium } = require("playwright");
  log("returned: launching browser");
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ storageState: SESSION_PATH });
  const page = await ctx.newPage();

  try {
    // LCR bounces through the identity provider, so a URL read straight
    // after goto is often mid-redirect. Wait for it to settle.
    const settle = async (ms = 20000) => {
      const by = Date.now() + ms;
      while (Date.now() < by && onIdentityProvider(page.url())) {
        await page.waitForTimeout(1000);
      }
      return !onIdentityProvider(page.url());
    };

    // Warm up on a route the saved session is known to satisfy; deep-linking
    // straight into a custom report can bounce to the identity provider.
    onProgress("Signing in to LCR");
    await page.goto(REPORT_URL, { waitUntil: "domcontentloaded" });
    const warm = await settle();
    log(`returned: warm-up landed on ${page.url().slice(0, 110)}`);
    if (!warm) throw new SessionExpiredError();

    onProgress("Opening the returned-missionary report");
    await page.goto(RETURNED_URL, { waitUntil: "domcontentloaded" });
    await settle();
    log(`returned: landed on ${page.url().slice(0, 110)}`);
    if (onIdentityProvider(page.url())) throw new SessionExpiredError();

    // Wait for rows to actually render, not merely for the grid to exist.
    onProgress("Reading the report");
    await page
      .waitForFunction(() => {
        const g = document.querySelector("table, [role=grid]");
        if (!g) return false;
        const rows = [...g.querySelectorAll("tr, [role=row]")].filter(
          (r) => r.querySelectorAll("th, td, [role=cell], [role=columnheader]").length >= 7
        );
        return rows.length > 1;
      }, { timeout: 45000 })
      .catch(() => {});

    const scraped = await page.evaluate((cols) => {
      const patterns = cols.map(([src, flags, field]) => [new RegExp(src, flags), field]);
      const grid = document.querySelector("table, [role=grid]");
      if (!grid) return { headers: [], rows: [] };

      const all = [...grid.querySelectorAll("tr, [role=row]")].map((r) =>
        [...r.querySelectorAll("th, td, [role=cell], [role=columnheader]")].map((c) =>
          c.innerText.trim().replace(/\s+/g, " ")
        )
      );
      const wide = all.filter((cells) => cells.length >= patterns.length);
      if (!wide.length) return { headers: [], rows: [] };

      // First wide row is the header; the rest are data.
      const headers = wide[0];
      const fieldByCol = headers.map((h) => {
        const hit = patterns.find(([re]) => re.test(h));
        return hit ? hit[1] : null;
      });
      const rows = wide.slice(1).map((cells) => {
        const rec = {};
        cells.forEach((v, i) => {
          const f = fieldByCol[i];
          if (f) rec[f] = v;
        });
        return rec;
      });
      return { headers, fieldByCol, rows };
    }, RM_COLUMNS.map(([re, field]) => [re.source, re.flags, field]));

    log(`returned: headers ${JSON.stringify(scraped.headers)}`);
    log(`returned: column map ${JSON.stringify(scraped.fieldByCol)}`);

    const records = (scraped.rows || []).filter((r) => r.name);
    log(`returned: ${records.length} records`);

    if (!records.length) {
      throw new Error(
        "The report page loaded but no rows were readable. LCR may have changed the table markup."
      );
    }

    return {
      records,
      headers: scraped.headers,
      fetchedAt: new Date().toISOString(),
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

// ---------------------------------------------------------- generic reports
// The all-members report is another custom report — same DOM-grid method,
// but ~65 columns, too many to hand-map. Read every column, keyed by a
// slug of its header, so any custom report works without per-column code.

const MEMBERS_URL =
  process.env.LCR_MEMBERS_URL ||
  "https://lcr.churchofjesuschrist.org/mlt/report/create-a-report/custom-reports-details/d366045c-4019-4170-aed9-efc4fdd95131?lang=eng";

// LCR headers arrive either as i18n keys ("record.preferred.name") or as
// translated labels ("Preferred Name"). Turn a key into a readable label;
// leave an already-translated label alone.
function prettifyHeader(h) {
  if (!h) return "";
  if (/^[a-z0-9.\-]+$/i.test(h) && h.includes(".")) {
    const s = h
      .replace(/^(record|custom-reports|report|member|household|individual)\./i, "")
      .replace(/[.\-_]+/g, " ")
      .trim();
    return s.replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return h;
}

function slugHeader(label) {
  return (
    String(label).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") ||
    "col"
  );
}

// Turn raw headers into columns with unique slug keys.
function buildColumns(headers) {
  const seen = {};
  return headers.map((h) => {
    const label = prettifyHeader(h);
    let key = slugHeader(label);
    if (seen[key] != null) {
      seen[key] += 1;
      key = `${key}_${seen[key]}`;
    } else {
      seen[key] = 0;
    }
    return { key, label, raw: h };
  });
}

async function openReportPage(page, url, onProgress, label) {
  const settle = async (ms = 20000) => {
    const by = Date.now() + ms;
    while (Date.now() < by && onIdentityProvider(page.url())) {
      await page.waitForTimeout(1000);
    }
    return !onIdentityProvider(page.url());
  };
  onProgress("Signing in to LCR");
  await page.goto(REPORT_URL, { waitUntil: "domcontentloaded" });
  if (!(await settle())) throw new SessionExpiredError();
  log(`${label}: warm-up landed on ${page.url().slice(0, 110)}`);

  onProgress("Opening the report");
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await settle();
  log(`${label}: landed on ${page.url().slice(0, 110)}`);
  if (onIdentityProvider(page.url())) throw new SessionExpiredError();

  onProgress("Reading the report");
  await page
    .waitForFunction(
      () => {
        const g = document.querySelector("table, [role=grid]");
        if (!g) return false;
        const rows = [...g.querySelectorAll("tr, [role=row]")].filter(
          (r) => r.querySelectorAll("th, td, [role=cell], [role=columnheader]").length >= 3
        );
        return rows.length > 1;
      },
      { timeout: 45000 }
    )
    .catch(() => {});
}

// Read the rendered grid generically: the widest rows are the table; the
// first is the header, the rest are data (cloned header rows dropped).
async function readGridRaw(page) {
  return page.evaluate(() => {
    const grid = document.querySelector("table, [role=grid]");
    if (!grid) return { headers: [], rows: [] };
    const all = [...grid.querySelectorAll("tr, [role=row]")].map((r) =>
      [...r.querySelectorAll("th, td, [role=cell], [role=columnheader]")].map((c) =>
        c.innerText.trim().replace(/\s+/g, " ")
      )
    );
    const maxCols = Math.max(0, ...all.map((a) => a.length));
    if (!maxCols) return { headers: [], rows: [] };
    const wide = all.filter((a) => a.length === maxCols);
    const headers = wide[0];
    const hkey = headers.join("\u0001");
    const rows = wide.slice(1).filter((a) => a.join("\u0001") !== hkey);
    return { headers, rows };
  });
}

async function captureCustomReport(url, opts = {}) {
  if (!hasSession()) throw new NoSessionError();
  const onProgress = opts.onProgress || (() => {});
  const label = opts.label || "report";
  const { chromium } = require("playwright");
  log(`${label}: pull starting — ${url}`);
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ storageState: SESSION_PATH });
  const page = await ctx.newPage();
  try {
    await openReportPage(page, url, onProgress, label);
    const { headers, rows } = await readGridRaw(page);
    log(`${label}: ${headers.length} columns, ${rows.length} rows`);
    if (!headers.length || !rows.length) {
      throw new Error("The report loaded but no rows were readable.");
    }
    const columns = buildColumns(headers);
    const records = rows.map((cells) => {
      const rec = {};
      columns.forEach((c, i) => {
        rec[c.key] = cells[i] != null ? cells[i] : "";
      });
      return rec;
    });
    log(`${label}: columns ${JSON.stringify(columns.slice(0, 8).map((c) => c.key))}…`);
    return { columns, records, fetchedAt: new Date().toISOString() };
  } finally {
    await browser.close().catch(() => {});
  }
}

async function captureMembers(opts = {}) {
  const url = process.env.LCR_MEMBERS_URL || MEMBERS_URL;
  if (!url) {
    throw new Error(
      "No all-members report URL is configured. Set LCR_MEMBERS_URL to the report's URL."
    );
  }
  return captureCustomReport(url, { ...opts, label: "members" });
}

module.exports = {
  login,
  capture,
  captureReturned,
  captureCustomReport,
  captureMembers,
  prettifyHeader,
  slugHeader,
  buildColumns,
  hasSession,
  monthsBackList,
  monthsFromStart,
  SessionExpiredError,
  NoSessionError,
  LoginTimeoutError,
};
