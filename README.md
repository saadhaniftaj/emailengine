# emailengine

Zoho-only cold-outreach automation on Google Sheets + Apps Script.

- Sends the initial email and follow-ups from your Zoho mailbox (Zoho Mail API).
- Sends only during each lead's local morning window (set from the `Location` column).
- Humanised pacing: random gaps, occasional breaks, rolling 24h cap (default 150, follow-ups included).
- Follow-up delays are adjustable in Settings (default `24,48,168,168` hours).
- Real replies turn the `Reply Status` cell green and stop that lead. No auto-replies are ever sent.
  Out-of-office is yellow (ignored); bounces are red.

## Files
- `Code.gs` - the Apps Script.
- `build_workbook.py` - generates `Outreach_Workbook.xlsx` (Leads, Templates, Settings, Log). Requires `openpyxl`.

## Setup
1. `python3 build_workbook.py`, upload `Outreach_Workbook.xlsx` to Google Drive, open as a Google Sheet.
2. In Settings set Zoho Address, Zoho Data Center (`com`, `in`, `eu`, `com.au`), Test Email, Alert Email.
3. Extensions > Apps Script: paste `Code.gs`, save, reload the sheet.
4. In `api-console.zoho.<dc>` create a **Self Client**; generate a code with scope
   `ZohoMail.messages.ALL,ZohoMail.accounts.READ,ZohoMail.folders.READ`.
5. Outreach > Connect Zoho (paste Client ID, Secret, grant code). Credentials are stored in Script Properties only.
6. Outreach > Send preview, then Start automation, add leads, set `Paused` to `FALSE`.

Never commit API credentials.
