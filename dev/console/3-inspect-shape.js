/**
 * STEP 3 — Read the structure of the data line.
 *
 * Run AFTER 2-inspect-flight.js has populated window.__flight, in the
 * same page session. Prints top-level keys and a sample from every array
 * so you can see the shape before writing a parser.
 *
 * Change LINE_ID if step 2 identified a different line.
 */

(() => {
  const LINE_ID = "1";

  if (!window.__flight) {
    console.error("window.__flight is empty. Run 2-inspect-flight.js first, then change a dropdown.");
    return;
  }

  const line = window.__flight
    .split(/\n(?=[0-9a-f]+:)/)
    .find((l) => l.startsWith(LINE_ID + ":"));

  if (!line) {
    console.error(`No line ${LINE_ID}: found.`);
    return;
  }

  let data;
  try {
    data = JSON.parse(line.slice(LINE_ID.length + 1));
  } catch (e) {
    console.error("Line did not parse as JSON:", e.message);
    console.log(line.slice(0, 300));
    return;
  }

  window.__data = data;
  console.log("%cparsed -> window.__data", "color:lime;font-weight:bold");
  console.log("top-level keys:", Object.keys(data));

  for (const [k, v] of Object.entries(data)) {
    if (Array.isArray(v)) {
      console.log(`%c${k}`, "font-weight:bold", `ARRAY len ${v.length}`);
      console.log("   sample:", JSON.stringify(v[0])?.slice(0, 300));
    } else if (v && typeof v === "object") {
      console.log(`%c${k}`, "font-weight:bold", "OBJECT", Object.keys(v).slice(0, 20));
    } else {
      console.log(`%c${k}`, "font-weight:bold", v);
    }
  }

  // The trap that cost real time: nested arrays that are usually empty.
  if (Array.isArray(data.members)) {
    const withWeeks = data.members.filter((m) => m.weeks && m.weeks.length);
    console.log(
      `\n%cmembers with a non-empty weeks[]:`,
      "color:orange;font-weight:bold",
      withWeeks.length,
      "of",
      data.members.length
    );
    console.log("sample weeks:", JSON.stringify(withWeeks[0]?.weeks));
    console.log(
      "%cNote:",
      "color:orange",
      "weeks[] holds ONLY attended weeks. Absence is omission, not didAttend:false."
    );
  }
})();
