#!/usr/bin/env node
/**
 * Guards the one rule every attendance figure depends on:
 *
 *   Somebody with no eligible Sunday in the period — baptized after the last
 *   week pulled, or not on the roll — counts as ATTENDING. There was nothing
 *   for them to miss, so they must never be reported as absent.
 *
 *   node dev/check-attending.js
 *
 * The rule lives in one function, eligibleWeeks() in public/app.js, and every
 * count of "attending" is derived from it. This file asserts that function
 * behaves, and that nobody has quietly re-implemented the baptism window
 * somewhere else — which is how these figures drift apart.
 */

const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "public", "app.js");
const src = fs.readFileSync(SRC, "utf8");
const fails = [];
const eq = (label, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fails.push(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
};

// --- the rule itself, lifted out of the shipped source ---------------------
const i = src.indexOf("  function eligibleWeeks(");
if (i < 0) fails.push("eligibleWeeks() is gone — the eligibility rule has no home");
const body = src.slice(i, src.indexOf("\n  }\n", i) + 4);
// Sundays 05 Jul .. 26 Jul 2026, the shape the roll has.
const WEEKS = [20260705, 20260712, 20260719, 20260726];
const eligibleWeeks = new Function(
  "attIndex",
  body + "\nreturn eligibleWeeks;"
)(() => ({ weekNums: WEEKS }));

const full = { start: 0, end: WEEKS.length - 1 };
eq("nobody baptized: every week is eligible", eligibleWeeks(null, full), [0, 1, 2, 3]);
eq("baptized before the period", eligibleWeeks(20260101, full), [0, 1, 2, 3]);
eq("baptized mid-period: only later weeks", eligibleWeeks(20260712, full), [2, 3]);
eq("the baptism Sunday itself does not count", eligibleWeeks(20260705, full), [1, 2, 3]);
// The case this whole file exists for.
eq("baptized after the last week: NO eligible Sunday", eligibleWeeks(20260906, full), []);
eq("baptized on the last week: no eligible Sunday", eligibleWeeks(20260726, full), []);
eq("a sub-range narrows it", eligibleWeeks(null, { start: 1, end: 2 }), [1, 2]);
eq("range clamps to the weeks held", eligibleWeeks(null, { start: -5, end: 99 }), [0, 1, 2, 3]);

// --- and that it stays the only implementation -----------------------------
// The baptism window is a date compared against a week. Written once, inside
// eligibleWeeks; anywhere else is a second copy waiting to disagree with it.
const windowTests = src.match(/wd\s*<=\s*bapt|weekNums\[i\]\s*<=\s*bapt/g) || [];
if (windowTests.length !== 1) {
  fails.push(
    `the baptism window is implemented ${windowTests.length} times, expected 1 ` +
    "(inside eligibleWeeks) — derive from eligibleWeeks() instead of re-writing it"
  );
}

// Both attendance readings must report a blank as attending, not absent.
const blanks = src.match(/status: "yes", tier: "unknown", total: 0, weeks: 0/g) || [];
if (blanks.length !== 4) {
  fails.push(
    `expected 4 blank-attendance returns marked status "yes", found ${blanks.length} ` +
    "— a blank (no eligible Sunday, or not on the roll) counts as attending"
  );
}

if (fails.length) {
  console.error("FAILED\n" + fails.map((f) => "  " + f).join("\n"));
  process.exit(1);
}
console.log("Attendance-eligibility checks passed.");
console.log("  a blank period counts as attending, and the rule is written once.");
