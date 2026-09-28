/**
 * Hide and Focus: the two things people do with a name on an action list.
 *
 * Hiding sets somebody aside on that one list. Focusing carries them to their
 * own tab with a note of where they came from. They are separate actions and
 * must stay separate — hiding somebody must not quietly focus them, and
 * starring somebody must not take them off the list they were starred on.
 */

const h = require("./harness");
h.seed();
h.run("focus + hide", async (page, t) => {
  await h.goTab(page, "actions");
  const rows = () => page.$$eval("#al-table tbody tr", (n) => n.length);
  const before = await rows();

  // Hide takes a name off this list without checking anybody off.
  const first = await page.$eval("#al-table tbody tr:nth-child(1) .name-link", (e) => e.textContent.trim());
  await page.click("#al-table tbody tr:nth-child(1) .al-act-hide");
  await page.waitForTimeout(600);
  t.eq(await rows(), before - 1, "Hide takes the row off the list");
  t.ok((await page.textContent("#al-count")).includes("1 hidden"), `and the count says so (${await page.textContent("#al-count")})`);
  t.ok(await page.$eval("#focus-tab-badge", (e) => e.hidden), "hiding does not put anybody in Focus");

  await page.check("#al-showdone");
  await page.waitForTimeout(600);
  t.eq(await rows(), before, "Show hidden brings it back");
  await page.click("#al-table tr.al-row-done .al-act-hide");   // Unhide
  await page.waitForTimeout(600);
  await page.uncheck("#al-showdone");
  await page.waitForTimeout(600);
  t.eq(await rows(), before, "unhiding restores it");

  // Star two people.
  const names = [];
  for (const i of [1, 2]) {
    names.push(await page.$eval(`#al-table tbody tr:nth-child(${i}) .name-link`, (e) => e.textContent.trim()));
    await page.click(`#al-table tbody tr:nth-child(${i}) .al-act-focus`);
    await page.waitForTimeout(500);
  }
  t.eq(await rows(), before, "starring leaves the row where it is");
  t.eq(await page.textContent("#focus-tab-badge"), "2", "the Focus badge counts them");
  t.ok((await page.textContent("#al-count")).includes("2 in Focus"), "and the list says how many");

  await h.goTab(page, "focus", 900).catch(() => {});
  await page.waitForTimeout(1200);
  const shown = await page.$$eval("#focus-table tbody tr .name-link", (n) => n.map((e) => e.textContent.trim()));
  t.eq(JSON.stringify(shown.sort()), JSON.stringify(names.slice().sort()), "the Focus tab lists them");
  const from = await page.$$eval("#focus-table tbody .focus-from", (n) => [...new Set(n.map((e) => e.textContent.trim()))]);
  t.eq(JSON.stringify(from), JSON.stringify(["Everyone"]), "with the list they came from");
  const heads = await page.$$eval("#focus-table thead th", (n) => n.map((e) => e.textContent.trim()));
  t.ok(heads.includes("Attendance") && heads.includes("3MOS") && heads.includes("From"),
    `columns: ${JSON.stringify(heads)}`);

  const csv = await h.downloadName(page, () => page.click("#focus-export"));
  t.eq(csv, "Focus - Kalayaan Stewardship.csv", "Focus downloads under its own name");

  // Unstar from Focus, and the action list agrees.
  await page.click("#focus-table tbody tr:nth-child(1) .al-act-focus");
  await page.waitForTimeout(600);
  t.eq(await page.$$eval("#focus-table tbody tr", (n) => n.length), 1, "taking one off Focus removes it");
  t.eq(await page.textContent("#focus-tab-badge"), "1", "and the badge follows");

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  t.eq(await page.textContent("#focus-tab-badge"), "1", "Focus survives a reload");
}, { viewport: { width: 1500, height: 1000 } });
