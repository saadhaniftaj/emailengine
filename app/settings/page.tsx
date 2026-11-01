"use client";
import { useEffect, useState } from "react";

export default function Settings() {
  const [d, setD] = useState<any>(null);
  const [g, setG] = useState<any>(null);
  const [code, setCode] = useState("");
  const [toast, setToast] = useState("");
  const say = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3000); };

  useEffect(() => {
    fetch("/api/overview").then((r) => r.json()).then((x) => { setD(x); if (x.global) setG(x.global); });
  }, []);

  if (!d) return <main className="container"><p className="hint">Loading…</p></main>;
  if (!g) return <main className="container"><p className="hint">Finish the Vercel environment setup first (see Overview).</p></main>;
  const upd = (p: any) => setG({ ...g, ...p });

  async function save() {
    const r = await fetch("/api/config", { method: "PUT", body: JSON.stringify({ global: g }) });
    say(r.ok ? "Saved" : "Save failed");
  }
  async function connect() {
    const r = await (await fetch("/api/zoho", { method: "POST", body: JSON.stringify({ code }) })).json();
    say(r.ok ? "Zoho connected ✓" : "Failed: " + r.error);
    if (r.ok) { setCode(""); setD({ ...d, zohoConnected: true }); }
  }

  return (
    <main className="container">
      <span className="section-label">Global</span>
      <h1 className="title">Engine <span className="gradient-text">settings</span></h1>
      <p className="sub">Shared by both pipelines.</p>

      <section className="glass stack">
        <h2>Sending</h2>
        <div className="fields">
          <div><label className="f">Sender name (display)</label><input value={g.senderName} onChange={(e) => upd({ senderName: e.target.value })} /></div>
          <div><label className="f">Your Zoho email (from address)</label><input placeholder="sohail@sourcepivot.co" value={g.fromAddress} onChange={(e) => upd({ fromAddress: e.target.value })} /></div>
          <div><label className="f">Zoho data center</label><input placeholder="com / in / eu / com.au" value={g.dc} onChange={(e) => upd({ dc: e.target.value })} /></div>
        </div>

        <div className="fields" style={{ marginTop: "1rem" }}>
          <div><label className="f">Total cap / rolling 24h</label><input type="number" value={g.cap} onChange={(e) => upd({ cap: +e.target.value })} /></div>
          <div><label className="f">Min gap between sends (minutes)</label><input type="number" value={g.minGap} onChange={(e) => upd({ minGap: +e.target.value })} /></div>
          <div><label className="f">Max gap between sends (minutes)</label><input type="number" value={g.maxGap} onChange={(e) => upd({ maxGap: +e.target.value })} /></div>
          <div><label className="f">Long break chance (0–1)</label><input type="number" step="0.05" min="0" max="1" value={g.breakChance} onChange={(e) => upd({ breakChance: +e.target.value })} /></div>
        </div>
        <p className="hint">Gaps are random. A break chance of 0.1 means ~1 in 10 sends adds an extra 10–35 min pause.</p>
        <div><button className="btn" id="save-global" onClick={save}>Save</button></div>
      </section>

      <section className="glass stack" style={{ marginTop: "1.5rem" }}>
        <div className="row between"><h2>Zoho connection</h2>
          <span className={"badge " + (d.zohoConnected ? "on" : "off")}><span className="dot" />{d.zohoConnected ? "Connected" : "Not connected"}</span></div>
        <p className="hint">
          1) In <code className="k">api-console.zoho.{g.dc}</code> open <b>Self Client</b>. 2) Generate a code with scope
          <code className="k">ZohoMail.messages.ALL,ZohoMail.accounts.READ,ZohoMail.folders.READ</code> (10 min). 3) Paste it here. It expires fast, so generate it right before.
          {!d.env.zohoClient && <b style={{ color: "var(--red)" }}> ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET are not set in Vercel yet.</b>}
        </p>
        <div className="row"><input style={{ flex: 1, minWidth: 240 }} placeholder="Grant code" value={code} onChange={(e) => setCode(e.target.value)} />
          <button className="btn" id="connect-zoho" disabled={!code} onClick={connect}>Connect</button></div>
      </section>
      {toast && <div className="toast">{toast}</div>}
    </main>
  );
}
