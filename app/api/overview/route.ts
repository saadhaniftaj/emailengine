import { NextResponse } from "next/server";
import { PIPELINES, loadConfig, getGlobal, getPipeline, getState, getZoho } from "@/lib/config";
import { getTabs, readTab, sheetUrl } from "@/lib/sheets";
import { norm, inWindow, formatLocalTime, firstName } from "@/lib/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 15-second server-side cache to avoid Sheets API quota errors
let cache: { data: unknown; at: number } | null = null;
const CACHE_TTL = 15_000;

export async function GET() {
  const env = {
    sheet: !!process.env.SHEET_ID,
    google: !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
    zohoClient: !!(process.env.ZOHO_CLIENT_ID && process.env.ZOHO_CLIENT_SECRET),
    cron: !!process.env.CRON_SECRET,
  };
  if (!env.sheet || !env.google) return NextResponse.json({ env, ready: false });

  if (cache && Date.now() - cache.at < CACHE_TTL) {
    return NextResponse.json(cache.data);
  }

  try {
    const cfg = await loadConfig();
    const tabs = await getTabs();
    const state = getState(cfg), now = Date.now(), nowDate = new Date();
    const pipelines = [];
    let queued = 0;
    let activeSent24h = 0;
    const candidates: any[] = [];

    for (const p of PIPELINES) {
      const tab = tabs.find((t) => t.title.trim().toLowerCase() === p.tab.toLowerCase());
      const pc = getPipeline(cfg, p.id);
      const counts: Record<string, number> = { total: 0, notSent: 0, awaiting: 0, replied: 0, noResponse: 0, bounced: 0, review: 0, autoReply: 0 };
      const replies: any[] = [];
      const sent24h = state.stamps.filter((s) => s.p === p.id && now - s.t < 86400000).length;

      if (!pc.paused) {
        activeSent24h += sent24h;
      }

      if (tab) {
        const rows = await readTab(tab.title);
        const h = (rows[0] || []).map(norm);
        const ix = (n: string) => h.indexOf(norm(n));
        const [iE, iN, iC, iS, iR, iSn, iRa, iD, iL] = ["Email", "Name", "Company", "Status", "Reply Status", "Reply Snippet", "Replied At", "Due At", "Location"].map(ix);
        for (let r = 1; r < rows.length; r++) {
          const row = rows[r];
          if (!row[iE]) continue;
          counts.total++;
          const st = (iS >= 0 ? row[iS] : "") || "Not Sent";
          const dueS = iD >= 0 ? row[iD] : "";
          const loc = iL >= 0 ? row[iL] : "";
          const name = iN >= 0 ? row[iN] : "";
          const co = iC >= 0 ? row[iC] : "";
          const email = row[iE];

          if (st === "Not Sent") {
            counts.notSent++;
            if (!pc.paused) {
              queued++;
              const due = dueS ? Date.parse(dueS) : NaN;
              candidates.push({
                r,
                name: firstName(name) || name || "Lead",
                company: co || "Prospect",
                email,
                pipeline: p.label,
                pipelineId: p.id,
                due: isNaN(due) ? now : due,
                loc,
                startH: pc.startH,
                endH: pc.endH,
                cap: pc.cap,
                sent24h,
              });
            }
          }
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
        sent24h,
      });
    }

    // Determine the next upcoming lead and transparent reason
    candidates.sort((a, b) => a.due - b.due);
    let nextLead: any = null;

    if (candidates.length > 0) {
      const cand = candidates[0];
      const normCo = norm(cand.company);
      const lastCoTime = (state.companyLast || {})[normCo] || 0;
      const coOnCooldown = normCo && (now - lastCoTime < 3600000);
      const winOk = !cand.loc || inWindow(nowDate, cand.loc, cand.startH, cand.endH);
      const capReached = cand.sent24h >= cand.cap;

      let status = "ready";
      let detail = "Ready to send on the next engine run";

      if (capReached) {
        status = "cap_reached";
        detail = `Daily cap (${cand.cap} emails) reached for ${cand.pipeline}. Resumes tomorrow.`;
      } else if (!winOk && cand.loc) {
        status = "window_closed";
        const { timeStr, tz } = formatLocalTime(nowDate, cand.loc);
        detail = `${cand.name} (${cand.company}) is in ${cand.loc} (${tz}). Current local time is ${timeStr}. Send window is ${cand.startH}:00 – ${cand.endH}:00.`;
      } else if (coOnCooldown) {
        status = "company_cooldown";
        const minsRemaining = Math.ceil((3600000 - (now - lastCoTime)) / 60000);
        detail = `${cand.company} was emailed recently. Cooling down for ${minsRemaining}m before sending another person at this company.`;
      } else if (cand.due > now) {
        status = "scheduled";
        detail = `Scheduled for ${new Date(cand.due).toLocaleTimeString([], { hour: "numeric", minute: "numeric" })}`;
      }

      nextLead = {
        name: cand.name,
        company: cand.company,
        email: cand.email,
        pipeline: cand.pipeline,
        due: cand.due,
        dueInMs: cand.due - now,
        status,
        detail,
      };
    }

    const g = getGlobal(cfg);
    const totalBatch = activeSent24h + queued;

    const data = {
      ready: true, env, global: g, zohoConnected: !!getZoho(cfg).refresh, pipelines,
      sent24h: state.stamps.filter((s) => now - s.t < 86400000).length,
      nextAllowed: state.nextAllowed,
      zohoError: state.zohoError || "",
      zohoTokenAt: (() => { try { return JSON.parse(cfg["ztoken"] || "null")?.at || 0; } catch { return 0; } })(),
      queue: {
        queued,
        batchTotal: totalBatch,
        batchSent: activeSent24h,
        nextLead,
        lastTick: state.lastTick || 0,
        lastSentAt: state.lastSentAt || 0,
        now,
      },
    };
    cache = { data, at: Date.now() };
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ env, ready: false, error: e.message });
  }
}
