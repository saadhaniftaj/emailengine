"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

const SAMPLE: Record<string, string> = { firstname: "Alex", companyname: "Sample Research Ltd" };
function preview(t: string) {
  return t
    .replace(/\{\{\s*([^}]+?)\s*\}\}/g, (m, k) => SAMPLE[String(k).toLowerCase().replace(/[^a-z0-9]/g, "")] || m)
    .replace(/\{([^{}]*\|[^{}]*)\}/g, (_m, o: string) => o.split("|")[0]);
}

export default function PipelinePage() {
  const { id } = useParams<{ id: string }>();
  const [p, setP] = useState<any>(null);
  const [cfg, setCfg] = useState<any>(null);
  const [toast, setToast] = useState("");
  const [open, setOpen] = useState<number | null>(0);

  useEffect(() => {
    fetch("/api/overview").then((r) => r.json()).then((d) => {
      const x = d.pipelines?.find((q: any) => q.id === id);
      setP(x || false); if (x) setCfg(x.cfg);
    });
  }, [id]);

  if (p === false) return <main className="container"><p className="hint">Pipeline not found (or setup incomplete). <Link href="/">Back</Link></p></main>;
  if (!cfg) return <main className="container"><p className="hint"><span className="spin">◌</span> Loading…</p></main>;

  const upd = (patch: any) => setCfg({ ...cfg, ...patch });
  const setDelay = (i: number, v: number) => upd({ delays: cfg.delays.map((d: number, j: number) => (j === i ? v : d)) });
  const setTpl = (i: number, patch: any) => upd({ templates: cfg.templates.map((t: any, j: number) => (j === i ? { ...t, ...patch } : t)) });
  const addFollow = () => upd({ delays: [...cfg.delays, 168], templates: [...cfg.templates, { subject: "Re: " + (cfg.templates[0]?.subject || ""), body: "" }] });
  const removeFollow = (i: number) => upd({ delays: cfg.delays.filter((_: any, j: number) => j !== i), templates: cfg.templates.filter((_: any, j: number) => j !== i + 1) });

  async function save() {
    const r = await fetch("/api/config", { method: "PUT", body: JSON.stringify({ id, cfg }) });
    setToast(r.ok ? "Saved" : "Save failed"); setTimeout(() => setToast(""), 2200);
  }

  const human = (h: number) => (h % 24 === 0 ? `${h / 24} day${h / 24 === 1 ? "" : "s"}` : `${h} hours`);

  return (
    <main className="container">
      <span className="section-label">Pipeline</span>
      <div className="row between">
        <h1 className="title">{p.label} <span className="gradient-text">settings</span></h1>
        <div className="row">
          <button className={"btn " + (cfg.paused ? "play" : "pause")} id="pipeline-toggle" onClick={() => upd({ paused: !cfg.paused })}>
            {cfg.paused ? "▶ Play" : "❚❚ Pause"}
          </button>
          <button className="btn" id="save-btn" onClick={save}>Save changes</button>
        </div>
      </div>
      <p className="sub">Timings and templates here apply only to the <b>{p.label}</b> leads. Remember to save. Play/Pause is applied when you save.</p>

      <section className="glass stack">
        <h2>Schedule</h2>
        <div className="fields">
          <div><label className="f">Window start (lead local hour)</label><input type="number" step="0.5" min="0" max="23" value={cfg.startH} onChange={(e) => upd({ startH: +e.target.value })} /></div>
          <div><label className="f">Window end (lead local hour)</label><input type="number" step="0.5" min="1" max="24" value={cfg.endH} onChange={(e) => upd({ endH: +e.target.value })} /></div>
          <div><label className="f">Max emails / 24h</label><input type="number" min="1" value={cfg.cap} onChange={(e) => upd({ cap: +e.target.value })} /></div>
        </div>
        <p className="hint">Emails go out only inside this local-time window (weekdays; Fri/Sat off for Gulf countries), so they sit at the top of the inbox.</p>
        <div className="step">
          <h3>Follow-up timings</h3>
          <p className="hint" style={{ margin: ".3rem 0 1rem" }}>Each delay is counted from the previous email.</p>
          <div className="stack">
            {cfg.delays.map((d: number, i: number) => (
              <div className="row" key={i}>
                <span style={{ width: 110, fontWeight: 700 }}>Follow-up {i + 1}</span>
                <input style={{ width: 110 }} type="number" min="1" value={d} onChange={(e) => setDelay(i, +e.target.value)} />
                <span className="hint">hours after {i === 0 ? "the first email" : `follow-up ${i}`} ({human(d)})</span>
                <button className="btn small ghost" onClick={() => removeFollow(i)}>Remove</button>
              </div>
            ))}
            <button className="btn small ghost" onClick={addFollow}>+ Add follow-up</button>
          </div>
        </div>
      </section>

      <section className="glass stack" style={{ marginTop: "1.5rem", border: "1px solid rgba(255,180,0,.25)", background: "rgba(255,180,0,.04)" }}>
        <div className="row between">
          <div>
            <h2>Skip old leads</h2>
            <p className="hint" style={{ margin: ".3rem 0 0" }}>
              {cfg.startRow > 0
                ? <><b style={{ color: "var(--green)" }}>✓ Active</b> — engine only processes rows added after row {cfg.startRow}. New leads you add below that point are picked up automatically.</>
                : <>Engine is scanning <b>all rows</b> including old ones. Click the button to make it ignore everything already in the sheet and only pick up new leads you add from now on.</>}
            </p>
          </div>
          <button className="btn" id="set-start-row" style={{ whiteSpace: "nowrap" }}
            onClick={async () => {
              const r = await fetch(`/api/pipeline/${id}/startrow`, { method: "POST" });
              const j = await r.json();
              if (j.ok) { upd({ startRow: j.startRow }); setToast(`Start row set to ${j.startRow} ✓`); }
              else setToast("Failed: " + j.error);
            }}>
            {cfg.startRow > 0 ? "↻ Reset to current last row" : "Skip all existing leads →"}
          </button>
        </div>
      </section>

      <div className="stack" style={{ marginTop: "1.5rem" }}>
        {cfg.templates.map((t: any, i: number) => (
          <section className="glass" key={i}>
            <div className="row between" style={{ cursor: "pointer" }} onClick={() => setOpen(open === i ? null : i)}>
              <h2>{i === 0 ? "Initial email" : `Follow-up ${i}`}</h2>
              <span className="badge">{open === i ? "Hide" : "Edit"}</span>
            </div>
            {open === i && (
              <div className="stack" style={{ marginTop: "1rem" }}>
                <div><label className="f">Subject</label><input value={t.subject} onChange={(e) => setTpl(i, { subject: e.target.value })} /></div>
                <div><label className="f">Body</label><textarea value={t.body} onChange={(e) => setTpl(i, { body: e.target.value })} /></div>
                <p className="hint">
                  Placeholders: <code className="k">{"{{FirstName}}"}</code> <code className="k">{"{{CompanyName}}"}</code> or any sheet column like <code className="k">{"{{Title}}"}</code>.
                  Variations: <code className="k">{"{Hi|Hello}"}</code> picks one at random for every email so no two look identical.
                  Follow-ups are sent as replies in the same thread.
                </p>
                <div><label className="f">Preview</label><div className="preview"><b>{preview(t.subject)}</b>{"\n\n"}{preview(t.body)}</div></div>
              </div>
            )}
          </section>
        ))}
      </div>
      {toast && <div className="toast">{toast}</div>}
    </main>
  );
}
