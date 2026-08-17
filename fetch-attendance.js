/**
 * Command-line attendance pull.
 *
 *   node fetch-attendance.js
 *
 * Writes three CSVs into ./output. Parsing lives in lib/parse.js so the
 * server and this script never drift apart.
 *
 * Exit codes: 0 success, 1 session expired, 2 parse failure.
 */

const fs = require("fs");
const path = require("path");
const { capture, SessionExpiredError, NoSessionError } = require("./lib/capture");
const { toCSV } = require("./lib/parse");

const OUT_DIR = path.join(__dirname, "output");

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);

  let result;
  try {
    result = await capture();
  } catch (err) {
    if (err instanceof NoSessionError || err instanceof SessionExpiredError) {
      console.error("Not signed in. Run: npm start  and sign in from the app.");
      process.exit(1);
    }
    console.error(`Pull failed: ${err.message}`);
    process.exit(2);
  }

  const unit = result.unitNumber;
  const base = path.join(OUT_DIR, `attendance-${unit}-${stamp}`);
  const attended = result.rows.filter((r) => r.total > 0);

  fs.writeFileSync(`${base}-all.csv`, toCSV(result.rows, result.weekOptions));
  fs.writeFileSync(`${base}-attended.csv`, toCSV(attended, result.weekOptions));
  fs.writeFileSync(
    `${base}-summary.csv`,
    ["week,date,weekCode,membersPresent,visitors,total"]
      .concat(
        result.weekTotals.map(
          (w) => `${w.week},${w.date},${w.weekCode},${w.membersPresent},${w.visitors},${w.total}`
        )
      )
      .join("\n")
  );
  fs.writeFileSync(path.join(OUT_DIR, "latest.json"), JSON.stringify(result));

  console.log(
    `${result.stats.members} members, ${result.stats.attending} with attendance, ${result.weekOptions.length} weeks across ${result.months || 1} month(s)`
  );
  console.table(result.weekTotals);
  if (result.warnings) result.warnings.forEach((w) => console.warn(`  note: ${w}`));
  console.log(`Written to ${OUT_DIR}`);
})();
