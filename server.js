/**
 * Attendance Roll.
 *
 *   npm start
 *
 * Starts the app, opens your browser, and handles everything else in the
 * interface: signing in to LCR, pulling the report, showing the roll.
 * There are no other terminal steps.
 */

const express = require("express");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const {
  login,
  capture,
  hasSession,
  SessionExpiredError,
  NoSessionError,
  LoginTimeoutError,
} = require("./lib/capture");
const { toCSV } = require("./lib/parse");

const PORT = process.env.PORT || 4173;
const CACHE_PATH = path.join(__dirname, "output", "latest.json");
const STALE_AFTER = 12 * 60 * 60 * 1000; // suggest a fresh pull after 12h

const app = express();
app.use(express.static(path.join(__dirname, "public")));

let cache = null;
let busy = null; // "login" | "pull" | null
let progress = "";

try {
  if (fs.existsSync(CACHE_PATH)) {
    cache = JSON.parse(fs.readFileSync(CACHE_PATH, "utf8"));
  }
} catch (_) {
  /* a corrupt cache is not fatal */
}

function writeCache(data) {
  fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
  fs.writeFileSync(CACHE_PATH, JSON.stringify(data));
}

/** Everything the interface needs to decide what to show. */
app.get("/api/state", (req, res) => {
  res.json({
    signedIn: hasSession(),
    hasData: Boolean(cache),
    busy,
    progress,
    stale: cache
      ? Date.now() - new Date(cache.fetchedAt).getTime() > STALE_AFTER
      : false,
    fetchedAt: cache ? cache.fetchedAt : null,
  });
});

app.get("/api/data", (req, res) => {
  if (!cache) return res.status(404).json({ error: "NO_DATA" });
  res.json(cache);
});

/** Opens a real browser window for sign-in, then pulls straight away. */
app.post("/api/login", async (req, res) => {
  if (busy) return res.status(409).json({ error: "BUSY", busy });
  busy = "login";
  progress = "Opening the sign-in window";
  try {
    await login((msg) => {
      progress = msg;
    });
    progress = "Signed in. Reading the report";
    busy = "pull";
    const data = await capture({ onProgress: (msg) => { progress = msg; } });
    cache = data;
    writeCache(data);
    res.json(data);
  } catch (err) {
    if (err instanceof LoginTimeoutError) {
      res.status(408).json({ error: "LOGIN_TIMEOUT" });
    } else {
      res.status(500).json({ error: "LOGIN_FAILED", detail: err.message });
    }
  } finally {
    busy = null;
    progress = "";
  }
});

app.post("/api/refresh", async (req, res) => {
  if (busy) return res.status(409).json({ error: "BUSY", busy });
  busy = "pull";
  progress = "Reading the report";
  try {
    const data = await capture({ onProgress: (msg) => { progress = msg; } });
    cache = data;
    writeCache(data);
    res.json(data);
  } catch (err) {
    if (err instanceof NoSessionError || err instanceof SessionExpiredError) {
      res.status(401).json({ error: "SESSION_EXPIRED" });
    } else {
      res.status(500).json({ error: "PULL_FAILED", detail: err.message });
    }
  } finally {
    busy = null;
    progress = "";
  }
});

app.get("/api/export.csv", (req, res) => {
  if (!cache) return res.status(404).send("Nothing pulled yet");
  const rows =
    req.query.scope === "attended"
      ? cache.rows.filter((r) => r.total > 0)
      : cache.rows;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="attendance-${cache.unitNumber}-${cache.fetchedAt.slice(0, 10)}.csv"`
  );
  res.send(toCSV(rows, cache.weekOptions));
});

function openBrowser(url) {
  const cmd =
    process.platform === "darwin"
      ? `open "${url}"`
      : process.platform === "win32"
        ? `start "" "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

app.listen(PORT, "127.0.0.1", () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n  Attendance Roll is open at ${url}`);
  console.log("  Leave this window running. Press Control-C to stop.\n");
  if (!process.env.NO_OPEN) openBrowser(url);
});
