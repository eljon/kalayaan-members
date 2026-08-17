/**
 * DISCOVERY — How a custom report delivers its data.
 *
 * For the Returned Missionaries report (a create-a-report custom report),
 * or any other custom report. Its data delivery is NOT assumed to match
 * the attendance report — observe it, do not guess.
 *
 * Use it:
 *   1. Open the custom report, signed in.
 *   2. Paste this into the console.
 *   3. RELOAD the page (custom reports usually fetch on load).
 *   4. Copy back the STRUCTURE block it prints.
 *
 * Privacy: this prints the shape only — endpoint, whether it is a GET or a
 * POST server action, the field NAMES, and value TYPES. It masks every
 * string value (names, temple-recommend status) as "•••", so the output
 * is safe to paste. Your auth cookie is never in it.
 *
 * Edit ROUTE if the report's URL segment differs.
 */

(() => {
  const ROUTE = "custom-reports-details";

  // Recursively describe a value: field names and types, never values.
  const describe = (v, depth = 0) => {
    if (depth > 4) return "…";
    if (Array.isArray(v)) {
      return v.length ? [`Array(${v.length}) of`, describe(v[0], depth + 1)] : "Array(0)";
    }
    if (v && typeof v === "object") {
      const o = {};
      for (const k of Object.keys(v)) o[k] = describe(v[k], depth + 1);
      return o;
    }
    if (typeof v === "string") return "string";
    if (typeof v === "number") return "number";
    if (typeof v === "boolean") return "boolean";
    if (v === null) return "null";
    return typeof v;
  };

  const report = (label, url, method, obj) => {
    console.log(`%c${label}`, "color:lime;font-weight:bold", method, url);
    console.log("STRUCTURE (field names + types, values masked):");
    console.log(JSON.stringify(describe(obj), null, 2));
    window.__report = obj; // full object stays local for your own inspection
  };

  // Try to pull a JSON data object out of a response body: either straight
  // JSON, or a React flight payload where one line parses as JSON.
  const findData = (body) => {
    try { return JSON.parse(body); } catch (_) {}
    const lines = body.split(/\n(?=[0-9a-f]+:)/);
    for (const l of lines) {
      const i = l.indexOf(":");
      if (i < 0) continue;
      try {
        const d = JSON.parse(l.slice(i + 1));
        if (d && typeof d === "object") return d;
      } catch (_) {}
    }
    return null;
  };

  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const req = args[0];
    const init = args[1] || (req && typeof req === "object" ? req : {});
    const url = (req && req.url) || req + "";
    const method = (init.method || "GET").toUpperCase();
    const res = await origFetch.apply(this, args);
    if (String(url).includes(ROUTE)) {
      res.clone().text().then((body) => {
        const data = findData(body);
        if (data) report("CUSTOM REPORT captured", String(url), method, data);
        else console.log("%ccaptured (no JSON found)", "color:orange", method, String(url), body.length + " chars");
      }).catch(() => {});
    }
    return res;
  };

  console.log(
    "%cArmed.",
    "color:lime;font-weight:bold",
    "Now RELOAD the page. The report's endpoint and field structure print below (values masked)."
  );
})();
