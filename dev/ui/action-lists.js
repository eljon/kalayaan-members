/**
 * Action Lists: nothing is pre-built, and every list behaves the same.
 *
 * The app used to ship four lists of its own (Never attended, Not seen in 4+
 * weeks, No calling, No active temple recommend). They are gone, along with
 * the whole "preset" half of the code — so what this guards is that they stay
 * gone, that an install with no lists says something useful instead of
 * showing an unnamed empty form, and that a list somebody builds has all of
 * the controls the presets used to have switched off.
 */

const h = require("./harness");

const SHIPPED = ["Never attended", "Not seen in 4+ weeks", "No calling", "No active temple recommend"];

h.seed({ lists: [] });                      // an install with no lists at all
h.run("action lists", async (page, t) => {
  await h.goTab(page, "actions", 0).catch(() => {});   // no rows yet: don't wait for one
  await page.waitForTimeout(2000);

  const names = () => page.$$eval("#al-list .al-open-name", (n) => n.map((x) => x.textContent.trim()));
  const listed = await names();
  t.eq(listed.length, 0, `an install starts with no lists ${JSON.stringify(listed)}`);
  t.ok(SHIPPED.every((g) => !listed.includes(g)), "and none of the old pre-built ones is back");

  t.ok(await page.isVisible("#al-none"), "the empty tab shows the invitation");
  t.ok(!(await page.isVisible("#view-actions .cr-builder")), "and hides the builder until there is a list");
  t.ok(await page.$eval("#actions-tab-badge", (e) => e.hidden), "the tab badge is hidden when there is nothing to action");

  await page.click("#al-none-new");
  await page.waitForTimeout(800);
  t.ok(!(await page.isVisible("#al-none")), "creating from the empty state dismisses it");
  t.ok(await page.isVisible("#view-actions .cr-builder"), "and reveals the builder");

  const before = await page.$$eval("#al-list .al-item", (n) => n.length);
  await page.click("#al-new");
  await page.waitForTimeout(800);
  const after = await page.$$eval("#al-list .al-item", (n) => n.length);
  t.eq(after, before + 1, `+ creates a list (${before} -> ${after})`);
  t.ok(await page.isVisible("#al-edit-panel"), "and opens it for editing");

  // Everything a preset could not do, every list can.
  t.ok(!(await page.$eval("#al-name", (e) => e.readOnly)), "its name is editable");
  t.ok(await page.isVisible("#al-desc"), "it has a description field");
  t.ok(await page.isVisible("#al-columns-btn"), "and a column picker");
  t.eq(await page.$$eval("#al-list .cr-list-del", (n) => n.length), after, "every list can be deleted");

  const rows = await page.$$eval("#al-table tbody tr", (n) => n.length);
  t.ok(rows > 0, `a new list shows everyone until narrowed (${rows})`);
  await page.click("#al-table tbody tr:first-child .al-done-td input");
  await page.waitForTimeout(500);
  t.eq(await page.$$eval("#al-table tbody tr", (n) => n.length), rows - 1, "checking off removes the row");

  // A reload re-reads the saved prefs, which is where a pre-built list would
  // have come back from.
  await page.reload({ waitUntil: "networkidle" });
  await h.goTab(page, "actions", 1500);
  const afterReload = await names();
  t.ok(SHIPPED.every((g) => !afterReload.includes(g)),
    `and they stay gone after a reload ${JSON.stringify(afterReload)}`);
  t.ok(afterReload.length === after, "while the lists that were built survive it");
}, { viewport: { width: 1400, height: 900 } });
