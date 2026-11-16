# Zoho handover — reconnecting the mailbox

Everything else (sheet, scheduler, secrets, deployment) is already configured. The **only** manual
task is giving the engine permission to send from the Zoho mailbox. This is needed once, and again only
if the dashboard shows **"⚠ Zoho needs reconnecting"**.

## Steps (≈3 minutes)
1. Open a **private / incognito browser window**.
2. Go to https://mail.zoho.com and log in as the **mailbox owner** (the "From" address shown in the
   dashboard under *Settings → Your Zoho email*). Confirm the inbox opens.
   *(If it redirects to mail.zoho.eu / .in / .com.au, tell the admin — the data centre setting must match.)*
3. In the **same window**, open https://api-console.zoho.com → **Self Client** → **Generate Code**.
4. Fill in:
   - **Scope:** `ZohoMail.messages.ALL,ZohoMail.accounts.READ,ZohoMail.folders.READ`
   - **Time duration:** 10 minutes
   - **Description:** anything
   Click **Create** and copy the code.
5. Open the dashboard → **Settings** → *Zoho connection* → paste the code → **Connect**
   (within 10 minutes — it expires).
6. You must see **"Zoho connected ✓ (mailbox@…)"**. Done. Queued emails resume on their own.

## Rules that prevent problems
- The code **must be generated while logged in as the mailbox owner**. Generating it in a browser logged
  into another Zoho account is the #1 cause of `INVALID_OAUTHTOKEN` errors.
- The system checks the code before saving it. If the message says the login "owns other mailboxes" or
  "refused to show the mailbox", repeat from step 1 in a fresh private window.
- Don't change the Zoho password / revoke sessions casually — that can invalidate the connection.
  If it happens, repeat the steps above.
- Never share the grant code or paste it anywhere except the Settings page.
