/**
 * STEP 1 — Find which request carries the data.
 *
 * Paste into the browser console on the LCR report page, then CHANGE A
 * DROPDOWN or the date range. The initial page load often does not carry
 * the payload; an interaction does.
 *
 * Anything whose response contains attendance-shaped text logs a HIT with
 * its URL. That URL is the endpoint.
 *
 * For a different report, edit MATCH to text you expect to see in it.
 */

(() => {
  const MATCH = /Elders Quorum|Relief Society|attendance|didAttend/i;

  const hits = [];
  const record = (url, body) => {
    if (!MATCH.test(body)) return;
    hits.push(url);
    console.log("%cHIT", "color:lime;font-weight:bold", url, body.slice(0, 200));
  };

  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await origFetch.apply(this, args);
    const url = (args[0]?.url || args[0]) + "";
    res.clone().text().then((b) => record(url, b)).catch(() => {});
    return res;
  };

  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.addEventListener("load", () => record(url, this.responseText || ""));
    return origOpen.apply(this, arguments);
  };

  window.__hits = hits;
  console.log(
    "%cArmed.",
    "color:lime;font-weight:bold",
    "Now change a dropdown or the date range. URLs that carry data will log as HIT."
  );
  console.log("Collected URLs are in window.__hits");
})();
