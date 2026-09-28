/**
 * The 3MOS column, in the interface.
 *
 * dev/check-3mos.js tests the windowing against a twenty-week roll, which the
 * fixture is too short to show. This is the other half: that the column is
 * actually rendered, beside Attendance, in every table that carries one, that
 * it sorts, and that it is pinned rather than draggable.
 */

const h = require("./harness");

const TABLES = [["members", "#mem-table"], ["custom", "#cr-table"], ["actions", "#al-table"]];
const heads = (page, sel) => page.$$eval(`${sel} thead th`, (n) => n.map((x) => x.textContent.trim()));

h.seed();
h.run("3MOS column", async (page, t) => {
  for (const [tab, sel] of TABLES) {
    await h.goTab(page, tab);
    const head = await heads(page, sel);
    const ai = head.findIndex((x) => x.startsWith("Attendance"));
    const mi = head.indexOf("3MOS");
    t.ok(ai >= 0 && mi >= 0,
      `${tab}: both columns present ${JSON.stringify(head.slice(Math.max(0, ai - 1), ai + 3))}`);
    t.eq(mi, ai + 1, `${tab}: 3MOS sits right beside Attendance`);

    // Header and body both start with the "#" column, so a header index maps
    // straight onto a cell index.
    const pairs = await page.$$eval(`${sel} tbody tr`, (rows, [a, m]) => rows.slice(0, 40).map((r) => {
      const td = r.querySelectorAll("td");
      return [td[a] && td[a].textContent.trim(), td[m] && td[m].textContent.trim()];
    }), [ai, mi]);

    // On the shipped fixture the roll is shorter than the window, so the two
    // read alike. What must hold at ANY length is the relationship.
    const weeks = (x) => { const g = /^\d+\/(\d+)/.exec(x || ""); return g ? +g[1] : null; };
    const wider = pairs.filter(([f, r]) => {
      const fw = weeks(f), rw = weeks(r);
      return fw != null && rw != null && rw > fw;
    });
    t.ok(wider.length === 0,
      `${tab}: 3MOS never spans more weeks than the full range (${pairs.length} rows checked)`);
    t.ok(pairs.every(([, r]) => { const w = weeks(r); return w == null || w <= 12; }),
      `${tab}: and never more than 12`);
    t.ok(pairs.some(([, r]) => /\d+\/\d+ \d+%/.test(r || "")),
      `${tab}: 3MOS shows real figures e.g. ${JSON.stringify(pairs.slice(0, 3).map((x) => x[1]))}`);

    await page.click(`${sel} thead th:nth-child(${mi + 1})`);
    await page.waitForTimeout(600);
    const pct = (x) => { const g = /(\d+)%/.exec(x || ""); return g ? +g[1] : -1; };
    const col = await page.$$eval(`${sel} tbody tr`,
      (rows, m) => rows.map((r) => (r.querySelectorAll("td")[m] || {}).textContent), mi);
    const vals = col.map(pct);
    const asc = vals.every((v, i) => i === 0 || vals[i - 1] <= v);
    const desc = vals.every((v, i) => i === 0 || vals[i - 1] >= v);
    t.ok(asc || desc, `${tab}: the 3MOS header sorts by it`);
    t.ok(!(await page.$eval(`${sel} thead th:nth-child(${mi + 1})`, (e) => e.classList.contains("cr-th-move"))),
      `${tab}: and it is pinned, not draggable`);
  }

  // With a range comparison on, 3MOS goes last rather than splitting the
  // range / vs-prior / change trio, which has to be read together.
  await h.goTab(page, "custom");
  await page.check("#cr-cmp-on");
  await page.waitForTimeout(1200);
  const cmp = await heads(page, "#cr-table");
  const i0 = cmp.findIndex((x) => x.startsWith("Attendance"));
  t.ok(cmp[i0 + 1].startsWith("vs ") && cmp[i0 + 2] === "Change" && cmp[i0 + 3] === "3MOS",
    `comparing keeps the trio intact, 3MOS last ${JSON.stringify(cmp.slice(i0, i0 + 4))}`);
  await page.uncheck("#cr-cmp-on");
  await page.waitForTimeout(700);

  // The quarterly drill-down carries it too.
  await h.goTab(page, "quarterly");
  const rows = await page.$$eval("#qi-table tbody tr", (n) => n.length);
  let drill = [];
  for (let i = 1; i <= rows && !drill.length; i++) {
    await page.click(`#qi-table tbody tr:nth-child(${i})`);
    await page.waitForTimeout(600);
    drill = await heads(page, ".qi-people");
    if (!drill.length && await page.isVisible("#qi-modal")) {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(200);
    }
  }
  t.ok(drill.includes("Attendance") && drill.includes("3MOS"),
    `quarterly drill-down carries it too ${JSON.stringify(drill)}`);
}, { viewport: { width: 1500, height: 950 } });
