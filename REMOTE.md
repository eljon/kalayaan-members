# Using the app from anywhere

The app keeps running on **your computer**. Cloudflare gives it a web
address (say `https://roll.yourdomain.org`) that works from any phone or
laptop, and asks for an email login before anyone gets in. Only email
addresses you approve can open it. Member records never leave your
computer; Cloudflare only passes the pages through.

```
leader's phone ──https──▶ Cloudflare: "which email are you?" ──▶ tunnel ──▶ your computer (the app)
```

**What it costs:** Cloudflare's Zero Trust plan is free for up to 50 people.
You need a domain name on Cloudflare — about US$10 a year if you buy one
there.

**What it needs:** your computer on and awake, with the app running. If it
sleeps, the link stops working until it wakes.

Setup takes about half an hour, once.

---

## 1. Put a domain on Cloudflare

1. Make a free account at <https://dash.cloudflare.com/sign-up>.
2. Either buy a domain there (**Domain Registration → Register Domains**),
   or add one you already own (**Add a domain**, then change its
   nameservers where you bought it — Cloudflare shows you the two names).

## 2. Turn on Zero Trust

1. In the Cloudflare dashboard, open **Zero Trust**.
2. Pick a **team name** (e.g. `kalayaan`). Your team domain becomes
   `kalayaan.cloudflareaccess.com` — you'll need it in step 5.
3. Choose the **Free** plan. It asks for a card but does not charge it.

## 3. Create the tunnel

1. **Zero Trust → Networks → Tunnels → Create a tunnel → Cloudflared.**
   Name it `kalayaan-roll`.
2. Choose your computer's system (Mac / Windows) and run the command it
   shows you in a terminal. It installs `cloudflared` as a background
   service that starts by itself whenever the computer starts.
   - Mac: install Homebrew from <https://brew.sh> first if `brew` is missing.
3. Under **Public hostname**, add:
   - **Subdomain:** `roll` · **Domain:** your domain
   - **Service:** type `HTTP`, URL `localhost:4173`
4. Save.

## 4. Put the email login in front

1. **Zero Trust → Access → Applications → Add an application → Self-hosted.**
2. **Application domain:** `roll` + your domain (the same as step 3).
3. **Add a policy:** name `Ward leaders`, action **Allow**,
   rule **Include → Emails**, and list every leader's email address.
4. **Login methods:** leave **One-time PIN** on. Each leader types their
   email and gets a code by email — no new password to remember.
5. Save. Then open the application again and copy its
   **Application Audience (AUD) Tag** (on its Overview/Basic information).

To add or remove a leader later, edit this policy's email list. That is
the whole guest list.

## 5. Tell the app about it

In the app's folder, create a file named `.env` (it is never committed):

```
ACCESS_TEAM_DOMAIN=kalayaan.cloudflareaccess.com
ACCESS_AUD=paste-the-AUD-tag-here
OWNER_EMAILS=you@example.com
```

`OWNER_EMAILS` is who may **sign the app out of LCR** — that clears the
LCR sign-in and every report for everybody. Separate several with commas.

## 6. Run it

```
npm run serve
```

`serve` is `npm start` without opening a browser window. On start-up it
prints a `Remote:` line naming your team — if that line is missing, the
`.env` file was not found.

With remote access on, the app **only listens on your computer itself**.
The tunnel is the only way in from outside, so nobody on the same Wi-Fi
can reach it and skip the email login.

To use it on this computer, open <http://localhost:4173> and enter the
access code printed in the terminal, as before.

### Keep it running

- **Stop the computer sleeping:** Mac — System Settings → Energy (or
  Battery → Options) → *Prevent automatic sleeping when the display is
  off*. Windows — Settings → Power → *Sleep: Never* when plugged in.
- **Start the app at login (Mac):** save the block below as
  `~/Library/LaunchAgents/org.kalayaan.roll.plist`, change the folder
  path, then run `launchctl load ~/Library/LaunchAgents/org.kalayaan.roll.plist`.

  ```xml
  <?xml version="1.0" encoding="UTF-8"?>
  <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
  <plist version="1.0"><dict>
    <key>Label</key><string>org.kalayaan.roll</string>
    <key>WorkingDirectory</key><string>/Users/YOU/kalayaan-members</string>
    <key>ProgramArguments</key><array>
      <string>/bin/zsh</string><string>-lc</string><string>npm run serve</string>
    </array>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>StandardErrorPath</key><string>/tmp/kalayaan-roll.log</string>
  </dict></plist>
  ```

## 7. Try it

On your phone, **turn Wi-Fi off** (so it is genuinely outside) and open
`https://roll.yourdomain.org`. Cloudflare asks for your email, emails a
code, and then the app opens. Settings shows who you're signed in as.

---

## Signing in to LCR

The app reads LCR with **your** LCR sign-in, kept on your computer. LCR
sign-ins last a few days. Signing in opens a browser window **on the
computer running the app** (for the password and the code sent to your
phone), so it can only be done there.

When it lapses, leaders opening the link see *"The app's LCR sign-in has
expired — ask whoever runs the app to sign in"* instead of a button they
couldn't use. Sign in at <http://localhost:4173> on your computer, and
everyone's next Refresh works again.

## What everybody shares

There is one copy of the data, so everybody sees the same roll, the same
action lists, the same Focus list and notes. A leader who hides somebody
on a list hides them for everyone. That suits a council working one list
together; it is worth saying out loud the first time.

## If something's wrong

| You see | Means |
|---|---|
| Cloudflare error 1033 / "tunnel not found" | `cloudflared` isn't running, or the computer is asleep or off. |
| Cloudflare 502 / "bad gateway" | The tunnel is up but the app isn't — run `npm run serve`. |
| The app's own access-code page, through the link | The Access application (step 4) isn't covering this address. Check its domain matches the tunnel's public hostname exactly. |
| "Your sign-in could not be verified" | `ACCESS_AUD` or `ACCESS_TEAM_DOMAIN` in `.env` is wrong; the terminal says which check failed. |
| Somebody can't get in | Their email isn't in the policy (step 4), or they're typing a different address. |
