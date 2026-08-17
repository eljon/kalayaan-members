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

// Field-name fragments the report's columns are built from. Used to score
// candidate arrays, not to hardcode a shape.
const RM_WANTED = /mission|temple|recommend|preferred|calling|expir|birth|age|name/i;
// Site chrome that has fooled shallower searches before (nav menus).
const RM_CHROME = /menu|banner|footer|includeRoles|urlInNewWindow|cfe|templateStyles/i;

/**
 * Find the report's record array inside a parsed flight payload. Scores
 * candidates on report-shaped keys and rejects nav/chrome objects, rather
 * than assuming a fixed path.
 */
function findRecordArray(root) {
  const out = [];
  const seen = new Set();
  const walk = (v, path, d) => {
    if (!v || typeof v !== "object" || d > 20 || seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) {
      const obj = v.find((x) => x && typeof x === "object" && !Array.isArray(x));
      if (v.length >= 3 && obj) {
        const keys = Object.keys(obj);
        const good = keys.filter((k) => RM_WANTED.test(k)).length;
        const bad = keys.filter((k) => RM_CHROME.test(k)).length;
        const score = good - bad * 5;
        if (score > 0) out.push({ path, len: v.length, keys, score, rows: v });
      }
      for (const x of v) walk(x, path + "[]", d + 1);
      return;
    }
    for (const k of Object.keys(v)) walk(v[k], path + "." + k, d + 1);
  };
  walk(root, "$", 0);
  out.sort((a, b) => b.score - a.score || b.len - a.len);
  return out;
}

/** Every JSON object parseable out of a flight payload's numbered lines. */
function flightObjects(body) {
  const objs = [];
  for (const line of body.split(/\n(?=[0-9a-f]+:)/)) {
    const i = line.indexOf(":");
    if (i < 0) continue;
    try {
      const d = JSON.parse(line.slice(i + 1));
      if (d && typeof d === "object") objs.push(d);
    } catch (_) {
      /* component/manifest lines are not JSON; skip */
    }
  }
  return objs;
}

/** Map a discovered record onto the report's columns, by key name. */
function normalizeReturned(rec) {
  const pick = (re) => {
    const k = Object.keys(rec).find((x) => re.test(x));
    const v = k ? rec[k] : "";
    if (v == null) return "";
    if (typeof v === "object") return v.name || v.label || v.value || "";
    return v;
  };
  return {
    name: pick(/preferredname|^name$|fullname|displayname/i),
    missionCountry: pick(/missioncountry|country/i),
    missionLanguage: pick(/missionlanguage|language/i),
    age: pick(/^age$|years/i),
    trStatus: pick(/recommendstatus|templerecommendstatus|status/i),
    trExpiration: pick(/expiration|expir/i),
    callings: pick(/calling|position/i),
    _raw: rec,
  };
}

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

  // Collect every response on the report route; the data one is whichever
  // yields a record array. Registered before navigation so nothing is missed.
  const bodies = [];
  page.on("response", async (res) => {
    if (!res.url().includes(RETURNED_ROUTE)) return;
    try {
      const body = await res.text();
      if (body.length > 2000) bodies.push({ url: res.url(), size: body.length, body });
    } catch (_) {
      /* body consumed or navigation raced */
    }
  });

  try {
    onProgress("Opening the returned-missionary report");
    await page.goto(RETURNED_URL, { waitUntil: "domcontentloaded" });
    if (onIdentityProvider(page.url())) throw new SessionExpiredError();

    // Let the page issue its own data fetch and render.
    await page.waitForSelector("table, [role=grid]", { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(4000);

    log(`returned: ${bodies.length} response(s) on the route: ${bodies.map((b) => Math.round(b.size / 1024) + "KB").join(", ")}`);

    let best = null;
    for (const b of bodies) {
      for (const obj of flightObjects(b.body)) {
        const cands = findRecordArray(obj);
        if (cands.length && (!best || cands[0].score > best.score || (cands[0].score === best.score && cands[0].len > best.len))) {
          best = cands[0];
        }
      }
    }

    if (!best) {
      // Report what IS in the payload — key names only, never values — so the
      // real field names can be read off without exposing member data.
      log("returned: no record array matched. Structure of what was found:");
      for (const b of bodies) {
        log(`  response ${Math.round(b.size / 1024)}KB ${b.url.slice(0, 90)}`);
        const objs = flightObjects(b.body);
        log(`    parseable flight objects: ${objs.length}`);
        const all = [];
        const seen = new Set();
        const scan = (v, p, d) => {
          if (!v || typeof v !== "object" || d > 20 || seen.has(v)) return;
          seen.add(v);
          if (Array.isArray(v)) {
            const o = v.find((x) => x && typeof x === "object" && !Array.isArray(x));
            if (v.length >= 3 && o) all.push({ path: p, len: v.length, keys: Object.keys(o) });
            for (const x of v) scan(x, p + "[]", d + 1);
            return;
          }
          for (const k of Object.keys(v)) scan(v[k], p + "." + k, d + 1);
        };
        objs.forEach((o) => scan(o, "$", 0));
        all.sort((a, b2) => b2.len - a.len);
        all.slice(0, 12).forEach((a) =>
          log(`    ${a.len} items @ ${a.path.slice(0, 80)} keys: ${JSON.stringify(a.keys.slice(0, 18))}`)
        );
        // Are the rows even here? Check for values only the table shows.
        const t = (re) => (b.body.match(re) || []).length;
        log(`    markers — Tagalog:${t(/Tagalog/g)} Cebuano:${t(/Cebuano/g)} Ilokano:${t(/Ilokano/g)} Expiring:${t(/Expiring/g)} Recommend:${t(/Recommend/gi)}`);
      }
      const dump = path.join(__dirname, "..", "output", "returned-raw.txt");
      fs.mkdirSync(path.dirname(dump), { recursive: true });
      fs.writeFileSync(dump, bodies.map((b) => `=== ${b.url} (${b.size}) ===\n${b.body}`).join("\n\n"));
      log(`returned: raw payload written to ${dump} (contains real names — do not paste it)`);
      throw new Error(
        "Could not find the records in the report payload. See the [pull] structure lines in this terminal."
      );
    }

    log(`returned: ${best.len} records at ${best.path}`);
    log(`returned: fields ${JSON.stringify(best.keys.slice(0, 25))}`);

    const records = best.rows
      .filter((r) => r && typeof r === "object" && !Array.isArray(r))
      .map(normalizeReturned)
      .filter((r) => r.name);

    log(`returned: ${records.length} records normalized`);

    return {
      records,
      sourceFields: best.keys,
      fetchedAt: new Date().toISOString(),
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

module.exports = {
  login,
  capture,
  captureReturned,
  hasSession,
  monthsBackList,
  monthsFromStart,
  SessionExpiredError,
  NoSessionError,
  LoginTimeoutError,
};
