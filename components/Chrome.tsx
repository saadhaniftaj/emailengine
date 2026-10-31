"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export default function Chrome({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [ps, setPs] = useState<any[]>([]);
  useEffect(() => {
    setPs(Array.from({ length: 14 }, () => ({
      left: Math.random() * 100, size: 14 + Math.random() * 34, dur: 14 + Math.random() * 18, delay: -Math.random() * 20,
    })));
  }, []);
  const link = (href: string, label: string) => (
    <Link href={href} className={path === href || (href !== "/" && path.startsWith(href)) ? "active" : ""}>{label}</Link>
  );
  return (
    <>
      <img src="/logo.png" alt="" className="bg-logo" />
      <div className="bg-particles">
        {ps.map((p, i) => (
          <span key={i} className="particle" style={{ left: p.left + "%", width: p.size, height: p.size, animationDuration: p.dur + "s", animationDelay: p.delay + "s" }} />
        ))}
      </div>
      {path !== "/login" && (
        <nav className="navbar">
          <div className="nav-content">
            <Link href="/" className="logo"><span className="logo-mark">✉</span><span>Email<span className="gradient-text">Engine</span></span></Link>
            <div className="nav-links">
              {link("/", "Overview")}
              {link("/p/market-research", "Market Research")}
              {link("/p/consultancy", "Consultancy")}
              {link("/settings", "Settings")}
            </div>
          </div>
        </nav>
      )}
      {children}
    </>
  );
}
