/**
 * Clicking an attendance figure opens that person's weeks.
 *
 * The figure and the grid behind it are computed separately, so the thing
 * worth holding is that they agree: the green cells must come to the
 * numerator, and the cells that count must come to the denominator. If those
 * two ever drift, the popup is quietly contradicting the column it came from.
 */

const h = require("./harness");

const modal = "#att-modal";
const grid = `${modal} .ah-months .ah-cell`;

// "2/4 50%" -> { got: 2, of: 4 }
const readBadge = (text) => {
  const m = /^(\d+)\/(\d+)/.exec(String(text || "").trim());
  return m ? { got: +m[1], of: +m[2] } : null;
};

async function openFrom(page, rowIndex, which) {
  await page.click(`#mem-table tbody tr:nth-child(${rowIndex}) .att-td .part >> nth=${which}`);
  await page.waitForSelector(`${modal}:not([hidden])`);
  await page.waitForTimeout(350);
}
const close = async (page) => { await page.keyboard.press("Escape"); await page.waitForTimeout(300); };

h.seed();
h.run("attendance history", async (page, t) => {
  await h.goTab(page, "members");

  // ---- the grid agrees with the figure it came from ------------------------
  // Across a decent spread of rows, and for both columns, since each opens a
  // different window over the same weeks.
  const rows = await page.$$eval("#mem-table tbody tr", (n) => n.length);
  const sample = [1, 2, 3, 5, 8, 13, 21, 34].filter((i) => i <= rows);
  let checked = 0, withBaptism = 0;

  for (const i of sample) {
    for (const which of [0, 1]) {
      const label = await page.$eval(
        `#mem-table tbody tr:nth-child(${i}) .att-td .part >> nth=${which}`,
        (e) => e.textContent.trim());
      const badge = readBadge(label);
      if (!badge) continue;                       // "—": nothing to open

      await openFrom(page, i, which);
      const marks = await page.$$eval(grid, (n) => n.map((e) => e.className.replace(/^ah-cell ?/, "")));
      const on = marks.filter((m) => m === "on").length;
      const counted = marks.filter((m) => m !== "na").length;
      t.eq(on, badge.got, `row ${i} col ${which}: green cells match the figure (${label})`);
      t.eq(counted, badge.of, `row ${i} col ${which}: countable cells match the denominator (${label})`);
      if (marks.some((m) => m === "na")) withBaptism += 1;
      checked += 1;
      await close(page);
    }
  }
  t.ok(checked >= 8, `checked ${checked} figures against their grids`);
  // Weeks before somebody's baptism are neither present nor absent. The
  // fixture has people baptized part-way through, so this must have come up.
  t.ok(withBaptism > 0, `and ${withBaptism} of them had weeks before their baptism, drawn as neither`);

  // ---- the two columns open their own windows -----------------------------
  // On a roll shorter than twelve weeks these coincide; what has to hold at
  // any length is that 3MOS is the narrower of the two and ends level with it.
  const wide = [];
  for (const which of [0, 1]) {
    await openFrom(page, 1, which);
    wide.push({
      cells: await page.$$eval(grid, (n) => n.length),
      meta: await page.textContent(`${modal} .att-modal-meta`),
      last: await page.$$eval(`${modal} .ah-date`, (n) => n[n.length - 1].textContent),
    });
    await close(page);
  }
  t.ok(wide[1].cells <= wide[0].cells && wide[1].cells <= 12,
    `3MOS opens the narrower window (${wide[1].cells} of ${wide[0].cells}, never over 12)`);
  t.eq(wide[1].last, wide[0].last, "and both end on the same Sunday");

  // ---- what the popup says -------------------------------------------------
  await openFrom(page, 1, 0);
  const name = await page.textContent(`${modal} h2`);
  const rowName = await page.$eval("#mem-table tbody tr:nth-child(1) .name-link", (e) => e.textContent.trim());
  t.eq(name.trim(), rowName, "it is headed with the person's name");
  const meta = (await page.textContent(`${modal} .att-modal-meta`)).trim();
  t.ok(/^\d{2} \w{3} – \d{2} \w{3} · /.test(meta), `and says which period it covers ("${meta}")`);
  t.ok(await page.isVisible(`${modal} .ah-key`), "a key explains the cells");
  const dates = await page.$$eval(`${modal} .ah-date`, (n) => n.map((e) => e.textContent));
  const cells = await page.$$eval(grid, (n) => n.length);
  t.eq(dates.length, cells, "every cell is dated");

  // ---- it closes, and it leads somewhere ----------------------------------
  await page.click("#att-backdrop");
  await page.waitForTimeout(300);
  t.ok(await page.isHidden(modal), "clicking away closes it");
  await openFrom(page, 1, 0);
  await page.click(`${modal} .ah-profile`);
  await page.waitForSelector("#profile-modal:not([hidden])");
  await page.waitForTimeout(400);
  t.ok(await page.isHidden(modal), "opening the full profile closes the popup");
  t.eq((await page.textContent("#profile-name")).trim(), rowName, "and opens the right person");
  await close(page);
  t.ok(await page.isHidden("#profile-modal"), "Escape closes the profile too");
  t.ok(!(await page.evaluate(() => document.body.classList.contains("modal-open"))),
    "and the page is scrollable again");

  // ---- "—" explains itself -------------------------------------------------
  // A dash means there was no Sunday for them to attend — baptized after the
  // last week pulled — which is the reading the whole app is built on and the
  // hardest one to take on trust from a column. Opening it is how somebody
  // finds out why, so it must open and it must say so.
  const dash = await page.$$eval("#mem-table tbody tr", (rows) => rows.findIndex((r) => {
    const b = r.querySelector(".att-td .part");
    return b && b.textContent.trim() === "—";
  }));
  t.ok(dash >= 0, "the fixture has somebody with no eligible Sunday");
  if (dash >= 0) {
    await openFrom(page, dash + 1, 0);
    const marks = await page.$$eval(grid, (n) => n.map((e) => e.className.replace(/^ah-cell ?/, "")));
    t.ok(marks.length > 0 && marks.every((m) => m === "na"),
      `a dash opens to weeks that were never theirs to attend (${JSON.stringify(marks)})`);
    t.ok((await page.textContent(`${modal} .att-modal-meta`)).includes("no Sunday yet to attend"),
      "and says as much, rather than calling them absent");
    await close(page);
  }

  // ---- the other tables offer it too --------------------------------------
  for (const tab of ["custom", "actions"]) {
    await h.goTab(page, tab);
    const table = "#" + h.TABLE[tab];
    await page.click(`${table} tbody tr:nth-child(1) .att-td .part >> nth=0`);
    await page.waitForSelector(`${modal}:not([hidden])`);
    await page.waitForTimeout(350);
    t.ok((await page.$$eval(grid, (n) => n.length)) > 0, `${tab}: its attendance figures open too`);
    await close(page);
  }
}, { viewport: { width: 1500, height: 1000 } });
