import { google } from "googleapis";

export const SHEET_ID = process.env.SHEET_ID || "";

function creds() {
  let raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "";
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not set");
  if (!raw.trim().startsWith("{")) raw = Buffer.from(raw, "base64").toString("utf8");
  return JSON.parse(raw);
}

function api() {
  const c = creds();
  const auth = new google.auth.JWT({
    email: c.client_email,
    key: String(c.private_key).replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

export type Tab = { title: string; gid: number };
export type Cell = { r: number; c: number; v: string | number };

export async function getTabs(): Promise<Tab[]> {
  const res = await api().spreadsheets.get({ spreadsheetId: SHEET_ID, fields: "sheets.properties(title,sheetId)" });
  return (res.data.sheets || []).map((s) => ({ title: s.properties!.title!, gid: s.properties!.sheetId! }));
}

export async function readTab(title: string): Promise<string[][]> {
  const res = await api().spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `'${title}'`,
    valueRenderOption: "FORMATTED_VALUE",
  });
  return (res.data.values as string[][]) || [];
}

export function colLetter(n: number) {
  let s = "";
  for (n++; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

export async function writeCells(title: string, cells: Cell[]) {
  if (!cells.length) return;
  await api().spreadsheets.values.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      valueInputOption: "RAW",
      data: cells.map((c) => ({ range: `'${title}'!${colLetter(c.c)}${c.r + 1}`, values: [[c.v]] })),
    },
  });
}

export async function colorCells(gid: number, cells: { r: number; c: number; hex: string; bold?: boolean }[]) {
  if (!cells.length) return;
  const rgb = (h: string) => ({
    red: parseInt(h.slice(1, 3), 16) / 255,
    green: parseInt(h.slice(3, 5), 16) / 255,
    blue: parseInt(h.slice(5, 7), 16) / 255,
  });
  await api().spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: cells.map((x) => ({
        repeatCell: {
          range: { sheetId: gid, startRowIndex: x.r, endRowIndex: x.r + 1, startColumnIndex: x.c, endColumnIndex: x.c + 1 },
          cell: { userEnteredFormat: { backgroundColor: rgb(x.hex), textFormat: { bold: !!x.bold } } },
          fields: "userEnteredFormat(backgroundColor,textFormat)",
        },
      })),
    },
  });
}

export async function ensureTab(title: string): Promise<void> {
  const tabs = await getTabs();
  if (tabs.find((t) => t.title === title)) return;
  await api().spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: { requests: [{ addSheet: { properties: { title, hidden: false } } }] },
  });
}

export function sheetUrl(gid: number, row?: number) {
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=${gid}${row ? `&range=A${row}` : ""}`;
}
