# Attendance Roll

Local web app that pulls the Class & Quorum Attendance report from LCR
(Leader and Clerk Resources) and shows it as a roll: one row per member,
one cell per week.

## Read these before changing anything

- **`DISCOVERY.md`** — how the data was found, and the reusable method for
  finding more. Read this before touching `lib/parse.js`, adding date
  parameters, pulling a different report, or repairing after an LCR
  deploy. LCR has **no JSON API**; the data lives in a React Server
  Components flight payload. That is not guessable, so don't try.
- **`HANDOFF.md`** — project state, architecture, design intent, hosting
  constraints, roadmap.
- **`dev/console/`** — the actual tools that found the data. Runnable.

## Work offline, no credentials needed

    npm install
    npm run fixture     # synthetic data, real shape, real numbers
    npm run server      # http://localhost:4173
    npm run check       # regression assertions, exits non-zero on drift

Run `npm run check` after touching `lib/parse.js`.

## Run for real

    npm start

Installs on first run, opens the browser, handles LCR sign-in in-app.

## Rules

- `lib/parse.js` is the only parser. Server and CLI both import it. Don't fork it.
- Never commit `lcr-session.json` (live auth cookies) or `output/` (member records).
- Never put real member names in the repo. Use the fixture.
- Server binds to 127.0.0.1 on purpose. Don't expose it.
- No build step, no framework, no bundler. Vanilla JS in `public/`.
- In `weeks[]`, absence is omission. There is no `didAttend: false`.
- Walk `childOrgs` when resolving `orgIds`, or class names leak as uuids.

## Design intent

Answers "who haven't we seen", not "are the numbers up". Default sort is
fewest weeks attended. A line graph of weekly attendance (numbers and
percentages) sits above the roll, added at the owner's request — built as
inline SVG, **no chart library** (that rule still holds).
Palette and type stack are in `HANDOFF.md`.
