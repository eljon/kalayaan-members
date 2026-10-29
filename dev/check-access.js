#!/usr/bin/env node
/**
 * The remote front door refuses everything it should.
 *
 *   node dev/check-access.js
 *
 * Reached from outside, the app believes an email only on the strength of
 * a Cloudflare Access token (lib/access.js). This signs real tokens with a
 * throwaway key served from a stand-in for Cloudflare, then checks a good
 * one passes and every way of faking one does not: wrong key, tampered
 * claims, expired, another team, another application, "alg: none", no
 * email. Then it starts the real server with Access configured and checks
 * the same at the HTTP layer, including that LCR sign-in and sign-out are
 * refused to remote users who may not do them.
 */

const crypto = require("crypto");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");
const { accessConfig, keyStore, verifyAccessToken } = require("../lib/access");

const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); };

const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const other = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
function sign(claims, { key = privateKey, kid = "k1", alg = "RS256" } = {}) {
  const head = b64({ alg, kid, typ: "JWT" });
  const body = b64(claims);
  if (alg === "none") return `${head}.${body}.`;
  const sig = crypto.sign("RSA-SHA256", Buffer.from(`${head}.${body}`), key).toString("base64url");
  return `${head}.${body}.${sig}`;
}

(async () => {
  const certs = http.createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise((r) => certs.listen(0, "127.0.0.1", r));
  const env = {
    ACCESS_TEAM_DOMAIN: "kalayaan.cloudflareaccess.com",
    ACCESS_AUD: "aud-for-this-app",
    OWNER_EMAILS: "Owner@Example.com",
    ACCESS_CERTS_URL: `http://127.0.0.1:${certs.address().port}/certs`,
  };
  const cfg = accessConfig(env);
  const keys = keyStore(cfg);
  const now = Math.floor(Date.now() / 1000);
  const good = { iss: "https://kalayaan.cloudflareaccess.com", aud: ["aud-for-this-app"], email: "Leader@Example.com", exp: now + 600, iat: now };

  ok(accessConfig({}) === null, "with nothing configured, remote mode stays off");
  ok(cfg.owners[0] === "owner@example.com", "owner emails are compared case-insensitively");

  const v = await verifyAccessToken(sign(good), cfg, keys).catch((e) => ({ err: e.message }));
  ok(v.email === "leader@example.com", `a genuine token is accepted (${JSON.stringify(v)})`);

  const refused = async (name, token) => {
    const r = await verifyAccessToken(token, cfg, keys).then(() => null, (e) => e.message);
    ok(!!r, `${name} must be refused`);
  };
  const [h, , s] = sign(good).split(".");
  await refused("a token signed with another key", sign(good, { key: other.privateKey }));
  await refused("a token whose claims were edited", `${h}.${b64({ ...good, email: "owner@example.com" })}.${s}`);
  await refused("an expired token", sign({ ...good, exp: now - 3600 }));
  await refused("a token from another Cloudflare team", sign({ ...good, iss: "https://evil.cloudflareaccess.com" }));
  await refused("a token for another application", sign({ ...good, aud: ["someone-else"] }));
  await refused('an "alg: none" token', sign(good, { alg: "none" }));
  await refused("a token with an unknown key id", sign(good, { kid: "nope" }));
  await refused("a token with no email", sign({ ...good, email: "" }));
  await refused("rubbish", "not.a.jwt");

  // ---- the real server, with Access on --------------------------------------
  const port = 4300 + Math.floor(Math.random() * 500);
  const srv = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    env: { ...process.env, ...env, PORT: String(port), NO_OPEN: "1", HOST: "127.0.0.1" },
    stdio: ["ignore", "ignore", "ignore"],
  });
  const get = (p, headers = {}, method = "GET") => new Promise((res) => {
    const req = http.request({ host: "127.0.0.1", port, path: p, method, headers }, (r) => {
      let b = ""; r.on("data", (c) => (b += c)); r.on("end", () => res({ status: r.statusCode, body: b }));
    });
    req.on("error", () => res({ status: 0, body: "" }));
    req.end();
  });
  for (let i = 0; i < 40; i++) { if ((await get("/api/whoami")).status) break; await new Promise((r) => setTimeout(r, 250)); }
  try {
    const leader = { "cf-access-jwt-assertion": sign(good) };
    const owner = { "cf-access-jwt-assertion": sign({ ...good, email: "owner@example.com" }) };
    ok((await get("/api/whoami")).status === 401, "no token and no access code: locked");
    ok((await get("/api/whoami", { "cf-access-jwt-assertion": sign(good, { key: other.privateKey }) })).status === 401,
      "a forged token over HTTP: locked");
    const w = await get("/api/whoami", leader);
    let who = {}; try { who = JSON.parse(w.body); } catch (_) {}
    ok(w.status === 200 && who.email === "leader@example.com" && who.canSignIn === false && who.owner === false,
      `an approved leader gets in, as themselves, without LCR sign-in rights (${w.body})`);
    ok((await get("/api/login", leader, "POST")).status === 403, "a remote leader cannot start an LCR sign-in");
    ok((await get("/api/logout", leader, "POST")).status === 403, "a remote leader cannot sign the app out");
    const ow = JSON.parse((await get("/api/whoami", owner)).body || "{}");
    ok(ow.owner === true && ow.signIn === "relay",
      `a remote owner signs in to LCR inside the app, not in a window on the host (${ow.signIn})`);
  } finally {
    srv.kill();
  }

  // ---- the cloud: the email login is the only way in -------------------------
  const cport = port + 1;
  const csrv = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    env: { ...process.env, ...env, PORT: String(cport), NO_OPEN: "1", HOST: "127.0.0.1", CLOUD: "1" },
    stdio: ["ignore", "ignore", "ignore"],
  });
  const cget = (p, headers = {}, method = "GET") => new Promise((res) => {
    const req = http.request({ host: "127.0.0.1", port: cport, path: p, method, headers }, (r) => {
      let b = ""; r.on("data", (c) => (b += c)); r.on("end", () => res({ status: r.statusCode, body: b }));
    });
    req.on("error", () => res({ status: 0, body: "" }));
    req.end();
  });
  for (let i = 0; i < 40; i++) { if ((await cget("/healthz")).status) break; await new Promise((r) => setTimeout(r, 250)); }
  try {
    const fs = require("fs");
    const { OUTPUT_DIR } = require("../lib/paths");
    const code = fs.readFileSync(path.join(OUTPUT_DIR, ".access-token"), "utf8").trim();
    ok((await cget("/healthz")).status === 200, "cloud: the health check answers without a login");
    ok((await cget("/api/whoami", { cookie: "access_token=" + code })).status === 401,
      "cloud: the access code from the server log does not open the app");
    ok((await cget("/api/auth", {}, "POST")).status === 403, "cloud: the access-code form is switched off");
    const lw = JSON.parse((await cget("/api/whoami", { "cf-access-jwt-assertion": sign(good) })).body || "{}");
    ok(lw.email === "leader@example.com" && lw.signIn === "none", "cloud: an approved leader gets in, without LCR sign-in");
    const ow2 = JSON.parse((await cget("/api/whoami", { "cf-access-jwt-assertion": sign({ ...good, email: "owner@example.com" }) })).body || "{}");
    ok(ow2.owner === true && ow2.signIn === "relay", "cloud: the owner signs in to LCR inside the app");
  } finally {
    csrv.kill();
    certs.close();
  }

  if (fails.length) {
    console.error("FAILED\n" + fails.map((f) => "  " + f).join("\n"));
    process.exit(1);
  }
  console.log("Remote-access checks passed.");
  console.log("  genuine Access tokens get in; forged, expired and misdirected ones do not.");
})();
