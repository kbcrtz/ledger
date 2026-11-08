"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { get, RuleSummary } from "@/lib/api";
import { StateIcon } from "@/components/Status";
import ProofChain, { stateOf } from "@/components/ProofChain";
import { Bug, Database } from "@/components/Icons";
import { FINDINGS, differ, plural } from "@/lib/labels";

type Summary = {
  totals: Record<string, number>;
  rules: number;
  cases: { total: number; passed: number };
  sample: Record<string, { match: boolean; difference_count: number; outcome: { legacy: string; port: string };
    files: Record<string, { legacy_records: number; port_records: number; differences: number }> }>;
  coverage: Record<string, { statement_lines: number; executed_any: number; cited_by_rules: number; neither: number }>;
};

const PROGRAMS = ["CBTRN02C", "CBACT04C"] as const;
const SHORT: Record<string, string> = { CBTRN02C: "Daily posting", CBACT04C: "Monthly interest" };
const DOT: Record<string, string> = { CBTRN02C: "bg-accent-bright", CBACT04C: "bg-approved" };
type Filter = "all" | (typeof PROGRAMS)[number] | "findings";

export default function Home() {
  const [rules, setRules] = useState<RuleSummary[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    Promise.all([get<RuleSummary[]>("/api/rules"), get<Summary>("/api/summary")])
      .then(([r, s]) => { setRules(r); setSummary(s); })
      .catch((e) => setError(String(e)));
  }, []);

  // One finding per rule today; the first one wins if a rule ever has more.
  const finding = useMemo(() => {
    const m: Record<string, (typeof FINDINGS)[number]> = {};
    FINDINGS.forEach((f) => { if (!m[f.rule]) m[f.rule] = f; });
    return m;
  }, []);

  if (error) return <Empty>The review API is not reachable ({error}). Start it with <code className="font-mono">uvicorn backend.app:app --port 8000</code>.</Empty>;
  if (!rules || !summary) return <Empty>Loading rules…</Empty>;
  if (rules.length === 0) return <Empty>No rules yet. Run <code className="font-mono">python -m ledger.pipeline all</code> to extract and verify them.</Empty>;

  const n = rules.length;
  const sourced = rules.filter((r) => r.sourced).length;
  const rebuilt = rules.filter((r) => r.port_function).length;
  const signed = rules.filter((r) => r.signed_off).length;
  const withFinding = rules.filter((r) => finding[r.id]).length;
  const shown = rules.filter((r) =>
    filter === "all" ? true : filter === "findings" ? !!finding[r.id] : r.program === filter);
  const filters: { key: Filter; label: string; count: number }[] = [
    { key: "all", label: "All rules", count: n },
    ...PROGRAMS.map((p) => ({ key: p as Filter, label: SHORT[p], count: rules.filter((r) => r.program === p).length })),
    { key: "findings", label: "Has a finding", count: withFinding },
  ];

  return (
    <>
      <section aria-label="What Ledger does" className="dot-grid border-b border-rule">
        <div className="mx-auto max-w-[1600px] px-6 pt-12 pb-10">
          <h1 className="text-[40px] leading-[1.06] font-semibold tracking-[-0.03em]">
            <span className="block text-[#8e8784]">What the old code actually does,</span>
            <span className="block">written down and checked against it.</span>
          </h1>
          <p className="mt-4 text-[16px] leading-relaxed text-ink-soft max-w-[68ch]">
            Ledger read two of AWS CardDemo&apos;s COBOL batch programs, wrote their business rules in plain English,
            and checked every rule against the running original.
          </p>
        </div>
      </section>

      <div className="mx-auto max-w-[1600px] px-6 pt-8 pb-16 grid gap-6">
        <section className="box" aria-label="Status">
          <div className="px-5 pt-5 pb-4">
            <ProofChain compact steps={[
              { title: "Sourced", value: `${sourced} of ${n} rules`, state: stateOf(sourced, n), detail: "Every sentence cites its COBOL lines." },
              { title: "Rebuilt", value: `${rebuilt} of ${n} rules`, state: stateOf(rebuilt, n), detail: "Python written from the rules alone." },
              { title: "Tested", value: `${summary.cases.passed} of ${summary.cases.total} tests match`, state: stateOf(summary.cases.passed, summary.cases.total), detail: "Original and rebuild give the same output." },
              { title: "Signed off", value: signed ? `${signed} of ${n} rules` : "Not yet", state: stateOf(signed, n), detail: "A person approves each rule." },
            ]} />
          </div>
          <RealData summary={summary} />
        </section>

        <section className="box" aria-label="Rules">
          <div className="box-header flex items-center gap-2 flex-wrap !py-2">
            <h2 className="font-semibold mr-2">Rules</h2>
            <div role="tablist" aria-label="Filter rules" className="flex gap-1 flex-wrap">
              {filters.map((f) => (
                <button key={f.key} role="tab" aria-selected={filter === f.key} onClick={() => setFilter(f.key)}
                  className={`h-8 px-3 rounded-md text-[13.5px] flex items-center gap-2 ${filter === f.key ? "bg-canvas border border-rule-strong text-ink font-medium" : "text-ink-soft hover:text-ink border border-transparent"}`}>
                  {f.key === "findings" ? <Bug className="text-flagged" /> : f.key !== "all" ? <span className={`h-2 w-2 rounded-full ${DOT[f.key]}`} aria-hidden /> : null}
                  {f.label}<span className="counter">{f.count}</span>
                </button>
              ))}
            </div>
            <span className="ml-auto text-[12.5px] text-ink-soft hidden md:inline">Open a rule to see its COBOL, sentences and Python side by side</span>
          </div>

          <div className="hidden md:grid grid-cols-[16px_minmax(0,1fr)_150px_96px] gap-x-4 px-4 py-2 text-[12px] text-ink-soft border-b border-rule">
            <span aria-hidden /><span>Rule</span><span>Program</span><span className="text-right">Tests</span>
          </div>

          <ul>
            {shown.map((r) => {
              const f = finding[r.id];
              const ok = r.tests_total > 0 && r.tests_passed === r.tests_total;
              const href = `/rules/${r.id}${f?.clause ? `?clause=${encodeURIComponent(f.clause)}` : ""}`;
              return (
                <li key={r.id} className="box-row">
                  <Link href={href} className="grid grid-cols-[16px_minmax(0,1fr)_auto] md:grid-cols-[16px_minmax(0,1fr)_150px_96px] gap-x-4 px-4 py-3.5 hover:bg-sheet group items-start">
                    <span className="mt-[3px]"><StateIcon state={r.signed_off ? "approved" : r.status === "verified" ? "pass" : r.status === "rejected" ? "fail" : "pending"} title={r.status} /></span>
                    <span className="min-w-0">
                      <span className="block text-[15px] font-semibold leading-snug group-hover:text-accent">{r.title}</span>
                      {f ? (
                        <span className="mt-1 flex items-start gap-1.5 text-[13.5px]">
                          <Bug className="mt-[2px] shrink-0 text-flagged" /><span><span className="text-flagged font-medium">Found in the code:</span> <span className="text-ink">{f.headline}</span></span>
                        </span>
                      ) : (
                        <span className="mt-1 block text-[13.5px] text-ink-soft truncate">{r.summary}</span>
                      )}
                    </span>
                    <span className="hidden md:flex items-center gap-2 text-[13px] text-ink-soft mt-[2px]">
                      <span className={`h-2 w-2 rounded-full ${DOT[r.program]}`} aria-hidden />{SHORT[r.program] ?? r.program}
                    </span>
                    <span className={`text-[13px] text-right whitespace-nowrap mt-[2px] ${ok ? "text-verified" : r.tests_total ? "text-rejected" : "text-ink-soft"}`}>
                      {r.tests_total ? `${r.tests_passed}/${r.tests_total} pass` : "no tests"}
                    </span>
                  </Link>
                </li>
              );
            })}
            {shown.length === 0 && <li className="px-4 py-6 text-ink-soft">No rules match this filter.</li>}
          </ul>
        </section>
      </div>
    </>
  );
}

// The strongest single claim, in one line: CardDemo's own data gives identical results.
function RealData({ summary }: { summary: Summary }) {
  const post = summary.sample.CBTRN02C, int = summary.sample.CBACT04C;
  if (!post && !int) return null;
  const both = (post?.match ?? true) && (int?.match ?? true);
  const neither = Object.values(summary.coverage ?? {}).reduce((a, c) => a + (c.neither ?? 0), 0);
  const parts = [
    post && `${post.files.DALYREJS?.legacy_records ?? 0} rejected transactions`,
    post && `${post.files.TRANSACT?.legacy_records ?? 0} posted`,
    post && `${post.files.ACCOUNT?.legacy_records ?? 0} accounts`,
    int && `${int.files.TRANSACT?.legacy_records ?? 0} interest charges`,
  ].filter(Boolean).join(", ");
  return (
    <div className="border-t border-rule bg-sheet rounded-b-lg px-5 py-3 flex items-start gap-3 flex-wrap text-[14px]">
      <span className="mt-[3px]"><StateIcon state={both ? "pass" : "fail"} /></span>
      <span className="flex-1 min-w-[280px]">
        <Database className="inline text-ink-soft mr-1.5 align-[-3px]" />
        On CardDemo&apos;s own data, {both
          ? <>the original COBOL and the Python rebuild produce <span className="text-verified font-medium">identical results</span>: {parts}.</>
          : <>the original and the rebuild differ: {differ((post?.difference_count ?? 0) + (int?.difference_count ?? 0))}.</>}
      </span>
      {neither > 0 && <Link href="/coverage" className="link text-[13px] whitespace-nowrap mt-[1px]">{plural(neither, "statement")} untouched by any rule or test</Link>}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-[760px] px-6 py-16 text-[15px] text-ink-soft">{children}</div>;
}
