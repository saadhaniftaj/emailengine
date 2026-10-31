import { NextResponse } from "next/server";
import { tick } from "@/lib/engine";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST() {
  try { return NextResponse.json({ ok: true, result: await tick() }); }
  catch (e: any) { return NextResponse.json({ ok: false, error: e.message }, { status: 500 }); }
}
