"use client";
import { useEffect, useState } from "react";
import { get } from "@/lib/api";
import SourceView from "@/components/SourceView";
import { FileCode } from "@/components/Icons";
import { PROGRAM_NAME } from "@/lib/labels";

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
  if (!cov) return <div className="mx-auto max-w-[1600px] px-6 py-10 text-ink-soft">Loading coverage…</div>;
  const c = cov[program];
  if (!c) return <div className="mx-auto max-w-[1600px] px-6 py-10 text-ink-soft">No coverage yet. Run <code className="font-mono">python -m ledger.pipeline coverage</code>.</div>;
  const executed = Object.entries(c.lines).filter(([, v]) => v.executed > 0).map(([k]) => Number(k));
  const byPara: Record<string, number[]> = {};
  c.uncovered_lines.forEach((u) => { (byPara[u.paragraph] ??= []).push(u.line); });
  const citedOnly = Math.max(0, c.statement_lines - c.executed_any - c.neither);
  const parts = [
    { label: "Run by a test", n: c.executed_any, color: "bg-verified" },
    { label: "Cited by a rule, not run", n: citedOnly, color: "bg-accent-bright" },
    { label: "Not cited or run", n: c.neither, color: "bg-[#42403e]" },
  ];

  return (
    <div className="mx-auto max-w-[1600px] px-6 pt-8 pb-16">
      <h1 className="text-[28px] font-semibold tracking-[-0.015em]">Coverage</h1>
      <p className="text-[14.5px] text-ink-soft max-w-[80ch] mt-1">
        What might the rules have missed? These are COBOL statements that no rule cites and no test runs. Line tracking comes from
        a second build of the COBOL that logs every line it executes, run on every test and on CardDemo&apos;s own data.
      </p>

      <div className="mt-5 flex gap-1 border-b border-rule text-[14px]">
        {Object.keys(cov).map((p) => (
          <button key={p} onClick={() => { setProgram(p); setLine(null); }} aria-current={p === program ? "page" : undefined}
            className={`relative flex items-center gap-2 px-3 h-11 ${p === program ? "font-semibold text-ink" : "text-ink-soft hover:text-ink"}`}>
            {PROGRAM_NAME[p] ?? p} <span className="font-mono text-[12px] text-ink-soft font-normal">{p}.cbl</span>
            {p === program && <span aria-hidden className="absolute left-2 right-2 -bottom-px h-[2px] rounded-full bg-accent-bright" />}
          </button>
        ))}
      </div>

      <section className="mt-6 box px-5 py-4" aria-label="Summary">
        <div className="flex flex-wrap gap-x-10 gap-y-3">
          {[["Statements", c.statement_lines], ["Run by some test", c.executed_any], ["Run by CardDemo's data alone", c.executed_by_sample], ["Cited by a rule", c.cited_by_rules], ["Not cited or run", c.neither]].map(([k, v]) => (
            <div key={k as string}><div className="text-[12.5px] text-ink-soft">{k}</div><div className="text-[24px] font-semibold tracking-tight">{v}</div></div>
          ))}
        </div>
        <div className="mt-4 flex h-2 rounded-full overflow-hidden" role="img" aria-label={parts.map((p) => `${p.label}: ${p.n}`).join(", ")}>
          {parts.map((p) => <span key={p.label} className={p.color} style={{ width: `${(p.n / c.statement_lines) * 100}%` }} />)}
        </div>
        <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px]">
          {parts.map((p) => <li key={p.label} className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${p.color}`} aria-hidden />{p.label} <span className="text-ink-soft">{p.n}</span></li>)}
        </ul>
      </section>

      <div className="mt-6 grid lg:grid-cols-[minmax(0,34fr)_minmax(0,66fr)] gap-6 items-start">
        <section className="box" aria-label="Untouched lines by paragraph">
          <div className="box-header">
            <h2 className="font-semibold">Not cited or run, by paragraph</h2>
            <p className="text-[12.5px] text-ink-soft mt-0.5">Mostly file-open and error paths. Click a line to see it.</p>
          </div>
          <ul className="max-h-[66vh] overflow-y-auto">
            {Object.entries(byPara).map(([p, ls]) => (
              <li key={p} className="box-row px-4 py-2.5">
                <div className="font-mono text-[12.5px] font-medium">{p}</div>
                <div className="flex flex-wrap gap-x-2.5 mt-0.5 text-[13px]">
                  {ls.map((l) => <button key={l} onClick={() => setLine(l)} className={`link font-mono text-[12.5px] ${line === l ? "underline" : ""}`}>{l}</button>)}
                </div>
              </li>
            ))}
          </ul>
        </section>
        <section className="box overflow-hidden lg:sticky lg:top-4" aria-label="COBOL source">
          <div className="box-header !py-0 h-10 flex items-center gap-2 text-[13px]">
            <FileCode className="text-ink-soft" /><span className="font-mono text-[12.5px]">{program}.cbl</span>
            <span className="ml-auto text-ink-soft"><span className="inline-block w-3 h-3 align-[-1px] bg-marker mr-1.5 border border-marker-strong rounded-[2px]" />not cited or run
              <span className="inline-block w-[3px] h-3 align-[-1px] bg-verified ml-4 mr-1.5" />run by a test</span>
          </div>
          <div className="h-[66vh]">
            <SourceView file={`${program}.cbl`} spans={c.uncovered_lines.map((u) => ({ file: `${program}.cbl`, lines: [u.line, u.line] }))}
              active={line ? { file: `${program}.cbl`, lines: [line, line] } : null} executed={executed} />
          </div>
        </section>
      </div>
    </div>
  );
}
