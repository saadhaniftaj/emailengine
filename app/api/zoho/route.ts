import { NextResponse } from "next/server";
import { loadConfig, getGlobal, getZoho, getState, saveKey } from "@/lib/config";
import { exchangeGrant, Zoho } from "@/lib/zoho";

export const dynamic = "force-dynamic";

/**
 * Connect Zoho. The new login is VERIFIED before it is saved: it must be able to read the mailbox
 * list, and (if a From address is set) the mailbox must belong to that address. A bad code never
 * overwrites a working connection.
 */
export async function POST(req: Request) {
  try {
    const { code } = await req.json();
    const cfg = await loadConfig();
    const g = getGlobal(cfg);
    const refresh = await exchangeGrant(String(code).trim(), g.dc);
    const z = { ...getZoho(cfg), refresh, accountId: undefined, inboxId: undefined };
    const zoho = new Zoho(g.dc, z);
    let accts;
    try { accts = await zoho.accounts(); }
    catch (e: any) {
      throw new Error("Zoho accepted the code but refused to show the mailbox. The code was probably generated while logged into a DIFFERENT Zoho account. Log in to Zoho as the mailbox owner (private window), then generate a new code. (" + e.message.slice(0, 120) + ")");
    }
    if (!accts.length) throw new Error("This Zoho login has no mailbox. Log in as the mailbox owner and generate a new code.");
    const want = (g.fromAddress || "").trim().toLowerCase();
    const hit = want ? accts.find((a) => a.emails.includes(want)) : accts[0];
    if (!hit) throw new Error(`This Zoho login owns ${accts.flatMap((a) => a.emails).join(", ") || "other mailboxes"}, not ${g.fromAddress}. Generate the code while logged in as ${g.fromAddress}, or change "Your Zoho email" in Settings.`);
    z.accountId = hit.id as any;
    await saveKey("zoho", z);
    const st = getState(cfg); st.zohoError = ""; await saveKey("state", st);
    return NextResponse.json({ ok: true, accountId: hit.id, mailbox: hit.emails[0] || g.fromAddress });
  } catch (e: any) { return NextResponse.json({ ok: false, error: e.message }, { status: 400 }); }
}
