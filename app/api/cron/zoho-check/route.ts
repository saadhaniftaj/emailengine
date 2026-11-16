import { NextResponse } from "next/server";
import { PIPELINES, loadConfig, getGlobal, getPipeline, getState, getZoho, saveKey } from "@/lib/config";
import { getAccessToken, Zoho } from "@/lib/zoho";
import { loadCtx, inWindow, tzFor, tick, get, norm } from "@/lib/engine";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try { return await run(req); } catch (e: any) { return NextResponse.json({ error: String(e?.message || e), stack: e?.stack }, { status: 500 }); }
}

async function run(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  
  const url = new URL(req.url);
  const doForce = url.searchParams.get("force") === "1";
  const unpause = url.searchParams.get("unpause") === "1";
  const fixWindows = url.searchParams.get("fixwindows") === "1";

  const cfg = await loadConfig();
  const g = getGlobal(cfg), z = getZoho(cfg), state = getState(cfg);
  
  if (unpause) {
    g.paused = false;
    await saveKey("global", g);
    for (const p of PIPELINES) {
      const pc = getPipeline(cfg, p.id);
      pc.paused = false;
      await saveKey("pipeline:" + p.id, pc);
    }
  }

  if (fixWindows) {
    for (const p of PIPELINES) {
      const pc = getPipeline(cfg, p.id);
      pc.startH = 0;
      pc.endH = 24;
      await saveKey("pipeline:" + p.id, pc);
    }
  }

  if (doForce) {
    const res = await tick(true);
    return NextResponse.json({ forcedTickResult: res });
  }

  const out: any = {
    now: new Date().toISOString(),
    global: g,
    pipelinesCfg: PIPELINES.map(p => ({ id: p.id, label: p.label, cfg: getPipeline(cfg, p.id) })),
    state: {
      nextAllowed: state.nextAllowed,
      stampsCount24h: state.stamps?.filter(s => Date.now() - s.t < 86400000).length,
      lastCompany: state.lastCompany,
      lastTick: state.lastTick,
      lastSentAt: state.lastSentAt,
      busyUntil: state.busyUntil,
      zohoError: state.zohoError,
      batchTotal: state.batchTotal,
      batchSent: state.batchSent,
      slotCursor: state.slotCursor,
    },
    zoho: {
      dc: g.dc,
      hasRefresh: !!z.refresh,
      accountId: z.accountId,
      from: g.fromAddress
    }
  };

  // Inspect eligible leads and check why rows aren't sending
  const cur = new Date();
  const pipelineAnalysis: any[] = [];
  
  for (const p of PIPELINES) {
    const pc = getPipeline(cfg, p.id);
    const ctx = await loadCtx(p, pc);
    if (!ctx) {
      pipelineAnalysis.push({ id: p.id, error: "ctx not loaded" });
      continue;
    }
    const sampleRows: any[] = [];
    let notSentCount = 0;
    let awaitingCount = 0;
    let eligibleCount = 0;

    for (let r = 1; r < ctx.rows.length; r++) {
      const email = get(ctx, r, "Email");
      if (!email) continue;
      const st = get(ctx, r, "Status") || "Not Sent";
      const dueS = get(ctx, r, "Due At");
      const loc = get(ctx, r, "Location");
      const co = norm(get(ctx, r, "Company"));
      
      if (st === "Not Sent") notSentCount++;
      if (st === "Awaiting Reply") awaitingCount++;

      if (st === "Not Sent" || st === "Awaiting Reply") {
        const due = dueS ? new Date(dueS).getTime() : NaN;
        const duePassed = !isNaN(due) && due <= cur.getTime();
        const winOk = !loc || inWindow(cur, loc, pc.startH, pc.endH);
        const cooldownOk = !co || (cur.getTime() - ((state.companyLast || {})[co] || 0) >= 3600000);
        const isElig = duePassed && winOk && cooldownOk;
        if (isElig) eligibleCount++;

        if (sampleRows.length < 10) {
          sampleRows.push({
            r,
            email,
            co,
            st,
            dueS,
            duePassed,
            dueMinutesFromNow: isNaN(due) ? null : Math.round((due - cur.getTime()) / 60000),
            loc,
            tz: loc ? tzFor(loc).tz : null,
            winOk,
            window: `${pc.startH}-${pc.endH}`,
            cooldownOk,
            isElig
          });
        }
      }
    }

    pipelineAnalysis.push({
      id: p.id,
      label: p.label,
      paused: pc.paused,
      totalRows: ctx.rows.length - 1,
      notSentCount,
      awaitingCount,
      eligibleCount,
      samples: sampleRows
    });
  }

  out.analysis = pipelineAnalysis;
  return NextResponse.json(out);
}
