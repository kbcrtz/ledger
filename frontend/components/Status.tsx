import { STATUS_HELP, STATUS_LABEL } from "@/lib/labels";
import { CheckCircle, DotCircle, EmptyCircle, NotEqual, Shield, XCircle } from "./Icons";

// GitHub-style state label: a pill with an icon, colored by meaning.
// Pill glyphs are plain strokes so they read in white on the colored pill.
const GLYPH: Record<string, string> = {
  check: "M3.5 8.5 6.5 11.5 12.5 4.5",
  dot: "M8 8m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0",
  x: "M4.5 4.5l7 7m0-7-7 7",
  neq: "M3.5 6.5h9M3.5 9.5h9M10 3.5 6 12.5",
  ring: "M8 8m-5 0a5 5 0 1 0 10 0a5 5 0 1 0 -10 0",
};
const STYLE: Record<string, { pill: string; glyph: string }> = {
  verified: { pill: "bg-verified-fill text-white", glyph: "check" },
  traced: { pill: "bg-accent-fill text-white", glyph: "check" },
  flagged: { pill: "bg-flagged-fill text-white", glyph: "dot" },
  rejected: { pill: "bg-rejected-fill text-white", glyph: "x" },
  approved: { pill: "bg-approved-fill text-white", glyph: "check" },
  diverged: { pill: "bg-accent-fill text-white", glyph: "neq" },
  stale: { pill: "bg-stale-fill text-white", glyph: "ring" },
  extracted: { pill: "bg-stale-fill text-white", glyph: "ring" },
};

export function StatusMark({ status, large = false }: { status: string; large?: boolean }) {
  const s = STYLE[status] ?? STYLE.extracted;
  return (
    <span title={STATUS_HELP[status]}
      className={`inline-flex items-center gap-1.5 rounded-full whitespace-nowrap font-medium ${s.pill} ${large ? "h-8 px-3 text-[14px]" : "h-[22px] px-2 text-[12px]"}`}>
      <svg viewBox="0 0 16 16" width={large ? 16 : 13} height={large ? 16 : 13} aria-hidden fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d={GLYPH[s.glyph]} />
      </svg>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

// Inline icon for a single check or row state.
export function StateIcon({ state, title }: { state: "pass" | "fail" | "pending" | "changed" | "approved"; title?: string }) {
  if (state === "pass") return <CheckCircle className="text-verified" title={title ?? "Passed"} />;
  if (state === "fail") return <XCircle className="text-rejected" title={title ?? "Failed"} />;
  if (state === "changed") return <NotEqual className="text-diverged" title={title ?? "Changed on purpose"} />;
  if (state === "approved") return <Shield className="text-approved" title={title ?? "Signed off"} />;
  return <DotCircle className="text-flagged" title={title ?? "Waiting"} />;
}

export function Tick({ ok, title }: { ok: boolean | null; title?: string }) {
  if (ok === null) return <EmptyCircle className="text-stale" title={title ?? "Not checked"} />;
  return <StateIcon state={ok ? "pass" : "fail"} title={title} />;
}

export const statusOrder = ["verified", "traced", "flagged", "approved", "rejected", "diverged", "stale", "extracted"];
