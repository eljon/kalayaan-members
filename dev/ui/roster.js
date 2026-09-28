/**
 * Anyone on the attendance roll who is not in the membership records has left
 * the ward: their name must not appear anywhere, and the counts, the graph
 * and the reconciliation notice all have to follow.
 *
 * The expected numbers are worked out here from the two data files rather
 * than hardcoded, so this keeps holding when the fixture changes.
 */

const fs = require("fs");
const path = require("path");
const h = require("./harness");

const att = JSON.parse(fs.readFileSync(path.join(h.ROOT, "output", "latest.json"), "utf8"));
const mem = JSON.parse(fs.readFileSync(path.join(h.ROOT, "output", "members.json"), "utf8"));

// nameKey() from public/app.js — the key the two reports are joined on.
const nk = (s) => String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/[.,\-]/g, " ").replace(/[‘’'`\-]/g, "")
  .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, " ").replace(/\s+/g, " ").trim();

const keys = new Set(mem.records.map((r) => nk(r.preferred_name)));
const roster = att.rows.filter((r) => keys.has(nk(r.nameSort)) || keys.has(nk(r.name)));
const gone = att.rows.filter((r) => !keys.has(nk(r.nameSort)) && !keys.has(nk(r.name)));
const ROSTER = roster.length, GONE = gone.length;

const cells = (r) => String(r.cells || "").split(",").map((x) => x === "true");
const presentIn = (rows) => (att.weekOptions || []).map((_, i) => rows.filter((r) => cells(r)[i]).length);

h.seed();
h.run("ward roster", async (page, t) => {
  await page.waitForTimeout(2500);        // members load in the background, then repaint

  // --- the roll lists only the roster ---
  const rollNames = await page.$$eval("#roll-body .roll-row .r-name", (n) => n.map((e) => e.textContent.trim()));
  t.eq(rollNames.length, ROSTER, `roll shows the roster, not all ${att.rows.length} rows`);
  const leaked = rollNames.filter((n) => !keys.has(nk(n)));
  t.ok(leaked.length === 0,
    `nobody who left is listed${leaked.length ? ": " + JSON.stringify(leaked.slice(0, 3)) : ""}`);
  const sample = gone.slice(0, 5).map((r) => r.name);
  t.ok(sample.every((n) => !rollNames.includes(n)), "spot-check of five who left: absent from the roll");

  // --- and their names are nowhere on the page at all ---
  const body = await page.evaluate(() => document.body.innerText);
  const seen = sample.filter((n) => body.includes(n));
  t.ok(seen.length === 0, `none of their names appear anywhere on the page${seen.length ? ": " + JSON.stringify(seen) : ""}`);

  // --- the counts follow ---
  const count = (await page.textContent("#att-count")).trim();
  t.ok(count.includes(String(ROSTER)), `the roll count says ${ROSTER} ("${count}")`);
  const legend = await page.$$eval("#att-stats .stat-item", (n) => n.map((e) => ({
    label: (e.querySelector(".stat-label") || {}).textContent || "",
    n: +((e.querySelector(".stat-count") || {}).textContent || "0"),
  })));
  const stat = (l) => { const x = legend.find((v) => v.label.startsWith(l)); return x ? x.n : null; };
  t.eq(stat("Seen") + stat("Not seen"), ROSTER, `Seen + Not seen (${stat("Seen")} + ${stat("Not seen")})`);

  // --- the graph plots the roster, not everyone who ever attended ---
  // The numbers drawn on it are axis ticks plus point labels, so the largest
  // should sit just above the roster's peak, nowhere near the peak you get
  // from counting everybody who was ever on the roll.
  const drawn = await page.$$eval("#graph .graph-svg text",
    (n) => n.map((e) => +e.textContent).filter((v) => !isNaN(v)));
  const top = Math.max(...drawn);
  const rosterPeak = Math.max(...presentIn(roster));
  const allPeak = Math.max(...presentIn(att.rows));
  t.ok(top >= rosterPeak && top < allPeak / 2,
    `graph is scaled to the roster's peak of ${rosterPeak}, not everyone's ${allPeak} (axis tops out at ${top})`);

  // --- the notice counts them but does not name them ---
  await h.goTab(page, "members");
  const recon = (await page.textContent("#mem-recon").catch(() => "")) || "";
  t.ok(recon.includes(String(GONE)),
    `the notice reports ${GONE} dropped (${JSON.stringify(recon.trim().slice(0, 110))})`);
  t.ok(sample.every((n) => !recon.includes(n)), "and does not name a single one of them");
});
