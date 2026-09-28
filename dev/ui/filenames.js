/**
 * Every download is named "<Report Name> - Kalayaan Stewardship".
 *
 * A file that leaves the app has to say what it is: in a Downloads folder,
 * "custom-report.csv" next to "all-members.csv" tells you nothing about which
 * ward or which report. Covers all three formats on all six tabs, plus the
 * names a report or list carries of its own.
 */

const h = require("./harness");

const SUFFIX = " - Kalayaan Stewardship";
// The name each tab prints when nothing has been named by hand.
const DEFAULTS = {
  attendance: "Attendance", returned: "Returned Missionaries", members: "Members",
  custom: "Custom Reports", actions: "Everyone", quarterly: "Quarterly Indicators",
};

h.seed({ listName: "Everyone" });
// Focus starts empty and an empty report has nothing to download, so it is
// covered by focus.js once somebody is in it, not here.
const TABS = h.TABS.filter((x) => x !== "focus");

h.run("download filenames", async (page, t) => {
  for (const tab of TABS) {
    await h.goTab(page, tab);
    const want = DEFAULTS[tab];

    if (h.CSV_BTN[tab]) {
      const n = await h.downloadName(page, () => page.click("#" + h.CSV_BTN[tab]));
      t.eq(n, `${want}${SUFFIX}.csv`, `${tab} CSV`);
    }
    const x = await h.downloadName(page, () => page.click("#" + h.SHEET_BTN[tab]));
    t.eq(x, `${want}${SUFFIX}.xlsx`, `${tab} spreadsheet`);
  }

  // A PDF is named by the document title — there is no other hook — so the
  // title is borrowed for the length of the print and handed back.
  await page.evaluate(() => {
    window.__titles = [];
    window.print = () => { window.__titles.push(document.title); };
  });
  for (const tab of TABS) {
    await h.goTab(page, tab, 500);
    await page.click("#" + h.PDF_BTN[tab]);
    await page.waitForTimeout(900);
    const got = await page.evaluate(() => window.__titles[window.__titles.length - 1]);
    t.eq(got, `${DEFAULTS[tab]}${SUFFIX}`, `${tab} PDF title`);
    t.eq(await page.title(), "Kalayaan Stewardship", `${tab}: and the tab title is handed back`);
  }

  // ---- names given by hand -------------------------------------------------
  await h.goTab(page, "actions");
  await page.fill("#al-name", "Needs a visit");
  await page.waitForTimeout(700);
  t.eq(await h.downloadName(page, () => page.click("#al-export")),
    `Needs a visit${SUFFIX}.csv`, "a list's own name is used");
  await page.click("#al-pdf");
  await page.waitForTimeout(400);
  t.eq(await page.evaluate(() => window.__titles[window.__titles.length - 1]),
    `Needs a visit${SUFFIX}`, "and in the PDF too");

  // A filesystem will not take every character somebody can type.
  await page.fill("#al-name", 'Re: "urgent" / follow-up <2026>');
  await page.waitForTimeout(700);
  const awkward = await h.downloadName(page, () => page.click("#al-export"));
  t.ok(!/[\\/:*?"<>|]/.test(awkward) && awkward.endsWith(`${SUFFIX}.csv`),
    `awkward characters are stripped: ${awkward}`);

  await h.goTab(page, "custom");
  await page.fill("#cr-name", "Youth needing a visit");
  await page.press("#cr-name", "Enter");            // Enter is how a report is saved
  await page.waitForTimeout(900);
  t.eq(await h.downloadName(page, () => page.click("#cr-export")),
    `Youth needing a visit${SUFFIX}.csv`, "a saved report's own name is used");

  // The quarterly drill-down is a different report each time, so it keeps its
  // specific name — and still ends with the app.
  await h.goTab(page, "quarterly");
  const rows = await page.$$eval("#qi-table tbody tr", (n) => n.length);
  let drill = null;
  for (let i = 1; i <= rows && !drill; i++) {
    await page.click(`#qi-table tbody tr:nth-child(${i})`);
    await page.waitForTimeout(600);
    if (await page.isVisible("#qi-modal-csv")) drill = await h.downloadName(page, () => page.click("#qi-modal-csv"));
  }
  t.ok(!!drill && drill.endsWith(`${SUFFIX}.csv`), `quarterly drill-down: ${drill}`);
  t.ok(!!drill && drill.length > SUFFIX.length + 10, "and keeps the indicator it drilled into");
});
