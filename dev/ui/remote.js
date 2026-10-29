/**
 * What a leader sees when they open the app through the shareable link.
 *
 * Starts a second copy of the app with remote access (Cloudflare Access)
 * configured, signs a token the way Cloudflare would, and opens the app
 * with it — as somebody arriving through the tunnel. They must get in
 * without the access code, see who they are signed in as, and — because
 * signing in to LCR opens a window on the computer running the app — be
 * told to ask the owner rather than offered a sign-in they cannot finish.
 */

const crypto = require("crypto");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");
const h = require("./harness");

(async () => {
  const why = h.blocked();
  if (why) { console.log("SKIP remote — " + why); process.exit(0); }
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1" };
  const certs = http.createServer((q, r) => { r.setHeader("content-type", "application/json"); r.end(JSON.stringify({ keys: [jwk] })); });
  await new Promise((r) => certs.listen(0, "127.0.0.1", r));
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: "RS256", kid: "k1" });
  const body = b64({ iss: "https://ward.cloudflareaccess.com", aud: ["app-aud"], email: "leader@example.com", exp: now + 3600 });
  const jwt = `${head}.${body}.${crypto.sign("RSA-SHA256", Buffer.from(`${head}.${body}`), privateKey).toString("base64url")}`;

  const port = 4800 + Math.floor(Math.random() * 100);
  const srv = spawn(process.execPath, [path.join(h.ROOT, "server.js")], {
    env: { ...process.env, PORT: String(port), NO_OPEN: "1", HOST: "127.0.0.1",
      ACCESS_TEAM_DOMAIN: "ward.cloudflareaccess.com", ACCESS_AUD: "app-aud",
      ACCESS_CERTS_URL: `http://127.0.0.1:${certs.address().port}/` },
    stdio: "ignore",
  });
  const { chromium } = require("playwright");
  const exe = h.chromiumPath();
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  let failed = 0;
  const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) failed += 1; };
  try {
    for (let i = 0; i < 40; i++) {
      const up = await new Promise((r) => http.get({ host: "127.0.0.1", port, path: "/" }, (x) => { x.resume(); r(true); }).on("error", () => r(false)));
      if (up) break; await new Promise((r) => setTimeout(r, 250));
    }
    const ctx = await browser.newContext({ extraHTTPHeaders: { "cf-access-jwt-assertion": jwt } });
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
    ok(!(await page.$("form[action='/api/auth']")), "no access-code page for a signed-in leader");
    await page.waitForSelector("#roll-body .roll-row", { timeout: 30000 });
    ok(true, "the roll loads");
    await page.click("#settings-btn");
    await page.waitForTimeout(300);
    ok((await page.textContent("#set-who")).includes("leader@example.com"), "Settings says who they are signed in as");
    ok(await page.isHidden("#set-signout-row"), "and does not offer Sign out to somebody who is not the owner");
    await page.keyboard.press("Escape");
    // This copy has no LCR session, so Refresh finds the app signed out.
    await page.click("#refresh");
    await page.waitForSelector("#curtain:not([hidden])", { timeout: 30000 });
    const said = await page.textContent("#curtain");
    ok(/computer the app runs on/.test(said), "a lapsed LCR sign-in tells them to ask the owner");
    ok(!/Open the sign-in window/.test(said), "rather than offering a sign-in window they could never see");

    const anon = await browser.newPage();
    await anon.goto(`http://127.0.0.1:${port}/`);
    ok(!!(await anon.$("form[action='/api/auth']")), "without a token, the door stays shut");
    await ctx.close(); await anon.close();
  } finally {
    await browser.close(); srv.kill(); certs.close();
  }
  console.log(failed ? `\n${failed} FAILED in remote` : "\nALL PASSED — remote");
  process.exit(failed ? 1 : 0);
})();
