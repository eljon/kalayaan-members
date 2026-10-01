/**
 * Shared plumbing for the browser suites in this folder.
 *
 * These drive a real Chromium against a running copy of the app, which is the
 * only way to check the things that are only true once the page has rendered:
 * that a column survives onto paper, that a download is named correctly, that
 * nothing clickable prints. `npm run check` cannot see any of that.
 *
 * Run them all with `npm run check:ui`, or one on its own:
 *
 *   npm run server &            # or leave your usual one running
 *   node dev/ui/print-report.js
 *
 * Each suite seeds whatever prefs it needs and does not clean up after itself
 * — the runner snapshots output/prefs.json and puts it back, so a test run
 * never costs you a saved report or an action list.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const BASE = process.env.KALAYAAN_TEST_URL || "http://127.0.0.1:4173";
const PREFS = path.join(ROOT, "output", "prefs.json");

// Playwright ships a browser per release, but a container may carry a
// different build than the installed version expects. Take whichever
// chromium is actually on disk before falling back to Playwright's own idea.
function chromiumPath() {
  const dirs = [process.env.PLAYWRIGHT_BROWSERS_PATH, "/opt/pw-browsers"].filter(Boolean);
  for (const d of dirs) {
    let names = [];
    try { names = fs.readdirSync(d); } catch (_) { continue; }
    for (const n of names.filter((x) => /^chromium-/.test(x)).sort().reverse()) {
      const exe = path.join(d, n, "chrome-linux", "chrome");
      if (fs.existsSync(exe)) return exe;
    }
  }
  return null;               // let Playwright resolve it
}

// Why the suites cannot run here, or null when they can.
function blocked() {
  try { require("playwright"); } catch (_) {
    return "playwright is not installed — run `npm install`";
  }
  if (!fs.existsSync(path.join(ROOT, "output", "latest.json"))) {
    return "there is no attendance data — run `npm run fixture`";
  }
  return null;
}

function token() {
  const p = path.join(ROOT, "output", ".access-token");
  if (!fs.existsSync(p)) throw new Error("no access token yet — start the server once");
  return fs.readFileSync(p, "utf8").trim();
}

const readPrefs = () => { try { return JSON.parse(fs.readFileSync(PREFS, "utf8")); } catch (_) { return {}; } };
const writePrefs = (o) => { fs.mkdirSync(path.dirname(PREFS), { recursive: true }); fs.writeFileSync(PREFS, JSON.stringify(o)); };

/**
 * Put the app into a known state. The app ships no pre-built action lists,
 * so a suite that exercises one has to make it.
 */
function seed(opts) {
  opts = opts || {};
  const p = readPrefs();
  p.actionLists = opts.lists === undefined
    ? [{
        id: "ui-test",
        name: opts.listName || "Everyone",
        state: {
          groupsMatch: "all", groups: [{ match: "all", filters: [] }],
          columns: [], description: "", summaryHidden: false, columnsCustomized: false,
        },
      }]
    : opts.lists;
  p.actionDone = {};
  if (opts.focus !== false) { p.focus = []; p.focusColumns = []; }
  if (opts.excluded !== false) p.excludedWeeks = [];
  if (opts.reports !== false) p.customReports = {};
  if (opts.sorts !== false) p.sort = {};
  writePrefs(p);
}

/** Open the app, signed in, on a page that has finished its first paint. */
async function open(o) {
  o = o || {};
  const { chromium } = require("playwright");
  const exe = chromiumPath();
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  const ctx = await browser.newContext({
    viewport: o.viewport || { width: 1500, height: 1000 },
    deviceScaleFactor: o.scale || 1,
    acceptDownloads: true,
  });
  await ctx.addCookies([{ name: "access_token", value: token(), url: BASE }]);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // A suite that stubs the API has to install its routes before the first
  // load, so it gets the page while it is still blank.
  if (o.before) await o.before(page);
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.waitForSelector("#roll-body .roll-row", { timeout: 30000 });
  return { browser, page, errors };
}

/** A suite is a name, a function of (page, t), and optional browser options. */
function run(name, body, opts) {
  const why = blocked();
  if (why) { console.log(`SKIP ${name} — ${why}`); process.exit(0); }
  let failed = 0;
  const t = {
    ok(cond, msg) {
      console.log((cond ? "PASS " : "FAIL ") + msg);
      if (!cond) failed += 1;
    },
    eq(got, want, msg) { t.ok(got === want, `${msg}${got === want ? "" : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`); },
  };
  (async () => {
    const { browser, page, errors } = await open(opts || {});
    try {
      await body(page, t);
    } finally {
      for (const e of errors) { console.log("FAIL page error: " + e); failed += 1; }
      await browser.close();
    }
    console.log(failed ? `\n${failed} FAILED in ${name}` : `\nALL PASSED — ${name}`);
    process.exit(failed ? 1 : 0);
  })().catch((e) => {
    console.log("FAIL " + name + " threw: " + e.message);
    process.exit(1);
  });
}

// Ids and readiness selectors, so a suite can loop over the tabs without
// repeating the map five times.
const TABS = ["attendance", "returned", "members", "custom", "actions", "focus", "quarterly"];
const READY = {
  attendance: "#roll-body .roll-row", returned: "#rm-table tbody tr", members: "#mem-table tbody tr",
  custom: "#cr-table tbody tr", actions: "#al-table tbody tr", focus: "#view-focus .cr-builder",
  quarterly: "#qi-table tbody tr",
};
const PDF_BTN = { attendance: "att-pdf", returned: "rm-pdf", members: "mem-pdf", custom: "cr-pdf", actions: "al-pdf", focus: "focus-pdf", quarterly: "qi-pdf" };
const CSV_BTN = { attendance: "export", returned: "rm-export", members: "mem-export", custom: "cr-export", actions: "al-export", focus: "focus-export" };
const SHEET_BTN = { attendance: "att-sheet", returned: "rm-sheet", members: "mem-sheet", custom: "cr-sheet", actions: "al-sheet", focus: "focus-sheet", quarterly: "qi-sheet" };
const TABLE = { returned: "rm-table", members: "mem-table", custom: "cr-table", actions: "al-table", focus: "focus-table", quarterly: "qi-table" };

async function goTab(page, tab, wait) {
  await page.click(`.tab[data-tab="${tab}"]`);
  await page.waitForSelector(READY[tab], { timeout: 30000 });
  await page.waitForTimeout(wait == null ? 900 : wait);
}

/** Capture a download's suggested filename without writing it anywhere. */
async function downloadName(page, act) {
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), act()]);
  return dl.suggestedFilename();
}

module.exports = {
  BASE, ROOT, TABS, READY, PDF_BTN, CSV_BTN, SHEET_BTN, TABLE,
  blocked, seed, open, run, goTab, downloadName, readPrefs, writePrefs,
};
