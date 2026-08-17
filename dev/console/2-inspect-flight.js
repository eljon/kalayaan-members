/**
 * STEP 2 — Capture the flight payload and locate the data line.
 *
 * Paste, then change a dropdown. Saves the raw response to
 * window.__flight and prints the numbered lines that look like they hold
 * real content.
 *
 * RSC flight format is newline-separated `id:content`. Most lines are
 * chunk manifests (`2:I[...]`) or preload hints (`:HL[...]`). The data
 * line is usually the long one that parses as JSON.
 *
 * Edit ROUTE for a different report.
 */

(() => {
  const ROUTE = "class-and-quorum-attendance";

  const orig = window.fetch;
  window.fetch = async function (...args) {
    const res = await orig.apply(this, args);
    const url = (args[0]?.url || args[0]) + "";
    if (url.includes(ROUTE)) {
      res.clone().text().then((body) => {
        window.__flight = body;
        console.log("%ccaptured", "color:lime", body.length, "chars -> window.__flight");

        const lines = body.split(/\n(?=[0-9a-f]+:)/);
        console.log("lines:", lines.length);

        for (const line of lines) {
          const id = line.slice(0, line.indexOf(":"));
          if (line.length < 500) continue;

          let parses = false;
          try {
            JSON.parse(line.slice(id.length + 1));
            parses = true;
          } catch (_) {}

          console.log(
            `%cline ${id}`,
            parses ? "color:lime;font-weight:bold" : "color:gray",
            line.length,
            parses ? "PARSES AS JSON" : "",
            line.slice(0, 160)
          );
        }
        console.log("\nThe line marked PARSES AS JSON is your data. For this report it is line 1.");
      });
    }
    return res;
  };
  console.log("%cArmed.", "color:lime;font-weight:bold", "Change a dropdown to capture.");
})();
