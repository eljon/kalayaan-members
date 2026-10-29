/**
 * Signing in to LCR from inside the app (the cloud has no screen for a
 * sign-in window).
 *
 * Starts a copy of the app in cloud mode, pointed at a stand-in sign-in that
 * works the way LCR's does: username, then password, then a code "sent to
 * the phone", then a redirect back to the report with a session cookie. The
 * owner signs in purely by tapping the picture of the page and typing in the
 * app's box. Checks the session is kept where the cloud keeps it, that the
 * password never reaches a log, and that a leader who is not an owner is
 * refused.
 */

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");
const h = require("./harness");

const PASSWORD = "Correct-Horse-" + crypto.randomBytes(4).toString("hex");
const CODE = "482916";

// Each step is one big input and one big button at the top of the page, so
// the test knows where to tap: input centre y=60, button centre y=180, of 760.
const step = (title, name, type, action) => `<!doctype html><meta name="viewport" content="width=device-width">
<body style="margin:0;font:28px sans-serif"><form method="POST" action="${action}" style="margin:0">
<input name="${name}" type="${type}" style="display:block;box-sizing:border-box;width:100%;height:120px;font-size:28px">
<button style="display:block;width:100%;height:120px;font-size:28px">${title}</button></form></body>`;

function standIn() {
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const form = Object.fromEntries(new URLSearchParams(body));
      const go = (to, cookie) => { if (cookie) res.setHeader("set-cookie", cookie); res.writeHead(302, { location: to }); res.end(); };
      const page = (html) => { res.setHeader("content-type", "text/html"); res.end(html); };
      const u = req.url.split("?")[0];
      if (u === "/report") {
        if (/sid=ok/.test(req.headers.cookie || "")) return page("<h1>Class and quorum attendance</h1>");
        return go("/signin/user");
      }
      if (u === "/signin/user") return req.method === "POST" ? go("/signin/pass") : page(step("Next", "u", "text", "/signin/user"));
      if (u === "/signin/pass") {
        if (req.method === "POST") return form.p === PASSWORD ? go("/signin/code") : page(step("Wrong — Verify", "p", "password", "/signin/pass"));
        return page(step("Verify", "p", "password", "/signin/pass"));
      }
      if (u === "/signin/code") {
        if (req.method === "POST") return form.c === CODE ? go("/report", "sid=ok; Path=/") : page(step("Wrong code", "c", "text", "/signin/code"));
        return page(step("Verify code", "c", "text", "/signin/code"));
      }
      res.statusCode = 404; res.end();
    });
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r(server)));
}

(async () => {
  const why = h.blocked();
  if (why && /playwright/.test(why)) { console.log("SKIP lcr sign-in — " + why); process.exit(0); }
  const idp = await standIn();
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1" };
  const certs = http.createServer((q, r) => { r.setHeader("content-type", "application/json"); r.end(JSON.stringify({ keys: [jwk] })); });
  await new Promise((r) => certs.listen(0, "127.0.0.1", r));
  const tok = (email) => {
    const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const head = b({ alg: "RS256", kid: "k1" });
    const body = b({ iss: "https://ward.cloudflareaccess.com", aud: ["aud"], email, exp: Math.floor(Date.now() / 1000) + 3600 });
    return `${head}.${body}.${crypto.sign("RSA-SHA256", Buffer.from(`${head}.${body}`), privateKey).toString("base64url")}`;
  };

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "kalayaan-cloud-"));
  const port = 4900 + Math.floor(Math.random() * 90);
  let log = "";
  const srv = spawn(process.execPath, [path.join(h.ROOT, "server.js")], {
    env: { ...process.env, PORT: String(port), NO_OPEN: "1", HOST: "127.0.0.1", CLOUD: "1", DATA_DIR: dataDir, CHROMIUM_PATH: h.chromiumPath() || "",
      LCR_REPORT_URL: `http://127.0.0.1:${idp.address().port}/report`,
      ACCESS_TEAM_DOMAIN: "ward.cloudflareaccess.com", ACCESS_AUD: "aud", OWNER_EMAILS: "owner@example.com",
      ACCESS_CERTS_URL: `http://127.0.0.1:${certs.address().port}/` },
  });
  srv.stdout.on("data", (d) => (log += d)); srv.stderr.on("data", (d) => (log += d));

  const { chromium } = require("playwright");
  const exe = h.chromiumPath();
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  let failed = 0;
  const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) failed += 1; };
  try {
    for (let i = 0; i < 40; i++) {
      const up = await new Promise((r) => http.get({ host: "127.0.0.1", port, path: "/healthz" }, (x) => { x.resume(); r(true); }).on("error", () => r(false)));
      if (up) break; await new Promise((r) => setTimeout(r, 250));
    }
    const base = `http://127.0.0.1:${port}`;

    // A leader who is not an owner cannot start one.
    const leader = await new Promise((r) => {
      const q = http.request(`${base}/api/login-relay/start`, { method: "POST", headers: { "cf-access-jwt-assertion": tok("leader@example.com") } },
        (x) => { x.resume(); r(x.statusCode); });
      q.end();
    });
    ok(leader === 403, "a leader who is not an owner cannot start an LCR sign-in");

    const ctx = await browser.newContext({ extraHTTPHeaders: { "cf-access-jwt-assertion": tok("owner@example.com") } });
    const page = await ctx.newPage();
    await page.goto(base + "/", { waitUntil: "networkidle" });
    await page.waitForSelector("#curtain:not([hidden])", { timeout: 20000 });
    ok((await page.textContent("#curtain")).includes("opens here, inside the app"), "with no LCR session, the owner is offered the in-app sign-in");
    await page.click("#curtain button, #curtain .btn");
    await page.waitForSelector("#lcr-modal:not([hidden])");
    await page.waitForFunction(() => { const i = document.getElementById("lcr-frame"); return i && i.naturalWidth > 0; }, null, { timeout: 30000 });
    ok(true, "the sign-in page appears as a picture inside the app");

    const tapInput = () => page.click("#lcr-frame", { position: { x: 0, y: 0 } }).catch(() => {}).then(async () => {
      const box = await page.$eval("#lcr-frame", (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
      await page.mouse.click(box.x + box.w * 0.5, box.y + box.h * (60 / 760));
    });
    const send = async (text) => { await page.fill("#lcr-text", text); await page.click("#lcr-type button"); await page.waitForTimeout(500); };
    const press = async (key) => { await page.click(`#lcr-modal [data-key="${key}"]`); await page.waitForTimeout(1200); };

    await tapInput(); await send("owner"); await press("Enter");           // username
    await tapInput(); await send(PASSWORD); await press("Enter");          // password
    await tapInput(); await send(CODE); await press("Enter");              // the code from the phone

    await page.waitForSelector("#lcr-modal[hidden]", { state: "attached", timeout: 30000 });
    const sessionFile = path.join(dataDir, "lcr-session.json");
    ok(fs.existsSync(sessionFile), "after the code, the session is kept in the cloud data folder");
    const saved = fs.existsSync(sessionFile) ? JSON.parse(fs.readFileSync(sessionFile, "utf8")) : {};
    ok((saved.cookies || []).some((c) => c.name === "sid" && c.value === "ok"), "and it is the signed-in session");
    ok(!log.includes(PASSWORD), "the password never reaches a log");
    ok(!fs.readFileSync(sessionFile, "utf8").includes(PASSWORD), "nor the saved session");
    await ctx.close();
  } finally {
    await browser.close(); srv.kill(); idp.close(); certs.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  console.log(failed ? `\n${failed} FAILED in lcr sign-in` : "\nALL PASSED — lcr sign-in");
  process.exit(failed ? 1 : 0);
})();
