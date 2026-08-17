# Attendance Roll

A local app that pulls the class and quorum attendance report out of
Leader and Clerk Resources and shows it as a roll: every member a row,
every week a cell.

It answers the question a bishopric actually asks, which is not "are the
numbers up" but **who haven't we seen**. So the default order is fewest
weeks attended, absence is what the design draws your eye to, and the
summary counts people rather than percentages.

## Run it

    npm start

That's the only command. On the first run it installs what it needs,
then it opens in your browser.

The app handles the rest:

1. It asks you to sign in. A browser window opens.
2. You sign in to LCR the way you normally do, code on your phone included.
3. The window closes on its own and the roll fills in.

The session is remembered, so later runs go straight to the data.

> Opening `public/index.html` by double-clicking will not work. The page
> talks to a small local server, and `npm start` is what runs it.

### In the app

- **Refresh from LCR** pulls fresh numbers without leaving the page
- Search by name
- Filter to one organization, including individual classes and quorums
- Reorder by fewest attended, most attended, or name
- Hide members with no attendance
- Download the current view as CSV

If the roll on screen is more than twelve hours old, it refreshes itself
when you open the app.

## Unattended pulls

For a scheduled job that just writes files:

    npm run pull

Writes three CSVs into `output/`. Exit codes are `0` success,
`1` signed out, `2` parse failure, so cron failures show up in your logs.

    0 6 * * 1 cd /path/to/lcr-attendance && /usr/bin/node fetch-attendance.js >> run.log 2>&1

Sign in through the app first; the CLI reuses the same saved session.

## How it gets the data

> Changing the parser, pulling a different report, or adding date ranges?
> Read **`DISCOVERY.md`** first. It documents the method, and
> `dev/console/` holds the tools. This is not guessable from the code.

LCR runs on Next.js with React Server Components. There is no public JSON
API, and the attendance data is not server-rendered into the HTML. It
arrives in the RSC flight payload for
`/mlt/report/class-and-quorum-attendance`, on the line prefixed `1:`,
which happens to be valid JSON:

    orgOptions  [] { name, uuid, orgTypeId, childOrgs[] }
    weekOptions [] { date, dateDisplay, weekCode }
    members     [] { name, nameSort, uuid, gender, orgIds[], weeks[] }
    weeks       [] { date, weekCode, didAttend }
    visitors    [] { date, weekCode, men, women, youngMen, youngWomen, children }

`weeks` lists only the weeks a member attended. `orgIds` resolve to names
through `orgOptions`, including nested `childOrgs`.

## When it breaks

The flight format is a Next.js internal with no stability guarantee, so
an LCR upgrade can change it without notice. The app says so plainly
rather than showing empty numbers.

To fix it, open the report in your own browser, run the console extractor
(`../lcr-attendance-extract.js`) to see the new shape, then adjust
`extractLine1` and `parse` in `lib/parse.js`. The app and the CLI share
that one file.

## Handling

`lcr-session.json` holds live authentication cookies and `output/` holds
names and attendance. Both are in `.gitignore`. The server binds to
localhost only, so nothing is reachable from your network. Keep the
folder out of any cloud sync.

Automated access is not sanctioned by the Church. This uses your own
credentials against data you are already authorized to view.

## Files

    start.js              one command: installs, then runs
    server.js             the local app
    lib/capture.js        sign-in and headless pull
    lib/parse.js          payload parsing, shared
    fetch-attendance.js   command-line pull to CSV
    public/               the interface
