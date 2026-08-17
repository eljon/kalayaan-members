# Attendance Roll

Local web app that pulls the Class & Quorum Attendance report from LCR
(Leader and Clerk Resources) and shows it as a roll: one row per member,
one cell per week.

**Read `HANDOFF.md` before changing anything.** It covers how the data is
obtained, dead ends already ruled out, and why GitHub Pages cannot host
this.

## Work offline, no credentials needed

    npm install
    npm run fixture     # synthetic data with the real shape and numbers
    npm run server      # http://localhost:4173
    npm run check       # regression assertions

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
fewest weeks attended. **No charts** — that's deliberate, not an
oversight. Palette and type stack are in `HANDOFF.md`.
