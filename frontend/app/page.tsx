"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { get, RuleSummary } from "@/lib/api";
import { StatusMark } from "@/components/Status";
import ProofChain, { stateOf } from "@/components/ProofChain";
import { FINDINGS, PROGRAM_BLURB, PROGRAM_NAME, fileName, outcomeText, plural } from "@/lib/labels";

type Summary = {
  totals: Record<string, number>;
  rules: number;
  cases: { total: number; passed: number };
  sample: Record<string, { match: boolean; difference_count: number; outcome: { legacy: string; port: string };
    files: Record<string, { legacy_records: number; port_records: number; differences: number }> }>;
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

  if (error) return <Empty>The review API is not reachable ({error}). Start it with <code>uvicorn backend.app:app --port 8000</code>.</Empty>;
  if (!rules || !summary) return <Empty>Loading rules</Empty>;
  if (rules.length === 0) return <Empty>No rules yet. Run <code>python -m ledger.pipeline all</code> to extract and verify them.</Empty>;

  const n = rules.length;
  const sourced = rules.filter((r) => r.sourced).length;
  const rebuilt = rules.filter((r) => r.port_function).length;
  const tested = rules.filter((r) => r.tests_total > 0 && r.tests_passed === r.tests_total).length;
  const signed = rules.filter((r) => r.signed_off).length;
  const findings = FINDINGS.filter((f) => byId[f.rule]);

  return (
    <div className="mx-auto max-w-[1120px] px-5 pt-10 pb-16">
      <section aria-label="What Ledger does">
        <h1 className="font-serif text-[34px] leading-[1.15] font-semibold max-w-[24ch]">
          What two old COBOL programs actually do, written down and checked
        </h1>
        <p className="mt-3 text-[16.5px] leading-relaxed text-ink-soft max-w-[68ch]">
          Ledger read AWS CardDemo&apos;s batch programs and wrote their business rules in plain English.
          Every rule then went through four checks, in order. A rule only counts as verified once it passes the first three;
          the last one is a person&apos;s call.
        </p>
        <div className="mt-8">
          <ProofChain steps={[
            { title: "Sourced", value: `${sourced} of ${plural(n, "rule")}`, state: stateOf(sourced, n),
              detail: "Every sentence points to the COBOL lines it came from, and a checker confirmed those lines say it." },
            { title: "Rebuilt", value: `${rebuilt} of ${plural(n, "rule")}`, state: stateOf(rebuilt, n),
              detail: "A separate AI wrote a Python version from the rules alone. It never saw the COBOL." },
            { title: "Tested", value: `${summary.cases.passed} of ${plural(summary.cases.total, "test")} match`, state: stateOf(tested, n),
              detail: "The original COBOL and the Python rebuild ran on the same inputs and produced the same outputs." },
            { title: "Signed off", value: signed ? `${signed} of ${plural(n, "rule")}` : "Not yet", state: stateOf(signed, n),
              detail: "A person reads each rule beside its code and approves or rejects it." },
          ]} />
        </div>
      </section>

      <section aria-label="Real data" className="mt-12 border-t border-ink pt-5">
        <h2 className="font-serif text-[22px] font-semibold">Checked on CardDemo&apos;s own data</h2>
        <p className="mt-1 text-[14.5px] text-ink-soft max-w-[70ch]">
          The tests above were written from the rules. This data wasn&apos;t, so it can catch anything the rules missed.
        </p>
        <ul className="mt-4 grid md:grid-cols-2 gap-x-10 gap-y-4">
          {PROGRAMS.filter((p) => summary.sample[p]).map((p) => {
            const s = summary.sample[p];
            return (
              <li key={p} className="text-[15px] leading-relaxed">
                <div className="font-medium">{PROGRAM_NAME[p]}</div>
                <div className={s.match ? "text-verified" : "text-flagged"}>
                  {s.match ? "✓ Identical results from the original and the rebuild" : `${plural(s.difference_count, "field")} differ between the original and the rebuild`}
                </div>
                <div className="text-ink-soft text-[14px]">
                  {Object.entries(s.files).map(([f, v]) => `${v.legacy_records} ${fileName(f)}`).join(", ")}; {outcomeText(s.outcome.legacy)}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {findings.length > 0 && (
        <section aria-label="Findings" className="mt-12 border-t border-ink pt-5">
          <h2 className="font-serif text-[22px] font-semibold">What it found in the code</h2>
          <p className="mt-1 text-[14.5px] text-ink-soft max-w-[70ch]">
            Behavior nobody wrote down. Each one is a sentence in a verified rule, so you can see the exact COBOL lines behind it.
          </p>
          <ul className="mt-3">
            {findings.map((f) => (
              <li key={f.rule + f.clause} className="border-b border-rule">
                <Link href={`/rules/${f.rule}${f.clause ? `?clause=${encodeURIComponent(f.clause)}` : ""}`}
                  className="group flex items-baseline gap-4 py-3 hover:bg-sheet px-1">
                  <span className="font-serif text-[17.5px] leading-snug flex-1">{f.headline}</span>
                  <span className="text-[13px] text-ink-soft group-hover:text-ink whitespace-nowrap">
                    {PROGRAM_NAME[byId[f.rule].program]}: see the code
                  </span>
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
          <section key={p} aria-label={PROGRAM_NAME[p]} className="mt-12 border-t border-ink pt-5">
            <div className="flex items-baseline gap-3 flex-wrap">
              <h2 className="font-serif text-[22px] font-semibold">{PROGRAM_NAME[p]}</h2>
              <span className="text-[13px] text-ink-soft">{p}.cbl, {plural(rs.length, "rule")}</span>
            </div>
            <p className="mt-1 text-[14.5px] text-ink-soft max-w-[70ch]">{PROGRAM_BLURB[p]}</p>
            <ul className="mt-3">
              {rs.map((r) => (
                <li key={r.id} className="border-b border-rule">
                  <Link href={`/rules/${r.id}`} className="grid grid-cols-[1fr_auto] md:grid-cols-[1fr_170px_150px] gap-x-6 gap-y-1 py-3 px-1 hover:bg-sheet items-baseline">
                    <span>
                      <span className="font-serif text-[17px] leading-snug block">{r.title}</span>
                      <span className="text-[12.5px] text-ink-soft">{r.id.replace("BR-", "")}</span>
                    </span>
                    <span className={`text-[14px] hidden md:block ${r.tests_total && r.tests_passed === r.tests_total ? "text-verified" : r.tests_total ? "text-flagged" : "text-ink-soft"}`}>
                      {r.tests_total ? `${r.tests_passed} of ${plural(r.tests_total, "test")} match` : "No tests yet"}
                    </span>
                    <span className="justify-self-end md:justify-self-start"><StatusMark status={r.status} /></span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-[760px] px-5 py-16 text-[15px] text-ink-soft">{children}</div>;
}
