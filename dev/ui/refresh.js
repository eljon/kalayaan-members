/**
 * One "Refresh from LCR" repaints every view, not just the tab in front of
 * you — and does not throw away the report somebody has open.
 *
 * The pull itself is stubbed: the API is answered with a deliberately shorter
 * roll and member list, so "did this view repaint" is a question with a hard
 * numeric answer rather than a judgement about whether anything looks newer.
 */

const fs = require("fs");
const path = require("path");
const h = require("./harness");

const roll = JSON.parse(fs.readFileSync(path.join(h.ROOT, "output", "latest.json"), "utf8"));
const mem = JSON.parse(fs.readFileSync(path.join(h.ROOT, "output", "members.json"), "utf8"));
// A pull "made" at a distinctive time, so the stamp can be checked against it.
const PULLED = "2026-10-08T14:37:00.000Z";
const roll2 = { ...roll, rows: roll.rows.slice(0, roll.rows.length - 30), fetchedAt: PULLED };
const mem2 = { ...mem, records: mem.records.slice(0, mem.records.length - 20), fetchedAt: PULLED, sample: false };
const WANT_MEM = mem2.records.length;

// The roll lists the roster — roll rows still in the membership records — so
// the expected count is the intersection, not the raw row count.
const nk = (s) => String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/[.,\-]/g, " ").replace(/[‘’'`\-]/g, "")
  .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, " ").replace(/\s+/g, " ").trim();
const keys2 = new Set(mem2.records.map((r) => nk(r.preferred_name)));
const WANT_ROLL = roll2.rows.filter((r) => keys2.has(nk(r.nameSort)) || keys2.has(nk(r.name))).length;

const counts = (page) => page.evaluate(() => ({
  rollRows: document.querySelectorAll("#roll-body .roll-row").length,
  memRows: document.querySelectorAll("#mem-table tbody tr").length,
  crRows: document.querySelectorAll("#cr-table tbody tr").length,
  alRows: document.querySelectorAll("#al-table tbody tr").length,
  qiTotal: (() => {
    const tr = [...document.querySelectorAll("#qi-table tbody tr")]
      .find((x) => (x.querySelector(".qi-name") || {}).textContent === "Total members");
    return tr ? +tr.children[2].textContent.trim() : null;
  })(),
}));

let refreshed = false;
const pulls = [];
let membersBusyOnce = true;   // the first forced members pull finds the server busy

h.seed();
h.run("refresh repaints everything", async (page, t) => {
  page.on("dialog", (d) => d.accept());

  // Visit every tab, so each one has something painted to go stale.
  for (const tab of ["members", "custom", "actions", "quarterly"]) {
    await page.click(`.tab[data-tab="${tab}"]`);
    await page.waitForTimeout(1100);
  }

  // A report with a filter on it, to prove a refresh does not reset it.
  await page.click('.tab[data-tab="custom"]');
  await page.waitForTimeout(800);
  await page.click("#cr-new");
  await page.waitForTimeout(700);
  await page.locator(".cr-linkbtn", { hasText: "+ condition" }).first().click();
  await page.waitForSelector(".cr-filter");
  await page.fill("#cr-name", "Refresh probe");
  await page.press("#cr-name", "Enter");
  await page.waitForTimeout(700);
  const before = await counts(page);
  const summaryBefore = (await page.textContent("#cr-summary")).trim();
  t.eq(before.memRows, mem.records.length, "starting from the full member list");

  // One click.
  refreshed = true;
  await page.click("#refresh");
  await page.waitForTimeout(4000);
  t.ok(pulls.includes("roll") && pulls.includes("members"),
    `one click pulled every report: ${JSON.stringify(pulls)}`);
  t.ok(pulls.indexOf("busy") >= 0 && pulls.indexOf("busy") < pulls.indexOf("members"),
    "a busy server is waited out, not taken as the answer");
  t.ok(await page.isHidden("#curtain"), "and no error is shown for it");

  // The stamp shows the time of the pull just made, for the report on screen.
  const want = new Date(PULLED).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  t.eq((await page.textContent("#stamp")).trim(), "Pulled " + want, "the Pulled line shows the new time");

  // Every view is current WITHOUT being visited.
  const after = await counts(page);
  t.eq(after.rollRows, WANT_ROLL, `attendance roll repainted to the new roster (of ${roll2.rows.length} rows)`);
  t.eq(after.memRows, WANT_MEM, "members repainted without visiting it");
  t.eq(after.crRows, WANT_MEM, "custom report repainted");
  t.ok(after.alRows > 0 && after.alRows < before.alRows,
    `action list repainted (${before.alRows} -> ${after.alRows})`);
  t.eq(after.qiTotal, WANT_MEM, "quarterly indicators repainted without visiting");

  // The open report survived it.
  t.eq(await page.inputValue("#cr-name"), "Refresh probe", "the open report keeps its name");
  t.eq((await page.textContent("#cr-summary")).trim(), summaryBefore, "and its conditions");
  t.ok(await page.$$eval(".cr-filter", (n) => n.length) >= 1, "the filter row is still there");

  // Walking the tabs shows nothing new — they were already current.
  for (const tab of h.TABS) {
    await page.click(`.tab[data-tab="${tab}"]`);
    await page.waitForTimeout(900);
  }
  t.eq(JSON.stringify(await counts(page)), JSON.stringify(after),
    "visiting each tab changes nothing — they were already refreshed");
}, {
  async before(page) {
    await page.route("**/api/**", async (route) => {
      const u = route.request().url();
      const json = (body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
      if (refreshed && /\/api\/refresh/.test(u)) { pulls.push("roll"); return json(roll2); }
      if (refreshed && /\/api\/members/.test(u)) {
        // The collision that used to lose a refresh: the click lands while
        // another pull is still running. It must wait and try again.
        if (membersBusyOnce) { membersBusyOnce = false; pulls.push("busy");
          return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "BUSY", busy: "pull" }) }); }
        pulls.push("members"); return json(mem2);
      }
      if (refreshed && /\/api\/data/.test(u)) return json(roll2);
      return route.continue();
    });
  },
});
