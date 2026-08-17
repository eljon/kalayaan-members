# Handoff brief

Written for whoever picks this up next. Read it before changing anything.

## State of play

**The app works.** `npm start` installs what it needs, opens the browser,
walks the user through LCR sign-in, and renders the roll. It has been
verified end to end against live data and against a fixture.

Nothing below is unfinished work. It's context for changing it safely.

Owner: Eljon, Kalayaan Ward, unit 2330423. macOS, Node v24.

## Develop without touching LCR

Do this first. You do not need credentials, a session, or live access to
work on this.

    npm install
    npm run fixture     # synthetic data, real shape, real numbers
    npm run server      # http://localhost:4173

`npm run fixture` writes `output/latest.json` with 556 invented members
that reproduce the real July 2026 totals exactly. No real names are in
the repo and none should ever be added.

    npm run check       # asserts the numbers, exits non-zero on drift

Run `npm run check` after any change to `lib/parse.js`. It catches uuid
leakage, wrong cell counts, and unwalked `childOrgs` as well as the totals.

## The hard constraint: GitHub Pages will not work

The owner asked about hosting on Pages. It cannot work, for three
independent reasons:

1. Pages serves static files. This needs a Node process.
2. Getting the data requires Playwright driving a real browser through
   LCR's Okta login with MFA. No browser-only code can do that.
3. Even with a valid session, a static page cannot fetch
   `lcr.churchofjesuschrist.org`. Same-origin policy blocks it and LCR
   sends no CORS headers.

Plus a privacy constraint: ~556 members' names and attendance, and a live
auth cookie. None of that belongs in a public repo.

### Hosting that does work

| Approach | Verdict | Notes |
|---|---|---|
| Local, `npm start` | Works today | What it does now. Nothing exposed. |
| Always-on box (Pi, home server) + Tailscale | **Best fit if he wants phone access** | Node and Playwright run fine. Tailscale gives a private URL reachable from his phone with no public exposure. This is the right answer to "I want it on my phone". |
| GitHub Actions pull, commit JSON, Pages serves | Partly | Needs a **private** repo; Pages on private repos requires a paid plan. Session secret expires every few days and MFA cannot be automated. Membership data enters git history permanently. Workflow is included but disabled at `.github/workflows/pull-attendance.yml`. |
| Pages hosts a viewer only, data pulled locally | Works | Nothing confidential leaves the machine. The weakest version of the idea but the safest. |

If he raises Pages again, the Tailscale row is what he actually wants.

## How the data is obtained

**Full method and reasoning: `DISCOVERY.md`. Tools: `dev/console/`.**
Read those before attempting to pull a different report, add date
parameters, or repair the parser. What follows is the summary only.

LCR runs Next.js with React Server Components. There is **no public JSON
API**, and attendance is **not** server-rendered into the HTML
(`self.__next_f` is empty on that route). It arrives inside the RSC flight
payload for `/mlt/report/class-and-quorum-attendance`, on the line
prefixed `1:`, which happens to be plain JSON.

Found by intercepting `window.fetch` on the live page and then changing a
dropdown. The interaction is essential; the initial load does not carry
the payload.

### Dead ends already ruled out, do not repeat

- No `/api/` or `/services/` endpoint exists for this report
- `data?lang=eng` returns site chrome: nav, footer, logo hashes
- `data.json` returns `{noBanner: true}`, a cookie-consent flag
- `attendance-rolls?_rsc=…` are Next.js route prefetches, no data
- `self.__next_f` is empty, nothing is inlined in the document
- DevTools response-body search for member names finds nothing, because
  the payload only exists after a client-side fetch

`DISCOVERY.md` explains why each of these failed, which is what makes the
working method obvious.

### Payload shape, confirmed against live data

```
1:{
  orgId, unitNumber,
  orgOptions  [] { name, uuid, orgTypeId, childOrgs[] },
  weekOptions [] { date, dateDisplay, weekCode },
  visitors    [] { date, weekCode, men, women, youngMen, youngWomen, children },
  members     [] { name, nameSort, uuid, gender, orgIds[], weeks[] }
}
```

Two traps:

- `weeks[]` contains **only weeks the member attended**. Absence is
  omission. Never assume a `didAttend: false` entry exists.
- `orgIds` resolve through `orgOptions`, and you must walk `childOrgs` or
  classes like "Course 15" resolve to a raw uuid and leak into the UI.

### Known-good numbers

July 2026, unit 2330423. `npm run check` asserts all of these.

| Week | Present | Visitors | Total |
|---|---|---|---|
| 05 Jul | 103 | 9 | 112 |
| 12 Jul | 130 | 18 | 148 |
| 19 Jul | 134 | 16 | 150 |
| 26 Jul | 118 | 10 | 128 |

556 on the roll, 180 attended at least once, 58 every week, 376 never seen.

## Architecture

```
start.js              installs deps + Chromium on first run, then runs server.js
server.js             Express on 127.0.0.1:4173
  GET  /api/state     { signedIn, hasData, busy, progress, stale, fetchedAt }
  GET  /api/data      cached parsed roll
  POST /api/login     headed browser, waits for sign-in, saves session, pulls
  POST /api/refresh   headless pull with the saved session
  GET  /api/export.csv?scope=attended
lib/capture.js        Playwright. login() headed, capture() headless.
lib/parse.js          flight -> JSON -> rows, weekTotals, stats. SHARED.
fetch-attendance.js   CLI pull to CSV for cron. Exit 0 / 1 signed out / 2 parse failure.
dev/make-fixture.js   synthetic data for offline development
dev/check.js          regression assertions
dev/console/          the tools that found the data. See DISCOVERY.md.
public/               vanilla JS, no build step, no framework
output/latest.json    cache, gitignored
lcr-session.json      Playwright storageState. Gitignored. LIVE CREDENTIALS.
```

`lib/parse.js` is the single source of truth. Server and CLI both import
it. Do not fork it.

The sign-in flow polls `page.url()` and requires three consecutive
readings on an LCR URL before saving state, so it doesn't capture a
session mid-redirect. If sign-in detection ever gets flaky, that's the
place to look: `lib/capture.js`, the `settled` counter.

## Design intent, preserve it

The organizing question is **"who haven't we seen"**, not "are the numbers
up". A bishopric uses this to find people who have stopped coming. So:

- Default sort is fewest weeks attended
- The summary counts people, not percentages
- "Not seen at all" is the only figure in the alert color
- **No bar charts, deliberately.** Week totals are typographic. The one
  chart-like element is a 3px rule whose width tracks attendance.
- Layout mirrors a paper attendance roll: names left, weeks across,
  filled squares present, hollow absent, dashed outline for never seen

Palette: ledger `#E4E2D9`, rule `#C6C2B4`, ink `#23262A`, attended
`#2F5D50`, alert `#8C2F26`. Type: Bitter display, IBM Plex Sans UI, IBM
Plex Mono for data with tabular figures.

If a change adds a chart library, it has misread the brief.

## Fragility

The RSC flight format is a Next.js internal with no stability guarantee.
An LCR upgrade can change it without notice. The app reports the failure
rather than showing empty numbers; the CLI dumps the raw payload to
`output/`.

To repair: open the report in a browser and run the tools in
`dev/console/` in order. `1-find-endpoint.js` confirms which request
carries the data, `2-inspect-flight.js` locates the data line, and
`3-inspect-shape.js` prints the structure. Then adjust `extractLine1` and
`parse` in `lib/parse.js` and run `npm run check`.

`dev/console/4-dump-tables.js` is the fallback: it copies the rendered
table as TSV, which is also the shape a Playwright DOM-scraping fallback
would take if flight parsing ever becomes untenable.

## Worth building next, roughly in order

1. **Trend across months.** DONE for within-year spans, verified against
   live LCR. `capture()` pulls from `LCR_START_MONTH` (default "04",
   April) through the current month by replaying the month-switch server
   action and merging with `mergeMonths`. Set `LCR_START_MONTH` to move
   the start, or pass `{ months: N }` for a months-back count instead. See `DISCOVERY.md`, "Specifically
   for multi-month history", for the shape and constraints. Two things
   remain: (a) the action id is pinned in `lib/capture.js` and needs
   refreshing after an LCR deploy via `dev/console/6-dump-post.js`;
   (b) crossing a calendar-year boundary needs the year parameter, which
   has not been observed yet — the action body carries only a month number.
   The merge path is covered by `dev/check-merge.js`; the live replay is
   verified by running `npm run pull` against a real session.
2. **Phone access via Tailscale.** What the owner keeps circling around
   when he says GitHub Pages. Small setup, no public exposure.
3. Flag members whose attendance dropped versus the previous period.
4. Per-organization summary, not just per-week.
5. Ministering assignments overlaid, if obtainable the same way.

## Rules

- Never commit `lcr-session.json` or `output/`. Both gitignored.
- Never put real member names in the repo. Use `npm run fixture`.
- Never expose the server beyond localhost or a private tailnet. It binds
  to 127.0.0.1 on purpose.
- Automated access is not sanctioned by the Church. This uses the owner's
  own credentials against data he is already authorized to view. Do not
  extend it to units he has no rights to.

## One loose end

During development a screenshot exposed an OAuth ID token and membership
record numbers. The owner was told to sign out and back in to rotate the
session. If `lcr-session.json` predates that, it should be regenerated by
signing in again through the app.
