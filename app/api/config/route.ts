import { NextResponse } from "next/server";
import { PIPELINES, saveKey, loadConfig, getGlobal, getPipeline } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function PUT(req: Request) {
  const b = await req.json();
  if (b.global) {
    const cur = getGlobal(await loadConfig());
    await saveKey("global", { ...cur, ...b.global });
  } else if (b.id && PIPELINES.find((p) => p.id === b.id)) {
    const cur = getPipeline(await loadConfig(), b.id);
    const next = { ...cur, ...b.cfg };
    // keep templates aligned with the number of follow-ups (initial + one per delay)
    const need = next.delays.length + 1;
    next.templates = next.templates.slice(0, need);
    while (next.templates.length < need) next.templates.push({ subject: "Re: ", body: "" });
    await saveKey("pipeline:" + b.id, next);
  } else return NextResponse.json({ error: "bad request" }, { status: 400 });
  return NextResponse.json({ ok: true });
}
