"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import LogPanel from "./LogPanel";

export default function Shell({ children }: { children: React.ReactNode }) {
  const [logOpen, setLogOpen] = useState(false);
  const path = usePathname();

  const tabs = [
    { href: "/", label: "Rules", active: path === "/" || path.startsWith("/rules") },
    { href: "/coverage", label: "Coverage", active: path.startsWith("/coverage") },
  ];

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-night text-night-ink">
        <div className="mx-auto max-w-[1600px] px-6 h-14 flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2.5" aria-label="Legibol home">
            <Mark />
            <span className="text-[16px] font-semibold tracking-[-0.01em]">Legibol</span>
          </Link>
          <button onClick={() => setLogOpen((v) => !v)}
            className="ml-auto btn !h-8 !text-[13.5px]">
            {logOpen ? "Hide pipeline log" : "Pipeline log"}
          </button>
        </div>
      </header>
      <nav className="border-b border-night-line bg-night" aria-label="Sections">
        <div className="mx-auto max-w-[1600px] px-6 flex gap-1 text-[14px]">
          {tabs.map((t) => (
            <Link key={t.href} href={t.href} aria-current={t.active ? "page" : undefined}
              className={`relative flex items-center gap-2 px-3 h-12 ${t.active ? "font-semibold text-ink" : "text-ink-soft hover:text-ink"}`}>
              {t.label}
              {t.active && <span aria-hidden className="absolute left-2 right-2 -bottom-px h-[2px] rounded-full bg-accent-bright" />}
            </Link>
          ))}
        </div>
      </nav>
      <div className="flex flex-1 min-h-0">
        <main className="flex-1 min-w-0">{children}</main>
        {logOpen && <LogPanel onClose={() => setLogOpen(false)} />}
      </div>
    </div>
  );
}

// Legibol mark: three ruled lines with a tick, a ledger page that has been checked.
function Mark() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden>
      <rect x="1" y="1" width="22" height="22" rx="5" fill="#f5f4f4" />
      <path d="M6 8h8M6 12h6M6 16h4" stroke="#151211" strokeWidth="2" strokeLinecap="round" />
      <path d="m13.5 15.5 2 2 3.5-4.5" fill="none" stroke="#1a7f37" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
