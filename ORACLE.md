# Free hosting: GitHub → Oracle's free server, at your own domain

The code stays on GitHub. **Every push deploys itself** to a server Oracle
gives away for good, behind the Cloudflare tunnel and email login you
already have, at **your** address (`https://roll.yourdomain.org`). No
computer of yours stays on, and after setup nobody types a command anywhere.

```
push to GitHub ──► GitHub Actions: npm run check ──► SSH to the server
                                                       └─ deploy/server.sh: install what's
                                                          missing, build, swap, roll back
                                                          if the new version won't start
```

## What it costs — checked 29 Oct 2026

| | Cost | What the sources say |
|---|---|---|
| **Oracle Always Free** server | **$0** | Ampere A1 Arm server, free indefinitely; 200 GB disk. Most guides still say **4 processors / 24 GB** of memory; reports from June 2026 say Oracle **halved it to 2 / 12 GB**, and Oracle's own page doesn't settle it. This app uses **1 processor / 6 GB**, inside either figure. |
| **GitHub Actions** | **$0** | Free plan: **2,000 minutes a month** for a private repository. A deploy takes about 3 (first one ~15). |
| **Cloudflare** tunnel + email login | **$0** | What you already have (`REMOTE.md`). |
| Your domain | what you pay now | — |

I could not open Oracle's, Fly's or Google's pricing pages from here (this
workspace's network doesn't reach them), so the figures above come from
search results, with the sources at the bottom. Where sources disagreed,
both figures are shown.

**What you give up vs. a paid host:** nothing at run time — it never sleeps,
the disk is permanent, and a failed deploy keeps the old version running.
The two catches are at sign-up:
- Oracle asks for a card (a temporary hold, released) and sometimes refuses
  one; try another.
- Free servers in Singapore are sometimes **out of capacity**. If creating
  the server says so, retry later, or do step 2 first.

If Oracle won't give you a server at all, the same workflow deploys to **any
Ubuntu server** — see *Another server* at the end.

About 40 minutes, once, all in a web browser.

---

## Step 1 — Oracle Cloud account (15 min)

1. Go to **oracle.com/cloud/free** → **Start for free**.
2. **Country:** Philippines. **Home region:** **Singapore** (ap-singapore-1).
   *This can't be changed later, and free servers only exist in your home
   region.*
3. Verify your email and phone, enter the card, and finish. You'll get an
   email when the account is ready (a few minutes).

## Step 2 — Pay As You Go (recommended, 2 min)

Still **$0** inside the free allowance, but Oracle then doesn't reclaim an
idle free server, and capacity is easier to get.

1. Sign in at **cloud.oracle.com**.
2. Menu ☰ → **Billing & Cost Management → Upgrade and Manage Payment** →
   **Pay As You Go** → confirm.
3. Peace of mind: Menu → **Billing → Budgets** → create a budget of US$1
   with an email alert. If anything ever starts costing money, you'll know.

## Step 3 — Create the server (10 min)

1. Menu ☰ → **Compute → Instances → Create instance**.
2. **Name:** `kalayaan`.
3. **Image and shape → Edit:**
   - **Change image** → **Ubuntu** → **Canonical Ubuntu 24.04** → Select.
   - **Change shape** → **Ampere** → **VM.Standard.A1.Flex** → **1 OCPU**,
     **6 GB memory** → Select. It should say *Always Free-eligible*.
4. **Networking:** leave the defaults (public IP address **on**).
5. **Add SSH keys:** **Generate a key pair for me** → **Save private key**.
6. **Create.** When the status is **Running**, copy the **Public IP address**.

> *"Out of capacity for shape VM.Standard.A1.Flex"* — none free in Singapore
> right now. Try again in a few hours, or do step 2 first.

## Step 4 — Tell GitHub about the server (10 min)

On **github.com → `kalayaan-members` → Settings → Secrets and variables →
Actions → New repository secret**, add each of these (name exactly as shown):

| Name | Value |
|---|---|
| `SERVER_HOST` | the public IP address from step 3 |
| `SERVER_SSH_KEY` | the private key file from step 3 — open it in a text editor (Notepad / TextEdit) and paste **all** of it, including the `-----BEGIN` and `-----END` lines |
| `ACCESS_TEAM_DOMAIN` | e.g. `kalayaan.cloudflareaccess.com` (as in `REMOTE.md` step 5) |
| `ACCESS_AUD` | the Access application's AUD tag (as in `REMOTE.md` step 5) |
| `OWNER_EMAILS` | who may sign the app in to LCR, comma-separated |
| `TUNNEL_TOKEN` | Cloudflare → **Zero Trust → Networks → Tunnels** → `kalayaan-roll` → **Configure** → under the install instructions pick **Debian / arm64**, and copy the long token after `cloudflared service install` (it starts `eyJ`) |

Then delete the key file from your Downloads — GitHub holds it now.

## Step 5 — First deploy (15 min, waiting)

**Actions** tab → **Deploy to the server** → **Run workflow** → branch
`claude/file-study-handover-32tv0w` → **Run workflow**.

The first one installs Docker and the tunnel on the server and builds the
app — about 15 minutes. A green tick means it's running. From then on, every
change I push deploys itself the same way, in a few minutes.

## Step 6 — Point your domain at the server (5 min)

**If your link still goes through the tunnel to your computer** (`REMOTE.md`):
nothing to change in Cloudflare — the tunnel already sends
`roll.yourdomain.org` to `localhost:4173`, and the server now answers there.
Just **stop the tunnel on your computer**, or visitors get split between the
two:
- Mac: `sudo cloudflared service uninstall`
- Windows (administrator PowerShell): `cloudflared.exe service uninstall`

**If you'd moved it to Fly.io** (`CLOUD.md` step 6):
1. Cloudflare → your domain → **DNS → Records**: delete the `roll` CNAME
   (to `…fly.dev`) and the `_acme-challenge.roll` record.
2. **Zero Trust → Networks → Tunnels** → `kalayaan-roll` → **Configure →
   Public Hostname** (or *Published application routes*) → **Add**:
   subdomain `roll`, your domain, type **HTTP**, URL **`localhost:4173`** → Save.
3. Stop paying Fly: `fly apps destroy kalayaan-stewardship`.

The **Access application** (the email login) is untouched either way.

## Step 7 — Sign in to LCR (5 min)

Open **`https://roll.yourdomain.org`**, sign in with your email, and use
**Sign in to LCR** — LCR's page appears inside the app; tap and type your way
through, including the code sent to your phone.

On your phone, add it to the home screen (Safari → Share → **Add to Home
Screen**; Chrome → ⋮ → **Install app**). It then opens with no signal too.

### Optional — bring your lists and notes over from your computer

Your action lists, Focus list, notes and settings from running it on your
computer are in `output/prefs.json` there. This is the one step that needs a
terminal, and only if you want them; skip it to start fresh. Keep the key
file from step 3 for it, then delete it. On your computer, in the app's
folder:

```
scp -i path/to/ssh-key.key output/prefs.json ubuntu@YOUR.IP.ADDRESS:~
ssh -i path/to/ssh-key.key ubuntu@YOUR.IP.ADDRESS "sudo cp ~/prefs.json /srv/kalayaan/output/ && sudo docker restart kalayaan"
```

(On Mac, first `chmod 600 path/to/ssh-key.key`.)

**If LCR won't accept the sign-in from the server**, copy your computer's
sign-in up the same way — `lcr-session.json` to `/srv/kalayaan/` — and tell
me what LCR said.

---

## Day to day

- **Updates:** nothing to do. A push deploys itself; the **Actions** tab
  shows each one. A red cross means it didn't go out, and the version
  before it is still running.
- **Redeploy by hand:** Actions → **Deploy to the server** → Run workflow.
- **Data** lives in `/srv/kalayaan` on the server and survives every deploy.

## If something's wrong

| You see | Means |
|---|---|
| Actions: "Missing repository secrets: …" | Add those in step 4. |
| Actions: `Permission denied (publickey)` | `SERVER_SSH_KEY` isn't the whole key file, or `SERVER_HOST` is the wrong IP. |
| Actions: `Connection timed out` | Wrong IP, or the server is stopped (Oracle → Instances → Start). |
| Actions: "This version did not start" | The log below it says why; the previous version was put back. Tell me. |
| Cloudflare error 1033 | The tunnel isn't connected — check `TUNNEL_TOKEN`, then run the workflow again. |
| Cloudflare 502 | Tunnel fine, app not running — run the workflow again; its log says why. |
| Sometimes the new app, sometimes the old | The tunnel still runs on your computer as well (step 6). |
| "Open the app through its usual link" on `roll.yourdomain.org` | `ACCESS_AUD` or `ACCESS_TEAM_DOMAIN` is wrong — fix the secret and rerun. |

## Another server

`deploy/server.sh` works on any Ubuntu server you can reach by SSH key, so
if Oracle won't give you one, rent a small one and set the same secrets —
plus `SERVER_USER` if its login isn't `ubuntu` (Hetzner's is `root`). It
needs about 2 GB of memory for the browser that reads LCR. Search results
put Hetzner's CX23 at €3.49–3.99/month plus €0.50 for an IPv4 address in
Germany/Finland after an April 2026 price change, with Singapore noticeably
dearer and some plans briefly unorderable in Sept–Oct 2026 — check the
price on Hetzner's own page before you buy.

## Sources (searched 29 Oct 2026)

- Oracle Always Free: [DEV Community guide](https://dev.to/build996/oracle-cloud-always-free-get-a-4-core-24gb-arm-vps-for-free-4l2o),
  [Oracle free tier changes 2026](https://terminalbytes.com/oracle-cloud-free-tier-changes-2026),
  [zenn.dev, Oct 2026](https://zenn.dev/tetsu_koba/articles/ffda32a38f22aa)
- GitHub Actions minutes: [GitHub docs](https://docs.github.com/billing/managing-billing-for-your-products/managing-billing-for-github-actions)
- Fly.io (for comparison, `CLOUD.md`): [Fly.io resource pricing](https://fly.io/docs/about/pricing/),
  [Fly.io pricing 2026](https://www.buildmvpfast.com/blog/fly-io-pricing-2026-ram-increase-vs-hetzner)
- Hetzner: [bitdoze](https://www.bitdoze.com/hetzner-cloud-cost-optimized-plans),
  [Hetzner price adjustment](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/),
  [costgoat](https://costgoat.com/pricing/hetzner)
