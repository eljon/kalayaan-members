/**
 * Every column on screen must survive into the PDF.
 *
 * Paper has no horizontal scrollbar: a table laid out to its content simply
 * loses its right-hand columns, and the browser gives no warning. Rendering
 * at the real printable page width is the only honest check — the viewport
 * is not it.
 */

const h = require("./harness");

// A4 at 96dpi, less the 1.1cm margins the print stylesheet sets.
const PORTRAIT = Math.round((21.0 - 2.2) / 2.54 * 96);
const LANDSCAPE = Math.round((29.7 - 2.2) / 2.54 * 96);

const REPORTS = ["members", "returned", "custom", "actions", "quarterly"];

h.seed();
h.run("print columns", async (page, t) => {
  await page.evaluate(() => { window.print = () => {}; });

  for (const tab of REPORTS) {
    const tableId = h.TABLE[tab];
    await h.goTab(page, tab, 1200);
    const onScreen = await page.$$eval(`#${tableId} thead th`, (n) => n.length);

    // Click the tab's own PDF button, so the real orientation logic runs.
    await page.click("#" + h.PDF_BTN[tab]);
    await page.waitForTimeout(300);
    const rule = await page.evaluate(() => (document.getElementById("print-page") || {}).textContent || "");
    const landscape = /landscape/.test(rule);

    await page.setViewportSize({ width: landscape ? LANDSCAPE : PORTRAIT, height: 1100 });
    await page.emulateMedia({ media: "print" });
    await page.waitForTimeout(500);

    const g = await page.evaluate((id) => {
      const table = document.getElementById(id);
      const ths = [...table.querySelectorAll("thead th")];
      const avail = document.documentElement.clientWidth;
      return {
        cols: ths.length,
        tableW: Math.round(table.getBoundingClientRect().width),
        avail,
        clipped: ths.filter((x) => x.getBoundingClientRect().right > avail + 1).map((x) => x.textContent.trim()),
      };
    }, tableId);

    t.ok(g.cols === onScreen, `${tab}: all ${onScreen} columns present on paper (${g.cols})`);
    t.ok(g.clipped.length === 0,
      `${tab}: nothing runs off the ${landscape ? "landscape" : "portrait"} page` +
      (g.clipped.length ? ` — clipped: ${JSON.stringify(g.clipped)}` : ` (table ${g.tableW} ≤ page ${g.avail})`));

    await page.emulateMedia({ media: "screen" });
    await page.setViewportSize({ width: 1500, height: 1000 });
    await page.waitForTimeout(300);
  }
});
