"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { get, RuleSummary } from "@/lib/api";
import { StatusMark } from "@/components/Status";

type Summary = {
  totals: Record<string, number>;
  rules: number;
  cases: { total: number; passed: number };
  sample: Record<string, { match: boolean; difference_count: number; outcome: { legacy: string; port: string };
    files: Record<string, { legacy_records: number; port_records: number; differences: number }> }>;
};

const TOTALS = ["verified", "flagged", "approved", "diverged"] as const;

export default function Catalog() {
  const [rules, setRules] = useState<RuleSummary[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [program, setProgram] = useState("all");
  const [status, setStatus] = useState("all");

  useEffect(() => {
    Promise.all([get<RuleSummary[]>("/api/rules"), get<Summary>("/api/summary")])
      .then(([r, s]) => { setRules(r); setSummary(s); })
      .catch((e) => setError(String(e)));
  }, []);

  const shown = useMemo(() => (rules ?? []).filter((r) =>
    (program === "all" || r.program === program) && (status === "all" || r.status === status)), [rules, program, status]);
  const statuses = useMemo(() => Array.from(new Set((rules ?? []).map((r) => r.status))).sort(), [rules]);

  if (error) return <Empty>The review API is not reachable ({error}). Start it with <code>uvicorn backend.app:app --port 8000</code>.</Empty>;
  if (!rules || !summary) return <Empty>Loading rules</Empty>;
  if (rules.length === 0) return <Empty>No rules yet. Run <code>python -m ledger.pipeline all</code> to extract and verify them.</Empty>;

  return (
    <div className="mx-auto max-w-[1180px] px-5 py-8">
      <div className="flex items-end gap-10 flex-wrap">
        <div>
          <h1 className="font-serif text-[30px] leading-tight font-semibold">Business rules</h1>
          <p className="text-ink-soft text-[15px] mt-1 max-w-[62ch]">
            Extracted from two CardDemo batch programs. Each clause cites its COBOL lines; each rule is checked by
            running the original program and a port written only from the rules.
          </p>
        </div>
        <table className="ml-auto text-[14px]">
          <tbody>
            <tr className="double-rule">
              {TOTALS.map((t) => (
                <td key={t} className="px-4 pb-1 text-right">
                  <div className="text-ink-soft capitalize">{t}</div>
                  <div className="font-serif text-[26px] leading-none mt-1">{summary.totals[t] ?? 0}</div>
                </td>
              ))}
              <td className="pl-6 pb-1 text-right">
                <div className="text-ink-soft">Cases matching</div>
                <div className="font-serif text-[26px] leading-none mt-1">{summary.cases.passed}<span className="text-ink-soft text-[18px]">/{summary.cases.total}</span></div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <section className="mt-6 border-t border-b border-rule py-3 overflow-x-auto">
        <table className="text-[14px] w-full">
          <caption className="text-left text-ink-soft text-[13px] pb-1">CardDemo&apos;s own sample data, run through the COBOL and the port (CBACT04C runs on the files CBTRN02C posted)</caption>
          <tbody>
            {Object.entries(summary.sample).map(([p, s]) => (
              <tr key={p} className="align-baseline">
                <td className="pr-6 py-0.5 font-medium whitespace-nowrap">{p}</td>
                <td className={`pr-6 whitespace-nowrap ${s.match ? "text-verified" : "text-flagged"}`}>
                  {s.match ? "legacy and port match" : `${s.difference_count} differing field${s.difference_count === 1 ? "" : "s"}`}
                </td>
                <td className="pr-6 text-ink-soft whitespace-nowrap">run outcome {s.outcome.legacy === s.outcome.port ? s.outcome.legacy : `${s.outcome.legacy} vs ${s.outcome.port}`}</td>
                <td className="text-ink-soft">{Object.entries(s.files).map(([f, v]) => `${f} ${v.legacy_records}${v.differences ? ` (${v.differences} differing)` : ""}`).join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="mt-6 flex gap-6 text-[14px] items-center flex-wrap">
        <Filter label="Program" value={program} set={setProgram} options={["all", "CBTRN02C", "CBACT04C"]} />
        <Filter label="Status" value={status} set={setStatus} options={["all", ...statuses]} />
        <span className="ml-auto text-ink-soft">{shown.length} of {rules.length} rules</span>
      </div>

      <table className="w-full mt-3 text-[14.5px] border-collapse">
        <thead>
          <tr className="text-left text-ink-soft text-[13px] border-b border-ink">
            <th className="py-2 pr-4 font-normal w-[150px]">Rule</th>
            <th className="py-2 pr-4 font-normal">Behaviour</th>
            <th className="py-2 pr-4 font-normal w-[110px]">Status</th>
            <th className="py-2 pr-4 font-normal w-[90px] text-right">Cases</th>
            <th className="py-2 font-normal w-[220px]">Port function</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.id} className="border-b border-rule align-top hover:bg-sheet">
              <td className="py-3 pr-4">
                <Link href={`/rules/${r.id}`} className="font-medium hover:underline">{r.id.replace("BR-", "")}</Link>
                <div className="text-[12.5px] text-ink-soft mt-0.5">{r.paragraph}</div>
              </td>
              <td className="py-3 pr-4">
                <Link href={`/rules/${r.id}`} className="font-serif text-[16px] leading-snug hover:underline">{r.title}</Link>
                <div className="text-[13px] text-ink-soft mt-1 max-w-[70ch]">{r.status_why}</div>
              </td>
              <td className="py-3 pr-4"><StatusMark status={r.status} /></td>
              <td className="py-3 pr-4 text-right whitespace-nowrap">
                {r.tests_total ? <span className={r.tests_passed === r.tests_total ? "text-verified" : "text-flagged"}>{r.tests_passed}/{r.tests_total}</span> : <span className="text-ink-soft">none</span>}
              </td>
              <td className="py-3 text-[13px] break-all">{r.port_function ?? <span className="text-ink-soft">not ported</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Filter({ label, value, set, options }: { label: string; value: string; set: (v: string) => void; options: string[] }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-ink-soft">{label}</span>
      {options.map((o) => (
        <button key={o} onClick={() => set(o)}
          className={`px-2 py-0.5 rounded-sm border ${value === o ? "border-ink bg-sheet" : "border-transparent text-ink-soft hover:text-ink"}`}>
          {o === "all" ? "All" : o}
        </button>
      ))}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-[760px] px-5 py-16 text-[15px] text-ink-soft">{children}</div>;
}
