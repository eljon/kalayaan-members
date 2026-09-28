/**
 * Date columns sort by date.
 *
 * LCR writes dates as "08 Nov 1940", which sorts alphabetically by day of
 * the month — 01 Jan 2020 before 02 Dec 1940. Every sortable table decides a
 * column's kind from its cells, and a date column must come out in date
 * order, with empty cells last whichever way it is sorted.
 */

const h = require("./harness");

const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const num = (s) => {
  const m = /^(\d{1,2}) ([A-Za-z]{3}) (\d{4})$/.exec(String(s).trim());
  return m ? +m[3] * 10000 + MON[m[2].toLowerCase()] * 100 + +m[1] : null;
};

async function column(page, table, label) {
  return page.$$eval(`${table} thead th`, (n, l) => n.findIndex((e) => e.textContent.trim().startsWith(l)), label);
}
async function sortBy(page, table, idx) {
  await page.click(`${table} thead th:nth-child(${idx + 1})`);
  await page.waitForTimeout(600);
  return page.$$eval(`${table} tbody tr`, (rows, i) => rows.map((r) => (r.children[i] || {}).textContent.trim()), idx);
}
function check(t, vals, what, dir) {
  const dates = [], blanks = [];
  vals.forEach((v, i) => (num(v) == null ? blanks.push(i) : dates.push(num(v))));
  const ordered = dates.every((d, i) => i === 0 || (dir > 0 ? dates[i - 1] <= d : dates[i - 1] >= d));
  t.ok(ordered, `${what}: in date order (${dir > 0 ? "oldest" : "newest"} first) — ${vals.slice(0, 3).join(", ")} …`);
  const lastDate = vals.map((v) => num(v) != null).lastIndexOf(true);
  t.ok(blanks.every((i) => i > lastDate), `${what}: empty cells last`);
}

h.seed();
h.run("date sorting", async (page, t) => {
  for (const [tab, table, label] of [
    ["members", "#mem-table", "Birthday"],
    ["members", "#mem-table", "Baptism Date"],
    ["members", "#mem-table", "Temple Recommend Expiration"],
    ["custom", "#cr-table", "Birthday"],
    ["actions", "#al-table", "Baptism Date"],
  ]) {
    await h.goTab(page, tab);
    const idx = await column(page, table, label);
    if (idx < 0) { t.ok(false, `${tab}: no ${label} column`); continue; }
    let vals = await sortBy(page, table, idx);
    let dir = num(vals[0]) != null && num(vals[vals.length - 1]) != null && num(vals[0]) > num(vals[vals.length - 1]) ? -1 : 1;
    check(t, vals, `${tab} · ${label}`, dir);
    vals = await sortBy(page, table, idx);
    check(t, vals, `${tab} · ${label} reversed`, -dir);
  }

  // Text columns stay alphabetical — a class name is not a date.
  await h.goTab(page, "members");
  const ci = await column(page, "#mem-table", "Class Assignment");
  const cls = (await sortBy(page, "#mem-table", ci)).filter((v) => v && v !== "—");
  const sorted = cls.slice().sort((a, b) => a.localeCompare(b));
  t.ok(JSON.stringify(cls) === JSON.stringify(sorted) || JSON.stringify(cls) === JSON.stringify(sorted.reverse()),
    "a text column still sorts alphabetically");
}, { viewport: { width: 1500, height: 1000 } });
