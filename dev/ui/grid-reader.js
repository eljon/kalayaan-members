/**
 * The LCR report reader must read every row of the grid.
 *
 * Reports are read from LCR's rendered table (lib/capture.js readGridRaw),
 * and a reader that stops early or throws rows away loses people without a
 * word — the all-members report is the roster, so a lost row is a member
 * who vanishes from every tab. This builds grids that misbehave the ways a
 * real one can and checks the reader gets all of them:
 *
 *   batched  rows arrive in batches after the first paint
 *   short    one row is drawn with fewer cells than the header
 *   virtual  only the rows in view exist in the page; scrolling swaps them
 *
 * Needs no server and no LCR — the grids are built in the page here.
 */

const h = require("./harness");
const { readGridRaw } = require("../../lib/capture");

const COLS = ["Preferred Name", "Age", "Gender", "Birth Date", "Callings"];
const people = Array.from({ length: 140 }, (_, i) =>
  [`Person ${String(i + 1).padStart(3, "0")}`, String(20 + (i % 60)), i % 2 ? "M" : "F", "01 Jan 1990", ""]);

const PAGES = {
  // Rows arrive 20 at a time, every 300ms, after the first two paint.
  batched: (rows) => `<table role="grid"><thead><tr>${COLS.map((c) => `<th>${c}</th>`).join("")}</tr></thead>
    <tbody id="b"></tbody></table>
    <script>
      const rows = ${JSON.stringify(rows)};
      const b = document.getElementById("b");
      const add = (n) => rows.splice(0, n).forEach((r) => {
        const tr = document.createElement("tr");
        tr.innerHTML = r.map((c) => "<td>" + c + "</td>").join("");
        b.appendChild(tr);
      });
      add(2);
      const t = setInterval(() => { add(20); if (!rows.length) clearInterval(t); }, 300);
    </script>`,
  // Everything at once, but one person's row is a cell short.
  short: (rows) => `<table role="grid"><thead><tr>${COLS.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>
    ${rows.map((r, i) => `<tr>${(i === 77 ? r.slice(0, 4) : r).map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}
    </tbody></table>`,
  // Only ~15 rows exist at any moment; scrolling the box swaps them.
  virtual: (rows) => `<div id="box" style="height:300px;overflow:auto">
      <div id="pad" style="position:relative"><table role="grid" style="position:absolute;top:0">
        <thead><tr>${COLS.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody id="b"></tbody></table></div></div>
    <script>
      const rows = ${JSON.stringify(rows)}, H = 20, SHOW = 15;
      const box = document.getElementById("box"), pad = document.getElementById("pad"), b = document.getElementById("b");
      pad.style.height = (rows.length * H + 40) + "px";
      const draw = () => {
        const first = Math.min(rows.length - SHOW, Math.floor(box.scrollTop / H));
        b.parentElement.style.top = (first * H) + "px";
        b.innerHTML = rows.slice(first, first + SHOW).map((r) => "<tr>" + r.map((c) => "<td>" + c + "</td>").join("") + "</tr>").join("");
      };
      box.addEventListener("scroll", draw); draw();
    </script>`,
};

(async () => {
  const why = h.blocked();
  if (why && /playwright/.test(why)) { console.log("SKIP grid reader — " + why); process.exit(0); }
  const { chromium } = require("playwright");
  const exe = h.chromiumPath();
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  let failed = 0;
  const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) failed += 1; };
  try {
    for (const [name, build] of Object.entries(PAGES)) {
      const page = await browser.newPage();
      await page.setContent(`<!doctype html><body>${build(people.map((p) => p.slice()))}</body>`);
      const got = await readGridRaw(page);
      const names = new Set(got.rows.map((r) => r[0]));
      const missing = people.filter((p) => !names.has(p[0])).map((p) => p[0]);
      ok(missing.length === 0, `${name}: all ${people.length} people read` +
        (missing.length ? ` — missing ${missing.length}: ${missing.slice(0, 5).join(", ")}` : ""));
      ok(got.rows.length === people.length, `${name}: and nobody twice (${got.rows.length})`);
      ok(got.headers.join("|") === COLS.join("|"), `${name}: header read as the header`);
      if (name === "short") {
        const p78 = got.rows.find((r) => r[0] === "Person 078");
        ok(!!p78 && p78.length === COLS.length && p78[4] === "", "short: the short row is kept, padded");
        ok(got.short.length === 1, "short: and reported as short");
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
  console.log(failed ? `\n${failed} FAILED in grid reader` : "\nALL PASSED — grid reader");
  process.exit(failed ? 1 : 0);
})();
