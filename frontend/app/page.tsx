"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { get, RuleSummary } from "@/lib/api";
import { StateIcon } from "@/components/Status";
import ChecksBox from "@/components/Checks";
import { Bug, Database, FileCode } from "@/components/Icons";
import { FINDINGS, PROGRAM_BLURB, PROGRAM_NAME, differ, fileName, outcomeText, plural } from "@/lib/labels";

type Summary = {
  totals: Record<string, number>;
  rules: number;
  cases: { total: number; passed: number };
  sample: Record<string, { match: boolean; difference_count: number; outcome: { legacy: string; port: string };
    files: Record<string, { legacy_records: number; port_records: number; differences: number }> }>;
  coverage: Record<string, { statement_lines: number; executed_any: number; cited_by_rules: number; neither: number }>;
};

const PROGRAMS = ["CBTRN02C", "CBACT04C"];

export default function Home() {
  const [rules, setRules] = useState<RuleSummary[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([get<RuleSummary[]>("/api/rules"), get<Summary>("/api/summary")])
      .then(([r, s]) => { setRules(r); setSummary(s); })
      .catch((e) => setError(String(e)));
  }, []);

  const byId = useMemo(() => Object.fromEntries((rules ?? []).map((r) => [r.id, r])), [rules]);

  if (error) return <Empty>The review API is not reachable ({error}). Start it with <code className="font-mono">uvicorn backend.app:app --port 8000</code>.</Empty>;
  if (!rules || !summary) return <Empty>Loading rules…</Empty>;
  if (rules.length === 0) return <Empty>No rules yet. Run <code className="font-mono">python -m ledger.pipeline all</code> to extract and verify them.</Empty>;

  const n = rules.length;
  const sourced = rules.filter((r) => r.sourced).length;
  const rebuilt = rules.filter((r) => r.port_function).length;
  const signed = rules.filter((r) => r.signed_off).length;
  const allTestsPass = summary.cases.total > 0 && summary.cases.passed === summary.cases.total;
  const findings = FINDINGS.filter((f) => byId[f.rule]);

  return (
    <>
    <section aria-label="What Ledger does" className="dot-grid border-b border-rule">
      <div className="mx-auto max-w-[1280px] px-6 pt-16 pb-14">
        <h1 className="text-[48px] leading-[1.04] font-semibold tracking-[-0.035em] max-w-[18ch] sm:max-w-none">
          <span className="block text-[#8e8784]">What the old code actually does,</span>
          <span className="block">written down and checked against it.</span>
        </h1>
        <p className="mt-5 text-[16.5px] leading-relaxed text-ink-soft max-w-[64ch]">
          Ledger read two of AWS CardDemo&apos;s COBOL batch programs and wrote their business rules in plain English.
          Every rule then goes through four checks, in order, and the last one is a person&apos;s call.
        </p>
      </div>
    </section>
    <div className="mx-auto max-w-[1280px] px-6 pt-10 pb-16">
      <div className="grid lg:grid-cols-[minmax(0,1fr)_300px] gap-8 items-start">
        <div className="grid gap-6 min-w-0">
          <ChecksBox title={`${n} rules`} checks={[
            { name: "Sourced", state: sourced === n ? "pass" : "pending", result: `${sourced} of ${plural(n, "rule")}`,
              detail: "Every sentence points to the COBOL lines it came from, and a checker confirmed those lines say it." },
            { name: "Rebuilt", state: rebuilt === n ? "pass" : "pending", result: `${rebuilt} of ${plural(n, "rule")}`,
              detail: "A separate AI wrote a Python version from the rules alone. It never saw the COBOL." },
            { name: "Tested", state: allTestsPass ? "pass" : summary.cases.passed < summary.cases.total ? "fail" : "pending",
              result: `${summary.cases.passed} of ${plural(summary.cases.total, "test")} match`,
              detail: "The original COBOL and the Python rebuild ran on the same inputs and produced the same outputs." },
            { name: "Signed off", state: signed === n ? "approved" : "pending", result: signed ? `${signed} of ${plural(n, "rule")}` : "Not yet",
              detail: "A person reads each rule beside its code and approves or rejects it. Open a rule below to do that." },
          ]} />

          {findings.length > 0 && (
            <section className="box" aria-label="Findings">
              <div className="box-header flex items-center gap-2">
                <Bug className="text-rejected" />
                <h2 className="font-semibold">What it found in the code</h2>
                <span className="counter">{findings.length}</span>
                <span className="ml-auto text-[12.5px] text-ink-soft hidden sm:inline">Behavior nobody wrote down, each backed by a verified sentence</span>
              </div>
              <ul>
                {findings.map((f) => (
                  <li key={f.rule + f.clause} className="box-row">
                    <Link href={`/rules/${f.rule}${f.clause ? `?clause=${encodeURIComponent(f.clause)}` : ""}`}
                      className="flex items-baseline gap-3 px-4 py-3 hover:bg-sheet group">
                      <span className="flex-1 text-[15px] group-hover:text-accent">{f.headline}</span>
                      <span className="text-[12px] text-ink-soft whitespace-nowrap hidden sm:inline">{PROGRAM_NAME[byId[f.rule].program]}</span>
                      <span className="font-mono text-[12px] text-accent whitespace-nowrap">{f.rule.replace("BR-", "")}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {PROGRAMS.map((p) => {
            const rs = rules.filter((r) => r.program === p);
            if (!rs.length) return null;
            return (
              <section key={p} className="box" aria-label={PROGRAM_NAME[p]}>
                <div className="box-header">
                  <div className="flex items-center gap-2 flex-wrap">
                    <FileCode className="text-ink-soft" />
                    <h2 className="font-semibold">{PROGRAM_NAME[p]}</h2>
                    <span className="font-mono text-[12px] text-ink-soft">{p}.cbl</span>
                    <span className="counter">{rs.length}</span>
                  </div>
                  <p className="text-[13px] text-ink-soft mt-1">{PROGRAM_BLURB[p]}</p>
                </div>
                <ul>
                  {rs.map((r) => {
                    const ok = r.tests_total > 0 && r.tests_passed === r.tests_total;
                    return (
                      <li key={r.id} className="box-row">
                        <Link href={`/rules/${r.id}`} className="grid grid-cols-[16px_1fr_auto] gap-x-3 px-4 py-3 hover:bg-sheet group items-start">
                          <span className="mt-[3px]"><StateIcon state={r.signed_off ? "approved" : r.status === "verified" ? "pass" : r.status === "rejected" ? "fail" : "pending"} title={r.status} /></span>
                          <span className="min-w-0">
                            <span className="block text-[15px] font-semibold leading-snug group-hover:text-accent">{r.title}</span>
                            <span className="block text-[12.5px] text-ink-soft mt-0.5">
                              <span className="font-mono">{r.id.replace("BR-", "")}</span> from paragraph <span className="font-mono">{r.paragraph}</span>
                            </span>
                          </span>
                          <span className={`text-[12.5px] whitespace-nowrap mt-[2px] ${ok ? "text-verified" : r.tests_total ? "text-rejected" : "text-ink-soft"}`}>
                            {r.tests_total ? `${r.tests_passed}/${r.tests_total} tests` : "no tests"}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>

        <aside className="grid gap-6 text-[14px]" aria-label="About">
          <section>
            <h2 className="font-semibold text-[16px]">About</h2>
            <p className="mt-2 text-ink-soft leading-relaxed">
              The input is <a className="link" href="https://github.com/aws-samples/aws-mainframe-modernization-carddemo" target="_blank" rel="noreferrer">AWS CardDemo</a>,
              an open-source COBOL credit-card system. The original programs run unchanged under GnuCOBOL; nothing was rewritten by hand.
            </p>
          </section>

          <section className="border-t border-rule pt-5">
            <h2 className="font-semibold text-[16px] flex items-center gap-2"><Database className="text-ink-soft" />Checked on CardDemo&apos;s own data</h2>
            <p className="mt-1 text-[13px] text-ink-soft">The tests were written from the rules. This data wasn&apos;t, so it can catch anything the rules missed.</p>
            <ul className="mt-3 grid gap-3">
              {PROGRAMS.filter((p) => summary.sample[p]).map((p) => {
                const s = summary.sample[p];
                return (
                  <li key={p} className="grid grid-cols-[16px_1fr] gap-x-2.5">
                    <span className="mt-[3px]"><StateIcon state={s.match ? "pass" : "fail"} /></span>
                    <span>
                      <span className="font-medium">{PROGRAM_NAME[p]}</span>
                      <span className={`block text-[13px] ${s.match ? "text-verified" : "text-rejected"}`}>{s.match ? "Identical results" : differ(s.difference_count)}</span>
                      <span className="block text-[12.5px] text-ink-soft">{Object.entries(s.files).map(([f, v]) => `${v.legacy_records} ${fileName(f)}`).join(", ")}; {outcomeText(s.outcome.legacy)}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>

          <CoverageBar cov={summary.coverage} />
        </aside>
      </div>
    </div>
    </>
  );
}

// Like GitHub's language bar: how much of the COBOL the tests ran, and what nothing touched.
function CoverageBar({ cov }: { cov: Summary["coverage"] }) {
  const t = Object.values(cov ?? {}).reduce((a, c) => ({ total: a.total + c.statement_lines, ran: a.ran + c.executed_any, neither: a.neither + c.neither }), { total: 0, ran: 0, neither: 0 });
  if (!t.total) return null;
  const citedOnly = Math.max(0, t.total - t.ran - t.neither);
  const parts = [
    { label: "Run by a test", n: t.ran, color: "bg-verified" },
    { label: "Cited, not run", n: citedOnly, color: "bg-accent-bright" },
    { label: "Not cited or run", n: t.neither, color: "bg-[#42403e]" },
  ];
  return (
    <section className="border-t border-rule pt-5">
      <h2 className="font-semibold text-[16px]">Coverage</h2>
      <p className="mt-1 text-[13px] text-ink-soft">{t.total} COBOL statements across both programs.</p>
      <div className="mt-3 flex h-2 rounded-full overflow-hidden" role="img" aria-label={parts.map((p) => `${p.label}: ${p.n}`).join(", ")}>
        {parts.map((p) => <span key={p.label} className={p.color} style={{ width: `${(p.n / t.total) * 100}%` }} />)}
      </div>
      <ul className="mt-2.5 grid gap-1 text-[12.5px]">
        {parts.map((p) => (
          <li key={p.label} className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${p.color}`} aria-hidden />
            <span>{p.label}</span>
            <span className="text-ink-soft">{p.n}</span>
          </li>
        ))}
      </ul>
      <Link href="/coverage" className="link text-[13px] mt-2 inline-block">See which lines nothing touched</Link>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-[760px] px-6 py-16 text-[15px] text-ink-soft">{children}</div>;
}
