# Running the app in the cloud

Everything lives on a rented server — no computer of yours has to be on.

- **The app** runs on **Fly.io**. The roll, members, action lists, Focus and
  notes are kept on a disk there that survives every update.
- **The email login** stays **Cloudflare Access**, the one you set up
  already. Only approved emails get in.
- **LCR sign-in** happens **inside the app**. LCR's sign-in page appears in
  a box, and you tap and type into it — password and the code sent to your
  phone, as usual. Owners only. It lasts a few days, then the app asks again.
- **Every phone and laptop keeps a copy.** Once someone has opened the app,
  it opens again with no connection, showing what that device last saved.
  Changes made offline are sent when the connection comes back.

**Cost:** Fly.io bills by the second, and the app **sleeps when nobody is
using it**, waking in a few seconds on the next visit. For a ward app that
is typically **about US$1 a month or less** (it would be about US$6 if it
never slept). Plus the domain you already have; Cloudflare stays free.
For **$0**, see `ORACLE.md` — same app, on Oracle's free server.

> **One thing only a real try will tell:** LCR is run by the Church, and
> some sign-in systems treat a sign-in from a data centre with extra
> suspicion. If LCR refuses or keeps re-asking from the server, use the
> fallback in **Step 7** (copy the sign-in over from your computer), and
> tell me what it said.

Setup is about 45 minutes, once. You'll do it on your computer, but only
this once.

---

## Before you start

- The Cloudflare account, domain, Zero Trust team and **Access application**
  from `REMOTE.md` (Parts 1, 2 and 4). If you did those, they carry over
  unchanged. Keep your **team domain** and **AUD tag** handy.
- A card for Fly.io.
- The app's folder on your computer, up to date (`git pull`).

## Step 1 — Fly.io account and tool (5 min)

1. Install Fly's command-line tool:
   - **Mac:** in Terminal, `brew install flyctl`
   - **Windows:** in PowerShell, `iwr https://fly.io/install.ps1 -useb | iex`
2. Run `fly auth signup` (or `fly auth login` if you have an account). A
   browser opens; finish there, and add a card under **Billing**.

## Step 2 — Create the app (3 min)

In Terminal, in the app's folder:

```
fly launch --no-deploy --copy-config
```

- It reads `fly.toml`. When asked for an **app name**, keep
  `kalayaan-stewardship` or pick another — it must be unique on Fly. If you
  change it, it updates `fly.toml` for you.
- **Region:** keep `sin` (Singapore, the closest to Manila).
- Say **No** to anything about databases, Redis or Postgres.

## Step 3 — Give it a disk (1 min)

```
fly volumes create kalayaan_data --region sin --size 1
```

Say **yes** if it warns about a single volume. 1 GB is plenty.

## Step 4 — Tell it about the email login (1 min)

The same three values as `REMOTE.md` step 5, but stored with Fly instead of
in a `.env` file:

```
fly secrets set ACCESS_TEAM_DOMAIN=kalayaan.cloudflareaccess.com ACCESS_AUD=paste-the-AUD-tag OWNER_EMAILS=your@email.com
```

`OWNER_EMAILS` are the people who may sign the app in to LCR and use
"Sign out & pull fresh". Separate several with commas.

## Step 5 — Deploy (5–10 min)

```
fly deploy
```

The first one takes a while (it installs a browser for reading LCR). When
it ends, `fly status` should show one machine **started**.

Open `https://kalayaan-stewardship.fly.dev` (your app name): it should say
**"Open the app through its usual link"**. That's right — in the cloud the
email login is the only way in, and that address doesn't go through it.

## Step 6 — Point your link at the cloud (10 min)

Your link (`roll.yourdomain.org`) currently goes through the tunnel to your
computer. Move it to Fly:

1. **Free the name.** Cloudflare → **Zero Trust → Networks → Tunnels** →
   `kalayaan-roll` → **Configure** → **Public Hostname** (or *Published
   application routes*) → delete the `roll` entry. Then in the main
   Cloudflare dashboard → your domain → **DNS → Records**, delete the
   `roll` record if it is still there.
2. **Ask Fly for a certificate:**
   ```
   fly certs add roll.yourdomain.org
   ```
   It prints DNS records to add. Note the `_acme-challenge` one.
3. **Add the records** in Cloudflare → your domain → **DNS → Records → Add record**:
   - **CNAME** · Name `roll` · Target `kalayaan-stewardship.fly.dev` ·
     Proxy **on** (orange cloud).
   - **CNAME** · Name `_acme-challenge.roll` · Target: the value
     `fly certs add` printed · Proxy **off** (grey cloud).
4. Cloudflare → your domain → **SSL/TLS → Overview** → set
   **Full (strict)**.
5. Wait a few minutes, then `fly certs show roll.yourdomain.org` should say
   the certificate is **Ready**.

The **Access application** from before still covers `roll.yourdomain.org`,
so the email login now sits in front of the cloud app. Nothing to change
there.

You can now **uninstall the tunnel** from your computer
(Mac: `sudo cloudflared service uninstall`; Windows: in an administrator
terminal, `cloudflared.exe service uninstall`) and stop running the app
there.

## Step 7 — Bring your data over, and sign in to LCR (5 min)

Your action lists, Focus list, notes, excluded Sundays and settings are in
`output/prefs.json` on your computer. Copy it up so nothing is lost:

```
fly ssh sftp shell
put output/prefs.json /data/output/prefs.json
```

(Type `exit` to leave.) If it says the folder doesn't exist, first run
`fly ssh console -C "mkdir -p /data/output"` and try again.

Then restart so the app reads it: `fly apps restart`.

**Sign in to LCR:** open `https://roll.yourdomain.org`, sign in with your
email, and the app offers **Sign in to LCR**. LCR's sign-in page appears in
a box:

1. Tap the username field in the picture, type in the box underneath, press **Send**.
2. Press **Enter** (or tap LCR's *Next* button in the picture).
3. Same for the password, then the code sent to your phone.
4. When it gets through, the box closes and the roll fills in.

**If LCR won't accept the sign-in from the server** — it keeps asking, or
refuses — copy the sign-in from your computer instead. Sign in to LCR in
the app on your computer as you always have, then:

```
fly ssh sftp shell
put lcr-session.json /data/lcr-session.json
```

and `fly apps restart`. That sign-in lasts a few days too; repeat when it
expires — and tell me, so I can look at what LCR is objecting to.

## Step 8 — Updates without your computer (optional, 5 min)

When I make a change, it lands on GitHub. To put it live straight from
GitHub, with no computer:

1. In Terminal, once: `fly tokens create deploy -x 999999h` — copy the
   whole token it prints.
2. On github.com → the `kalayaan-members` repository → **Settings →
   Secrets and variables → Actions → New repository secret** · Name
   `FLY_API_TOKEN` · paste the token.
3. To deploy: **Actions** tab → **Deploy to Fly.io** → **Run workflow** →
   pick the branch → **Run workflow**. About five minutes later it's live.

Without this, deploy from your computer with `git pull` then `fly deploy`.

## Step 9 — Put it on phones

Send leaders the link. On their phone:

- **iPhone:** open it in **Safari** → Share → **Add to Home Screen**.
- **Android:** open it in **Chrome** → ⋮ → **Add to Home screen** (or
  **Install app**).

It gets the sheep icon and opens like an app. After the first visit it
also opens with no signal, showing a yellow **Offline** bar with the date
of the copy.

---

## Good to know

- **One copy of the data**, shared by everybody: the same roll, lists,
  Focus and notes. Hiding someone on a list hides them for everyone.
- **Copies on devices.** Every phone that opens the app keeps the roll and
  member details on it, so it works offline. On a shared or borrowed
  device, or one being given away, use **Settings → Remove saved data from
  this device**. Removing someone from the Access email list stops them
  getting new data, but can't reach into their phone to wipe the old copy.
- **Offline edits.** Changes made offline are sent when the device is back
  online. If two people change the same list while one is offline, the
  last to reconnect wins.
- **Logs:** `fly logs` shows what the server is doing — what LCR returned,
  which months were read, any rows it had trouble with. Never passwords.

## If something's wrong

| You see | Means |
|---|---|
| "Open the app through its usual link" on the `fly.dev` address | Normal. Use `roll.yourdomain.org`. |
| The same message on `roll.yourdomain.org` | The Access application isn't covering the address, or `ACCESS_AUD` / `ACCESS_TEAM_DOMAIN` are wrong — `fly logs` says which check failed. Fix with `fly secrets set …` (it restarts by itself). |
| Cloudflare error 525/526 | SSL mode isn't **Full (strict)**, or Fly's certificate isn't ready yet (`fly certs show …`). |
| Cloudflare 502/521 | The app is down — `fly status`, then `fly logs`. |
| "Only the owner can do that" | Your email isn't in `OWNER_EMAILS`. |
| The LCR sign-in box stays blank | The server is starting its browser; give it 20 seconds. If it stays blank, `fly logs`. |
| Data missing after an update | The volume isn't mounted — `fly volumes list` should show `kalayaan_data` attached. |
