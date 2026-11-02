import { NextResponse } from "next/server";
import { PIPELINES, loadConfig, getPipeline, saveKey } from "@/lib/config";
import { getTabs, readTab } from "@/lib/sheets";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const p = PIPELINES.find((x) => x.id === params.id);
    if (!p) return NextResponse.json({ ok: false, error: "pipeline not found" }, { status: 404 });

    const tabs = await getTabs();
    const tab = tabs.find((t) => t.title.trim().toLowerCase() === p.tab.toLowerCase());
    if (!tab) return NextResponse.json({ ok: false, error: "sheet tab not found" }, { status: 404 });

    const rows = await readTab(tab.title);
    // startRow = last data row index (1-based, includes header).
    // Engine will skip rows with index <= startRow that have no status yet.
    const startRow = Math.max(rows.length - 1, 0);

    const cfg = await loadConfig();
    const pc = { ...getPipeline(cfg, p.id), startRow };
    await saveKey("pipeline:" + p.id, pc);

    return NextResponse.json({ ok: true, startRow });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
