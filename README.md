# emailengine

Dashboard + engine for Zoho cold outreach, driven by a Google Sheet (Next.js on Vercel).

- Two pipelines (tabs `Market Research`, `Consultancy`), each with its own play/pause, follow-up timings and templates.
- Sends from Zoho via the Zoho Mail API, inside each lead's local morning window, with random human-like gaps.
- Real replies turn the `Reply Status` cell green and stop the lead. Nothing is auto-replied.
- Replies count on the dashboard links to the sheet rows.

## Environment variables (Vercel)
`DASHBOARD_PASSWORD`, `CRON_SECRET`, `SHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_JSON` (share the sheet with its email as Editor),
`ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`.

## Scheduling
Vercel Hobby cron is daily only, so `.github/workflows/tick.yml` pings `/api/cron` every 5 minutes.
Set GitHub secrets `APP_URL` and `CRON_SECRET`.

`legacy-apps-script/` holds the earlier Apps Script version.
