/**
 * Choose columns: the search, in both pickers.
 *
 * The member export runs to dozens of columns, so each picker has a search.
 * Both Custom Reports and Action Lists share one renderColumnPicker(), so a
 * break in one is a break in both — which is exactly why both are checked.
 */

const h = require("./harness");

// Something the fixture and a real export both carry, matching more than one
// column but not all of them.
const TERM = "temple";

const PICKERS = [
  ["custom", "cr-columns-btn", "cr-columns", "cr-edit", "cr-edit-panel"],
  ["actions", "al-columns-btn", "al-columns", "al-edit", "al-edit-panel"],
];

const shown = (page, box) => page.$$eval(`#${box} .cr-col`,
  (n) => n.filter((x) => !x.hidden).map((x) => x.textContent.trim()));

h.seed();
h.run("column picker search", async (page, t) => {
  for (const [tab, btn, box, editBtn, panel] of PICKERS) {
    console.log("--- " + tab);
    await h.goTab(page, tab);
    // Custom Reports keeps its column button inside the edit panel.
    if (await page.isHidden("#" + panel)) await page.click("#" + editBtn);
    await page.waitForSelector("#" + btn, { state: "visible", timeout: 20000 });
    if (await page.isHidden("#" + box)) await page.click("#" + btn);
    await page.waitForSelector(`#${box} .cr-col-find`);

    const all = (await shown(page, box)).length;
    t.ok(all > 10, `${tab}: picker lists every column (${all})`);

    await page.fill(`#${box} .cr-col-find`, TERM);
    await page.waitForTimeout(250);
    const hits = await shown(page, box);
    t.ok(hits.length > 0 && hits.length < all,
      `${tab}: search narrows the list (${hits.length} of ${all}) ${JSON.stringify(hits)}`);
    t.ok(hits.every((x) => x.toLowerCase().includes(TERM)), `${tab}: and every survivor matches`);

    // Labels are shown and hidden rather than re-rendered, precisely so the
    // field keeps focus while you type.
    t.ok(await page.$eval(`#${box} .cr-col-find`, (e) => e === document.activeElement),
      `${tab}: the field keeps focus while typing`);

    // With a search running the two buttons act on what you can see.
    const bar = () => page.$eval(`#${box} .cr-col-actions`, (e) => e.textContent);
    t.ok((await bar()).includes("Select these"), `${tab}: buttons scope to the search`);
    await page.click(`#${box} .cr-linkbtn:nth-of-type(1)`);
    await page.waitForTimeout(400);
    const ticked = await page.$$eval(`#${box} .cr-col`,
      (n) => n.filter((x) => !x.hidden && x.querySelector("input").checked).length);
    t.eq(ticked, hits.length, `${tab}: "Select these" ticks the matches`);
    t.ok(await page.$eval(`#${box} .cr-col-find`, (e, q) => e.value === q, TERM),
      `${tab}: and the query survives the repaint`);
    const others = await page.$$eval(`#${box} .cr-col`,
      (n) => n.filter((x) => x.hidden && x.querySelector("input").checked).length);
    t.ok(others > 0, `${tab}: columns outside the search keep their state (${others} still ticked)`);

    await page.click(`#${box} .cr-linkbtn:nth-of-type(2)`);
    await page.waitForTimeout(400);
    const left = await page.$$eval(`#${box} .cr-col`,
      (n) => n.filter((x) => !x.hidden && x.querySelector("input").checked).length);
    t.eq(left, 0, `${tab}: "Clear these" unticks only the matches`);
    t.eq(await page.$$eval(`#${box} .cr-col`,
      (n) => n.filter((x) => x.hidden && x.querySelector("input").checked).length),
      others, `${tab}: leaving the rest alone`);

    await page.fill(`#${box} .cr-col-find`, "zzzznomatch");
    await page.waitForTimeout(250);
    t.eq((await shown(page, box)).length, 0, `${tab}: a miss hides everything`);
    t.ok(await page.isVisible(`#${box} .cr-col-none`), `${tab}: and says so`);

    await page.fill(`#${box} .cr-col-find`, "");
    await page.waitForTimeout(250);
    t.eq((await shown(page, box)).length, all, `${tab}: clearing the search brings them all back`);
    t.ok((await bar()).includes("Select all"), `${tab}: and the buttons go back to meaning "all"`);
  }
});
