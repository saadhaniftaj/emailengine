import { NextResponse } from "next/server";
import { PIPELINES, loadConfig, getGlobal, getPipeline, getState, getZoho } from "@/lib/config";
import { getTabs, readTab, sheetUrl } from "@/lib/sheets";
import { norm } from "@/lib/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 60-second server-side cache to avoid Sheets API quota errors
let cache: { data: unknown; at: number } | null = null;
const CACHE_TTL = 60_000;

export async function GET() {
  const env = {
    sheet: !!process.env.SHEET_ID,
    google: !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
    zohoClient: !!(process.env.ZOHO_CLIENT_ID && process.env.ZOHO_CLIENT_SECRET),
    cron: !!process.env.CRON_SECRET,
  };
  if (!env.sheet || !env.google) return NextResponse.json({ env, ready: false });

  // Return cached response if fresh
  if (cache && Date.now() - cache.at < CACHE_TTL) {
    return NextResponse.json(cache.data);
  }

  try {
    const cfg = await loadConfig();
    const tabs = await getTabs();
    const state = getState(cfg), now = Date.now();
    const pipelines = [];
    for (const p of PIPELINES) {
      const tab = tabs.find((t) => t.title.trim().toLowerCase() === p.tab.toLowerCase());
      const pc = getPipeline(cfg, p.id);
      const counts: Record<string, number> = { total: 0, notSent: 0, awaiting: 0, replied: 0, noResponse: 0, bounced: 0, review: 0, autoReply: 0 };
      const replies: any[] = [];
      if (tab) {
        const rows = await readTab(tab.title);
        const h = (rows[0] || []).map(norm);
        const ix = (n: string) => h.indexOf(norm(n));
        const [iE, iN, iC, iS, iR, iSn, iRa] = ["Email", "Name", "Company", "Status", "Reply Status", "Reply Snippet", "Replied At"].map(ix);
        for (let r = 1; r < rows.length; r++) {
          const row = rows[r];
          if (!row[iE]) continue;
          counts.total++;
          const st = (iS >= 0 ? row[iS] : "") || "Not Sent";
          if (st === "Not Sent") counts.notSent++;
          else if (st === "Awaiting Reply") counts.awaiting++;
          else if (st === "Responded") {
            counts.replied++;
            replies.push({ name: row[iN], company: row[iC], email: row[iE], snippet: iSn >= 0 ? row[iSn] : "", at: iRa >= 0 ? row[iRa] : "", url: sheetUrl(tab.gid, r + 1) });
          } else if (st === "No Response") counts.noResponse++;
          else if (st === "Bounced") counts.bounced++;
          else if (st === "Needs Review") counts.review++;
          if (iR >= 0 && /auto-reply/i.test(row[iR] || "")) counts.autoReply++;
        }
      }
      pipelines.push({
        id: p.id, label: p.label, found: !!tab, url: tab ? sheetUrl(tab.gid) : "", cfg: pc, counts,
        replies: replies.sort((a, b) => String(b.at).localeCompare(String(a.at))),
        sent24h: state.stamps.filter((s) => s.p === p.id && now - s.t < 86400000).length,
      });
    }
    const g = getGlobal(cfg);
    const data = {
      ready: true, env, global: g, zohoConnected: !!getZoho(cfg).refresh, pipelines,
      sent24h: state.stamps.filter((s) => now - s.t < 86400000).length,
      nextAllowed: state.nextAllowed,
    };
    cache = { data, at: Date.now() }; // store in cache
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ env, ready: false, error: e.message });
  }
}
