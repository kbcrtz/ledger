import { STATUS_HELP, STATUS_LABEL } from "@/lib/labels";

const COLORS: Record<string, string> = {
  verified: "text-verified border-verified",
  traced: "text-traced border-traced",
  flagged: "text-flagged border-flagged",
  rejected: "text-rejected border-rejected",
  approved: "text-approved border-approved",
  diverged: "text-diverged border-diverged",
  stale: "text-stale border-stale",
  extracted: "text-extracted border-extracted",
};
const MARK: Record<string, string> = {
  verified: "✓✓", traced: "✓", flagged: "!", rejected: "✕", approved: "✓✓", diverged: "≠", stale: "~", extracted: "·",
};

export function StatusMark({ status, large = false }: { status: string; large?: boolean }) {
  return (
    <span title={STATUS_HELP[status]} className={`inline-flex items-center gap-1.5 border rounded-sm whitespace-nowrap ${COLORS[status] ?? "text-ink-soft border-rule"} ${large ? "px-2.5 py-1 text-[14px]" : "px-1.5 py-[1px] text-[12.5px]"}`}>
      <span aria-hidden className="font-semibold">{MARK[status] ?? "?"}</span>
      <span>{STATUS_LABEL[status] ?? status}</span>
    </span>
  );
}

export function Tick({ ok, title }: { ok: boolean | null; title?: string }) {
  if (ok === null) return <span className="text-ink-soft" title={title}>·</span>;
  return ok
    ? <span className="text-verified font-semibold" title={title} aria-label="verified">✓</span>
    : <span className="text-rejected font-semibold" title={title} aria-label="failed">✕</span>;
}

export const statusOrder = ["verified", "traced", "flagged", "approved", "rejected", "diverged", "stale", "extracted"];
