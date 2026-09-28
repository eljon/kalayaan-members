/**
 * A printed report is read, not operated.
 *
 * Nothing on paper may be a control, the app's own summary sentence stays
 * off, a description somebody typed takes its place, and what the controls
 * were set to is stated as text instead. Also the legibility rules the
 * printed table has to keep: headers whole, row numbers whole.
 */

const h = require("./harness");

// The controls: things that draw as something to operate — a field, a
// dropdown, a button, a switch. None of them may reach the page.
//
// This is deliberately a list of chrome, not of `role="button"`. Plenty of
// the report IS clickable on screen without looking like a control: a name
// opens a profile, an attendance figure opens that person's weeks, an
// indicator row opens the people behind the number, a column header sorts.
// Their whole affordance is a cursor and a hover tint, neither of which
// exists on paper — so each is checked below for printing as what it says,
// rather than being caught here for carrying an attribute.
const INTERACTIVE =
  "select, input, textarea, a[href]:not([href^='#']), button:not(.name-link)," +
  " .btn, .icon-btn, .g-seg, .g-seg-group, .subtab, .g-toggle," +
  " .range-bar, .graph-controls, .cr-controls, .controls";

const visible = (page, sel) => page.$$eval(sel, (n) => n
  .filter((e) => e.offsetParent !== null || e.getClientRects().length > 0)
  .map((e) => String(e.id || e.className || e.tagName))
  .slice(0, 8));

async function toPrint(page, tab) {
  await page.emulateMedia({ media: "screen" });
  await h.goTab(page, tab);
  await page.click("#" + h.PDF_BTN[tab]);
  await page.waitForTimeout(300);
  await page.emulateMedia({ media: "print" });
  await page.waitForTimeout(400);
}

h.seed();
h.run("printed report", async (page, t) => {
  // window.print() would open a dialog nothing can dismiss.
  await page.evaluate(() => { window.print = () => {}; });

  for (const tab of h.TABS) {
    await toPrint(page, tab);
    const live = await visible(page, `.view:not([hidden]) ${INTERACTIVE}`);
    t.ok(live.length === 0,
      `${tab}: nothing clickable survives onto the page${live.length ? " — " + JSON.stringify(live) : ""}`);
    const summary = await visible(page, ".view:not([hidden]) .cr-summary");
    t.ok(summary.length === 0, `${tab}: the app's own summary sentence is not printed`);
  }

  // ---- the controls become text ------------------------------------------
  await toPrint(page, "custom");
  const params = await page.$eval("#print-params", (e) => e.textContent.trim());
  t.ok(/Weeks .+ – .+/.test(params), `custom: the week range is stated as text — "${params}"`);
  t.ok(/grouped (weekly|monthly|quarterly)/.test(params), "custom: and so is the grouping");
  t.ok(await page.isHidden(".view:not([hidden]) .range-bar"), "custom: the range pickers themselves are gone");

  // Pick a grouping that is NOT the one already set, or this proves nothing.
  await page.emulateMedia({ media: "screen" });
  const was = (/grouped (\w+)/.exec(params) || [])[1];
  const want = was === "quarterly" ? "weekly" : "quarterly";
  const segs = await page.$$(".view:not([hidden]) .g-seg");
  await segs[{ weekly: 0, monthly: 1, quarterly: 2 }[want]].click();
  await page.waitForTimeout(600);
  await toPrint(page, "custom");
  const params2 = await page.$eval("#print-params", (e) => e.textContent.trim());
  t.ok(params2.includes("grouped " + want) && params2 !== params,
    `it follows the control: "${was}" -> "${want}" ("${params2}")`);

  // ---- the description ----------------------------------------------------
  await page.emulateMedia({ media: "screen" });
  await h.goTab(page, "actions");
  await page.fill("#al-desc", "");
  await page.waitForTimeout(500);
  await toPrint(page, "actions");
  t.ok(await page.isHidden("#print-desc"), "an empty description prints nothing");

  const typed = "Brethren to visit before the end of the month";
  await page.emulateMedia({ media: "screen" });
  await page.fill("#al-desc", typed);
  await page.waitForTimeout(600);
  await toPrint(page, "actions");
  t.ok(await page.isVisible("#print-desc"), "a description somebody typed does print");
  t.eq(await page.$eval("#print-desc", (e) => e.textContent.trim()), typed, "and it is the text they typed");
  t.ok(await page.isHidden("#al-desc"), "the input it was typed into is not what prints");

  // On screen the description lives in an <input>, which on paper would show
  // one clipped line of it.
  const long = "A deliberately long description, longer than one line of a landscape page, so that " +
    "the check is about whether the whole of it survives onto the paper rather than about whether a " +
    "short one happens to fit; an <input> would have shown the first line and swallowed the rest.";
  await page.emulateMedia({ media: "screen" });
  await page.fill("#al-desc", long);
  await page.waitForTimeout(600);
  await toPrint(page, "actions");
  const box = await page.$eval("#print-desc", (e) => ({
    text: e.textContent.trim(),
    h: e.getBoundingClientRect().height,
    line: parseFloat(getComputedStyle(e).lineHeight),
    overflows: e.scrollWidth > e.clientWidth + 1,
  }));
  t.ok(box.text === long, "a long description prints in full");
  t.ok(box.h > box.line * 1.5,
    `and wraps onto further lines (${Math.round(box.h)}px over ${Math.round(box.line)}px lines)`);
  t.ok(!box.overflows, "with nothing running off the side");
  await page.emulateMedia({ media: "screen" });
  await page.fill("#al-desc", "");
  await page.waitForTimeout(400);

  // ---- the table stays legible -------------------------------------------
  await toPrint(page, "members");
  const chopped = await page.evaluate(() => {
    const out = [];
    for (const th of document.querySelectorAll("#mem-table thead th")) {
      // A header is broken mid-word when its widest word needs more room
      // than the cell gives it.
      const probe = document.createElement("span");
      probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre;";
      probe.style.font = getComputedStyle(th).font;
      document.body.appendChild(probe);
      let widest = 0;
      for (const w of th.textContent.trim().split(/\s+/)) {
        probe.textContent = w;
        widest = Math.max(widest, probe.getBoundingClientRect().width);
      }
      probe.remove();
      const cs = getComputedStyle(th);
      const inner = th.getBoundingClientRect().width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      if (widest > inner + 0.5) out.push(th.textContent.trim());
    }
    return out;
  });
  t.ok(chopped.length === 0,
    `members: no header is chopped mid-word${chopped.length ? " — " + JSON.stringify(chopped) : ""}`);

  const nums = await page.$$eval("#mem-table .num-td", (n) => n.slice(8, 13).map((e) => e.textContent));
  t.eq(nums.join(","), "9,10,11,12,13", "row numbers read straight");
  const numWrapped = await page.$$eval("#mem-table .num-td", (n) => n.some((e) => e.scrollHeight > e.clientHeight + 1));
  t.ok(!numWrapped, "and none of them wraps");

  const nm = await page.$eval("#mem-table .name-link", (e) => {
    const cs = getComputedStyle(e);
    return { border: cs.borderBottomWidth, deco: cs.textDecorationLine };
  });
  t.ok(nm.border === "0px" && nm.deco === "none",
    `a name prints as plain text, not a control (${JSON.stringify(nm)})`);

  // The affordance on an attendance figure is a hover/focus outline and a
  // pointer cursor — neither of which exists on paper. What must not appear
  // is anything that reads as a button when it cannot be pressed.
  const fig = await page.$eval("#mem-table .att-td .part", (e) => {
    const cs = getComputedStyle(e);
    return { outline: cs.outlineStyle, deco: cs.textDecorationLine, border: cs.borderTopWidth };
  });
  t.ok(fig.outline === "none" && fig.deco === "none" && fig.border === "0px",
    `an attendance figure prints as a figure (${JSON.stringify(fig)})`);

  // A sortable column header is a header, not a button.
  const th = await page.$eval("#mem-table thead th:nth-child(2)", (e) => {
    const cs = getComputedStyle(e);
    return { outline: cs.outlineStyle, deco: cs.textDecorationLine };
  });
  t.ok(th.outline === "none" && th.deco === "none",
    `a sortable header prints as a header (${JSON.stringify(th)})`);

  await page.emulateMedia({ media: "screen" });
  await toPrint(page, "quarterly");
  const rowBgs = await page.$$eval("#qi-table .qi-clickable",
    (n) => [...new Set(n.slice(0, 8).map((e) => getComputedStyle(e).backgroundColor))]);
  t.ok(rowBgs.length === 1, `an indicator row prints as a row (${JSON.stringify(rowBgs)})`);

  // Where the pointer happened to be resting is not part of the report.
  await page.emulateMedia({ media: "screen" });
  await h.goTab(page, "members");
  await page.hover("#mem-table tbody tr:nth-child(3)");
  await page.waitForTimeout(200);
  await page.click("#mem-pdf");
  await page.waitForTimeout(300);
  await page.emulateMedia({ media: "print" });
  await page.waitForTimeout(300);
  const bgs = await page.$$eval("#mem-table tbody tr",
    (n) => [...new Set(n.slice(0, 8).map((e) => getComputedStyle(e).backgroundColor))]);
  t.ok(bgs.length === 1, `no row is tinted by where the pointer was left (${JSON.stringify(bgs)})`);
}, { viewport: { width: 1039, height: 1200 } });
