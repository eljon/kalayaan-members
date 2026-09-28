/**
 * The broad net: every tab renders, and the invariants that have broken
 * before stay unbroken.
 *
 * Rebuilt after a container reset took the per-feature suites with it, which
 * is the reason these now live in the repo rather than in a scratch folder.
 */

const fs = require("fs");
const path = require("path");
const h = require("./harness");

h.seed({ listName: "Everyone" });
h.run("smoke", async (page, t) => {
  t.eq(await page.title(), "Kalayaan Stewardship", "app title");
  t.eq((await page.textContent(".print-ward")).trim(), "Kalayaan Ward Stewardship", "ward name in the print header");

  // --- every tab renders ---
  for (const tab of h.TABS) {
    await page.click(`.tab[data-tab="${tab}"]`);
    await page.waitForSelector(tab === "actions" ? ".al-item" : h.READY[tab], { timeout: 15000 });
    await page.waitForTimeout(700);
    t.ok(true, `${tab} tab renders`);
  }

  // --- a blank counts as attending, not absent ---
  await h.goTab(page, "members");
  const legend = await page.$$eval("#mem-stats .stat-item", (n) => n.map((e) => ({
    label: (e.querySelector(".stat-label") || {}).textContent || "",
    n: +((e.querySelector(".stat-count") || {}).textContent || "0"),
  })));
  const get = (l) => { const x = legend.find((v) => v.label.startsWith(l)); return x ? x.n : null; };
  t.ok(get("Not yet counted") > 0, `blanks shown as "Not yet counted" (${get("Not yet counted")})`);
  t.ok(get("Green (≥50%)") + get("Yellow (<50%)") + get("Orange (≤25%)") + get("Not yet counted") === get("Attending"),
    "the breakdown sums to Attending");

  await page.click("#mem-stats .subtab >> nth=2");          // Not attending
  await page.waitForTimeout(700);
  const notAtt = await page.$$eval("#mem-table tbody tr", (n) => n.map((tr) =>
    [...tr.children].map((td) => td.textContent.trim()).find((x) => x === "—" || /^\d+\/\d+/.test(x))));
  t.ok(notAtt.every((x) => x !== "—"), "no blank sits under Not attending");

  // --- names are clickable, including inside the profile ---
  await page.click("#mem-stats .subtab >> nth=0");
  await page.waitForTimeout(700);
  await page.click("#mem-table tbody tr:first-child .name-link");
  await page.waitForSelector("#profile-modal:not([hidden])");
  await page.waitForTimeout(700);
  t.ok((await page.$$eval(".profile-field", (n) => n.length)) > 5, "profile modal fills in");
  // Every fixture member heads their own house, so the only name-bearing
  // field self-references and is deliberately NOT a link. The real case is
  // checked below with a stubbed cross-reference.
  t.eq(await page.$$eval(".profile-field dd .name-link", (n) => n.length), 0,
    "a field naming the open profile is not a link back to itself");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  // --- column labels tidied ---
  const heads = await page.$$eval("#mem-table thead th", (n) => n.map((e) => e.textContent.trim()));
  t.ok(!heads.some((x) => /Progress|with Example/i.test(x)),
    `no raw LCR labels: ${JSON.stringify(heads.slice(0, 8))}`);

  // --- action lists: search, column picker, check-off ---
  await h.goTab(page, "actions");
  await page.locator(".al-item .al-open").first().click();
  await page.waitForTimeout(800);
  const alBefore = await page.$$eval("#al-table tbody tr", (n) => n.length);
  await page.fill("#alq", "zzzznomatch");
  await page.waitForTimeout(600);
  t.eq(await page.$$eval("#al-table tbody tr", (n) => n.length), 0, "action list search filters");
  await page.fill("#alq", "");
  await page.waitForTimeout(600);
  await page.click("#al-columns-btn");
  await page.waitForTimeout(400);
  t.ok(await page.isVisible("#al-columns"), "action list column picker opens");
  await page.click("#al-columns-btn");

  await page.click("#al-table tbody tr:first-child .al-act-hide");
  await page.waitForTimeout(600);
  t.eq(await page.$$eval("#al-table tbody tr", (n) => n.length), alBefore - 1, "hiding one removes it");
  await page.click("#al-showdone");
  await page.waitForTimeout(600);
  t.eq(await page.$$eval("#al-table tbody tr", (n) => n.length), alBefore, "Show hidden brings it back");
  // Unhide while Show hidden is still on, or the click lands on somebody else
  // and each run leaves another person hidden.
  await page.click("#al-table tr.al-row-done .al-act-hide");
  await page.waitForTimeout(600);
  t.eq(await page.$$eval("#al-table tbody tr", (n) => n.length), alBefore, "unhiding restores the list");
  await page.click("#al-showdone");
  await page.waitForTimeout(400);

  // --- quarterly: the indicators, and the drill-down's three scopes ---
  await h.goTab(page, "quarterly");
  const inds = await page.$$eval("#qi-table tbody tr:not(.qi-group-row)", (n) => n.length);
  t.eq(inds, 26, "26 indicators");
  const bangs = await page.$$eval("#qi-table .qi-bang", (n) => n.length);
  t.ok(bangs >= 5 && bangs < 26, `some marked ! and most derive (${bangs} marked)`);
  await page.click('#qi-table tbody tr:has(.qi-name:text-is("Adult males holding Melchizedek Priesthood"))');
  await page.waitForSelector("#qi-modal:not([hidden])");
  await page.waitForTimeout(600);
  const scopes = await page.$$eval("#qi-modal .qi-scopes .subtab",
    (n) => n.map((e) => e.textContent.trim().split(" ")[0]));
  t.eq(JSON.stringify(scopes), JSON.stringify(["Remaining", "Actual", "Potential"]), "drill-down scopes");
  t.ok(await page.$$eval("#qi-modal .qi-scopes .subtab.is-active",
    (n) => n[0].textContent.startsWith("Remaining")), "Remaining is the default");
  await page.keyboard.press("Escape");

  // --- a field naming SOMEBODY ELSE is a link, and navigates ---
  // Stubbed, because every fixture member heads their own house.
  const mem = JSON.parse(fs.readFileSync(path.join(h.ROOT, "output", "members.json"), "utf8"));
  const other = mem.records[1].preferred_name;
  mem.records[0].head_of_house = other;
  const ctx = page.context();
  const q = await ctx.newPage();
  await q.route("**/api/members*", (r) => r.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify(mem),
  }));
  await q.goto(h.BASE + "/", { waitUntil: "networkidle" });
  await q.click('.tab[data-tab="members"]');
  await q.waitForSelector("#mem-table tbody tr");
  await q.waitForTimeout(700);
  await q.click("#mem-table tbody tr:first-child .name-link");
  await q.waitForSelector("#profile-modal:not([hidden])");
  await q.waitForTimeout(700);
  const links = await q.$$eval(".profile-field dd .name-link", (n) => n.map((e) => e.textContent.trim()));
  t.ok(links.includes(other), `another member's name in the profile IS a link (${JSON.stringify(links)})`);
  await q.click(".profile-field dd .name-link >> nth=0");
  await q.waitForTimeout(800);
  t.eq((await q.textContent("#profile-name")).trim(), other, "and clicking it opens that profile");
  await q.close();
});
