# How the data was found, and how to find more

This is the method, not just the result. Read it before trying to pull a
different LCR report, add date parameters, or repair the parser after an
LCR deploy. The technique is reusable; the specific findings are not.

## The problem

LCR reports look like they should have a JSON API behind them. They don't.
The site is Next.js with React Server Components, so the data arrives in
an internal serialization format on a route that looks like a page, not an
endpoint. Standard endpoint-hunting fails, and it fails in ways that look
like you're almost there, which is what wastes the time.

## What did not work, and why

Each of these was tried on the live class-and-quorum-attendance report.
Knowing why they failed is what makes the successful method obvious.

**DevTools Network tab, filtering by name.** The page issues ~550
requests. Filtering by `lcr` in the filter box matched almost nothing,
because the box does substring matching on the full URL and most requests
are relative or third-party. Sorting by size surfaced analytics blobs.
Clicking promising-looking entries one at a time was pure attrition.

**The obvious JSON candidates.** Two requests had the JSON icon:

- `data?lang=eng` returned site chrome. Nav menus, footer, logo hashes,
  sign-in labels. It appears three times because different route segments
  each fetch the shared header/footer config.
- `data.json` returned `{noBanner: true}`, a cookie-consent flag.

**The `attendance-rolls?_rsc=…` requests.** A dozen of them, which looks
promising. They're Next.js router prefetches, fired when a link enters the
viewport. Their bodies are `:HL[...]` preload hints plus a router tree
with `"prefetchHints":20`. No data. You can confirm one is a prefetch by
checking for the `Next-Router-Prefetch: 1` request header.

**Response-body search.** DevTools has a search panel (the magnifying
glass) that greps every captured response body. Searching a member's
surname found nothing. Searching "Relief" hit only the Adobe Launch tag
manager config, which contains a lookup table mapping
`churchofjesuschrist.org/callings/relief-society-organization` to a site
name. Analytics plumbing, a false positive.

**Checking for server-rendered data.** RSC apps often inline the payload
into the HTML document under `self.__next_f`. This returns 0 characters
on the attendance route:

```js
const f = (self.__next_f || []).map(x => x?.[1]).filter(s => typeof s === "string").join("");
console.log("chars:", f.length);
```

Zero means nothing is inlined, so the data must cross the network.
That was the finding that made the next step obvious.

## What worked: intercept `window.fetch`

Stop hunting through the Network tab. Wrap `fetch` and let the page tell
you which request carries the data. Paste this into the console on the
report page, then **change a dropdown or the date range** so the page
re-fetches. Anything containing report-shaped text logs a `HIT` with its
URL.

```js
(() => {
  const MATCH = /Elders Quorum|Relief Society|attendance|didAttend/i; // edit per report
  const orig = window.fetch;
  window.fetch = async function (...a) {
    const res = await orig.apply(this, a);
    const url = (a[0]?.url || a[0]) + "";
    res.clone().text().then((b) => {
      if (MATCH.test(b)) console.log("%cHIT", "color:lime;font-weight:bold", url, b.slice(0, 160));
    }).catch(() => {});
    return res;
  };
  console.log("Armed — change a dropdown; the data request logs as HIT.");
})();
```

For attendance this immediately produced:

```
HIT /mlt/report/class-and-quorum-attendance?lang=eng
```

The report route itself. Not an API path, the page URL. That's the thing
that is hard to guess and easy to confirm once you look for it this way.

## Reading the flight payload

The response is ~380,000 characters of React Server Components flight
format: numbered lines, each `id:content`, where content may be a chunk
manifest, a preload hint, or serialized React output.

To locate the data line, capture the body and print the long lines that
parse as JSON:

```js
(() => {
  const ROUTE = "class-and-quorum-attendance"; // edit per report
  const orig = window.fetch;
  window.fetch = async function (...a) {
    const res = await orig.apply(this, a);
    const url = (a[0]?.url || a[0]) + "";
    if (String(url).includes(ROUTE)) res.clone().text().then((body) => {
      window.__flight = body;
      for (const l of body.split(/\n(?=[0-9a-f]+:)/)) {
        if (l.length < 500) continue;
        const i = l.indexOf(":");
        let ok = false; try { JSON.parse(l.slice(i + 1)); ok = true; } catch (_) {}
        console.log(l.slice(0, i), l.length, ok ? "PARSES AS JSON" : "", l.slice(0, 120));
      }
    });
    return res;
  };
  console.log("Armed — change a dropdown. The line marked PARSES AS JSON is the data.");
})();
```

For this report the payload sits on **line `1:`**, ~162,000 characters,
and it is plain JSON. `JSON.parse(line.slice(2))` just works. That will
not necessarily be true of other reports; a different route may put its
data on a different line, or use `$`-prefixed references that need
resolving. Check before assuming.

Line 1 for this report:

```
1:{ orgId, unitNumber, orgOptions[], weekOptions[], visitors[], members[] }
```

Inspect the shape by logging `Object.keys(data)` and a sample from every
array (`window.__flight` holds the raw body from the snippet above). That
is how the two traps were found:

- `members[].weeks[]` contains **only attended weeks**. A member with no
  attendance has `weeks: []`. There is no `didAttend: false` entry. If you
  assume otherwise you silently count absences as attendance.
- `orgIds` are uuids that resolve through `orgOptions`, and `orgOptions`
  nests `childOrgs`. Skip the recursion and "Course 15" renders as
  `20bf3a6a-522e-4077-80c8-62be31833fac`.

## Doing this for a different report or different parameters

The method generalizes. The findings do not.

1. Open the target report in a browser, signed in.
2. Paste the fetch-interceptor snippet above, editing the MATCH/ROUTE for
   that report.
3. Interact with the page so it fetches. **This step is essential.** The
   initial page load may not carry the payload; a filter change usually
   does.
4. Note the URL that hits. Compare it against the URL before your
   interaction to see which query parameters changed. This is how to
   learn what date or unit parameters the report accepts.
5. Capture the body and locate the data line with the second snippet, then
   read its structure.
6. Write the parser (its own module — do not fork `lib/parse.js`), add
   assertions to a check script.

### Specifically for multi-month history

This was the top roadmap item and it is now implemented. The finding,
established by capturing the request (paste the interceptor, change the
date range once, read what differs): switching months is **a Next.js
server action**, not a query parameter. The page POSTs to the report
route itself with:

```
accept: text/x-component
next-action: <hash>            # the action id, changes on LCR deploy
next-router-state-tree: <...>  # the route's render tree
body: [unitNumber, "MM", "eng"]
```

`lib/capture.js` replays this POST once per month (via the browser
context's cookie jar, so the saved session authenticates it), then
`mergeMonths` in `lib/parse.js` unions `weekOptions`, `visitors`, and
`members[].weeks` across the responses. The router state tree is captured
live off the page's own requests, so only the action id is pinned.

Two constraints that came out of the shape:

- **No year in the body.** The action selects a month by number only; the
  server assumes the current year. So a span is reliable only within one
  calendar year. `capture.js` refuses prior-year months and flags them
  rather than pulling the wrong year's data. Extending across a year
  boundary needs another observation: change the date range to a
  prior-year month with the interceptor armed and see what carries the year.
- **The action id is a Next.js internal with no stability guarantee.** When
  it changes on an LCR deploy, capture a fresh month-switch POST (the
  interceptor logs its `next-action` header) and set `MONTH_ACTION_ID` (or
  the `LCR_MONTH_ACTION` env var).

  The symptom is unmistakable: the current month still loads (it comes from
  the passive page load, no action needed) but every earlier month is
  skipped with `Month NN returned HTTP 404`. To grab the fresh id, sign in
  to LCR, open the class-and-quorum-attendance report, paste this, then
  **change the month dropdown once**:

  ```js
  (() => {
    const orig = window.fetch;
    window.fetch = async function (...a) {
      const id = a[1]?.headers?.["next-action"] || a[1]?.headers?.["Next-Action"];
      if (id) console.log("%cnext-action id:", "color:lime;font-weight:bold", id);
      return orig.apply(this, a);
    };
    console.log("Armed — change the month dropdown; the action id logs.");
  })();
  ```

  Then run the app with `LCR_MONTH_ACTION=<that id> npm start` (or paste it
  into `MONTH_ACTION_ID` in `lib/capture.js`). If the members report broke
  in the same deploy, re-observe it too: it is a DOM scrape, so check that
  its grid still renders and the row/column selectors in `readGridRaw`
  still match.

Do not guess the parameter name. Observe it. The failure mode of guessing
is silent: a wrong parameter still returns *a* month, so the pull looks
like it worked while showing the wrong data.

## Getting the rendered table as a fallback

If the flight format ever becomes unparseable, the DOM still has the
data. This one-liner copies every rendered table to the clipboard as TSV,
which is also the shape a Playwright DOM-scraping fallback would take:

```js
copy([...document.querySelectorAll("table")].map((t) =>
  [...t.rows].map((r) => [...r.cells].map((c) => c.innerText.trim()).join("\t")).join("\n")
).join("\n\n"));
```

## Why not just scrape the DOM in the first place

It was considered. The flight payload was chosen because it carries
structure the DOM discards: member uuids, org ids, gender, and the
distinction between "absent" and "not on this class roll". The DOM route
remains the fallback, and the tradeoff is written up here so the next
person doesn't have to rederive it: flight parsing is richer but depends
on a Next.js internal with no stability guarantee; DOM scraping is poorer
but survives framework upgrades.
