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
function scheduleNew(x: Ctx) {
  const seen: Record<string, 1> = {};
  const dl = x.cfg.delays;
  for (let r = 1; r < x.rows.length; r++) {
    const email = get(x, r, "Email").toLowerCase();
    if (!email) continue;
    let st = get(x, r, "Status");
    if (["Needs Review", "Duplicate", "Responded", "Bounced", "No Response"].includes(st)) { seen[email] = 1; continue; }
    if (seen[email]) { set(x, r, "Status", "Duplicate"); continue; }
    seen[email] = 1;
    if (get(x, r, "Due At")) continue;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || !firstName(get(x, r, "Name"))) {
      set(x, r, "Status", "Needs Review"); continue;
    }
    set(x, r, "Time Zone", tzFor(get(x, r, "Location")).tz);
    const dateSent = get(x, r, "Date Sent");
    if (!st && dateSent && !isNaN(Date.parse(dateSent))) {     // already contacted before the engine
      st = "Awaiting Reply";
      set(x, r, "Status", st); set(x, r, "Last Sent At", new Date(dateSent).toISOString()); set(x, r, "Follow-ups Sent", 0);
    }
    if (!st || st === "Not Sent") {
      set(x, r, "Status", "Not Sent"); set(x, r, "Due At", new Date().toISOString());
    } else if (st === "Awaiting Reply") {
      const sent = Number(get(x, r, "Follow-ups Sent") || 0);
      if (sent >= dl.length) { set(x, r, "Status", "No Response"); continue; }
      const last = new Date(get(x, r, "Last Sent At") || Date.now()).getTime();
      set(x, r, "Due At", new Date(last + dl[sent] * 3600000).toISOString());
    }
  }
}

/* ---------- main tick ---------- */
export async function tick(): Promise<string> {
  const cfg = await loadConfig();
  const g: GlobalCfg = getGlobal(cfg), state = getState(cfg), zs = getZoho(cfg);
  if (!zs.refresh) return "zoho not connected";
  if (!g.fromAddress) return "from address not set";
  const zoho = new Zoho(g.dc, zs);

  const ctxs: Ctx[] = [];
  for (const p of PIPELINES) {
    const x = await loadCtx(p, getPipeline(cfg, p.id));
    if (x) ctxs.push(x);
  }
  await scanReplies(ctxs, zoho, state, 2);
  for (const x of ctxs) await flush(x);

  let result = "idle";
  const now = new Date();
  state.stamps = state.stamps.filter((s) => now.getTime() - s.t < 86400000);

  if (!g.paused && now.getTime() >= state.nextAllowed && state.stamps.length < g.cap) {
    const elig: { x: Ctx; r: number }[] = [];
    for (const x of ctxs) {
      if (x.cfg.paused) continue;
      scheduleNew(x);
      if (state.stamps.filter((s) => s.p === x.p.id).length >= x.cfg.cap) continue;
      for (let r = 1; r < x.rows.length; r++) {
        const st = get(x, r, "Status"), due = get(x, r, "Due At");
        if (!due || (st !== "Not Sent" && st !== "Awaiting Reply")) continue;
        if (new Date(due).getTime() > now.getTime()) continue;
        if (inWindow(now, get(x, r, "Location"), x.cfg.startH, x.cfg.endH)) elig.push({ x, r });
      }
    }
    for (const x of ctxs) await flush(x);
    if (elig.length) {
      const { x, r } = elig[Math.floor(Math.random() * elig.length)];
      result = await sendOne(x, r, zoho, g, state);
      state.stamps.push({ t: Date.now(), p: x.p.id });
      const gap = (g.minGap + Math.random() * (g.maxGap - g.minGap)) * 60000 + (Math.random() < g.breakChance ? (10 + Math.random() * 25) * 60000 : 0);
      state.nextAllowed = Date.now() + gap;
    }
  }
  await saveKey("state", state);
  return result;
}

async function sendOne(x: Ctx, r: number, zoho: Zoho, g: GlobalCfg, state: State) {
  const email = get(x, r, "Email");
  const step = get(x, r, "Status") === "Not Sent" ? 0 : Number(get(x, r, "Follow-ups Sent") || 0) + 1;
  const tpl = x.cfg.templates[step];
  if (!tpl) { set(x, r, "Status", "No Response"); set(x, r, "Due At", ""); await flush(x); return "no template"; }
  const vars = leadVars(x, r);
  const subject = render(tpl.subject, vars), body = render(tpl.body, vars);
  if (/\{\{.*?\}\}/.test(subject + body)) {
    set(x, r, "Status", "Needs Review"); set(x, r, "Due At", ""); await flush(x); return "unfilled placeholder: " + email;
  }
  const prev = get(x, r, "Message ID");
  let id: string;
  if (step === 0 || !prev) id = await zoho.send(email, subject, body, g.fromAddress, g.senderName);
  else id = (await zoho.reply(prev, email, subject, body, g.fromAddress, g.senderName)).id;

  const nowIso = new Date().toISOString();
  if (step === 0 || !prev) set(x, r, "Message ID", id);
  set(x, r, "Last Sent At", nowIso);
  set(x, r, "Status", "Awaiting Reply");
  if (step === 0) set(x, r, "Date Sent", nowIso.slice(0, 10));
  set(x, r, "Follow-ups Sent", step);
  set(x, r, "Last Step", step === 0 ? "Initial" : "Follow-up " + step);
  // write the date into the user's own "Followup N" column if present
  const fuName = ["followup" + step];
  if (step > 0 && x.col[fuName[0]] !== undefined) set(x, r, x.header[x.col[fuName[0]]], nowIso.slice(0, 10));
  if (step >= x.cfg.delays.length) { set(x, r, "Due At", ""); set(x, r, "Status", "No Response"); }
  else set(x, r, "Due At", new Date(Date.now() + x.cfg.delays[step] * 3600000).toISOString());
  await flush(x);
  return `sent step ${step} to ${email}`;
}
