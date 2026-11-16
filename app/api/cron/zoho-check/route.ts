import { NextResponse } from "next/server";
import { loadConfig, getGlobal, getZoho } from "@/lib/config";
import { getAccessToken } from "@/lib/zoho";

export const dynamic = "force-dynamic";

/** Diagnostic (cron-secret protected): shows what Zoho grants the saved refresh token. No tokens are returned. */
export async function GET(req: Request) {
  try { return await run(req); } catch (e: any) { return NextResponse.json({ error: String(e?.message || e) }, { status: 500 }); }
}

async function run(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const cfg = await loadConfig(), g = getGlobal(cfg), z = getZoho(cfg);
  const out: any = { dc: g.dc, hasRefresh: !!z.refresh, accountId: z.accountId, from: g.fromAddress };
  if (!z.refresh) return NextResponse.json(out);
  const tok = await getAccessToken(g.dc, z).catch((e: any) => { out.tokenError = String(e.message).slice(0, 200); return ""; });
  const tj: any = { access_token: tok };
  try { const st = JSON.parse(cfg["ztoken"] || "null"); if (st) out.tokenAgeMin = Math.round((Date.now() - st.at) / 60000); } catch {}
  if (tj.access_token) {
    const h = { Authorization: "Zoho-oauthtoken " + tj.access_token, Accept: "application/json" };
    const a = await fetch(`https://mail.zoho.${g.dc}/api/accounts`, { headers: h });
    const aj: any = await a.json().catch(() => ({}));
    out.accounts = { status: a.status, list: (Array.isArray(aj.data) ? aj.data : []).map((x: any) => ({ id: x.accountId, mail: x.primaryEmailAddress || x.mailboxAddress })), err: aj.data?.errorCode, raw: Array.isArray(aj.data) ? undefined : JSON.stringify(aj).slice(0, 300) };
  }
  return NextResponse.json(out);
}
