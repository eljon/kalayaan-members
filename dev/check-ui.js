#!/usr/bin/env node
/**
 * Runs every browser suite in dev/ui.
 *
 *   npm run check:ui
 *
 * These drive a real Chromium against a running copy of the app, which is the
 * only way to check what is only true once the page has rendered: that a
 * column survives onto paper, that a download is named correctly, that
 * nothing clickable prints. `npm run check` cannot see any of that, and is
 * kept separate because it needs nothing but node.
 *
 * This starts a server on 4173 if one is not already up, makes the fixture if
 * there is no data, and puts output/prefs.json back afterwards — the suites
 * seed lists and reports as they go, and a test run must not cost you yours.
 */

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");

const ROOT = path.join(__dirname, "..");
const PREFS = path.join(ROOT, "output", "prefs.json");
const PORT = 4173;

const SUITES = [
  "grid-reader",     // the LCR report reader reads every row, however the grid draws
  "smoke",           // every tab renders; the invariants that have broken before
  "roster",          // people who left the ward appear nowhere
  "refresh",         // one refresh repaints every tab
  "action-lists",    // nothing is pre-built; every list behaves the same
  "columns",         // the column-picker search, in both pickers
  "three-months",    // the 3MOS column, in the interface
  "attendance-history", // an attendance figure opens the weeks behind it
  "excluded-weeks",  // a Sunday excluded in Settings leaves every count
  "focus",           // hide and Focus, and the Focus tab
  "sorting",         // date columns sort by date
  "filenames",       // every download is named "<Report> - Kalayaan Stewardship"
  "print-columns",   // every column survives onto paper
  "print-report",    // a printed report is read, not operated
];

const up = () => new Promise((res) => {
  const req = http.get({ host: "127.0.0.1", port: PORT, path: "/", timeout: 1000 }, (r) => {
    r.resume(); res(true);
  });
  req.on("error", () => res(false));
  req.on("timeout", () => { req.destroy(); res(false); });
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function runOne(suite) {
  return new Promise((res) => {
    const p = spawn(process.execPath, [path.join(__dirname, "ui", suite + ".js")], { stdio: "inherit" });
    p.on("close", (code) => res(code));
  });
}

(async () => {
  const { blocked } = require("./ui/harness");

  if (!fs.existsSync(path.join(ROOT, "output", "latest.json"))) {
    console.log("No attendance data — building the fixture first.\n");
    await new Promise((r) => spawn(process.execPath, [path.join(__dirname, "make-fixture.js")], { stdio: "inherit" }).on("close", r));
  }

  let server = null;
  if (!(await up())) {
    console.log(`Starting a server on ${PORT}…`);
    server = spawn(process.execPath, [path.join(ROOT, "server.js")], { stdio: "ignore", detached: false });
    for (let i = 0; i < 20 && !(await up()); i++) await wait(500);
    if (!(await up())) {
      console.error("The server did not come up. Try `npm run server` in another terminal.");
      process.exit(1);
    }
  }

  const why = blocked();
  if (why) {
    console.log("\n" + "=".repeat(64));
    console.log("NOTHING WAS TESTED — " + why);
    console.log("=".repeat(64));
    if (server) server.kill();
    process.exit(0);
  }

  // The suites seed lists and reports as they go. Hand back what was there.
  const saved = fs.existsSync(PREFS) ? fs.readFileSync(PREFS) : null;

  const failed = [];
  try {
    for (const suite of SUITES) {
      console.log(`\n── ${suite} ${"─".repeat(Math.max(0, 56 - suite.length))}`);
      if (await runOne(suite)) failed.push(suite);
    }
  } finally {
    if (saved) fs.writeFileSync(PREFS, saved);
    else if (fs.existsSync(PREFS)) fs.rmSync(PREFS);
    if (server) server.kill();
  }

  console.log("\n" + "═".repeat(64));
  if (failed.length) {
    console.log(`${failed.length} of ${SUITES.length} suites FAILED: ${failed.join(", ")}`);
    process.exit(1);
  }
  console.log(`All ${SUITES.length} browser suites passed.`);
})();
