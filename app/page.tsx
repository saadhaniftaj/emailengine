"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

export default function Overview() {
  const [d, setD] = useState<any>(null);
  const [modal, setModal] = useState<any>(null);
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch("/api/overview", { cache: "no-store" });
    setD(await r.json());
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);

  const say = (m: string) => { setToast(m); setTimeout(() => setToast(""), 2800); };
  async function save(body: any) {
    await fetch("/api/config", { method: "PUT", body: JSON.stringify(body) });
    await load();
  }
  async function runNow() {
    setBusy(true);
    const r = await (await fetch("/api/run", { method: "POST" })).json();
    setBusy(false);
    say(r.ok ? "Engine: " + r.result : "Error: " + r.error);
    load();
  }

  if (!d) return <main className="container"><p className="hint"><span className="spin">◌</span> Loading…</p></main>;
  if (!d.ready) return (
    <main className="container">
      <span className="section-label">Setup needed</span>
      <h1 className="title">Almost <span className="gradient-text">there</span></h1>
      <div className="glass stack">
        <p className="hint">Add these environment variables in Vercel, then redeploy:</p>
        <ul className="hint" style={{ paddingLeft: "1.2rem", lineHeight: 2 }}>
          <li>{d.env.sheet ? "✅" : "❌"} <code className="k">SHEET_ID</code></li>
          <li>{d.env.google ? "✅" : "❌"} <code className="k">GOOGLE_SERVICE_ACCOUNT_JSON</code> (and share the sheet with its email as Editor)</li>
          <li>{d.env.zohoClient ? "✅" : "❌"} <code className="k">ZOHO_CLIENT_ID</code> / <code className="k">ZOHO_CLIENT_SECRET</code></li>
          <li>{d.env.cron ? "✅" : "❌"} <code className="k">CRON_SECRET</code></li>
        </ul>
        {d.error && <p className="hint" style={{ color: "var(--red)" }}>Sheets error: {d.error}</p>}
      </div>
    </main>
  );

  const g = d.global;
  return (
    <main className="container">
      <span className="section-label">Control center</span>
      <div className="row between">
        <div>
          <p style={{ color: "var(--text-muted)", fontWeight: 600, marginBottom: ".2rem" }}>👋 Hi, Sohail</p>
          <h1 className="title">Outreach <span className="gradient-text">Engine</span></h1>
        </div>
        <div className="row">
          <button className="btn ghost small" id="run-now" disabled={busy} onClick={runNow} title="Manually trigger one send right now — same as what happens automatically every 5 min">
            {busy ? "Sending…" : "⚡ Send one now"}
          </button>
          <button id="master-toggle" className={"btn " + (g.paused ? "play" : "pause")} onClick={() => save({ global: { paused: !g.paused } })}>
            {g.paused ? "▶ Start engine" : "❚❚ Pause engine"}
          </button>
        </div>
      </div>
      <p className="sub">
        <span className={"badge " + (g.paused ? "off" : "on")}><span className="dot" />{g.paused ? "Engine paused" : "Engine running"}</span>{" "}
        <span className="badge">{d.sent24h}/{g.cap} sent in the last 24h</span>{" "}
        <span className={"badge " + (d.zohoConnected ? "on" : "off")}>{d.zohoConnected ? "Zoho connected" : <Link href="/settings">Connect Zoho →</Link>}</span>
      </p>

      <div className="grid2">
        {d.pipelines.map((p: any) => (
          <section key={p.id} className="glass lift">
            <div className="row between">
              <h2>{p.label}</h2>
              <span className={"badge " + (p.cfg.paused ? "off" : "on")}><span className="dot" />{p.cfg.paused ? "Paused" : "Running"}</span>
            </div>
            {!p.found ? <p className="hint" style={{ marginTop: "1rem" }}>Tab “{p.label}” not found in the sheet.</p> : (
              <>
                <div className="stats">
                  <button className={"stat " + (p.counts.replied ? "green" : "")} id={`replies-${p.id}`} onClick={() => setModal(p)}>
                    <b>{p.counts.replied}</b><span>Replies ↗</span>
                  </button>
                  <div className="stat"><b>{p.counts.awaiting}</b><span>Awaiting</span></div>
                  <div className="stat"><b>{p.counts.notSent}</b><span>Not sent</span></div>
                  <div className="stat"><b>{p.sent24h}</b><span>Sent 24h</span></div>
                  <div className="stat"><b>{p.counts.noResponse}</b><span>No response</span></div>
                  <div className="stat"><b>{p.counts.bounced}</b><span>Bounced</span></div>
                </div>
                <div className="row">
                  <button className={"btn small " + (p.cfg.paused ? "play" : "pause")} id={`toggle-${p.id}`} onClick={() => save({ id: p.id, cfg: { paused: !p.cfg.paused } })}>
                    {p.cfg.paused ? "▶ Play" : "❚❚ Pause"}
                  </button>
                  <Link className="btn small ghost" href={`/p/${p.id}`}>Timings & templates</Link>
                  <a className="btn small ghost" href={p.url} target="_blank" rel="noreferrer">Open sheet ↗</a>
                </div>
              </>
            )}
          </section>
        ))}
      </div>

      {modal && (
        <div className="modal-bg" onClick={() => setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="row between">
              <h2>{modal.label} replies ({modal.replies.length})</h2>
              <a className="btn small" href={modal.url} target="_blank" rel="noreferrer">Open sheet ↗</a>
            </div>
            {modal.replies.length === 0 && <p className="hint" style={{ marginTop: "1rem" }}>No replies yet.</p>}
            {modal.replies.map((r: any) => (
              <div className="reply" key={r.email}>
                <div>
                  <b>{r.name}</b> · {r.company}
                  <small>{r.email}{r.snippet ? " — " + r.snippet : ""}</small>
                </div>
                <a className="btn small ghost" href={r.url} target="_blank" rel="noreferrer">Go to row ↗</a>
              </div>
            ))}
          </div>
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
    </main>
  );
}
