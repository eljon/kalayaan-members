/**
 * REPAIR — Refresh the month-switch action id.
 *
 * Switching months is a Next.js server action: a POST to the report route
 * carrying a `next-action` id (a hash) and a body of [unitNumber, "MM",
 * "eng"]. The id changes when LCR redeploys. If multi-month pulls start
 * failing, come here.
 *
 * Paste this on the report page, change the date range ONCE, and copy the
 * JSON that prints. Put the `next-action` value into lib/capture.js
 * (MONTH_ACTION_ID) or set the LCR_MONTH_ACTION env var. The state tree is
 * captured live by the pull, so you do not need to copy it.
 *
 * Your auth cookie is not in this output; the browser sends it separately.
 */

(() => {
  const ROUTE = "class-and-quorum-attendance";
  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const req = args[0];
    const init = args[1] || (req && typeof req === "object" ? req : {});
    const url = (req && req.url) || req + "";
    const method = (init.method || "GET").toUpperCase();
    if (String(url).includes(ROUTE) && method === "POST") {
      const headers = {};
      try {
        new Headers(init.headers || {}).forEach((v, k) => (headers[k] = v));
      } catch (_) {}
      let body = init.body;
      try {
        body = typeof body === "string" ? body : String(body);
      } catch (_) {}
      window.__post = { url: String(url), method, headers, body };
      console.log("%cMONTH POST captured", "color:lime;font-weight:bold");
      console.log(JSON.stringify(window.__post, null, 2));
    }
    return origFetch.apply(this, args);
  };
  console.log(
    "%cArmed.",
    "color:lime;font-weight:bold",
    "Change the date range ONCE, then copy the JSON block. The next-action value is what to update."
  );
})();
