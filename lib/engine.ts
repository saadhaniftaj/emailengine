import {
  PIPELINES, Pipeline, PipelineCfg, GlobalCfg, loadConfig, saveKey,
  getGlobal, getPipeline, getState, getZoho, State,
} from "./config";
import { getTabs, readTab, writeCells, colorCells, Cell } from "./sheets";
import { Zoho } from "./zoho";

/* ---------- column handling ---------- */
export const norm = (s: string) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const AUTO = ["Status", "Reply Status", "Last Step", "Follow-ups Sent", "Last Sent At", "Due At", "Replied At", "Reply Snippet", "Message ID", "Time Zone", "Date Sent"];

export type Ctx = {
  p: Pipeline; cfg: PipelineCfg; tab: string; gid: number;
  col: Record<string, number>; header: string[]; rows: string[][];
  writes: Cell[]; colors: { r: number; c: number; hex: string; bold?: boolean }[];
};

export async function loadCtx(p: Pipeline, cfg: PipelineCfg): Promise<Ctx | null> {
  const tabs = await getTabs();
  const t = tabs.find((x) => x.title.trim().toLowerCase() === p.tab.toLowerCase());
  if (!t) return null;
  const rows = await readTab(t.title);
  const header = (rows[0] || []).map((h) => String(h));
  const writes: Cell[] = [];
  const col: Record<string, number> = {};
  header.forEach((h, i) => { if (h.trim()) col[norm(h)] = i; });
  for (const a of AUTO) {
    if (col[norm(a)] === undefined) {
      col[norm(a)] = header.length;
      header.push(a);
      writes.push({ r: 0, c: header.length - 1, v: a });
    }
  }
  const ctx: Ctx = { p, cfg, tab: t.title, gid: t.gid, col, header, rows, writes, colors: [] };
  if (col["email"] === undefined) throw new Error(`Tab "${t.title}" has no Email column`);
  if (col["name"] === undefined) throw new Error(`Tab "${t.title}" has no Name column`);
  await flush(ctx);
  return ctx;
}

export const get = (x: Ctx, r: number, name: string) => String(x.rows[r]?.[x.col[norm(name)]] ?? "").trim();
export function set(x: Ctx, r: number, name: string, v: string | number) {
  const c = x.col[norm(name)];
  if (c === undefined) return;
  while (x.rows[r].length <= c) x.rows[r].push("");
  x.rows[r][c] = String(v);
  x.writes.push({ r, c, v });
}
export async function flush(x: Ctx) {
  const w = x.writes.splice(0), c = x.colors.splice(0);
  await writeCells(x.tab, w);
  await colorCells(x.gid, c);
}

/* ---------- time zones ---------- */
const TZ: [RegExp, string][] = [
  [/uae|dubai|sharjah|abu dhabi/, "Asia/Dubai"], [/ksa|saudi|riyadh|kuwait/, "Asia/Riyadh"],
  [/qatar/, "Asia/Qatar"], [/bahrain/, "Asia/Bahrain"], [/oman/, "Asia/Muscat"], [/egypt/, "Africa/Cairo"],
  [/uk|london|england|britain|scotland|ireland/, "Europe/London"], [/germany|austria/, "Europe/Berlin"],
  [/france/, "Europe/Paris"], [/netherlands|belgium/, "Europe/Amsterdam"], [/spain/, "Europe/Madrid"],
  [/italy/, "Europe/Rome"], [/switzerland/, "Europe/Zurich"], [/bulgaria/, "Europe/Sofia"], [/turkey/, "Europe/Istanbul"],
  [/singapore/, "Asia/Singapore"], [/indonesia/, "Asia/Jakarta"], [/phil/, "Asia/Manila"], [/malaysia/, "Asia/Kuala_Lumpur"],
  [/china/, "Asia/Shanghai"], [/india/, "Asia/Kolkata"], [/pakistan/, "Asia/Karachi"], [/japan/, "Asia/Tokyo"],
  [/australia|sydney|melbourne/, "Australia/Sydney"], [/canada|toronto/, "America/Toronto"],
  [/california|san francisco|los angeles|seattle|oregon|nevada/, "America/Los_Angeles"],
  [/texas|chicago|illinois|minnesota|dallas|houston/, "America/Chicago"],
  [/colorado|denver|arizona|utah/, "America/Denver"],
  [/usa|^us$|united states|new york|boston|florida|miami|atlanta/, "America/New_York"],
];
export function formatLocalTime(d: Date, loc: string): { timeStr: string; tz: string } {
  const { tz } = tzFor(loc);
  try {
    const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "numeric", hour12: true });
    return { timeStr: f.format(d), tz };
  } catch {
    return { timeStr: d.toLocaleTimeString([], { hour: "numeric", minute: "numeric" }), tz };
  }
}

export function tzFor(loc: string) {
  const l = String(loc).toLowerCase().trim();
  const gulf = /uae|dubai|sharjah|abu dhabi|ksa|saudi|riyadh|egypt|qatar|kuwait|bahrain|oman/.test(l);
  for (const [re, tz] of TZ) if (re.test(l)) return { tz, gulf };
  return { tz: "Europe/London", gulf: false };
}
function localParts(d: Date, tz: string) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "numeric", weekday: "short", hourCycle: "h23" });
  const p: Record<string, string> = {};
  f.formatToParts(d).forEach((x) => (p[x.type] = x.value));
  return { h: Number(p.hour) + Number(p.minute) / 60, wd: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday) };
}
export function inWindow(now: Date, loc: string, startH: number, endH: number) {
  const z = tzFor(loc), { h, wd } = localParts(now, z.tz);
  const weekend = z.gulf ? wd === 5 || wd === 6 : wd === 0 || wd === 6;
  return !weekend && h >= startH && h < endH;
}

/* ---------- templating ---------- */
export function firstName(n: string) {
  const f = String(n || "").trim().replace(/^(dr|mr|mrs|ms|prof)\.?\s+/i, "").split(/\s+/)[0];
  return f ? f.charAt(0).toUpperCase() + f.slice(1) : "";
}
export function render(text: string, vars: Record<string, string>) {
  const t = text.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (m, k) => vars[norm(k)] || m);
  return t.replace(/\{([^{}]*\|[^{}]*)\}/g, (_m, o: string) => {
    const a = o.split("|");
    return a[Math.floor(Math.random() * a.length)];
  });
}
function leadVars(x: Ctx, r: number) {
  const v: Record<string, string> = {};
  x.header.forEach((h) => { if (h.trim()) v[norm(h)] = get(x, r, h); });
  v["firstname"] = firstName(get(x, r, "Name"));
  v["companyname"] = get(x, r, "Company");
  return v;
}
export const previewVars = () => ({ firstname: "Alex", companyname: "Sample Research Ltd", name: "Alex Sample", company: "Sample Research Ltd" });

/* ---------- replies ---------- */
const AUTO_SUBJ = /auto(matic)?[\s-]?(reply|response)|out of office|away from|vacation|\booo\b|automatische antwort|abwesenheit|r[ée]ponse automatique|absence|respuesta autom|fuera de la oficina|afwezig/i;
const BOUNCE_SUBJ = /undeliver|delivery status|failure notice|returned mail|delivery has failed|couldn.t be delivered/i;

const isZohoAuth = (e: any) => /Zoho (401|token error|not connected|token refresh throttled)/.test(String(e?.message || e));

async function scanReplies(ctxs: Ctx[], zoho: Zoho, state: State, days: number) {
  const map: Record<string, { x: Ctx; r: number }> = {};
  for (const x of ctxs) for (let r = 1; r < x.rows.length; r++) {
    const e = get(x, r, "Email").toLowerCase();
    if (e && get(x, r, "Status") === "Awaiting Reply") map[e] = { x, r };
  }
  if (!Object.keys(map).length) return;
  const msgs = await zoho.inbox(Date.now() - days * 86400000);
  const me = "";
  for (const m of msgs) {
    const mid = String(m.messageId);
    if (state.seen.includes(mid)) continue;
    const from = String(m.fromAddress || m.sender || "").replace(/&lt;|&gt;/g, " ").toLowerCase();
    const fe = (from.match(/[^\s<>"']+@[^\s<>"']+\.[a-z]{2,}/) || [""])[0];
    const subj = String(m.subject || ""), summary = String(m.summary || "");
    if (!fe || fe === me) continue;

    if (/mailer-daemon|postmaster/.test(fe) || BOUNCE_SUBJ.test(subj)) {
      const text = (subj + " " + summary + " " + (await zoho.content(mid))).toLowerCase();
      for (let addr of text.match(/[^\s<>"'()]+@[^\s<>"'()]+\.[a-z]{2,}/g) || []) {
        addr = addr.replace(/[.,;:]+$/, "");
        const hit = map[addr];
        if (hit) { mark(hit.x, hit.r, "Bounced", "BOUNCED", "#f4c7c3", m); delete map[addr]; }
      }
      state.seen.push(mid);
      continue;
    }
    const hit = map[fe];
    if (!hit) continue;
    state.seen.push(mid);
    const sentAt = get(hit.x, hit.r, "Date Sent") || get(hit.x, hit.r, "Last Sent At");
    if (sentAt && Number(m.receivedTime) < new Date(sentAt).getTime() - 60000) continue;
    const hdr = await zoho.header(mid);
    const auto = AUTO_SUBJ.test(subj) || /auto-submitted:\s*auto-(replied|generated)|x-autoreply|x-autorespond|precedence:\s*(auto_reply|bulk|junk)/i.test(hdr);
    if (auto) {
      set(hit.x, hit.r, "Reply Status", "Auto-reply (ignored)");
      hit.x.colors.push({ r: hit.r, c: hit.x.col[norm("Reply Status")], hex: "#fff2cc" });
    } else {
      mark(hit.x, hit.r, "Responded", "REPLIED - ACTION NEEDED", "#34a853", m, true);
      delete map[fe];
    }
  }
  state.seen = state.seen.slice(-600);
}

function mark(x: Ctx, r: number, status: string, label: string, hex: string, m: any, bold = false) {
  set(x, r, "Status", status);
  set(x, r, "Due At", "");
  set(x, r, "Replied At", new Date(Number(m.receivedTime)).toISOString());
  set(x, r, "Reply Snippet", String(m.summary || "").replace(/\s+/g, " ").slice(0, 200));
  set(x, r, "Reply Status", label);
  x.colors.push({ r, c: x.col[norm("Reply Status")], hex, bold: true });
}

/* ---------- scheduling ---------- */
function scheduleNew(x: Ctx, state: State, isManual = false): number[] {
  const fresh: number[] = []; // rows needing a (re)staggered send slot
  const staggerFrom = state.staggerFrom || Date.now();
  const seen: Record<string, 1> = {};
  const dl = x.cfg.delays;
  const startRow = x.cfg.startRow || 0; // rows at or below this index are old leads
  for (let r = 1; r < x.rows.length; r++) {
    const email = get(x, r, "Email").toLowerCase();
    if (!email) continue;
    let st = get(x, r, "Status");
    // "Bounced" is NOT in this list — if user edits the email and clears Status, it retries
    if (["Needs Review", "Duplicate", "Responded", "No Response"].includes(st)) { seen[email] = 1; continue; }
    if (seen[email]) { set(x, r, "Status", "Duplicate"); continue; }
    seen[email] = 1;
    const dueAt = get(x, r, "Due At");
    const dueTime = dueAt ? Date.parse(dueAt) : 0;
    // Stale/overdue leads (e.g. from when engine was paused or Zoho was down) get smoothly re-staggered
    const isUnsent = !st || st === "Not Sent";
    const isStale = isUnsent && (!dueAt || isNaN(dueTime) || dueTime < Date.now() - 30 * 60000);
    if (dueAt && !isStale) continue;

    // Skip old leads that haven't been touched (blank status, no engine action yet)
    // unless the user explicitly set a status like "Awaiting Reply"
    if (!isManual && startRow > 0 && r <= startRow && !st) continue;

    // Only 3 mandatory fields: Name, Email, Company
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || !firstName(get(x, r, "Name")) || !get(x, r, "Company")) {
      set(x, r, "Status", "Needs Review"); set(x, r, "Notes", "Missing name, email or company"); continue;
    }

    // Set timezone if Location column exists (optional)
    const loc = get(x, r, "Location");
    if (loc) set(x, r, "Time Zone", tzFor(loc).tz);

    const dateSent = get(x, r, "Date Sent");
    // Skip rows already mailed before the engine started
    if (!st && dateSent && !isNaN(Date.parse(dateSent))) continue;

    if (!st || st === "Not Sent") {
      set(x, r, "Status", "Not Sent"); fresh.push(r);
    } else if (st === "Awaiting Reply") {
      // Do not schedule auto follow-ups for leads sent via "Send One Now"
      if (get(x, r, "Notes").toLowerCase().includes("send one now")) continue;
      const sent = Number(get(x, r, "Follow-ups Sent") || 0);
      if (sent >= dl.length) { set(x, r, "Status", "No Response"); continue; }
      const last = new Date(get(x, r, "Last Sent At") || Date.now()).getTime();
      set(x, r, "Due At", new Date(last + dl[sent] * 3600000).toISOString());
    }
  }

  return fresh;
}

const TARGET_SPAN_MS = 7.5 * 3600000; // aim to spread a batch over ~7.5h (gap clamped to 1.5-8 min avg)
const COMPANY_COOLDOWN_MS = 60 * 60000; // never mail the same company twice within an hour

/**
 * Humanized batch scheduling. New rows from all active pipelines are interleaved round-robin by
 * company (CFO -> other companies -> HR -> ...), then each gets a randomized send slot. The average gap
 * adapts to batch size so 50/100/150 leads all spread over roughly 7-8 hours.
 */
function assignSlots(fresh: { x: Ctx; r: number; co: string }[], state: State) {
  if (!fresh.length) return;
  const groups = new Map<string, { x: Ctx; r: number; co: string }[]>();
  for (const f of fresh.slice().reverse()) { // newest first
    const k = f.co || "?" + f.r;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(f);
  }
  const order: { x: Ctx; r: number; co: string }[] = [];
  while (groups.size) {
    for (const [k, list] of Array.from(groups.entries())) {
      order.push(list.shift()!);
      if (!list.length) groups.delete(k);
    }
  }
  const now = Date.now();
  if ((state.batchSent || 0) >= (state.batchTotal || 0)) { state.batchTotal = 0; state.batchSent = 0; state.batchStart = now; }
  state.batchTotal = (state.batchTotal || 0) + order.length;
  const avg = Math.min(8 * 60000, Math.max(1.5 * 60000, TARGET_SPAN_MS / order.length));
  let cursor = Math.max(now, state.slotCursor && state.slotCursor > now ? state.slotCursor : now);
  for (const o of order) {
    set(o.x, o.r, "Due At", new Date(cursor).toISOString());
    cursor += avg * 0.8 * (0.5 + Math.random()) + (Math.random() < 0.06 ? avg * (3 + Math.random() * 3) : 0);
  }
  state.slotCursor = cursor;
  state.batchEnd = cursor;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));


/* ---------- main tick ---------- */
export async function tick(force = false): Promise<string> {
  const cfg = await loadConfig();
  const g: GlobalCfg = getGlobal(cfg), state = getState(cfg), zs = getZoho(cfg);
  if (!zs.refresh) return "zoho not connected";
  if (!g.fromAddress) return "from address not set";
  // overlapping runs (several triggers) must not both work: skip if another run is in progress
  if (!force && (state.busyUntil || 0) > Date.now()) return "busy (another run in progress)";
  if (!force) { state.busyUntil = Date.now() + 55000; await saveKey("state", state); }
  const zoho = new Zoho(g.dc, zs);

  const ctxs: Ctx[] = [];
  for (const p of PIPELINES) {
    const x = await loadCtx(p, getPipeline(cfg, p.id));
    if (x) ctxs.push(x);
  }
  // reply scan hits Zoho, so do it at most every 5 minutes (not on every 1-minute tick)
  const scanDue = force || !state.lastScan || Date.now() - state.lastScan >= 5 * 60000;
  try { if (scanDue) { await scanReplies(ctxs, zoho, state, 2); state.lastScan = Date.now(); } }
  catch (err: any) { if (isZohoAuth(err)) { state.zohoError = String(err.message).slice(0, 200); await saveKey("state", state); } }
  for (const x of ctxs) await flush(x);

  if (force) {
    const out = await sendLatest(ctxs, zoho, g, state);
    await saveKey("state", state);
    return out;
  }

  let result = "idle";
  const now = new Date();
  state.stamps = state.stamps.filter((s) => now.getTime() - s.t < 86400000);
  if (!state.lastCompany) state.lastCompany = "";

  if (!state.staggerFrom) state.staggerFrom = now.getTime();
  state.lastTick = now.getTime();
  const t0 = Date.now();
  const MAX_PER_TICK = 3; // sends per run; spaced by short random pauses, rest wait for next run
  if (!g.paused) {
    const freshAll: { x: Ctx; r: number; co: string }[] = [];
    for (const x of ctxs) {
      if (x.cfg.paused) continue;
      for (const r of scheduleNew(x, state)) freshAll.push({ x, r, co: norm(get(x, r, "Company")) });
    }
    assignSlots(freshAll, state);
    for (const x of ctxs) await flush(x);

    const sent: string[] = [];
    for (let n = 0; n < MAX_PER_TICK && Date.now() - t0 < 35000; n++) {
      const cur = new Date();
      if (state.stamps.length >= g.cap) break;
      const elig: { x: Ctx; r: number; co: string; due: number; step0: boolean }[] = [];
      for (const x of ctxs) {
        if (x.cfg.paused) continue;
        if (state.stamps.filter((s) => s.p === x.p.id).length >= x.cfg.cap) continue;
        for (let r = 1; r < x.rows.length; r++) {
          const st = get(x, r, "Status"), dueS = get(x, r, "Due At");
          if (!dueS || (st !== "Not Sent" && st !== "Awaiting Reply")) continue;
          const due = new Date(dueS).getTime();
          if (due > cur.getTime()) continue;
          const step0 = st === "Not Sent";
          // follow-ups keep the global gap timer; scheduled first emails are already spaced by their slots
          if (!step0 && cur.getTime() < state.nextAllowed) continue;
          const loc = get(x, r, "Location");
          if (loc && !inWindow(cur, loc, x.cfg.startH, x.cfg.endH)) continue;
          const co = norm(get(x, r, "Company"));
          if (co && cur.getTime() - ((state.companyLast || {})[co] || 0) < COMPANY_COOLDOWN_MS) continue;
          elig.push({ x, r, co, due, step0 });
        }
      }
      if (!elig.length) break;
      elig.sort((a, b) => (a.step0 === b.step0 ? a.due - b.due : a.step0 ? -1 : 1));
      const pick = elig.find((e) => e.co !== state.lastCompany) || elig[0];
      try {
        const res = await sendOne(pick.x, pick.r, zoho, g, state);
        sent.push(res);
        state.stamps.push({ t: Date.now(), p: pick.x.p.id });
        state.lastCompany = pick.co;
        state.lastSentAt = Date.now();
        state.zohoError = "";
        if (!state.companyLast) state.companyLast = {};
        if (pick.co) state.companyLast[pick.co] = Date.now();
        if (pick.step0 && (state.batchSent || 0) < (state.batchTotal || 0)) state.batchSent = (state.batchSent || 0) + 1;
        if (!pick.step0) state.nextAllowed = Date.now() + (g.minGap + Math.random() * (g.maxGap - g.minGap)) * 60000;
      } catch (e: any) {
        sent.push("failed: " + e.message);
        if (isZohoAuth(e)) state.zohoError = String(e.message).slice(0, 200);
        break;
      }
      await sleep(4000 + Math.random() * 8000);
    }
    result = sent.length ? sent.join(" | ") : "idle";
  } else result = "engine paused";
  state.busyUntil = 0;
  await saveKey("state", state);
  return result;
}


async function sendOne(x: Ctx, r: number, zoho: Zoho, g: GlobalCfg, state: State, isManual = false) {
  const email = get(x, r, "Email");
  const step = isManual || get(x, r, "Status") === "Not Sent" ? 0 : Number(get(x, r, "Follow-ups Sent") || 0) + 1;
  const tpl = x.cfg.templates[step];
  if (!tpl) { set(x, r, "Status", "No Response"); set(x, r, "Due At", ""); await flush(x); return "no template"; }
  const vars = leadVars(x, r);
  const subject = render(tpl.subject, vars), body = render(tpl.body, vars);
  if (/\{\{.*?\}\}/.test(subject + body)) {
    set(x, r, "Status", "Needs Review"); set(x, r, "Due At", ""); await flush(x); return "unfilled placeholder: " + email;
  }
  const sender = g.fromAddress;
  const prev = get(x, r, "Message ID");
  let id: string;
  const sig = g.signatureHtml || undefined; // undefined = fall back to Zoho API sig
  if (step === 0 || !prev) id = await zoho.send(email, subject, body, sender, g.senderName, sig);
  else id = (await zoho.reply(prev, email, subject, body, sender, g.senderName, sig)).id;

  const nowIso = new Date().toISOString();
  if (step === 0 || !prev) set(x, r, "Message ID", id);
  set(x, r, "Last Sent At", nowIso);
  set(x, r, "Status", "Awaiting Reply");
  if (step === 0) set(x, r, "Date Sent", nowIso.slice(0, 10));
  set(x, r, "Follow-ups Sent", step);
  set(x, r, "Last Step", step === 0 ? "Initial" : "Follow-up " + step);
  const fuName = "followup" + step;
  if (step > 0 && x.col[fuName] !== undefined) set(x, r, x.header[x.col[fuName]], nowIso.slice(0, 10));
  if (isManual) {
    set(x, r, "Notes", "Sent via Send One Now (no auto follow-ups)");
    set(x, r, "Due At", "");
  } else if (step >= x.cfg.delays.length) {
    set(x, r, "Due At", "");
    set(x, r, "Status", "No Response");
  } else {
    set(x, r, "Due At", new Date(Date.now() + x.cfg.delays[step] * 3600000).toISOString());
  }
  await flush(x);
  return `sent step ${step} to ${email}`;
}


/**
 * "Send one now": strictly the LATEST entry (last row with an email) of every ACTIVE
 * (not paused) pipeline gets its initial email. Never sends follow-ups, never picks older rows.
 */
async function sendLatest(ctxs: Ctx[], zoho: Zoho, g: GlobalCfg, state: State): Promise<string> {
  const out: string[] = [];
  for (const x of ctxs) {
    if (x.cfg.paused) { out.push(`${x.p.label}: paused, skipped`); continue; }
    let r = -1;
    for (let i = x.rows.length - 1; i >= 1; i--) if (get(x, i, "Email")) { r = i; break; }
    if (r < 0) { out.push(`${x.p.label}: no entries`); continue; }
    const email = get(x, r, "Email");
    const st = get(x, r, "Status");
    if (st && st !== "Not Sent") { out.push(`${x.p.label}: latest entry ${email} already handled (${st}), nothing sent`); continue; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || !firstName(get(x, r, "Name")) || !get(x, r, "Company")) {
      set(x, r, "Status", "Needs Review"); set(x, r, "Notes", "Missing name, email or company"); await flush(x);
      out.push(`${x.p.label}: latest entry ${email} missing name/email/company`); continue;
    }
    const loc = get(x, r, "Location");
    if (loc) set(x, r, "Time Zone", tzFor(loc).tz);
    set(x, r, "Status", "Not Sent");
    try {
      out.push(`${x.p.label}: ` + await sendOne(x, r, zoho, g, state, true));
      state.stamps.push({ t: Date.now(), p: x.p.id });
    } catch (e: any) {
      out.push(`${x.p.label}: failed ${email}: ${e.message}`);
    }
  }
  return out.join(" | ");
}
