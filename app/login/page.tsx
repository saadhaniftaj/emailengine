"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Login() {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const r = useRouter();
  async function go(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/login", { method: "POST", body: JSON.stringify({ password: pw }) });
    if (res.ok) { r.push("/"); r.refresh(); } else setErr("Wrong password");
  }
  return (
    <main className="container" style={{ display: "grid", placeItems: "center", minHeight: "100vh" }}>
      <form className="glass stack" style={{ width: 380 }} onSubmit={go}>
        <span className="section-label">Private</span>
        <h1 className="title">Email<span className="gradient-text">Engine</span></h1>
        <div>
          <label className="f" htmlFor="pw">Password</label>
          <input id="pw" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
        </div>
        {err && <p className="hint" style={{ color: "var(--red)" }}>{err}</p>}
        <button className="btn" id="login-btn" type="submit">Enter</button>
      </form>
    </main>
  );
}
