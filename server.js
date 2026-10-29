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
  captureMembers,
  hasSession,
  clearSession,
  SessionExpiredError,
  NoSessionError,
  LoginTimeoutError,
  onReport,
  REPORT_URL,
  SESSION_PATH,
} = require("./lib/capture");
const { LoginRelay } = require("./lib/login-relay");
const { toCSV } = require("./lib/parse");
const { buildWorkbook } = require("./lib/xlsx");
const { version: APP_VERSION } = require("./version");

const crypto = require("crypto");
const { loadDotEnv, accessConfig, keyStore, verifyAccessToken } = require("./lib/access");
const { OUTPUT_DIR } = require("./lib/paths");

loadDotEnv(__dirname);
// Remote use (REMOTE.md): Cloudflare Tunnel in front, Cloudflare Access
// asking for an approved email. Null when not set up.
const REMOTE = accessConfig();
// Running on a cloud server (the Dockerfile sets CLOUD=1): no screen, so LCR
// sign-in happens inside the app, and nobody is "on this computer".
const CLOUD = process.env.CLOUD === "1";
const accessKeys = REMOTE ? keyStore(REMOTE) : null;

const PORT = process.env.PORT || 4173;
// With the tunnel set up, the tunnel is the only way in: listen on this
// machine alone, so nothing on the local network can reach the port and
// skip the email check. Without it, keep the old behaviour (access code,
// reachable on the local network).
const HOST = process.env.HOST || (REMOTE ? "127.0.0.1" : "0.0.0.0");
const CACHE_PATH = path.join(OUTPUT_DIR, "latest.json");
const STALE_AFTER = 12 * 60 * 60 * 1000; // suggest a fresh pull after 12h
const VERSIONS_DIR = path.join(__dirname, "public", "_versions");
const TOKEN_PATH = path.join(OUTPUT_DIR, ".access-token");

function ensureAccessToken() {
  fs.mkdirSync(path.dirname(TOKEN_PATH), { recursive: true });
  try {
    const t = fs.readFileSync(TOKEN_PATH, "utf8").trim();
    if (t.length >= 16) return t;
  } catch (_) {}
  const t = crypto.randomBytes(24).toString("base64url");
  fs.writeFileSync(TOKEN_PATH, t + "\n");
  return t;
}

const ACCESS_TOKEN = ensureAccessToken();

const app = express();

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(";").forEach((p) => {
    const [k, ...v] = p.split("=");
    out[k.trim()] = decodeURIComponent(v.join("=").trim());
  });
  return out;
}

app.post("/api/auth", express.urlencoded({ extended: false }), (req, res) => {
  // In the cloud with the email login set up, there is no access code.
  if (CLOUD && REMOTE) return res.status(403).send(gatePage(null, true));
  const code = (req.body && req.body.code || "").trim();
  if (code !== ACCESS_TOKEN) {
    return res.status(401).send(gatePage("Incorrect access code. Try again."));
  }
  res.setHeader("Set-Cookie", `access_token=${ACCESS_TOKEN}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000`);
  res.redirect("/");
});

function gatePage(error, linkOnly) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Kalayaan Stewardship — Access</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f5f4f0;color:#1a1a1a}
.gate{background:#fff;padding:2.5rem;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,.08);max-width:360px;width:90%}
h1{font-size:1.25rem;margin-bottom:.75rem}p{font-size:.9rem;color:#555;margin-bottom:1.25rem}
input{width:100%;padding:.6rem .75rem;font-size:1rem;border:1px solid #ccc;border-radius:6px;margin-bottom:1rem}
button{width:100%;padding:.6rem;font-size:1rem;background:#2F5D50;color:#fff;border:none;border-radius:6px;cursor:pointer}
button:hover{background:#264d42}.err{color:#8C2F26;font-size:.85rem;margin-bottom:.75rem}</style></head>
<body><div class="gate"><h1>Kalayaan Stewardship</h1>${linkOnly
  ? "<p>Open the app through its usual link, and sign in with your approved email.</p></div></body></html>"
  : `<p>Enter the access code shown in the terminal where the app is running.</p>
${error ? '<p class="err">' + error + "</p>" : ""}
<form method="POST" action="/api/auth">`}${linkOnly ? "" : `<input name="code" type="password" placeholder="Access code" autofocus autocomplete="off">
<button type="submit">Continue</button></form></div></body></html>`}`;
}

// Two ways in. Through the tunnel, Cloudflare Access has already asked for
// an approved email and signed a token saying so — verified here, never
// taken on trust. On this machine (or the local network, without the
// tunnel), the access code printed in the terminal. A request through the
// tunnel with no valid token falls back to the access code, so a tunnel
// set up without Access is still locked.
// The cloud host asks this to know the app is up. It says nothing else.
app.get("/healthz", (req, res) => res.type("text").send("ok"));

// In the cloud with the email login set up, that login is the only way in:
// the access code — printed in the server's log — is switched off, so the
// log is not a key to member records.
const ACCESS_ONLY = CLOUD && !!REMOTE;
if (CLOUD && !REMOTE) {
  console.error("\n  WARNING: running in the cloud without the email login (ACCESS_TEAM_DOMAIN / ACCESS_AUD).");
  console.error("  The access code is the only lock. Finish CLOUD.md step 4 before sharing the link.\n");
}

app.use(async (req, res, next) => {
  if (req.path === "/api/auth") return ACCESS_ONLY ? res.status(403).send(gatePage("Open the app through its link.")) : next();
  const jwt = req.headers["cf-access-jwt-assertion"];
  if (REMOTE && jwt) {
    try {
      const { email } = await verifyAccessToken(jwt, REMOTE, accessKeys);
      req.user = { email, via: "access", owner: REMOTE.owners.includes(email) };
      return next();
    } catch (err) {
      console.error(`[access] refused a tunnelled request: ${err.message}`);
      if (req.path.startsWith("/api/")) return res.status(401).json({ error: "UNAUTHORIZED" });
      return res.status(401).send(gatePage("Your sign-in could not be verified. Close this tab and open the link again."));
    }
  }
  if (ACCESS_ONLY) {
    if (req.path.startsWith("/api/")) return res.status(401).json({ error: "UNAUTHORIZED" });
    return res.status(401).send(gatePage(null, true));
  }
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies.access_token || (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (token === ACCESS_TOKEN) {
    req.user = { email: null, via: "code", owner: true };
    return next();
  }
  if (req.path.startsWith("/api/")) return res.status(401).json({ error: "UNAUTHORIZED" });
  res.status(401).send(gatePage());
});

// Who is looking, and what they may do — the interface shows the email and
// words its sign-in messages to suit.
app.get("/api/whoami", (req, res) => {
  res.json({
    email: req.user.email,
    via: req.user.via,
    owner: req.user.owner,
    // How this person can sign the app in to LCR: a window on this computer
    // (here, with a screen), the sign-in shown inside the app (the cloud, or
    // an owner from afar), or not at all (a leader who is not an owner).
    signIn: signInModeFor(req.user),
    canSignIn: signInModeFor(req.user) !== "none",
  });
});

function signInModeFor(user) {
  if (user.via === "code" && !CLOUD) return "window";
  return user.owner ? "relay" : "none";
}

// ------------------------------------------------- LCR sign-in inside the app
// See lib/login-relay.js. One at a time; owners only.
let relay = null;
function relayGuard(req, res) {
  if (signInModeFor(req.user) !== "relay") { res.status(403).json({ error: "OWNER_ONLY" }); return false; }
  return true;
}
app.post("/api/login-relay/start", async (req, res) => {
  if (!relayGuard(req, res)) return;
  if (busy) return res.status(409).json({ error: "BUSY", busy });
  if (relay) await relay.close();
  const { chromium } = require("playwright");
  relay = new LoginRelay({
    startUrl: REPORT_URL,
    isDone: onReport,
    // CHROMIUM_PATH: only for a machine whose browser build does not match
    // the installed Playwright (the tests' container). The cloud image
    // installs the matching one and leaves it unset.
    launch: () => chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined }),
    save: async (ctx) => {
      fs.mkdirSync(path.dirname(SESSION_PATH), { recursive: true });
      await ctx.storageState({ path: SESSION_PATH });
    },
  });
  await relay.start();
  res.json(relay.status());
});
app.get("/api/login-relay/status", (req, res) => {
  if (!relayGuard(req, res)) return;
  res.json(relay ? relay.status() : { state: "none" });
});
app.get("/api/login-relay/frame", async (req, res) => {
  if (!relayGuard(req, res)) return;
  try {
    const img = relay && (await relay.frame());
    if (!img) return res.status(204).end();
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "no-store");
    res.end(img);
  } catch (_) { res.status(204).end(); }
});
app.post("/api/login-relay/input", express.json({ limit: "4kb" }), async (req, res) => {
  if (!relayGuard(req, res)) return;
  if (!relay || relay.state !== "signing-in") return res.status(409).json({ error: "NOT_SIGNING_IN" });
  const b = req.body || {};
  try {
    if (b.tap) await relay.tap(b.tap.x, b.tap.y);
    else if (typeof b.type === "string") await relay.type(b.type);
    else if (b.press) await relay.press(b.press);
    else if (b.scroll) await relay.scroll(b.scroll);
    res.json(relay.status());
  } catch (err) {
    res.status(400).json({ error: "BAD_INPUT", detail: err.message });
  }
});
app.post("/api/login-relay/cancel", async (req, res) => {
  if (!relayGuard(req, res)) return;
  if (relay) { await relay.close(); relay = null; }
  res.json({ state: "none" });
});

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
    setHeaders: (res, file) => {
      res.setHeader("Cache-Control", "no-cache, must-revalidate");
      if (file.endsWith(".webmanifest")) res.setHeader("Content-Type", "application/manifest+json");
    },
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
  if (signInModeFor(req.user) !== "window") return res.status(403).json({ error: "LOGIN_ON_HOST" });
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

// Downloads are named "<what it is> - Kalayaan Stewardship", the same rule
// exportName() applies to the ones the browser builds — a file has to stay
// identifiable once it is sitting in somebody's Downloads folder.
const csvAttachment = (name) => `attachment; filename="${name} - Kalayaan Stewardship.csv"`;

app.get("/api/export.csv", (req, res) => {
  if (!cache) return res.status(404).send("Nothing pulled yet");
  const rows =
    req.query.scope === "attended"
      ? cache.rows.filter((r) => r.total > 0)
      : cache.rows;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", csvAttachment("Attendance"));
  res.send(toCSV(rows, cache.weekOptions));
});

// Returned missionaries — a separate LCR custom report. The pull is not
// wired yet (its payload shape must be observed first); this serves
// whatever has been written to output/returned.json, or the offline
// fixture the fixture generator writes there.
const RETURNED_PATH = path.join(OUTPUT_DIR, "returned.json");

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
  const forced = req.query.force === "1";
  if (cached && !cached.sample && !forced) return res.json(cached);
  // As with members: a forced pull reports what happened, never the old copy.
  if (!hasSession()) {
    if (cached && !forced) return res.json(cached);
    return res.status(401).json({ error: "SESSION_EXPIRED" });
  }
  if (busy) {
    if (cached && !forced) return res.json(cached);
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
    } else if (cached && !forced) {
      res.json(cached); // stale beats nothing — but not when Refresh was pressed
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
  res.setHeader("Content-Disposition", csvAttachment("Returned Missionaries"));
  res.send([header, ...lines].join("\n"));
});

// All members — another LCR custom report, ~65 columns. Same generic pull;
// auto-loads on first open like the returned report.
const MEMBERS_PATH = path.join(OUTPUT_DIR, "members.json");

function readMembers() {
  try {
    if (fs.existsSync(MEMBERS_PATH)) return JSON.parse(fs.readFileSync(MEMBERS_PATH, "utf8"));
  } catch (_) { /* corrupt file is not fatal */ }
  return null;
}

app.get("/api/members", async (req, res) => {
  console.error(`[api] /api/members hit (force=${req.query.force || "0"})`);
  const cached = readMembers();
  const forced = req.query.force === "1";
  if (cached && !cached.sample && !forced) return res.json(cached);
  // A forced pull is somebody pressing Refresh. Handing back the old copy
  // with a 200 told them it had worked when nothing had been read — so a
  // forced pull reports what actually happened instead. Only an ordinary
  // load (opening the tab) falls back to the copy on disk.
  if (!hasSession()) {
    if (cached && !forced) return res.json(cached);
    return res.status(401).json({ error: "SESSION_EXPIRED" });
  }
  if (busy) {
    if (cached && !forced) return res.json(cached);
    return res.status(409).json({ error: "BUSY", busy });
  }
  busy = "pull";
  progress = "Reading the all-members report";
  try {
    const data = await captureMembers({ onProgress: (m) => { progress = m; } });
    fs.mkdirSync(path.dirname(MEMBERS_PATH), { recursive: true });
    fs.writeFileSync(MEMBERS_PATH, JSON.stringify(data));
    res.json(data);
  } catch (err) {
    if (err instanceof NoSessionError || err instanceof SessionExpiredError) {
      res.status(401).json({ error: "SESSION_EXPIRED" });
    } else if (cached && !forced) {
      res.json(cached);
    } else {
      res.status(500).json({ error: "PULL_FAILED", detail: err.message });
    }
  } finally {
    busy = null;
    progress = "";
  }
});

app.get("/api/members.csv", (req, res) => {
  const m = readMembers();
  if (!m) return res.status(404).send("Nothing pulled yet");
  const cols = m.columns || [];
  const esc = (v) => {
    const str = String(v ?? "");
    return /[",\n]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
  };
  const header = cols.map((c) => esc(c.label)).join(",");
  const lines = (m.records || []).map((r) => cols.map((c) => esc(r[c.key])).join(","));
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", csvAttachment("Members"));
  res.send([header, ...lines].join("\n"));
});

// User preferences — server-side persistence so settings, custom reports,
// action lists, and check-offs survive across machines and browser resets.
const PREFS_PATH = path.join(OUTPUT_DIR, "prefs.json");

function readPrefs() {
  try {
    if (fs.existsSync(PREFS_PATH)) return JSON.parse(fs.readFileSync(PREFS_PATH, "utf8"));
  } catch (_) {}
  return {};
}

function writePrefs(obj) {
  fs.mkdirSync(path.dirname(PREFS_PATH), { recursive: true });
  fs.writeFileSync(PREFS_PATH, JSON.stringify(obj));
}

app.get("/api/prefs", (req, res) => {
  res.json(readPrefs());
});

app.put("/api/prefs", express.json(), (req, res) => {
  const existing = readPrefs();
  const merged = { ...existing, ...req.body };
  writePrefs(merged);
  res.json(merged);
});

// Sign out: forget the LCR session and drop every cached report, so the next
// open starts from a clean sign-in and a fresh, full pull. Use this when a
// pull is misbehaving on a stale or half-broken session.
app.post("/api/logout", (req, res) => {
  // Signing out wipes the LCR session and every cached report for everyone,
  // so it is the owner's to do.
  if (!req.user.owner) return res.status(403).json({ error: "OWNER_ONLY" });
  if (busy) return res.status(409).json({ error: "BUSY", busy });
  clearSession();
  cache = null;
  for (const f of [CACHE_PATH, RETURNED_PATH, MEMBERS_PATH]) {
    try { fs.rmSync(f, { force: true }); } catch (_) {}
  }
  res.json({ ok: true });
});

// Build a styled .xlsx from the report the browser serialized (matching the
// on-screen view and the PDF design) and send it as a download. The client
// opens it in Google Sheets or Excel. No data is stored server-side.
app.post("/api/xlsx", express.json({ limit: "8mb" }), async (req, res) => {
  try {
    const buf = await buildWorkbook(req.body || {});
    const name = String((req.body && req.body.filename) || "report")
      .replace(/[^A-Za-z0-9 _-]+/g, "").trim().slice(0, 80) || "report";
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${name}.xlsx"`);
    res.send(Buffer.from(buf));
  } catch (err) {
    res.status(500).json({ error: "XLSX_FAILED", detail: err.message });
  }
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

app.listen(PORT, HOST, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n  Kalayaan Stewardship v${APP_VERSION} is running on ${HOST}:${PORT}`);
  console.log(`  Local:   ${url}`);
  if (HOST === "0.0.0.0") {
    const nets = require("os").networkInterfaces();
    for (const iface of Object.values(nets)) {
      for (const addr of iface) {
        if (addr.family === "IPv4" && !addr.internal) {
          console.log(`  Network: http://${addr.address}:${PORT}`);
        }
      }
    }
  }
  if (REMOTE) {
    console.log(`  Remote:  through the Cloudflare Tunnel, email login via ${REMOTE.team}`);
    console.log(`  Owners:  ${REMOTE.owners.length ? REMOTE.owners.join(", ") : "(none set — OWNER_EMAILS)"}`);
  }
  console.log(`\n  Access code: ${ACCESS_TOKEN}`);
  console.log(REMOTE ? "  For use on this computer.\n" : "  Enter this code when opening from another device.\n");
  if (!process.env.NO_OPEN) openBrowser(url);
});
