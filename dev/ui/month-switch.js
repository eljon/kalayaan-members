/**
 * Switching months must survive LCR changing what it accepts.
 *
 * The attendance pull reads earlier months by replaying the page's own
 * month-switch server action. LCR has broken that twice: once by rotating
 * the action id (HTTP 404), later by answering every month HTTP 409. This
 * runs lib/capture.js monthSwitcher() against a stand-in server that only
 * accepts the request the live page itself would make — current action id,
 * a deployment header, and same-origin — and answers 409 otherwise, the way
 * LCR did. The switcher must learn the request from the page and read every
 * month. A server that has truly changed must still be reported, not hidden.
 *
 * Needs no LCR and no app server.
 */

const http = require("http");
const h = require("./harness");
const { monthSwitcher } = require("../../lib/capture");

const ROUTE = "class-and-quorum-attendance";
const FRESH = "fresh0123456789abcdef";
const DEPLOY = "dpl_2026_10";

function stand(opts = {}) {
  const posts = [];
  const server = http.createServer((req, res) => {
    if (req.method === "GET") {
      res.setHeader("content-type", "text/html");
      // The page's month picker fires the real action with the real headers.
      return res.end(`<!doctype html><select id="m"><option>10</option><option>09</option></select>
        <script>
          document.getElementById("m").addEventListener("change", () => fetch(location.pathname, {
            method: "POST",
            headers: { "next-action": "${opts.pageId || FRESH}", "x-deployment-id": "${DEPLOY}",
                       "next-router-state-tree": "%5B%22tree%22%5D", "content-type": "text/plain;charset=UTF-8" },
            body: '[1,"' + document.getElementById("m").value + '","eng"]' }));
        </script>`);
    }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      posts.push({ id: req.headers["next-action"], origin: req.headers.origin, deploy: req.headers["x-deployment-id"] });
      const ok = !opts.broken && req.headers["next-action"] === FRESH &&
        req.headers["x-deployment-id"] === DEPLOY && !!req.headers.origin;
      if (!ok) { res.statusCode = 409; return res.end("conflict"); }
      const month = (/"(\d\d)"/.exec(body) || [])[1];
      res.setHeader("content-type", "text/x-component");
      res.end(`0:{"weekOptions":[{"date":"2026-${month}-07"}],"members":[]}`);
    });
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r({ server, posts, port: server.address().port })));
}

(async () => {
  const why = h.blocked();
  if (why && /playwright/.test(why)) { console.log("SKIP month switch — " + why); process.exit(0); }
  const { chromium } = require("playwright");
  const exe = h.chromiumPath();
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  let failed = 0;
  const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) failed += 1; };
  // Keep the real lcr-action.json out of it.
  process.env.LCR_MONTH_ACTION = "stale9999";
  try {
    // ---- a stale request is rejected with 409, and recovered from ----------
    {
      const { server, posts, port } = await stand();
      const page = await browser.newPage();
      const url = `http://127.0.0.1:${port}/mlt/report/${ROUTE}`;
      await page.goto(url);
      const sw = monthSwitcher(page, { url, route: ROUTE, unitNumber: 1, anchorMonth: "10" });
      const got = [];
      for (const m of ["04", "05", "06", "07", "08", "09"]) {
        try { got.push((/2026-(\d\d)/.exec(await sw.post(m)) || [])[1]); } catch (e) { got.push("ERR " + e.message); }
      }
      sw.stop();
      ok(posts[0].id === "stale9999", "the first request uses the remembered id");
      ok(got.join(",") === "04,05,06,07,08,09", `every month read after a 409 (${got.join(",")})`);
      const after = posts.slice(1).filter((p) => p.id === FRESH);
      ok(after.length >= 6 && after.every((p) => p.deploy === DEPLOY && p.origin),
        "the page's own action id, deployment header and origin are what is sent");
      await page.close(); server.close();
    }

    // ---- a server that has really changed is reported, not hidden ----------
    {
      const { server, port } = await stand({ broken: true });
      const page = await browser.newPage();
      const url = `http://127.0.0.1:${port}/mlt/report/${ROUTE}`;
      await page.goto(url);
      const sw = monthSwitcher(page, { url, route: ROUTE, unitNumber: 1, anchorMonth: "10" });
      let err = null;
      try { await sw.post("09"); } catch (e) { err = e.message; }
      sw.stop();
      ok(!!err && /HTTP 409/.test(err) && /could not be learned/.test(err),
        `an unrecoverable rejection still says so (${err})`);
      await page.close(); server.close();
    }
  } finally {
    await browser.close();
  }
  console.log(failed ? `\n${failed} FAILED in month switch` : "\nALL PASSED — month switch");
  process.exit(failed ? 1 : 0);
})();
