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
  captureReturned,
  hasSession,
  SessionExpiredError,
  NoSessionError,
  LoginTimeoutError,
} = require("./lib/capture");
const { toCSV } = require("./lib/parse");
const { version: APP_VERSION } = require("./version");

const PORT = process.env.PORT || 4173;
const CACHE_PATH = path.join(__dirname, "output", "latest.json");
const STALE_AFTER = 12 * 60 * 60 * 1000; // suggest a fresh pull after 12h
const VERSIONS_DIR = path.join(__dirname, "public", "_versions");

const app = express();

// Revert route: /v4 (and /v4/app.js, /v4/style.css) serve an archived
// front-end so you can go back to an earlier UI. The data API stays
// current, so an old page reads today's numbers.
app.use((req, res, next) => {
  const m = req.path.match(/^\/v(\d+)(\/.*)?$/);
  if (!m) return next();
  const baseDir = path.join(VERSIONS_DIR, m[1]);
  if (!fs.existsSync(baseDir)) {
    return res.status(404).send(`Version ${m[1]} is not archived.`);
  }
  const sub = m[2] && m[2] !== "/" ? m[2] : "/index.html";
  const filePath = path.normalize(path.join(baseDir, sub));
  if (!filePath.startsWith(baseDir)) return res.status(400).send("Bad path");
  return res.sendFile(filePath, (err) => {
    if (err && !res.headersSent) res.status(404).end();
  });
});

// no-cache so a stale front-end can never linger after an update
app.use(
  express.static(path.join(__dirname, "public"), {
    etag: true,
    maxAge: 0,
    setHeaders: (res) => res.setHeader("Cache-Control", "no-cache, must-revalidate"),
  })
);

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
    version: APP_VERSION,
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

// Returned missionaries — a separate LCR custom report. The pull is not
// wired yet (its payload shape must be observed first); this serves
// whatever has been written to output/returned.json, or the offline
// fixture the fixture generator writes there.
const RETURNED_PATH = path.join(__dirname, "output", "returned.json");

function readReturned() {
  try {
    if (fs.existsSync(RETURNED_PATH)) {
      return JSON.parse(fs.readFileSync(RETURNED_PATH, "utf8"));
    }
  } catch (_) {
    /* corrupt file is not fatal */
  }
  return null;
}

// Serves cached returned-missionary data, and pulls it on first open so the
// tab fills itself the way the attendance roll does — no button to press.
app.get("/api/returned", async (req, res) => {
  console.error(`[api] /api/returned hit (force=${req.query.force || "0"})`);
  const cached = readReturned();
  if (cached && !cached.sample && req.query.force !== "1") return res.json(cached);
  if (!hasSession()) {
    if (cached) return res.json(cached);
    return res.status(401).json({ error: "SESSION_EXPIRED" });
  }
  if (busy) {
    if (cached) return res.json(cached);
    return res.status(409).json({ error: "BUSY", busy });
  }
  busy = "pull";
  progress = "Reading the returned-missionary report";
  try {
    const data = await captureReturned({ onProgress: (m) => { progress = m; } });
    fs.mkdirSync(path.dirname(RETURNED_PATH), { recursive: true });
    fs.writeFileSync(RETURNED_PATH, JSON.stringify(data));
    res.json(data);
  } catch (err) {
    if (err instanceof NoSessionError || err instanceof SessionExpiredError) {
      res.status(401).json({ error: "SESSION_EXPIRED" });
    } else if (cached) {
      res.json(cached); // stale beats nothing
    } else {
      res.status(500).json({ error: "PULL_FAILED", detail: err.message });
    }
  } finally {
    busy = null;
    progress = "";
  }
});

// Pull the returned-missionary report by reading its rendered table with
// the saved session. Writes output/returned.json.
app.post("/api/refresh-returned", async (req, res) => {
  if (busy) return res.status(409).json({ error: "BUSY", busy });
  busy = "pull";
  progress = "Reading the returned-missionary report";
  try {
    const data = await captureReturned({ onProgress: (m) => { progress = m; } });
    fs.mkdirSync(path.dirname(RETURNED_PATH), { recursive: true });
    fs.writeFileSync(RETURNED_PATH, JSON.stringify(data));
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

const RM_FIELDS = [
  ["name", "Preferred Name"],
  ["missionCountry", "Mission Country"],
  ["missionLanguage", "Mission Language"],
  ["age", "Age"],
  ["trStatus", "Temple Recommend Status"],
  ["trExpiration", "Temple Recommend Expiration Date"],
  ["callings", "Callings"],
];

app.get("/api/returned.csv", (req, res) => {
  const rm = readReturned();
  if (!rm) return res.status(404).send("Nothing pulled yet");
  const esc = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const header = RM_FIELDS.map(([, label]) => label).join(",");
  const lines = (rm.records || []).map((r) =>
    RM_FIELDS.map(([key]) => esc(r[key])).join(",")
  );
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="returned-missionaries.csv"');
  res.send([header, ...lines].join("\n"));
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
  console.log(`\n  Attendance Roll v${APP_VERSION} is open at ${url}`);
  console.log("  Leave this window running. Press Control-C to stop.\n");
  if (!process.env.NO_OPEN) openBrowser(url);
});
