import { getZoho, saveKey, loadConfig, ZohoState } from "./config";

let tokenCache: { t: string; exp: number; rt: string; at: number } | null = null;
let sigCache: { html: string; at: number } | null = null; // cached signature HTML

function base(dc: string) { return `https://mail.zoho.${dc}/api`; }

export async function exchangeGrant(code: string, dc: string): Promise<string> {
  const res = await fetch(`https://accounts.zoho.${dc}/oauth/v2/token`, {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: process.env.ZOHO_CLIENT_ID || "",
      client_secret: process.env.ZOHO_CLIENT_SECRET || "",
      code,
    }),
  });
  const j = await res.json();
  if (!j.refresh_token) throw new Error("Zoho said: " + JSON.stringify(j));
  return j.refresh_token;
}

/**
 * Access tokens are shared between ALL engine runs (stored in the _EngineConfig tab) and reused until
 * ~5 min before expiry. Zoho caps active tokens per refresh token and invalidates older ones when it is
 * exceeded, so we must NOT mint a token per run. Refreshes are also throttled to one per 2 minutes.
 */
type StoredToken = { t: string; exp: number; rt: string; at: number };
const MIN_REFRESH_GAP = 2 * 60000;

async function readStored(): Promise<StoredToken | null> {
  try { const raw = (await loadConfig())["ztoken"]; return raw ? JSON.parse(raw) : null; } catch { return null; }
}

export async function getAccessToken(dc: string, z: ZohoState, bad?: string): Promise<string> {
  if (!z.refresh) throw new Error("Zoho not connected");
  const fresh = (x: StoredToken | null) => !!x && x.rt === z.refresh && x.exp > Date.now() + 5 * 60000 && x.t !== bad;
  if (fresh(tokenCache)) return tokenCache!.t;
  let st = await readStored();
  if (fresh(st)) { tokenCache = st; return st!.t; }
  // someone may have refreshed a moment ago: honour the throttle, reuse their token if it differs from the rejected one
  if (st && st.rt === z.refresh && Date.now() - st.at < MIN_REFRESH_GAP) {
    if (st.t !== bad && st.exp > Date.now()) { tokenCache = st; return st.t; }
    throw new Error("Zoho token refresh throttled (last refresh " + Math.round((Date.now() - st.at) / 1000) + "s ago) — will retry");
  }
  const res = await fetch(`https://accounts.zoho.${dc}/oauth/v2/token`, {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: process.env.ZOHO_CLIENT_ID || "",
      client_secret: process.env.ZOHO_CLIENT_SECRET || "",
      refresh_token: z.refresh,
    }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error("Zoho token error: " + JSON.stringify(j));
  const next: StoredToken = { t: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000, rt: z.refresh, at: Date.now() };
  tokenCache = next;
  await saveKey("ztoken", next);
  return next.t;
}

export class Zoho {
  constructor(private dc: string, private z: ZohoState) {}

  private async call(method: string, path: string, body?: unknown, badToken?: string): Promise<any> {
    const token = await getAccessToken(this.dc, this.z, badToken);
    const res = await fetch(base(this.dc) + path, {
      method,
      headers: {
        Authorization: "Zoho-oauthtoken " + token,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const txt = await res.text();
    // stale/invalid access token: drop the cache and retry once with a fresh one
    if (res.status === 401 && !badToken) { tokenCache = null; return this.call(method, path, body, token); }
    if (!res.ok) throw new Error(`Zoho ${res.status} ${path}: ${txt.slice(0, 300)}`);
    return JSON.parse(txt);
  }

  /**
   * Save only the cached ids, merged into whatever is stored RIGHT NOW. A tick that started before a
   * reconnect must never write its stale refresh token back over the freshly connected one.
   */
  private async persist(patch: Partial<ZohoState>) {
    const cur = getZoho(await loadConfig());
    await saveKey("zoho", { ...cur, ...patch });
  }

  /** All mailbox accounts this Zoho login can access, with every email address attached to them. */
  async accounts(): Promise<{ id: string; emails: string[] }[]> {
    const r = await this.call("GET", "/accounts");
    return (Array.isArray(r.data) ? r.data : []).map((a: any) => {
      const emails = new Set<string>();
      const add = (v: any) => { if (typeof v === "string" && v.includes("@")) emails.add(v.toLowerCase()); };
      add(a.primaryEmailAddress); add(a.mailboxAddress); add(a.incomingUserName);
      (a.emailAddress || []).forEach((e: any) => add(typeof e === "string" ? e : e?.mailId));
      (a.sendMailDetails || []).forEach((e: any) => add(e?.fromAddress));
      return { id: String(a.accountId), emails: Array.from(emails) };
    });
  }

  async accountId() {
    if (this.z.accountId) return this.z.accountId;
    const r = await this.call("GET", "/accounts");
    this.z.accountId = String(r.data[0].accountId);
    await this.persist({ accountId: this.z.accountId });
    return this.z.accountId;
  }
  async inboxId() {
    if (this.z.inboxId) return this.z.inboxId;
    const r = await this.call("GET", `/accounts/${await this.accountId()}/folders`);
    const f = r.data.find((x: any) => String(x.folderType).toLowerCase() === "inbox");
    this.z.inboxId = String(f.folderId);
    await this.persist({ inboxId: this.z.inboxId });
    return this.z.inboxId;
  }

  /** Fetch the default signature from Zoho and cache it for 1 hour */
  private async defaultSig(): Promise<string> {
    if (sigCache && Date.now() - sigCache.at < 3600_000) return sigCache.html;
    try {
      const r = await this.call("GET", `/accounts/${await this.accountId()}/signatures`);
      const sigs: any[] = r.data || [];
      // prefer the one marked default, else fall back to first
      const sig = sigs.find((s) => s.isDefault) || sigs[0];
      const html = sig?.content || sig?.signature || "";
      sigCache = { html, at: Date.now() };
      return html;
    } catch {
      return ""; // signature fetch failed — send without it
    }
  }

  private bodyHtml(t: string) {
    return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
  }
  private from(addr: string, name: string) { return name ? `"${name}" <${addr}>` : addr; }

  /** Build full HTML body: message + divider + signature */
  private async fullBody(text: string, sigOverride?: string): Promise<string> {
    // Use the saved signature from Settings if available, otherwise try Zoho API
    const sig = sigOverride !== undefined ? sigOverride : await this.defaultSig();
    const msgHtml = this.bodyHtml(text);
    if (!sig) return msgHtml;
    return `<div style="font-family:Arial,sans-serif;font-size:14px;">${msgHtml}</div>`
      + `<br><div>${sig}</div>`;
  }

  async send(to: string, subject: string, body: string, from: string, name: string, sigHtml?: string): Promise<string> {
    const r = await this.call("POST", `/accounts/${await this.accountId()}/messages`, {
      fromAddress: this.from(from, name),
      toAddress: to,
      subject,
      content: await this.fullBody(body, sigHtml),
      mailFormat: "html",
      askReceipt: "no",
    });
    return String(r.data.messageId);
  }

  /** Threaded reply to an earlier message; falls back to a fresh mail. */
  async reply(msgId: string, to: string, subject: string, body: string, from: string, name: string, sigHtml?: string) {
    try {
      const r = await this.call("POST", `/accounts/${await this.accountId()}/messages/${msgId}`, {
        action: "reply",
        fromAddress: this.from(from, name),
        toAddress: to,
        subject,
        content: await this.fullBody(body, sigHtml),
        mailFormat: "html",
      });
      return { id: String(r.data?.messageId || msgId), threaded: true };
    } catch {
      return { id: await this.send(to, subject, body, from, name, sigHtml), threaded: false };
    }
  }

  async inbox(sinceMs: number) {
    const aid = await this.accountId(), fid = await this.inboxId();
    let all: any[] = [];
    for (let page = 0; page < 6; page++) {
      const r = await this.call("GET", `/accounts/${aid}/messages/view?folderId=${fid}&start=${page * 200 + 1}&limit=200&sortBy=date&sortorder=false`);
      const batch: any[] = r.data || [];
      all = all.concat(batch);
      if (batch.length < 200 || Number(batch[batch.length - 1].receivedTime) < sinceMs) break;
    }
    return all.filter((m) => Number(m.receivedTime) >= sinceMs);
  }
  async header(mid: string) {
    try { return JSON.stringify(await this.call("GET", `/accounts/${await this.accountId()}/folders/${await this.inboxId()}/messages/${mid}/header`)); } catch { return ""; }
  }
  async content(mid: string) {
    try { return String((await this.call("GET", `/accounts/${await this.accountId()}/folders/${await this.inboxId()}/messages/${mid}/content`)).data?.content || ""); } catch { return ""; }
  }
}

export async function connectedZoho(cfg: Record<string, string>, dc: string) {
  return new Zoho(dc, getZoho(cfg));
}
export { loadConfig };
