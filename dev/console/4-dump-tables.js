/**
 * FALLBACK — Copy the rendered tables to the clipboard as TSV.
 *
 * Use when the flight payload cannot be parsed, or to sanity-check the
 * parser against what is actually on screen. This is also the shape a
 * Playwright DOM-scraping fallback would take.
 */

copy(
  [...document.querySelectorAll("table")]
    .map((t) =>
      [...t.rows]
        .map((r) => [...r.cells].map((c) => c.innerText.trim()).join("\t"))
        .join("\n")
    )
    .join("\n\n")
);
console.log("Tables copied to clipboard as TSV.");
