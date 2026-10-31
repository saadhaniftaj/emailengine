import { NextResponse } from "next/server";
import { sha, COOKIE } from "@/lib/auth";

export async function POST(req: Request) {
  const { password } = await req.json();
  const pw = process.env.DASHBOARD_PASSWORD || "";
  if (!pw || password !== pw) return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, await sha(pw), { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
  return res;
}
