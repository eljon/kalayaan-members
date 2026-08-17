# Console tools

Paste these into the browser console on a signed-in LCR report page.
They are the tools that found the data in the first place, kept here so
the method is repeatable for other reports and after LCR deploys.

Read `../../DISCOVERY.md` for the reasoning behind them.

| File | Use |
|---|---|
| `1-find-endpoint.js` | Which request carries the data. Start here. |
| `2-inspect-flight.js` | Capture the payload, find the data line. |
| `3-inspect-shape.js` | Read the structure before writing a parser. |
| `4-dump-tables.js` | Fallback: copy the rendered table as TSV. |
| `5-diff-date-request.js` | Find the parameter that selects the month. |
| `6-dump-post.js` | Repair: refresh the month-switch action id. |
| `7-custom-report.js` | Discover how a custom report delivers its data. |

**The one thing people get wrong:** after pasting, you must *interact*
with the page, usually by changing a dropdown or the date range. The
initial page load often does not carry the payload.
