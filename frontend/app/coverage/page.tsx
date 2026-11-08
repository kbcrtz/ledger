"use client";
import { useEffect, useState } from "react";
import { get } from "@/lib/api";
import SourceView from "@/components/SourceView";

type Cov = Record<string, {
  statement_lines: number; executed_any: number; executed_by_sample: number; cited_by_rules: number; neither: number;
  uncovered_lines: { line: number; paragraph: string; text: string }[];
  lines: Record<string, { executed: number; cited_by: string[] }>;
}>;

export default function Coverage() {
  const [cov, setCov] = useState<Cov | null>(null);
  const [program, setProgram] = useState("CBTRN02C");
  const [line, setLine] = useState<number | null>(null);
  useEffect(() => { get<Cov>("/api/coverage").then(setCov).catch(() => setCov({})); }, []);
  if (!cov) return <div className="p-10 text-ink-soft">Loading coverage</div>;
  const c = cov[program];
  if (!c) return <div className="p-10 text-ink-soft">No coverage yet. Run <code>python -m ledger.pipeline coverage</code>.</div>;
  const executed = Object.entries(c.lines).filter(([, v]) => v.executed > 0).map(([k]) => Number(k));
  const byPara: Record<string, number[]> = {};
  c.uncovered_lines.forEach((u) => { (byPara[u.paragraph] ??= []).push(u.line); });
  return (
    <div className="mx-auto max-w-[1500px] px-5 py-6">
      <h1 className="font-serif text-[28px] font-semibold">Coverage</h1>
      <p className="text-[14.5px] text-ink-soft max-w-[85ch] mt-1">
        COBOL statements that no rule cites and no test executes. Executed lines come from a second build compiled
        with <code>-ftraceall</code>, run on every generated case and on CardDemo&apos;s sample data.
      </p>
      <div className="mt-4 flex gap-2 text-[14px]">
        {Object.keys(cov).map((p) => (
          <button key={p} onClick={() => { setProgram(p); setLine(null); }} className={`px-3 py-1 border rounded-sm ${p === program ? "border-ink" : "border-rule text-ink-soft"}`}>{p}</button>
        ))}
      </div>
      <table className="mt-4 text-[14px]">
        <tbody className="double-rule">
          <tr>
            {[["Statements", c.statement_lines], ["Executed by some case", c.executed_any], ["By sample data alone", c.executed_by_sample],
              ["Cited by a rule", c.cited_by_rules], ["Neither", c.neither]].map(([k, v]) => (
              <td key={k as string} className="pr-10 pb-1"><div className="text-ink-soft">{k}</div><div className="font-serif text-[24px]">{v}</div></td>
            ))}
          </tr>
        </tbody>
      </table>
      <div className="mt-6 grid lg:grid-cols-[minmax(0,38fr)_minmax(0,62fr)] gap-6">
        <section>
          <h2 className="font-serif text-[18px] font-semibold border-b border-ink pb-1">Neither cited nor executed, by paragraph</h2>
          <ul className="text-[13.5px]">
            {Object.entries(byPara).map(([p, ls]) => (
              <li key={p} className="py-1.5 border-b border-rule">
                <div className="font-medium">{p}</div>
                <div className="flex flex-wrap gap-x-2 text-traced">
                  {ls.map((l) => <button key={l} onClick={() => setLine(l)} className="hover:underline">{l}</button>)}
                </div>
              </li>
            ))}
          </ul>
        </section>
        <section className="h-[72vh] border border-rule bg-sheet">
          <SourceView file={`${program}.cbl`} spans={c.uncovered_lines.map((u) => ({ file: `${program}.cbl`, lines: [u.line, u.line] }))}
            active={line ? { file: `${program}.cbl`, lines: [line, line] } : null} executed={executed} />
        </section>
      </div>
      <p className="mt-3 text-[13px] text-ink-soft">Yellow: neither cited nor executed. Green gutter marks: executed by at least one case.</p>
    </div>
  );
}
