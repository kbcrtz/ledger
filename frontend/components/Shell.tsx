"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import LogPanel from "./LogPanel";

export default function Shell({ children }: { children: React.ReactNode }) {
  const [logOpen, setLogOpen] = useState(false);
  const path = usePathname();
  const nav = [
    { href: "/", label: "Rules" },
    { href: "/coverage", label: "Coverage" },
  ];
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-rule bg-sheet">
        <div className="mx-auto max-w-[1500px] px-5 h-12 flex items-center gap-8">
          <Link href="/" className="font-serif text-[19px] font-semibold tracking-tight">Ledger</Link>
          <nav className="flex gap-5 text-[14px]">
            {nav.map((n) => {
              const active = n.href === "/" ? path === "/" || path.startsWith("/rules") : path.startsWith(n.href);
              return (
                <Link key={n.href} href={n.href}
                  className={active ? "text-ink border-b-2 border-ink pb-[11px] pt-[13px]" : "text-ink-soft hover:text-ink pb-[13px] pt-[13px]"}>
                  {n.label}
                </Link>
              );
            })}
          </nav>
          <span className="ml-auto text-[13px] text-ink-soft hidden md:inline">AWS CardDemo, two batch COBOL programs</span>
          <button onClick={() => setLogOpen((v) => !v)}
            className="text-[13px] px-3 py-1 border border-rule rounded-sm hover:border-ink-soft">
            {logOpen ? "Hide pipeline log" : "Pipeline log"}
          </button>
        </div>
      </header>
      <div className="flex flex-1 min-h-0">
        <main className="flex-1 min-w-0">{children}</main>
        {logOpen && <LogPanel onClose={() => setLogOpen(false)} />}
      </div>
    </div>
  );
}
