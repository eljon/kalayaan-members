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
you which request carries the data.

`dev/console/1-find-endpoint.js` does this. Paste it into the console on
the report page, then **change a dropdown or the date range** so the page
re-fetches. Anything containing attendance-shaped text logs a `HIT` with
its URL.

This immediately produced:

```
HIT /mlt/report/class-and-quorum-attendance?lang=eng
```

The report route itself. Not an API path, the page URL. That's the thing
that is hard to guess and easy to confirm once you look for it this way.

## Reading the flight payload

The response is ~380,000 characters of React Server Components flight
format: numbered lines, each `id:content`, where content may be a chunk
manifest, a preload hint, or serialized React output.

`dev/console/2-inspect-flight.js` captures it to `window.__flight` and
prints the lines that look like they hold data.

For this report the payload sits on **line `1:`**, ~162,000 characters,
and it is plain JSON. `JSON.parse(line.slice(2))` just works. That will
not necessarily be true of other reports; a different route may put its
data on a different line, or use `$`-prefixed references that need
resolving. Check before assuming.

Line 1 for this report:

```
1:{ orgId, unitNumber, orgOptions[], weekOptions[], visitors[], members[] }
```

Inspecting the shape is `dev/console/3-inspect-shape.js`, which prints
top-level keys and a sample from every array. That is how the two traps
were found:

- `members[].weeks[]` contains **only attended weeks**. A member with no
  attendance has `weeks: []`. There is no `didAttend: false` entry. If you
  assume otherwise you silently count absences as attendance.
- `orgIds` are uuids that resolve through `orgOptions`, and `orgOptions`
  nests `childOrgs`. Skip the recursion and "Course 15" renders as
  `20bf3a6a-522e-4077-80c8-62be31833fac`.

## Doing this for a different report or different parameters

The method generalizes. The findings do not.

1. Open the target report in a browser, signed in.
2. Paste `dev/console/1-find-endpoint.js`, edited so the regex matches
   text you expect in that report.
3. Interact with the page so it fetches. **This step is essential.** The
   initial page load may not carry the payload; a filter change usually
   does.
4. Note the URL that hits. Compare it against the URL before your
   interaction to see which query parameters changed. This is how to
   learn what date or unit parameters the report accepts.
5. Paste `dev/console/2-inspect-flight.js` to capture and locate the data
   line, then `dev/console/3-inspect-shape.js` to read its structure.
6. Write the parser in `lib/parse.js`, add assertions to `dev/check.js`.

### Specifically for multi-month history

This is the top item on the roadmap and it needs step 4. The report shows
one month at a time. `dev/console/5-diff-date-request.js` is built for
exactly this: paste it, change the date range in the UI once, and it
prints what differs between the two report requests — query parameter,
RSC header, or POST body. Whatever changes is what `lib/capture.js` needs
to loop over. Then merge the `weekOptions`, `visitors`, and
`members[].weeks` arrays across responses.

Do not guess the parameter name. Observe it. The failure mode of guessing
is silent: a wrong parameter still returns *a* month, so the pull looks
like it worked while showing the wrong data.

## Getting the rendered table as a fallback

If the flight format ever becomes unparseable, the DOM still has the
data. `dev/console/4-dump-tables.js` copies every rendered table to the
clipboard as TSV. That is also the shape a Playwright DOM-scraping
fallback would take, if it ever becomes the more stable option.

## Why not just scrape the DOM in the first place

It was considered. The flight payload was chosen because it carries
structure the DOM discards: member uuids, org ids, gender, and the
distinction between "absent" and "not on this class roll". The DOM route
remains the fallback, and the tradeoff is written up here so the next
person doesn't have to rederive it: flight parsing is richer but depends
on a Next.js internal with no stability guarantee; DOM scraping is poorer
but survives framework upgrades.
