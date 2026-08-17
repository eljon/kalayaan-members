#!/usr/bin/env node
/**
 * Generates a synthetic payload matching the real LCR flight shape, so the
 * app can be developed and tested without touching LCR or handling real
 * membership records.
 *
 *   node dev/make-fixture.js
 *
 * Writes output/latest.json. Reproduces the known-good July 2026 totals
 * (103 / 130 / 134 / 118 present, 9 / 18 / 16 / 10 visiting, 556 on the
 * roll, 180 attending, 58 every week) so regressions are detectable.
 *
 * Every name is invented. Nothing here came from a real ward.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { parse } = require("../lib/parse");

const uid = (s) => crypto.createHash("md5").update(s).digest("hex");

// Deterministic PRNG so the fixture is identical on every run.
let seed = 20260705;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const pick = (a) => a[Math.floor(rand() * a.length)];

const weekOptions = [
  { date: "2026-07-05", dateDisplay: "05 Jul", weekCode: "ONE_THREE" },
  { date: "2026-07-12", dateDisplay: "12 Jul", weekCode: "TWO_FOUR" },
  { date: "2026-07-19", dateDisplay: "19 Jul", weekCode: "ONE_THREE" },
  { date: "2026-07-26", dateDisplay: "26 Jul", weekCode: "TWO_FOUR" },
];

const visitors = [
  { date: "2026-07-05", weekCode: "ONE_THREE", men: 2, women: 2, youngMen: 1, youngWomen: 1, children: 3 },
  { date: "2026-07-12", weekCode: "TWO_FOUR", men: 5, women: 6, youngMen: 2, youngWomen: 2, children: 3 },
  { date: "2026-07-19", weekCode: "ONE_THREE", men: 4, women: 5, youngMen: 3, youngWomen: 2, children: 2 },
  { date: "2026-07-26", weekCode: "TWO_FOUR", men: 3, women: 3, youngMen: 1, youngWomen: 1, children: 2 },
];

const tree = {
  "Elders Quorum": [],
  "Relief Society": [],
  "Aaronic Priesthood Quorums": ["Priests Quorum", "Teachers Quorum", "Deacons Quorum"],
  "Young Women": ["Gatherers of Light", "Messengers of Hope", "Builders of Faith"],
  "Sunday School": ["Adult Sunday School", "Course 17", "Course 16", "Course 15", "Course 14", "Course 13"],
  Primary: ["Valiant 11", "Valiant 10", "CTR 8"],
};

const orgOptions = Object.entries(tree).map(([name, kids]) => {
  const o = { name, uuid: uid(name), orgTypeId: 70 };
  if (kids.length) o.childOrgs = kids.map((k) => ({ name: k, uuid: uid(k), orgTypeId: 1255 }));
  return o;
});
const leafOrgs = Object.entries(tree).flatMap(([n, k]) => (k.length ? k : [n]));

const surnames = "Abella Bautista Cabrera Delgado Espinosa Fajardo Gutierrez Hidalgo Ibarra Jimenez Lorenzo Marquez Navarro Ocampo Padilla Quintero Reyes Salcedo Tolentino Urbano Valdez Yumul Zamora".split(" ");
const givens = "Adriana Benigno Clarita Dominga Emilio Faustina Gregorio Herminia Ignacio Josefina Leandro Milagros Nicanor Ofelia Prospero Rosalinda Salvador Teodora Ulises Veronica".split(" ");

// Targets taken from the real July 2026 pull, so a regression is visible.
const TOTAL = 556, ATTENDING = 180, PERFECT = 58;
const PRESENT = [103, 130, 134, 118];

const members = [];
const used = new Set();
const makeName = () => {
  let n;
  do {
    n = `${pick(surnames)}, ${pick(givens)} ${pick(givens)}`;
  } while (used.has(n));
  used.add(n);
  return n;
};

// Perfect attenders cover PERFECT of every week; the rest of each week's
// count is filled exactly by the remaining attenders.
const need = PRESENT.map((p) => p - PERFECT);
const partial = ATTENDING - PERFECT;
const assigned = Array.from({ length: partial }, () => new Set());

// Hand out one week at a time, always to the week that still needs the
// most bodies, skipping members who already have that week. This lands on
// the targets exactly rather than approximately.
let guard = 0;
while (need.some((n) => n > 0) && guard++ < 10000) {
  const w = need.indexOf(Math.max(...need));
  const candidate = assigned
    .map((set, i) => ({ set, i }))
    .filter((c) => !c.set.has(w) && c.set.size < 3)
    .sort((a, b) => a.set.size - b.set.size)[0];
  if (!candidate) break;
  candidate.set.add(w);
  need[w]--;
}

// Anyone left with nothing would inflate the "never seen" count, so give
// them the week with the most slack. This cannot happen with the numbers
// above, but the fixture should not silently drift if they change.
assigned.forEach((set, i) => {
  if (set.size === 0) {
    set.add(0);
    need[0]--;
  }
});

for (let i = 0; i < ATTENDING; i++) {
  const name = makeName();
  const weeks =
    i < PERFECT
      ? weekOptions.slice()
      : [...assigned[i - PERFECT]].sort().map((idx) => weekOptions[idx]);
  members.push({
    name,
    nameSort: name,
    uuid: uid(name),
    gender: rand() > 0.5 ? "M" : "F",
    orgIds: [uid(pick(leafOrgs)), uid(pick(leafOrgs))],
    weeks: weeks.map((w) => ({ date: w.date, weekCode: w.weekCode, didAttend: true })),
  });
}

// Everyone else has never been seen: weeks is empty, not false entries.
for (let i = members.length; i < TOTAL; i++) {
  const name = makeName();
  members.push({
    name,
    nameSort: name,
    uuid: uid(name),
    gender: rand() > 0.5 ? "M" : "F",
    orgIds: rand() > 0.15 ? [uid(pick(leafOrgs))] : [],
    weeks: [],
  });
}

const payload = {
  orgId: uid("fixture-org"),
  unitNumber: 2330423,
  orgOptions,
  weekOptions,
  visitors,
  members,
};

const parsed = parse(payload);
parsed.fetchedAt = new Date().toISOString();

const out = path.join(__dirname, "..", "output");
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "latest.json"), JSON.stringify(parsed));
fs.writeFileSync(path.join(__dirname, "fixture-payload.json"), JSON.stringify(payload, null, 2));

console.log("Fixture written to output/latest.json");
console.log(`  ${parsed.stats.members} on the roll, ${parsed.stats.attending} attending, ${parsed.stats.everyWeek} every week, ${parsed.stats.absent} never seen`);
console.table(parsed.weekTotals);
console.log("\nNow run: npm run server");
