import { NextResponse } from "next/server";
import { loadConfig, getGlobal, getZoho, saveKey } from "@/lib/config";
import { exchangeGrant, Zoho } from "@/lib/zoho";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { code } = await req.json();
    const cfg = await loadConfig();
    const g = getGlobal(cfg);
    const refresh = await exchangeGrant(String(code).trim(), g.dc);
    const z = { ...getZoho(cfg), refresh, accountId: undefined, inboxId: undefined };
    await saveKey("zoho", z);
    const zoho = new Zoho(g.dc, z);
    const aid = await zoho.accountId();
    return NextResponse.json({ ok: true, accountId: aid });
  } catch (e: any) { return NextResponse.json({ ok: false, error: e.message }, { status: 400 }); }
}
