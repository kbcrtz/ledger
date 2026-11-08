"use client";
import { useEffect, useMemo, useState } from "react";
import { get, LogEvent } from "@/lib/api";

// Styled like a CI run log: dark, monospace, one line per agent step.
const AGENT_COLOR: Record<string, string> = {
  parser: "text-night-soft", extractor: "text-[#82bbf5]", verifier: "text-[#6fdd8b]", modernizer: "text-[#d2a8ff]",
  testgen: "text-[#e3b341]", harness: "text-night-ink", coverage: "text-night-soft", impact: "text-[#ffa198]", pipeline: "text-night-ink",
};
const ISSUE = ["reject", "retry", "mismatch", "sample-mismatch", "gap", "drop", "invalid", "guard"];

export default function LogPanel({ onClose }: { onClose: () => void }) {
  const [events, setEvents] = useState<LogEvent[]>([]);
  const [program, setProgram] = useState<string>("all");
  const [onlyIssues, setOnlyIssues] = useState(false);
  useEffect(() => { get<LogEvent[]>("/api/log").then(setEvents).catch(() => setEvents([])); }, []);
  const shown = useMemo(() => events.filter((e) =>
    e.step !== "tool" &&
    (program === "all" || e.program === program || e.program === null) &&
    (!onlyIssues || ISSUE.includes(e.step))
  ), [events, program, onlyIssues]);
  return (
    <aside className="w-[440px] shrink-0 bg-night text-night-ink h-[calc(100vh-6.5rem)] sticky top-0 flex flex-col border-l border-night-line">
      <div className="px-4 h-12 border-b border-night-line flex items-center gap-3">
        <h2 className="text-[14px] font-semibold">Pipeline log</h2>
        <span className="text-[12px] text-night-soft">what each agent did, in order</span>
        <button onClick={onClose} className="ml-auto text-[13px] text-night-soft hover:text-night-ink">Close</button>
      </div>
      <div className="px-4 py-2 flex gap-1.5 text-[12.5px] border-b border-night-line items-center">
        {["all", "CBTRN02C", "CBACT04C"].map((p) => (
          <button key={p} onClick={() => setProgram(p)}
            className={`px-2 h-6 rounded-md ${program === p ? "bg-night-line text-night-ink" : "text-night-soft hover:text-night-ink"}`}>{p === "all" ? "Both programs" : p}</button>
        ))}
        <label className="ml-auto flex items-center gap-1.5 text-night-soft">
          <input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} />
          Only rejections and gaps
        </label>
      </div>
      <ol className="overflow-y-auto flex-1 font-mono text-[12px] leading-[1.55] py-1">
        {shown.map((e, i) => (
          <li key={i} className={`px-4 py-1 grid grid-cols-[64px_1fr] gap-x-3 ${ISSUE.includes(e.step) ? "bg-[#3a1d1a]/60" : "hover:bg-night-2"}`}>
            <span className="text-night-soft">{e.ts.slice(11, 19)}</span>
            <span>
              <span className={AGENT_COLOR[e.agent] ?? ""}>{e.agent}</span>
              <span className="text-night-soft"> {e.step}{e.program ? ` ${e.program}` : ""}</span>
              <span className="block text-night-ink/90 font-sans text-[12.5px]">{e.message}</span>
            </span>
          </li>
        ))}
        {shown.length === 0 && <li className="px-4 py-6 text-night-soft">No pipeline events yet. Run the pipeline to populate the log.</li>}
      </ol>
    </aside>
  );
}
