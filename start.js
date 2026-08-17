#!/usr/bin/env node
/**
 * One command to run everything.
 *
 *   node start.js
 *
 * Installs what's missing on the first run, then starts the app and opens
 * it in your browser. Sign-in happens inside the app itself.
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const here = __dirname;
const run = (cmd) => execSync(cmd, { cwd: here, stdio: "inherit" });

function have(mod) {
  try {
    require.resolve(mod, { paths: [here] });
    return true;
  } catch (_) {
    return false;
  }
}

if (!have("express") || !have("playwright")) {
  console.log("\n  First run. Installing what the app needs, about a minute.\n");
  run("npm install");
}

// Playwright ships without browsers; install Chromium once.
const marker = path.join(here, ".chromium-ready");
if (!fs.existsSync(marker)) {
  console.log("\n  Downloading the browser the app uses, one time only.\n");
  try {
    run("npx playwright install chromium");
    fs.writeFileSync(marker, "");
  } catch (_) {
    console.log("\n  Could not download the browser automatically.");
    console.log("  Run this once, then try again:  npx playwright install chromium\n");
    process.exit(1);
  }
}

require("./server.js");
