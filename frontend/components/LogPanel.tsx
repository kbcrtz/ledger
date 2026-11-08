"use client";
import { useEffect, useMemo, useState } from "react";
import { get, LogEvent } from "@/lib/api";

const AGENT_COLOR: Record<string, string> = {
  parser: "text-ink-soft", extractor: "text-traced", verifier: "text-verified", modernizer: "text-diverged",
  testgen: "text-stale", harness: "text-ink", coverage: "text-ink-soft", impact: "text-flagged", pipeline: "text-ink",
};

export default function LogPanel({ onClose }: { onClose: () => void }) {
  const [events, setEvents] = useState<LogEvent[]>([]);
  const [program, setProgram] = useState<string>("all");
  const [onlyIssues, setOnlyIssues] = useState(false);
  useEffect(() => { get<LogEvent[]>("/api/log").then(setEvents).catch(() => setEvents([])); }, []);
  const shown = useMemo(() => events.filter((e) =>
    e.step !== "tool" &&
    (program === "all" || e.program === program || e.program === null) &&
    (!onlyIssues || ["reject", "retry", "mismatch", "sample-mismatch", "gap", "drop", "invalid", "guard"].includes(e.step))
  ), [events, program, onlyIssues]);
  return (
    <aside className="w-[420px] shrink-0 border-l border-rule bg-sheet h-[calc(100vh-3rem)] sticky top-0 flex flex-col">
      <div className="px-4 py-3 border-b border-rule flex items-center gap-3">
        <h2 className="font-serif text-[16px] font-semibold">Pipeline log</h2>
        <span className="text-[12.5px] text-ink-soft">supervision only</span>
        <button onClick={onClose} className="ml-auto text-[13px] text-ink-soft hover:text-ink">Close</button>
      </div>
      <div className="px-4 py-2 flex gap-2 text-[12.5px] border-b border-rule items-center">
        {["all", "CBTRN02C", "CBACT04C"].map((p) => (
          <button key={p} onClick={() => setProgram(p)}
            className={`px-2 py-0.5 rounded-sm border ${program === p ? "border-ink" : "border-rule text-ink-soft"}`}>{p === "all" ? "Both" : p}</button>
        ))}
        <label className="ml-auto flex items-center gap-1.5 text-ink-soft">
          <input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} />
          Rejections and gaps
        </label>
      </div>
      <ol className="overflow-y-auto flex-1 text-[12.5px] leading-snug">
        {shown.map((e, i) => (
          <li key={i} className={`px-4 py-1.5 border-b border-rule/60 ${["reject", "mismatch", "sample-mismatch"].includes(e.step) ? "bg-[#fbf1ec]" : e.step === "retry" ? "bg-[#fbf6e6]" : ""}`}>
            <div className="flex gap-2 text-[11.5px] text-ink-soft">
              <span className={AGENT_COLOR[e.agent] ?? ""}>{e.agent}</span>
              <span>{e.step}</span>
              {e.program && <span>{e.program}</span>}
              <span className="ml-auto">{e.ts.slice(11)}</span>
            </div>
            <div className="text-ink">{e.message}</div>
          </li>
        ))}
        {shown.length === 0 && <li className="px-4 py-6 text-ink-soft">No pipeline events yet. Run the pipeline to populate the log.</li>}
      </ol>
    </aside>
  );
}
