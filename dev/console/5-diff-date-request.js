/**
 * STEP 5 — Find the parameter that selects the month.
 *
 * The report shows one month at a time. To pull history we need to know
 * exactly what changes in the request when the date range changes. This
 * captures every request to the report route and, from the second one on,
 * prints precisely what differs between the last two: query parameters,
 * the RSC router headers, the path, and any POST body.
 *
 * Use it:
 *   1. Open the report, signed in.
 *   2. Paste this into the console.
 *   3. Change the date range in the UI ONCE.
 *   4. Read the "what changed" block. That is the parameter to loop over.
 *
 * Do not guess the parameter. This prints it. If nothing prints in the
 * diff, the month is not travelling in the URL/headers/body this captures
 * (unlikely, but then inspect window.__reqs by hand).
 *
 * Edit ROUTE for a different report.
 */

(() => {
  const ROUTE = "class-and-quorum-attendance";

  // RSC encodes navigation state in these; a date change may live here
  // rather than in the query string.
  const HEADERS_OF_INTEREST = [
    "rsc",
    "next-router-state-tree",
    "next-router-prefetch",
    "next-url",
  ];

  const seen = [];

  const snap = (url, init) => {
    const u = new URL(url, location.origin);
    const h = new Headers((init && init.headers) || {});
    const headers = {};
    for (const k of HEADERS_OF_INTEREST) if (h.has(k)) headers[k] = h.get(k);
    let body = null;
    if (init && init.body != null) {
      try {
        body = typeof init.body === "string" ? init.body : String(init.body);
      } catch (_) {}
    }
    return {
      url: u.href,
      path: u.pathname,
      query: Object.fromEntries(u.searchParams),
      method: ((init && init.method) || "GET").toUpperCase(),
      headers,
      body: body ? body.slice(0, 4000) : null,
    };
  };

  const diff = (a, b) => {
    const out = [];
    if (a.path !== b.path) out.push(`  path: ${a.path} -> ${b.path}`);
    const qk = new Set([...Object.keys(a.query), ...Object.keys(b.query)]);
    for (const k of qk)
      if (a.query[k] !== b.query[k])
        out.push(
          `  query.${k}: ${JSON.stringify(a.query[k])} -> ${JSON.stringify(b.query[k])}`
        );
    const hk = new Set([...Object.keys(a.headers), ...Object.keys(b.headers)]);
    for (const k of hk)
      if (a.headers[k] !== b.headers[k])
        out.push(
          `  header.${k}: ${JSON.stringify(a.headers[k])} -> ${JSON.stringify(b.headers[k])}`
        );
    if (a.body !== b.body)
      out.push(`  body: ${JSON.stringify(a.body)} -> ${JSON.stringify(b.body)}`);
    return out;
  };

  const record = (s) => {
    seen.push(s);
    console.log(`%ccaptured #${seen.length}`, "color:lime", s.method, s.url);
    if (seen.length >= 2) {
      const d = diff(seen[seen.length - 2], seen[seen.length - 1]);
      console.log(
        "%cwhat changed between the last two report requests:",
        "color:orange;font-weight:bold"
      );
      console.log(
        d.length
          ? d.join("\n")
          : "  (nothing in path/query/headers/body — inspect window.__reqs directly)"
      );
    }
  };

  const asInit = (args) => {
    if (args[1]) return args[1];
    // fetch(Request) — pull method/headers/body off the Request itself.
    const r = args[0];
    if (r && typeof r === "object" && "method" in r) return r;
    return {};
  };

  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const url = (args[0] && args[0].url) || args[0] + "";
    if (String(url).includes(ROUTE)) record(snap(String(url), asInit(args)));
    return origFetch.apply(this, args);
  };

  window.__reqs = seen;
  console.log(
    "%cArmed.",
    "color:lime;font-weight:bold",
    "Change the date range in the UI ONCE. The changed parameter prints below. Full log in window.__reqs."
  );
})();
