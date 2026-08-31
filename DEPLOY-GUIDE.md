# How to Publish the Portal — Plain-Language Guide

*No technical background needed. Choose ONE option. Option A works today for free; Option B puts it on the internet; Option C is for when you have a tech volunteer.*

---

## Option A — Use it at the parish office today (free, 10 minutes)

The portal runs on the office computer, and anyone **on the same Wi-Fi** can sign in.

1. Put the folder on the office computer and start it (double-click `START-WINDOWS.bat` or `START-MAC-LINUX.sh` — see the README for the one-time Node.js install).
2. The black window will show a line like:
   `http://192.168.1.23:3000`
3. Give that address to members **on the same Wi-Fi** (send it by text/messenger). They open their browser, type it, and sign in.
4. Keep the computer and the black window running while people use it.

**Limitation:** members not on the parish Wi-Fi (e.g., at home) cannot connect this way — use Option A2 for that.

---

## Option A2 — Instant public link, NO account, NO payment (~2 minutes)

The fastest way to get members connected from anywhere. One double-click creates a secure public web link. (Verified working — it's the same "secure tunnel" method.)

1. On the parish office computer, double-click **`PUBLISH-NOW-WINDOWS.bat`** (or `PUBLISH-NOW-MAC-LINUX.sh` on a Mac).
2. Wait up to 30 seconds. A line starting with `https://` will appear — for example `https://abcd1234.lhr.life`. **That is your public link.**
3. Send it to your members (messenger, group chat, SMS). They open it in any browser and sign in. It works from home, work — anywhere with internet.
4. Keep the black window open — closing it stops the link.

**Notes**
- The link changes every time you restart — that's fine; just send the new one.
- The office computer must stay on and connected to the internet while the link is active.
- The portal itself is still protected: everyone needs a username and password; logins are limited and passwords are encrypted.
- If you want one **permanent** link, use Option B (Replit) or Option C (volunteer + small server).

---

## Option B — Put it on the internet with Replit (free, ~20 minutes)

Replit gives you a free web address your members can open from anywhere. Members keep the portal working while it's running.

**Step 1 — Make a Replit account**
- Go to https://replit.com and click **Sign up** (free). Use any email. Keep your password safe.

**Step 2 — Create a new project**
- After signing in, click the green **+ Create** (or "Create Repl").
- Choose **Node.js** as the template.
- Give it a name, e.g. `lcm-portal`. Click **Create Repl**.

**Step 3 — Upload the portal files**
- In the left panel (Files), click the **three dots (⋯)** at the top and choose **Upload file**, or drag the files in.
- Upload the **contents of the project folder** (not the zip itself). If you have the `lcm-ministry-portal.zip`: upload it, then in the Replit terminal type `unzip lcm-ministry-portal.zip` and press Enter, then move the files to the top level.
- Make sure `package.json`, `server`, `public`, and `docs` appear in the files panel.

**Step 4 — Install and run**
- Replit shows a terminal at the bottom. Type:
  `npm install` → Enter (wait until it finishes)
- Then press the green **Run** button (top of the screen). The portal starts.
- The portal creates its own database the first time (no extra step needed).

**Step 5 — Get your web address**
- Replit shows a "Webview" — and under it a URL like `https://lcm-portal.yourname.repl.co`.
- That is your public address. Send it to your members: `https://lcm-portal.yourname.repl.co`
- Sign in as `admin / Admin@123` and change the admin password immediately.

**Important free-tier notes**
- The site **sleeps after a while of no visitors** and wakes up when someone opens it (takes ~30 seconds). Your data stays saved.
- Anyone with the link can open the sign-in page — but only people with a username and password can get in.

---

## Option C — A proper website with a volunteer (best long-term)

Find a tech-savvy parishioner (a student, an IT person) and give them the README's **Part 3 — Technical appendix**. They can:
1. Rent a small server (~$5–10/month, e.g. DigitalOcean, Vultr, or a local provider).
2. Copy the project there, run `npm install` and `npm start`.
3. Put it behind a free HTTPS certificate (nginx/Caddy) with a domain like `lcm.yourparish.org`.

The README appendix has the exact commands. HTTPS means logins are encrypted — the right choice once real member data is inside.

---

## Good-to-know (for any option)

| Question | Answer |
|---|---|
| Do members need accounts? | Yes — the administrator creates them under **Members**. Sample accounts (see README) are for trying it out. |
| Is it secure? | Passwords are encrypted, login attempts are limited, and evaluation results stay confidential until the administrator approves them. |
| What about backups? | With the portal stopped, run `npm run backup` — it saves the database into the `backups/` folder. Copy that folder somewhere safe now and then. |
| What if something breaks? | Ask me — tell me the message you see and I'll guide you. |

---

## Option D — Render (for when the ministry has a helper with GitHub)

Render runs full Node apps, but two things matter:
1. **Render does not accept zip uploads.** It deploys from a **GitHub repository** — a helper needs to create a GitHub account, upload the zip contents to a repo, and connect Render to it.
2. **Free tier wipes runtime data on restart** (same problem as published apps elsewhere). To keep announcements/members across restarts you must add Render's **Persistent Disk** (paid add-on, ~$7–15/month).

The zip includes `render.yaml` (a ready blueprint) and a `Dockerfile` — a helper can follow the README appendix to get it running. Recommended only when the ministry is ready to pay ~$10–15/month for a permanent, always-on site.
