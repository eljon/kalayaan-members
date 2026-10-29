# Free hosting on Oracle Cloud, at your own domain

The same app as `CLOUD.md`, on a server Oracle gives away for good —
**$0 a month**. It sits behind the Cloudflare tunnel and email login you
already have, at **your** address (`https://roll.yourdomain.org`). No
computer of yours stays on.

- **Oracle "Always Free"** gives a small Linux server (we use 1 processor
  and 6 GB of memory — well inside the free allowance), free indefinitely.
- **Cloudflare** stays exactly as you set it up in `REMOTE.md`: your domain,
  the `kalayaan-roll` tunnel, and the email login. The tunnel simply moves
  from your computer to the server.
- **LCR sign-in** is inside the app; **each device keeps an offline copy** —
  both as in `CLOUD.md`.

**The catches, honestly:**
- Oracle's sign-up asks for a card (a small temporary hold, then released)
  and occasionally rejects one; try another if it does.
- Free servers in Singapore are sometimes **out of capacity**. If creating
  the server fails with that, retry later — or do step 2 (Pay As You Go),
  which still costs $0 inside the free allowance and makes capacity much
  easier to get.
- It is a small Linux server you own. The setup script turns on automatic
  security updates; otherwise there is nothing to look after day to day.

About an hour, once. Everything below is done in a web browser plus one
terminal window on your computer — which you only need for this setup.

---

## Step 1 — Oracle Cloud account (15 min)

1. Go to **oracle.com/cloud/free** → **Start for free**.
2. **Country:** Philippines. **Home region:** **Singapore** (ap-singapore-1).
   *This can't be changed later, and free servers only exist in your home
   region* — pick Singapore.
3. Verify your email and phone, enter the card, and finish. Account set-up
   can take a few minutes after you submit; you'll get an email when it's ready.

## Step 2 — Pay As You Go (recommended, 2 min)

Still **$0** as long as you stay inside the free allowance (this guide
does), but Oracle then doesn't reclaim an idle free server, and capacity
is easier to get.

1. Sign in at **cloud.oracle.com**.
2. Menu ☰ → **Billing & Cost Management → Upgrade and Manage Payment**.
3. Choose **Pay As You Go** and confirm.

(Optional peace of mind: Menu → **Billing → Budgets** → create a budget of
US$1 with an email alert.)

## Step 3 — Create the server (10 min)

1. Menu ☰ → **Compute → Instances → Create instance**.
2. **Name:** `kalayaan`.
3. **Image and shape → Edit:**
   - **Change image** → **Ubuntu** → **Canonical Ubuntu 24.04** → Select.
   - **Change shape** → **Ampere** → **VM.Standard.A1.Flex** → set
     **1 OCPU** and **6 GB memory** → Select. It should say
     *Always Free-eligible*.
4. **Networking:** leave the defaults (a new network, public IP address **on**).
5. **Add SSH keys:** **Generate a key pair for me** → **Save private key**.
   Keep this file safe — it is the key to the server.
6. **Create.** After a minute or two the status turns **Running**. Copy the
   **Public IP address** from the instance page.

> *"Out of capacity for shape VM.Standard.A1.Flex"* — Oracle has no free
> servers left in Singapore at that moment. Try again in a few hours, or
> do step 2 first.

## Step 4 — Get onto the server (5 min)

**Mac:** open Terminal and run (with your key file name and IP):

```
chmod 600 ~/Downloads/ssh-key-*.key
ssh -i ~/Downloads/ssh-key-*.key ubuntu@YOUR.IP.ADDRESS
```

**Windows:** open PowerShell and run:

```
icacls $HOME\Downloads\ssh-key-*.key /inheritance:r /grant:r "$($env:USERNAME):R"
ssh -i $HOME\Downloads\ssh-key-*.key ubuntu@YOUR.IP.ADDRESS
```

On Windows, type the key file's full name instead of `ssh-key-*.key`
(PowerShell doesn't fill in the `*`), here and in step 7.

Type `yes` when asked about the fingerprint. You're in when the prompt
reads `ubuntu@kalayaan`. Everything in step 5 is typed here.

## Step 5 — Install the app (20 min, mostly waiting)

1. **A GitHub key for the server**, so it can download the app (the
   repository is private). On github.com → your photo → **Settings →
   Developer settings → Personal access tokens → Fine-grained tokens →
   Generate new token**:
   - **Name:** `kalayaan server` · **Expiration:** 1 year
   - **Repository access:** *Only select repositories* → `kalayaan-members`
   - **Permissions → Repository → Contents:** *Read-only*
   - Generate, and copy the token.
2. **Download the app** on the server:
   ```
   git config --global credential.helper store
   git clone -b claude/file-study-handover-32tv0w https://github.com/eljon/kalayaan-members.git
   cd kalayaan-members
   ```
   When asked: **Username** = your GitHub username, **Password** = the token.
   (The server remembers it, so updates later don't ask again.)
3. **Your tunnel's token.** In Cloudflare → **Zero Trust → Networks →
   Tunnels** → `kalayaan-roll` → **Configure** (or *Edit*). Under the
   install instructions choose **Debian** and **arm64**, and copy the long
   token — the part after `cloudflared service install`, starting `eyJ`.
4. **Run the setup:**
   ```
   sudo ./deploy/oracle-setup.sh
   ```
   It asks for your **team domain** (`kalayaan.cloudflareaccess.com`), the
   **AUD tag**, your **owner email(s)** — the same three as `REMOTE.md`
   step 5 — and the **tunnel token** (nothing shows as you paste it; that's
   normal). Then it installs everything and builds the app. The first build
   takes 5–10 minutes. It ends with **"Done"**.

## Step 6 — Point your domain at the server (5 min)

**If your link still goes through the tunnel** (you set up `REMOTE.md` and
didn't move it to Fly.io): nothing to change in Cloudflare — the tunnel
already sends `roll.yourdomain.org` to `localhost:4173`, and the server
answers there now. Just **stop the tunnel on your own computer**, or
visitors get split between the two:
- Mac: `sudo cloudflared service uninstall`
- Windows (administrator PowerShell): `cloudflared.exe service uninstall`

**If you'd already moved it to Fly.io** (`CLOUD.md` step 6):
1. Cloudflare → your domain → **DNS → Records**: delete the `roll` CNAME
   (to `…fly.dev`) and the `_acme-challenge.roll` record.
2. **Zero Trust → Networks → Tunnels** → `kalayaan-roll` → **Configure →
   Public Hostname** (or *Published application routes*) → **Add**:
   subdomain `roll`, your domain, type **HTTP**, URL **`localhost:4173`** → Save.
3. Stop paying Fly: on your computer, `fly apps destroy kalayaan-stewardship`.

Your **Access application** (the email login) is untouched either way and
keeps guarding `roll.yourdomain.org`.

## Step 7 — Bring your data over, and sign in to LCR (5 min)

Your action lists, Focus list, notes and settings are in `output/prefs.json`
on your computer. In a **new** terminal window on your computer (not the
server), from the app's folder:

```
scp -i ~/Downloads/ssh-key-*.key output/prefs.json ubuntu@YOUR.IP.ADDRESS:~
```

Then back in the server window:

```
sudo cp ~/prefs.json /srv/kalayaan/output/prefs.json
sudo docker restart kalayaan
```

Now open **`https://roll.yourdomain.org`**, sign in with your email, and use
**Sign in to LCR** — LCR's page appears inside the app; tap and type your
way through, including the code sent to your phone.

**If LCR won't accept the sign-in from the server**, sign in on your
computer as before, then copy that sign-in up the same way:

```
scp -i ~/Downloads/ssh-key-*.key lcr-session.json ubuntu@YOUR.IP.ADDRESS:~
```
```
sudo cp ~/lcr-session.json /srv/kalayaan/lcr-session.json && sudo docker restart kalayaan
```

…and tell me what LCR said.

## Step 8 — Test

On your phone with **Wi-Fi off**, open `https://roll.yourdomain.org`, sign in
with your email, and check the roll. Then add it to your home screen
(Safari → Share → **Add to Home Screen**; Chrome → ⋮ → **Install app**).

---

## Later

- **Updating to a new version:** sign in to the server (step 4), then
  ```
  cd kalayaan-members && sudo ./deploy/update.sh
  ```
- **What's it doing?** `sudo docker logs -f kalayaan` (Ctrl+C to stop
  watching). Shows what LCR returned; never passwords.
- **Restarting:** `sudo docker restart kalayaan`. It also starts by itself
  whenever the server reboots.
- **Where the data is:** `/srv/kalayaan` on the server. Copy it somewhere
  now and then if you'd like a backup:
  `scp -r -i ~/Downloads/ssh-key-*.key ubuntu@YOUR.IP.ADDRESS:/srv/kalayaan/output ./backup`
  (run on your computer).

## If something's wrong

| You see | Means |
|---|---|
| Cloudflare error 1033 | The tunnel isn't connected: on the server, `sudo systemctl status cloudflared`. Re-run the setup with the token if needed. |
| Cloudflare 502 | Tunnel fine, app not running: `sudo docker ps`, then `sudo docker logs kalayaan`. |
| Sometimes the new app, sometimes the old one | The tunnel still runs on your computer as well — uninstall it there (step 6). |
| "Open the app through its usual link" on `roll.yourdomain.org` | A setting in `/etc/kalayaan.env` is wrong — `sudo docker logs kalayaan` says which check failed. Fix it with `sudo nano /etc/kalayaan.env`, then `sudo ./deploy/update.sh`. |
| `ssh: Permission denied (publickey)` | Wrong key file, or the user isn't `ubuntu`. |
| The build stops with "Killed" | Out of memory — make sure the shape has 6 GB (step 3); the script also adds swap. |
