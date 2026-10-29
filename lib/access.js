/**
 * Cloudflare Access: the front door when the app is reached from outside.
 *
 * Remote use goes through a Cloudflare Tunnel with Cloudflare Access in
 * front of it (see REMOTE.md). Access makes everybody sign in with an
 * approved email before any request reaches this machine, and stamps each
 * request it lets through with a signed token, `Cf-Access-Jwt-Assertion`.
 *
 * That header is checked here rather than trusted: a header is just text,
 * and anything else that can reach the port could write one. The token must
 * be signed by this Cloudflare team's own keys, issued by this team, meant
 * for this application (its AUD tag), and not expired. Only then is the
 * email inside it believed.
 *
 * Configuration (environment, or a `.env` file beside server.js):
 *   ACCESS_TEAM_DOMAIN   e.g. kalayaan.cloudflareaccess.com
 *   ACCESS_AUD           the application's AUD tag, from the Access dashboard
 *   OWNER_EMAILS         comma-separated; who may sign the app out of LCR
 *
 * With none of it set the app behaves exactly as before: access code only.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// A minimal .env reader — no dependency for six lines of KEY=value.
function loadDotEnv(dir) {
  const file = path.join(dir, ".env");
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch (_) { return; }
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith("#")) continue;
    const v = m[2].replace(/^(['"])(.*)\1$/, "$2");
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

function accessConfig(env = process.env) {
  const team = String(env.ACCESS_TEAM_DOMAIN || "").trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const aud = String(env.ACCESS_AUD || "").trim();
  if (!team || !aud) return null;
  const owners = String(env.OWNER_EMAILS || "")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return {
    team,
    aud,
    owners,
    issuer: `https://${team}`,
    // Overridable only so the test can serve keys from a local stand-in.
    certsUrl: env.ACCESS_CERTS_URL || `https://${team}/cdn-cgi/access/certs`,
  };
}

const b64urlJson = (s) => JSON.parse(Buffer.from(s, "base64url").toString("utf8"));

// Signing keys, fetched from the team and kept for an hour. A token signed
// with a key we have not seen triggers one early refetch — Cloudflare
// rotates keys — but no more, so a forged kid cannot make us hammer them.
function keyStore(cfg, fetchImpl = globalThis.fetch) {
  let keys = new Map(), fetchedAt = 0, lastForced = 0;
  async function load() {
    const res = await fetchImpl(cfg.certsUrl);
    if (!res.ok) throw new Error(`could not fetch Access signing keys (${res.status})`);
    const body = await res.json();
    const next = new Map();
    for (const jwk of body.keys || []) {
      if (jwk.kid && jwk.kty === "RSA") next.set(jwk.kid, crypto.createPublicKey({ key: jwk, format: "jwk" }));
    }
    keys = next; fetchedAt = Date.now();
  }
  return async function keyFor(kid) {
    if (!fetchedAt || Date.now() - fetchedAt > 60 * 60 * 1000) await load();
    if (!keys.has(kid) && Date.now() - lastForced > 5 * 60 * 1000) { lastForced = Date.now(); await load(); }
    return keys.get(kid) || null;
  };
}

/**
 * Verify a Cloudflare Access token. Resolves to { email } or throws with
 * the reason it was refused.
 */
async function verifyAccessToken(token, cfg, keyFor, now = Date.now()) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new Error("not a token");
  let header, claims;
  try { header = b64urlJson(parts[0]); claims = b64urlJson(parts[1]); } catch (_) { throw new Error("unreadable token"); }
  // Only RS256: refusing everything else is what stops "alg: none" and
  // algorithm-confusion forgeries.
  if (header.alg !== "RS256") throw new Error(`refused algorithm ${header.alg}`);
  const key = await keyFor(header.kid);
  if (!key) throw new Error("signed with a key this team does not hold");
  const ok = crypto.verify("RSA-SHA256", Buffer.from(parts[0] + "." + parts[1]), key, Buffer.from(parts[2], "base64url"));
  if (!ok) throw new Error("bad signature");
  const t = Math.floor(now / 1000);
  const skew = 60;
  if (typeof claims.exp !== "number" || claims.exp + skew < t) throw new Error("expired");
  if (typeof claims.nbf === "number" && claims.nbf - skew > t) throw new Error("not yet valid");
  if (claims.iss !== cfg.issuer) throw new Error("issued by another team");
  const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!auds.includes(cfg.aud)) throw new Error("meant for another application");
  const email = String(claims.email || "").toLowerCase();
  if (!email) throw new Error("no email in token");
  return { email };
}

module.exports = { loadDotEnv, accessConfig, keyStore, verifyAccessToken };
