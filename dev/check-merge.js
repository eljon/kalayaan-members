#!/usr/bin/env node
/**
 * Merge regression check. Proves mergeMonths against hand-built payloads
 * so the multi-month path is verified without touching LCR.
 *
 *   node dev/check-merge.js
 *
 * Two months, June and July. One member attends across both, one is only
 * on June's roll, one only on July's. Asserts the merged roll spans all
 * weeks, unions each member's attendance, unions the roster, and sums
 * visitors per week.
 */

const { parse, mergeMonths } = require("../lib/parse");

const org = { name: "Elders Quorum", uuid: "org-eq", orgTypeId: 70 };

// June: two weeks. July: two weeks.
const june = {
  orgId: "o",
  unitNumber: 2330423,
  orgOptions: [org],
  weekOptions: [
    { date: "2026-06-07", dateDisplay: "07 Jun", weekCode: "ONE_THREE" },
    { date: "2026-06-14", dateDisplay: "14 Jun", weekCode: "TWO_FOUR" },
  ],
  visitors: [
    { date: "2026-06-07", men: 1, women: 1, youngMen: 0, youngWomen: 0, children: 0 },
    { date: "2026-06-14", men: 0, women: 2, youngMen: 0, youngWomen: 0, children: 1 },
  ],
  members: [
    // Attends one June week; will also attend in July.
    { name: "Reyes, Ana", nameSort: "Reyes, Ana", uuid: "u-ana", gender: "F", orgIds: ["org-eq"],
      weeks: [{ date: "2026-06-07", weekCode: "ONE_THREE", didAttend: true }] },
    // Only on June's roll, never attended.
    { name: "Cruz, Ben", nameSort: "Cruz, Ben", uuid: "u-ben", gender: "M", orgIds: ["org-eq"], weeks: [] },
  ],
};

const july = {
  orgId: "o",
  unitNumber: 2330423,
  orgOptions: [org],
  weekOptions: [
    { date: "2026-07-05", dateDisplay: "05 Jul", weekCode: "ONE_THREE" },
    { date: "2026-07-12", dateDisplay: "12 Jul", weekCode: "TWO_FOUR" },
  ],
  visitors: [
    { date: "2026-07-05", men: 3, women: 0, youngMen: 0, youngWomen: 0, children: 0 },
    { date: "2026-07-12", men: 0, women: 0, youngMen: 1, youngWomen: 1, children: 0 },
  ],
  members: [
    // Same person as June (u-ana), attends both July weeks. Name updated.
    { name: "Reyes, Ana Marie", nameSort: "Reyes, Ana Marie", uuid: "u-ana", gender: "F", orgIds: ["org-eq"],
      weeks: [
        { date: "2026-07-05", weekCode: "ONE_THREE", didAttend: true },
        { date: "2026-07-12", weekCode: "TWO_FOUR", didAttend: true },
      ] },
    // Only on July's roll (moved in), attends once.
    { name: "Santos, Cio", nameSort: "Santos, Cio", uuid: "u-cio", gender: "F", orgIds: ["org-eq"],
      weeks: [{ date: "2026-07-12", weekCode: "TWO_FOUR", didAttend: true }] },
  ],
};

// Deliberately pass newest-first to prove the merge orders internally.
const merged = mergeMonths([july, june]);
const got = parse(merged);

const fails = [];
const eq = (label, a, b) => {
  if (a !== b) fails.push(`${label}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
};

// Four weeks, chronological.
eq("week count", got.weekOptions.length, 4);
eq("weeks ordered", got.weekOptions.map((w) => w.date).join(","),
  "2026-06-07,2026-06-14,2026-07-05,2026-07-12");

// Roster is the union of both months: Ana, Ben, Cio.
eq("roster size", got.stats.members, 3);

// Ana attended June wk1 + both July weeks = 3 of 4. Identity is the July (latest) name.
const ana = got.rows.find((r) => r.uuid === "u-ana");
eq("ana total", ana && ana.total, 3);
eq("ana latest name wins", ana && ana.name, "Reyes, Ana Marie");
eq("ana cells", ana && ana.cells.join(","), "true,false,true,true");

// Ben never attended, on the roll only via June.
const ben = got.rows.find((r) => r.uuid === "u-ben");
eq("ben total", ben && ben.total, 0);

// Cio only exists in July; June weeks are blank, not attended.
const cio = got.rows.find((r) => r.uuid === "u-cio");
eq("cio total", cio && cio.total, 1);
eq("cio cells", cio && cio.cells.join(","), "false,false,false,true");

// Visitors summed per week from each month's payload.
eq("jun07 visitors", got.weekTotals[0].visitors, 2);
eq("jun14 visitors", got.weekTotals[1].visitors, 3);
eq("jul05 visitors", got.weekTotals[2].visitors, 3);
eq("jul12 visitors", got.weekTotals[3].visitors, 2);

// Members-present per week.
eq("jun07 present", got.weekTotals[0].membersPresent, 1);
eq("jul12 present", got.weekTotals[3].membersPresent, 2);

// Never-seen across the whole span: only Ben.
eq("absent across span", got.stats.absent, 1);

if (fails.length) {
  console.error("MERGE FAILED\n" + fails.map((f) => "  " + f).join("\n"));
  process.exit(1);
}

console.log("Merge checks passed.");
console.log(`  ${got.stats.members} on the merged roll across ${got.weekOptions.length} weeks, ${got.stats.absent} never seen`);
