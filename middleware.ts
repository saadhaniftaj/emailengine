import { NextRequest, NextResponse } from "next/server";
import { sha, COOKIE } from "./lib/auth";

export async function middleware(req: NextRequest) {
  const p = req.nextUrl.pathname;
  if (p.startsWith("/api/cron") || p.startsWith("/api/login") || p === "/login" || p.startsWith("/_next") || p.endsWith(".png")) {
    return NextResponse.next();
  }
  const pw = process.env.DASHBOARD_PASSWORD || "";
  const ok = pw && req.cookies.get(COOKIE)?.value === (await sha(pw));
  if (ok) return NextResponse.next();
  if (p.startsWith("/api/")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.redirect(new URL("/login", req.url));
}
export const config = { matcher: ["/((?!favicon.ico).*)"] };
