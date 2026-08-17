#!/usr/bin/env node
/**
 * Regression check. Runs the parser against the fixture and asserts the
 * numbers from the real July 2026 pull.
 *
 *   node dev/check.js
 *
 * Exits non-zero on any mismatch, so it works in a pre-commit hook or CI.
 */

const path = require("path");
const { parse } = require("../lib/parse");

const payload = require("./fixture-payload.json");
const got = parse(payload);

const expect = {
  members: 556,
  attending: 180,
  everyWeek: 58,
  absent: 376,
  weeks: [
    { week: "05 Jul", membersPresent: 103, visitors: 9, total: 112 },
    { week: "12 Jul", membersPresent: 130, visitors: 18, total: 148 },
    { week: "19 Jul", membersPresent: 134, visitors: 16, total: 150 },
    { week: "26 Jul", membersPresent: 118, visitors: 10, total: 128 },
  ],
};

const fails = [];
const eq = (label, a, b) => {
  if (a !== b) fails.push(`${label}: expected ${b}, got ${a}`);
};

eq("members", got.stats.members, expect.members);
eq("attending", got.stats.attending, expect.attending);
eq("everyWeek", got.stats.everyWeek, expect.everyWeek);
eq("absent", got.stats.absent, expect.absent);

expect.weeks.forEach((w, i) => {
  const g = got.weekTotals[i] || {};
  eq(`${w.week} present`, g.membersPresent, w.membersPresent);
  eq(`${w.week} visitors`, g.visitors, w.visitors);
  eq(`${w.week} total`, g.total, w.total);
});

// Structural guarantees the interface depends on.
const uuidish = /^[0-9a-f]{32}$/;
if (got.rows.some((r) => r.orgs.some((o) => uuidish.test(o))))
  fails.push("org uuids leaked into display names");
if (got.rows.some((r) => r.cells.length !== got.weekOptions.length))
  fails.push("a row has the wrong number of week cells");
if (!got.orgList.some((o) => o.name === "Course 15"))
  fails.push("nested childOrgs were not walked");

if (fails.length) {
  console.error("FAILED\n" + fails.map((f) => "  " + f).join("\n"));
  process.exit(1);
}

console.log("All checks passed.");
console.log(`  ${got.stats.members} on the roll, ${got.stats.attending} attending, ${got.stats.everyWeek} every week, ${got.stats.absent} never seen`);
