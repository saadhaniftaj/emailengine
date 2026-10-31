import { getZoho, saveKey, loadConfig, ZohoState } from "./config";

let tokenCache: { t: string; exp: number } | null = null;

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

async function accessToken(dc: string, z: ZohoState) {
  if (tokenCache && tokenCache.exp > Date.now()) return tokenCache.t;
  if (!z.refresh) throw new Error("Zoho not connected");
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
  tokenCache = { t: j.access_token, exp: Date.now() + 50 * 60000 };
  return j.access_token as string;
}

export class Zoho {
  constructor(private dc: string, private z: ZohoState) {}

  private async call(method: string, path: string, body?: unknown) {
    const res = await fetch(base(this.dc) + path, {
      method,
      headers: {
        Authorization: "Zoho-oauthtoken " + (await accessToken(this.dc, this.z)),
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const txt = await res.text();
    if (!res.ok) throw new Error(`Zoho ${res.status} ${path}: ${txt.slice(0, 300)}`);
    return JSON.parse(txt);
  }

  async accountId() {
    if (this.z.accountId) return this.z.accountId;
    const r = await this.call("GET", "/accounts");
    this.z.accountId = String(r.data[0].accountId);
    await saveKey("zoho", this.z);
    return this.z.accountId;
  }
  async inboxId() {
    if (this.z.inboxId) return this.z.inboxId;
    const r = await this.call("GET", `/accounts/${await this.accountId()}/folders`);
    const f = r.data.find((x: any) => String(x.folderType).toLowerCase() === "inbox");
    this.z.inboxId = String(f.folderId);
    await saveKey("zoho", this.z);
    return this.z.inboxId;
  }

  private html(t: string) {
    return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
  }
  private from(addr: string, name: string) { return name ? `"${name}" <${addr}>` : addr; }

  async send(to: string, subject: string, body: string, from: string, name: string): Promise<string> {
    const r = await this.call("POST", `/accounts/${await this.accountId()}/messages`, {
      fromAddress: this.from(from, name), toAddress: to, subject, content: this.html(body), mailFormat: "html", askReceipt: "no",
    });
    return String(r.data.messageId);
  }

  /** Threaded reply to an earlier message; falls back to a fresh mail. */
  async reply(msgId: string, to: string, subject: string, body: string, from: string, name: string) {
    try {
      const r = await this.call("POST", `/accounts/${await this.accountId()}/messages/${msgId}`, {
        action: "reply", fromAddress: this.from(from, name), toAddress: to, subject, content: this.html(body), mailFormat: "html",
      });
      return { id: String(r.data?.messageId || msgId), threaded: true };
    } catch {
      return { id: await this.send(to, subject, body, from, name), threaded: false };
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
