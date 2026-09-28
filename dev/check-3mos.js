#!/usr/bin/env node
/**
 * Guards the 3MOS column — attendance over the last twelve weeks, shown
 * beside the full-range Attendance column wherever that column appears.
 *
 *   node dev/check-3mos.js
 *
 * The shipped fixture holds four Sundays, which is fewer than 3MOS spans, so
 * on the fixture the two columns are necessarily identical and nothing about
 * the windowing is exercised. This file builds its own twenty-week roll and
 * runs the shipped functions against it, so the divergence is actually
 * tested rather than assumed.
 *
 * Both functions are lifted out of public/app.js rather than copied here.
 * A copy would keep passing after the real one changed, which is the whole
 * failure mode these checks exist to catch.
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
const lift = (name) => {
  const i = src.indexOf(`  function ${name}(`);
  if (i < 0) { fails.push(`${name}() is gone`); return null; }
  return src.slice(i, src.indexOf("\n  }\n", i) + 4);
};

// Twenty consecutive Sundays, 15 Mar – 26 Jul 2026, as yyyymmdd — the shape
// attIndex() hands the rest of the app.
const WEEKS = [];
for (let d = new Date(Date.UTC(2026, 2, 15)); WEEKS.length < 20; d.setUTCDate(d.getUTCDate() + 7)) {
  WEEKS.push(d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate());
}
const LAST = WEEKS.length - 1;

const eligibleSrc = lift("eligibleWeeks");
const recentSrc = lift("recentRange");
const infoSrc = lift("attendanceInfoRange");
if (fails.length) { console.error("FAILED\n" + fails.map((f) => "  " + f).join("\n")); process.exit(1); }

// MOS3_WEEKS is what recentRange counts back by; take it from the source so
// the assertions below track the shipped value instead of restating it.
const mos3 = /const MOS3_WEEKS = (\d+);/.exec(src);
if (!mos3) fails.push("MOS3_WEEKS is gone — 3MOS has no defined span");
const SPAN = mos3 ? Number(mos3[1]) : 12;
if (SPAN !== 12) fails.push(`MOS3_WEEKS is ${SPAN}; 3MOS means three months, i.e. 12 weeks`);

// A roll to read: one person present every week, one present only in the
// first half (so the two columns MUST disagree), one never seen.
const ROLL = {
  Always: WEEKS.map(() => true),
  EarlyOnly: WEEKS.map((_, i) => i < 8),
  Never: WEEKS.map(() => false),
};
const BAPTISED = { Always: null, EarlyOnly: null, Never: null, Newcomer: WEEKS[LAST - 2] };
ROLL.Newcomer = WEEKS.map((_, i) => i > LAST - 2);

const build = (weekNums) => new Function(
  "attIndex", "attendanceFor", "baptismDateOf", "attendanceTier", "weekCount",
  // The Settings opt-out, with nothing excluded — this file is about the
  // twelve-week window, not about which Sundays somebody ticked off.
  "isExcludedWeek",
  `const MOS3_WEEKS = ${SPAN};\n` + eligibleSrc + recentSrc + infoSrc +
  "\nreturn { eligibleWeeks, recentRange, attendanceInfoRange };"
)(
  () => ({ weekNums }),
  (name) => (ROLL[name] ? { cells: ROLL[name] } : null),
  (name) => BAPTISED[name],
  (pct) => (pct <= 0 ? "p0" : pct <= 25 ? "p25" : pct < 50 ? "p50" : "p100"),
  () => weekNums.length,
  () => false,
);

// ---------------------------------------------------- twenty weeks of roll
{
  const { recentRange, attendanceInfoRange } = build(WEEKS);
  const full = { start: 0, end: LAST };

  eq("3MOS window is the last 12 weeks of the roll", recentRange(full), { start: 8, end: 19 });
  eq("and with no range given it still ends at the last week pulled",
     recentRange(null), { start: 8, end: 19 });

  const alwaysFull = attendanceInfoRange("Always", full);
  const always3mo = attendanceInfoRange("Always", recentRange(full));
  eq("perfect attender, full range", alwaysFull.text, "20/20 100%");
  eq("perfect attender, 3MOS", always3mo.text, "12/12 100%");

  // The case the fixture cannot show: somebody who stopped coming. The full
  // range still credits the weeks they attended; 3MOS reports the present.
  const earlyFull = attendanceInfoRange("EarlyOnly", full);
  const early3mo = attendanceInfoRange("EarlyOnly", recentRange(full));
  eq("lapsed attender, full range", earlyFull.text, "8/20 40%");
  eq("lapsed attender, 3MOS", early3mo.text, "0/12 0%");
  if (earlyFull.text === early3mo.text) {
    fails.push("the two columns did not diverge — 3MOS is not windowing anything");
  }
  eq("and 3MOS is the column that calls them absent",
     [earlyFull.status, early3mo.status], ["yes", "no"]);

  eq("never seen reads 0 in both", [attendanceInfoRange("Never", full).text,
                                    attendanceInfoRange("Never", recentRange(full)).text],
     ["0/20 0%", "0/12 0%"]);

  // The baptism window still applies inside the 3MOS window: a recent convert
  // is measured over the Sundays they have had, not twelve.
  eq("a recent convert is measured over their own Sundays",
     attendanceInfoRange("Newcomer", recentRange(full)).text, "2/2 100%");

  // A narrowed report range moves the finish line with it, so the two
  // columns on screen are always read against the same end date.
  eq("a narrowed range moves the 3MOS window with it",
     recentRange({ start: 4, end: 15 }), { start: 4, end: 15 });
  eq("3MOS never starts before the roll does",
     recentRange({ start: 0, end: 5 }), { start: 0, end: 5 });
}

// ------------------------------------------------- fewer weeks than 3 months
// What the shipped fixture looks like. 3MOS must clamp to the weeks held
// rather than inventing a denominator of 12.
{
  const SHORT = WEEKS.slice(-4);
  const { recentRange, attendanceInfoRange } = build(SHORT);
  const full = { start: 0, end: SHORT.length - 1 };
  eq("a short roll clamps the window", recentRange(full), { start: 0, end: 3 });
  const a = attendanceInfoRange("Always", full);
  const b = attendanceInfoRange("Always", recentRange(full));
  eq("and the two columns then agree, over 4 weeks not 12", [a.text, b.text],
     ["4/4 100%", "4/4 100%"]);
}

// ------------------------------------------------ one window, written once
// recentRange() is where the twelve-week span lives. A second place that
// counts back by MOS3_WEEKS is a copy waiting to disagree with it.
const spans = src.match(/MOS3_WEEKS\s*-\s*1/g) || [];
if (spans.length !== 1) {
  fails.push(
    `the 3MOS window is computed ${spans.length} times, expected 1 (inside recentRange) ` +
    "— derive from recentRange() instead of re-writing it"
  );
}
// And every attendance column that reads it goes through recentRange.
if (/recent\s*\?/.test(src) === false) {
  fails.push("no column branches on `recent` — 3MOS is not being rendered anywhere");
}

if (fails.length) {
  console.error("FAILED\n" + fails.map((f) => "  " + f).join("\n"));
  process.exit(1);
}
console.log("3MOS checks passed.");
console.log(`  over 20 weeks: full range 8/20 40%, 3MOS 0/12 0% — the columns diverge.`);
