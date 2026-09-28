/**
 * A Sunday excluded in Settings leaves every count.
 *
 * Excluding is one tick in one place, but it has to reach the roll's
 * denominators, the stats, the graph, the Members and 3MOS columns and the
 * history popup — everything derives from eligibleWeeks(), and this is what
 * holds that claim to account.
 */

const h = require("./harness");
h.seed();
h.run("exclude a week", async (page, t) => {
  const stat = (l) => page.$$eval("#att-stats .stat-item", (n, lab) => {
    const x = n.find((e) => ((e.querySelector(".stat-label") || {}).textContent || "").startsWith(lab));
    return x ? +((x.querySelector(".stat-count") || {}).textContent || "0") : null;
  }, l);
  const firstScore = () => page.$eval("#roll-body .roll-row .r-score", (e) => e.textContent.trim());
  const points = () => page.$$eval("#graph .graph-svg circle, #graph .graph-svg .pt", (n) => n.length);

  const before = { score: await firstScore(), every: await stat("Every week") };
  console.log("before:", JSON.stringify(before), "graph pts:", await points());

  await page.click("#settings-btn");
  await page.waitForSelector("#set-weeks .set-week");
  const boxes = await page.$$eval("#set-weeks .set-week", (n) => n.map((e) => e.textContent.trim()));
  console.log("weeks offered:", JSON.stringify(boxes));
  t.ok(boxes.length === 4, `every pulled Sunday is offered (${boxes.length})`);
  await page.click("#set-weeks .set-week:nth-child(1) input");   // newest = 26 Jul
  await page.waitForTimeout(1200);

  const after = { score: await firstScore(), every: await stat("Every week") };
  console.log("after:", JSON.stringify(after), "graph pts:", await points());
  t.ok(/\/3$/.test(after.score), `the denominator drops to 3 (${before.score} -> ${after.score})`);
  t.ok(await page.isVisible(".cell.excluded"), "the roll marks that Sunday");
  t.ok(await page.isVisible(".h-week-excluded"), "and strikes its date in the header");

  // members + custom + 3MOS all follow
  await h.goTab(page, "members");
  const m = await page.$eval("#mem-table tbody tr .att-td .part", (e) => e.textContent.trim());
  t.ok(/\/3 /.test(m) || m === "—", `the Members column follows (${m})`);
  await page.click("#mem-table tbody tr .att-td .part >> nth=0");
  await page.waitForSelector("#att-modal:not([hidden])");
  await page.waitForTimeout(400);
  const marks = await page.$$eval("#att-modal .ah-months .ah-cell", (n) => n.map((e) => e.className));
  t.ok(marks.some((c) => /skip/.test(c)), `the popup marks it too ${JSON.stringify(marks)}`);
  t.ok((await page.textContent("#att-modal .ah-key")).includes("no class"), "and the key says why");

  // put it back
  await page.keyboard.press("Escape");
  await page.click("#settings-btn");
  await page.waitForTimeout(400);
  await page.click("#set-weeks .set-week:nth-child(1) input");
  await page.waitForTimeout(1200);
  await h.goTab(page, "attendance");
  t.eq(await firstScore(), before.score, "unticking puts the week back");
}, { viewport: { width: 1500, height: 1000 } });
