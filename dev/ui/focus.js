/**
 * Action-list selection, and Focus.
 *
 * On a list, a tick selects a row and the bar above the table decides what
 * happens to the selection: Add to Focus, or Hide. They stay separate
 * actions — hiding must not quietly focus anybody, and focusing must not take
 * anybody off the list they were chosen from.
 *
 * On Focus: each person carries the list they came from and a note, and
 * turns green once that list no longer matches them.
 */

const fs = require("fs");
const path = require("path");
const h = require("./harness");

const mem = JSON.parse(fs.readFileSync(path.join(h.ROOT, "output", "members.json"), "utf8"));
const nameCol = mem.columns.find((c) => /name/.test(c.key)).key;
// Two real people: one the "Named" list will match, one it will not.
const kept = mem.records[0][nameCol];
const gone = mem.records[1][nameCol];
const nk = (s) => String(s).toLowerCase().replace(/[.,\-]/g, " ").replace(/\s+/g, " ").trim();

h.seed({
  lists: [
    {
      id: "ui-everyone", name: "Everyone",
      state: { groupsMatch: "all", groups: [{ match: "all", filters: [] }], columns: [], description: "", summaryHidden: false, columnsCustomized: false },
    },
    {
      // Matches exactly one person, so the other one in Focus from here is
      // "no longer on the list".
      id: "ui-named", name: "Named",
      state: { groupsMatch: "all", groups: [{ match: "all", filters: [{ field: nameCol, op: "contains", value: kept }] }],
        columns: [], description: "", summaryHidden: false, columnsCustomized: false },
    },
  ],
});
// Seed Focus directly for the green case — both from "Named".
{
  const p = h.readPrefs();
  p.focus = [
    { key: nk(kept), name: kept, listId: "ui-named", listName: "Named", added: "2026-09-01" },
    { key: nk(gone), name: gone, listId: "ui-named", listName: "Named", added: "2026-09-01" },
  ];
  h.writePrefs(p);
}

h.run("selection + Focus", async (page, t) => {
  await h.goTab(page, "actions");
  await page.locator(".al-item .al-open", { hasText: "Everyone" }).first().click();
  await page.waitForTimeout(700);
  const rows = () => page.$$eval("#al-table tbody tr", (n) => n.length);
  const before = await rows();

  // ---- a tick selects, and nothing else ------------------------------------
  t.ok(await page.isHidden("#al-bulk"), "no bar until something is ticked");
  // Two rows not already in Focus, so the bar should offer to add them.
  const free = await page.$$eval("#al-table tbody tr",
    (n) => n.map((r, i) => (r.querySelector(".al-focus-mark") ? -1 : i + 1)).filter((i) => i > 0).slice(0, 2));
  await page.check(`#al-table tbody tr:nth-child(${free[0]}) .al-done-td input`);
  await page.check(`#al-table tbody tr:nth-child(${free[1]}) .al-done-td input`);
  await page.waitForTimeout(300);
  t.eq(await rows(), before, "ticking removes nobody");
  t.ok(await page.isVisible("#al-bulk"), "ticking shows the actions");
  t.eq((await page.textContent("#al-bulk-count")).trim(), "2 selected", "and says how many");
  t.ok(await page.isVisible("#al-bulk-focus") && await page.isVisible("#al-bulk-hide"), "offering Add to Focus and Hide");
  t.ok(await page.isHidden("#al-bulk-unhide"), "and not Unhide, since nobody ticked is hidden");
  t.ok(await page.isHidden("#al-bulk-unfocus"), "nor Remove from Focus, since nobody ticked is in it");
  // Tick somebody already in Focus and the bar offers to take them out.
  const inF = await page.$$eval("#al-table tbody tr", (n) => n.findIndex((r) => r.querySelector(".al-focus-mark")) + 1);
  await page.check(`#al-table tbody tr:nth-child(${inF}) .al-done-td input`);
  t.ok(await page.isVisible("#al-bulk-unfocus"), "a ticked Focus row offers Remove from Focus");

  // ---- Hide ----------------------------------------------------------------
  const hideName = await page.$eval("#al-table tbody tr:nth-child(1) .name-link", (e) => e.textContent.trim());
  await page.click("#al-bulk-clear");
  await page.check("#al-table tbody tr:nth-child(1) .al-done-td input");
  await page.click("#al-bulk-hide");
  await page.waitForTimeout(500);
  t.eq(await rows(), before - 1, "Hide takes the ticked row off the list");
  t.ok(await page.isHidden("#al-bulk"), "and clears the selection");
  const focusBefore = await page.textContent("#focus-tab-badge");
  t.eq(focusBefore, "2", "hiding puts nobody in Focus");

  await page.check("#al-showdone");
  await page.waitForTimeout(500);
  await page.check("#al-table tr.al-row-done .al-done-td input");
  t.ok(await page.isVisible("#al-bulk-unhide"), "a hidden row offers Unhide");
  await page.click("#al-bulk-unhide");
  await page.waitForTimeout(500);
  await page.uncheck("#al-showdone");
  await page.waitForTimeout(500);
  t.eq(await rows(), before, `Unhide brings ${hideName} back`);

  // ---- Add to Focus, several at once --------------------------------------
  // Rows 3 and 4: rows 1-2 may already be in Focus from the seed.
  const picked = [];
  const free2 = await page.$$eval("#al-table tbody tr",
    (n) => n.map((r, i) => (r.querySelector(".al-focus-mark") ? -1 : i + 1)).filter((i) => i > 0).slice(0, 2));
  for (const i of free2) {
    picked.push(await page.$eval(`#al-table tbody tr:nth-child(${i}) .name-link`, (e) => e.textContent.trim()));
    await page.check(`#al-table tbody tr:nth-child(${i}) .al-done-td input`);
  }
  await page.click("#al-bulk-focus");
  await page.waitForTimeout(500);
  t.eq(await rows(), before, "focusing leaves the rows where they are");
  t.eq(await page.textContent("#focus-tab-badge"), "4", "the Focus badge counts them");
  t.eq(await page.$$eval("#al-table .al-focus-mark", (n) => n.length) >= 2, true, "and the list marks who is in Focus");

  // select-all
  await page.check("#al-table thead .al-done-th input");
  await page.waitForTimeout(300);
  t.eq((await page.textContent("#al-bulk-count")).trim(), `${before} selected`, "the header box selects every row shown");
  await page.click("#al-bulk-clear");

  // ---- Focus tab -----------------------------------------------------------
  await page.click('.tab[data-tab="focus"]');
  await page.waitForTimeout(1500);
  const names = await page.$$eval("#focus-table tbody .name-link", (n) => n.map((e) => e.textContent.trim()));
  t.ok(picked.every((n) => names.includes(n)), "the Focus tab lists them");
  const heads = await page.$$eval("#focus-table thead th", (n) => n.map((e) => e.textContent.trim()));
  t.ok(["Attendance", "3MOS", "From", "Notes"].every((x) => heads.includes(x)), `columns: ${JSON.stringify(heads)}`);

  // green when no longer on the list they came from
  const rowOf = (n) => page.locator("#focus-table tbody tr", { has: page.locator(".name-link", { hasText: n }) }).first();
  t.ok(await rowOf(gone).evaluate((e) => e.classList.contains("focus-resolved")),
    `${gone} is no longer on "Named" — green`);
  t.ok(!(await rowOf(kept).evaluate((e) => e.classList.contains("focus-resolved"))),
    `${kept} still is — not green`);
  t.ok(!(await rowOf(picked[0]).evaluate((e) => e.classList.contains("focus-resolved"))),
    "and somebody from Everyone, who everyone matches, is not green");
  t.ok((await page.textContent("#focus-summary")).includes("1 is no longer on the list"), "the summary counts them");

  // notes persist
  await rowOf(kept).locator(".focus-note").fill("Visited 12 Sep — invite to ward social");
  await page.waitForTimeout(700);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await page.click('.tab[data-tab="focus"]');
  await page.waitForTimeout(1500);
  t.eq(await rowOf(kept).locator(".focus-note").inputValue(), "Visited 12 Sep — invite to ward social",
    "a note survives a reload");
  t.eq(await page.textContent("#focus-tab-badge"), "4", "and so does Focus");

  const csv = await h.downloadName(page, () => page.click("#focus-export"));
  t.eq(csv, "Focus - Kalayaan Stewardship.csv", "Focus downloads under its own name");

  // the note prints as text, not as a box
  await page.evaluate(() => { window.print = () => {}; });
  await page.click("#focus-pdf");
  await page.emulateMedia({ media: "print" });
  await page.waitForTimeout(400);
  t.ok(await rowOf(kept).locator(".focus-note").isHidden(), "on paper the note box is gone");
  t.eq((await rowOf(kept).locator(".focus-note-print").textContent()).trim(),
    "Visited 12 Sep — invite to ward social", "and its text is there instead");
  await page.emulateMedia({ media: "screen" });

  // "From" follows the list's current name, not the name it had when they
  // were added.
  await h.goTab(page, "actions");
  await page.locator(".al-item .al-open", { hasText: "Named" }).first().click();
  await page.waitForTimeout(500);
  await page.fill("#al-name", "Named, renamed");
  await page.waitForTimeout(600);
  await page.click('.tab[data-tab="focus"]');
  await page.waitForTimeout(1200);
  t.eq((await rowOf(kept).locator(".focus-from").textContent()).trim(), "Named, renamed",
    "renaming a list renames it in the From column");

  // taking somebody off
  await rowOf(picked[0]).locator(".al-act-focus").click();
  await page.waitForTimeout(500);
  t.eq(await page.textContent("#focus-tab-badge"), "3", "taking one off Focus updates the badge");
}, { viewport: { width: 1500, height: 1000 } });
