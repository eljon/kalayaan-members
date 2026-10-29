/**
 * Keeps a copy of the app and its latest data on this device, so it opens
 * with no connection — on a bus, in a chapel with no signal.
 *
 * Always the network first: when it answers, that is what you see, and the
 * copy is quietly updated. Only when it cannot be reached does the saved copy
 * stand in, marked with when it was saved so the page can say "offline —
 * from Tuesday" rather than pass old numbers off as current.
 *
 * What is never kept or replayed: anything that changes something (PUT,
 * POST), downloads, the LCR sign-in, and a Refresh — a Refresh that cannot
 * reach LCR has to say so, not show yesterday's copy.
 */

const CACHE = "kalayaan-v1";
const SHELL = ["./", "index.html", "app.js", "style.css", "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png"];
const DATA = /\/api\/(data|members|returned|prefs|state|whoami)$/;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {})))));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

// A response is worth keeping only if it is the real thing from this app:
// not a sign-in page Cloudflare redirected to, not a refusal.
const keepable = (res) => res && res.ok && res.type === "basic" && !res.redirected;

async function networkFirst(req, key) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (keepable(res)) {
      const copy = res.clone();
      const headers = new Headers(copy.headers);
      headers.set("x-saved-at", new Date().toISOString());
      cache.put(key, new Response(await copy.blob(), { status: copy.status, headers }));
      return res;
    }
    // Signed out of the email login, or the server refused: fall through to
    // the copy only for data, so the app still opens; pages go to the network
    // answer so the sign-in can happen.
    if (req.mode === "navigate") return res;
    throw new Error("not usable");
  } catch (_) {
    const hit = await cache.match(key);
    if (hit) {
      const headers = new Headers(hit.headers);
      headers.set("x-from-cache", hit.headers.get("x-saved-at") || "");
      return new Response(await hit.blob(), { status: 200, headers });
    }
    if (req.mode === "navigate") {
      const shell = await cache.match("index.html");
      if (shell) return shell;
    }
    return Response.error();
  }
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const p = url.pathname;

  if (p.startsWith("/api/")) {
    if (!DATA.test(p)) return;                       // downloads, sign-in, exports: network only
    if (url.searchParams.get("force") === "1") {
      // A Refresh. Never answered from the copy; but a fresh answer becomes
      // the copy the next offline visit uses.
      e.respondWith(fetch(req).then(async (res) => {
        if (keepable(res)) {
          const copy = res.clone();
          const headers = new Headers(copy.headers);
          headers.set("x-saved-at", new Date().toISOString());
          (await caches.open(CACHE)).put(url.origin + p, new Response(await copy.blob(), { status: 200, headers }));
        }
        return res;
      }));
      return;
    }
    e.respondWith(networkFirst(req, url.origin + p));
    return;
  }
  if (req.mode === "navigate") { e.respondWith(networkFirst(req, "index.html")); return; }
  if (/\.(js|css|svg|png|webmanifest)$/.test(p) && !/\/v\d+\//.test(p) && !p.endsWith("/sw.js")) {
    e.respondWith(networkFirst(req, url.origin + p));
  }
});
