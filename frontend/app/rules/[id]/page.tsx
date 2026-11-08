"use client";
import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import { get, post, Rule, Clause, Part, CaseResult, ClauseCheck } from "@/lib/api";
import SourceView from "@/components/SourceView";
import { StatusMark, StateIcon, Tick } from "@/components/Status";
import DiffTable from "@/components/DiffTable";
import ChecksBox from "@/components/Checks";
import { Database, FileCode } from "@/components/Icons";
import { PROGRAM_NAME, differ, fileName, lineRange, outcomeText, plural } from "@/lib/labels";

const PARTS: Part[] = ["given", "when", "then"];
const PART_LABEL: Record<Part, string> = { given: "Given", when: "When", then: "Then" };
const PART_HINT: Record<Part, string> = { given: "the starting situation", when: "what triggers the rule", then: "what the program does" };
type Tab = "rule" | "tests" | "history";

export default function RuleDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [rule, setRule] = useState<Rule | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<{ part: Part; index: number } | null>(null);
  const [openCase, setOpenCase] = useState<string | null>(null);
  const [execFor, setExecFor] = useState<string | null>(null);
  const [file, setFile] = useState<string | null>(null);
  const [tab, setTabState] = useState<Tab>("rule");

  useEffect(() => { get<Rule>(`/api/rules/${id}`).then(setRule).catch((e) => setError(String(e))); }, [id]);

  // #tests / #history open a tab; ?clause=then[3] (from the home page findings) opens a sentence.
  useEffect(() => {
    const h = window.location.hash.slice(1);
    if (h === "tests" || h === "history") setTabState(h);
  }, []);
  useEffect(() => {
    if (!rule) return;
    const m = /^(given|when|then)\[(\d+)\]$/.exec(new URLSearchParams(window.location.search).get("clause") ?? "");
    if (m && rule.scenario[m[1] as Part][Number(m[2])]) {
      setActive({ part: m[1] as Part, index: Number(m[2]) });
      setTimeout(() => document.getElementById(`clause-${m[1]}-${m[2]}`)?.scrollIntoView({ block: "center" }), 150);
    }
  }, [rule]);

  const checks = useMemo(() => {
    const last = rule?.verification.attempts.at(-1);
    const m: Record<string, ClauseCheck> = {};
    last?.clauses.forEach((c) => { m[c.clause] = c; });
    return m;
  }, [rule]);

  function setTab(t: Tab) {
    setTabState(t);
    history.replaceState(null, "", t === "rule" ? window.location.pathname + window.location.search : `#${t}`);
  }

  if (error) return <div className="mx-auto max-w-[1280px] px-6 py-10 text-ink-soft">Could not load {id}: {error}</div>;
  if (!rule) return <div className="mx-auto max-w-[1280px] px-6 py-10 text-ink-soft">Loading {id}…</div>;

  const progFile = `${rule.program}.cbl`;
  const spans = PARTS.flatMap((p) => rule.scenario[p].flatMap((c) => [c.source, ...(c.also ?? [])]));
  const files = Array.from(new Set([progFile, ...spans.map((s) => s.file)]));
  const activeClause: Clause | null = active ? rule.scenario[active.part][active.index] : null;
  const shownFile = file ?? activeClause?.source.file ?? progFile;
  const execCase = execFor ? rule.cases.find((c) => c.id === execFor) : null;
  const attempts = rule.verification.attempts.length;
  const allClauses = PARTS.flatMap((p) => rule.scenario[p].map((_, i) => `${p}[${i}]`));
  const passedClauses = allClauses.filter((k) => checks[k]?.passed).length;
  const sourced = rule.status_history.some((h) => h.by === "verifier" && h.status === "traced");
  const fns = rule.port_functions?.length ? rule.port_functions : rule.port_function ? [rule.port_function] : [];
  const signedOff = rule.review.decision === "approved" || rule.status === "diverged";
  const rejected = rule.review.decision === "rejected";
  const testsOk = rule.tests_total > 0 && rule.tests_passed === rule.tests_total;
  const timelineCount = rule.status_history.length + rule.review_history.length;

  return (
    <div className="mx-auto max-w-[1280px] px-6 pt-6 pb-16">
      <div className="text-[13px] text-ink-soft">
        <Link href="/" className="link">Rules</Link> / {PROGRAM_NAME[rule.program] ?? rule.program}
      </div>

      <header className="mt-2">
        <div className="flex items-start gap-4 flex-wrap">
          <h1 className="text-[28px] leading-[1.2] font-semibold tracking-[-0.015em] flex-1 min-w-[300px]">
            {rule.title} <span className="font-normal text-ink-soft font-mono text-[22px] tracking-normal">{rule.id.replace("BR-", "")}</span>
          </h1>
          <Link href={`/rules/${rule.id}/impact`} className="btn">Change this rule</Link>
        </div>
        <div className="mt-3 flex items-center gap-2.5 flex-wrap text-[14px] text-ink-soft">
          <StatusMark status={rule.status} large />
          <span>
            In <span className="text-ink font-medium">{PROGRAM_NAME[rule.program]}</span>, from paragraph{" "}
            <span className="font-mono text-[13px] text-ink">{rule.paragraph}</span> of <span className="font-mono text-[13px] text-ink">{progFile}</span>
          </span>
        </div>
      </header>

      <nav className="mt-5 border-b border-rule flex gap-1 text-[14px]" aria-label="Rule sections">
        {([["rule", "Rule", undefined], ["tests", "Tests", rule.cases.length], ["history", "History", timelineCount]] as const).map(([k, label, count]) => (
          <button key={k} onClick={() => setTab(k)} aria-current={tab === k ? "page" : undefined}
            className={`relative flex items-center gap-2 px-3 h-11 ${tab === k ? "font-semibold text-ink" : "text-ink-soft hover:text-ink"}`}>
            {label}{count !== undefined && <span className="counter">{count}</span>}
            {tab === k && <span aria-hidden className="absolute left-2 right-2 -bottom-px h-[2px] rounded-full bg-accent-bright" />}
          </button>
        ))}
      </nav>

      {tab === "rule" && (
        <>
          <div className="mt-6 grid lg:grid-cols-[minmax(0,1fr)_280px] gap-8 items-start">
            <div className="min-w-0">
              <section className="box" aria-label="Summary">
                <div className="box-header text-[13.5px] text-ink-soft">
                  <span className="font-semibold text-ink">extractor</span> drafted this rule from <span className="font-mono text-[12.5px]">{rule.paragraph}</span>
                </div>
                <div className="px-4 py-4 text-[15.5px] leading-relaxed max-w-[78ch]">{rule.summary}</div>
                {rule.notes && rule.notes.length > 0 && (
                  <div className="px-4 pb-4">
                    <div className="rounded-md border border-rule bg-sheet px-3.5 py-3">
                      <div className="text-[13px] font-semibold">Notes for the reviewer</div>
                      <p className="text-[12.5px] text-ink-soft">Not checked: no single line can prove these, so they are not used to build the Python version.</p>
                      <ul className="mt-1.5 list-disc ml-5 text-[13.5px] grid gap-1">
                        {rule.notes.map((n, i) => <li key={i}>{n}</li>)}
                      </ul>
                    </div>
                  </div>
                )}
              </section>


            </div>

            <aside className="grid gap-5 text-[13.5px]" aria-label="Details">
              <SideItem title="Checks">
                <ul className="grid gap-1.5">
                  {([["Sourced", sourced ? "pass" : "fail"], ["Rebuilt", fns.length ? "pass" : "pending"], ["Tested", !rule.tests_total ? "pending" : testsOk ? "pass" : "fail"], ["Signed off", signedOff ? "approved" : rejected ? "fail" : "pending"]] as const).map(([n, st]) => (
                    <li key={n} className="flex items-center gap-2"><StateIcon state={st} />{n}</li>
                  ))}
                </ul>
                <a href="#checks" className="link text-[12.5px] mt-1.5 inline-block">Details and sign-off</a>
              </SideItem>
              <SideItem title="Python function">
                {fns.length ? fns.map((f) => <div key={f} className="font-mono text-[12.5px] break-all">{f}</div>) : <span className="text-ink-soft">Not rebuilt yet</span>}
              </SideItem>
            </aside>
          </div>

          <div className="mt-8 grid xl:grid-cols-[minmax(0,42fr)_minmax(0,58fr)] gap-6">
            <section className="box min-w-0 self-start" aria-label="Rule sentences">
              <div className="box-header flex items-baseline gap-3 flex-wrap">
                <h2 className="font-semibold">What the rule says</h2>
                <span className="text-[12.5px] text-ink-soft">Click a sentence to see the COBOL it comes from.</span>
              </div>
              {PARTS.map((part) => (
                <div key={part}>
                  <h3 className="px-4 pt-3 pb-1 flex items-baseline gap-2 border-t border-rule first:border-t-0">
                    <span className="font-semibold">{PART_LABEL[part]}</span>
                    <span className="text-[12.5px] text-ink-soft">{PART_HINT[part]}</span>
                  </h3>
                  <ol>
                    {rule.scenario[part].map((c, i) => {
                      const key = `${part}[${i}]`;
                      const chk = checks[key];
                      const isActive = active?.part === part && active.index === i;
                      return (
                        <li key={key} id={`clause-${part}-${i}`} className={isActive ? "bg-marker/70 shadow-[inset_3px_0_0_var(--color-marker-strong)]" : ""}>
                          <button onClick={() => { setActive(isActive ? null : { part, index: i }); setFile(null); }} aria-expanded={isActive}
                            className="w-full text-left grid grid-cols-[16px_1fr] gap-3 px-4 py-2.5 hover:bg-sheet/70">
                            <span className="mt-[3px]"><Tick ok={chk ? chk.passed : null} title={chk ? (chk.passed ? "Backed by the cited COBOL lines" : "Not backed by the cited lines") : "Not checked"} /></span>
                            <span>
                              <span className="block text-[15px] leading-[1.55]">{c.text}</span>
                              <span className="text-[12px] text-ink-soft mt-0.5 flex flex-wrap gap-x-3 font-mono">
                                {[c.source, ...(c.also ?? [])].map((s, k) => <span key={k}>{lineRange(s.file, s.lines)}</span>)}
                              </span>
                            </span>
                          </button>
                          {isActive && chk && (
                            <div className="ml-[44px] mr-4 mb-3 text-[13px] grid gap-1.5 rounded-md border border-rule bg-canvas px-3 py-2.5">
                              <div className="font-semibold text-[12.5px]">Why this sentence counts as sourced</div>
                              <div className="flex gap-2"><Tick ok={chk.deterministic.passed} /><span>The highlighted lines contain <span className="font-mono text-[12px]">{[...c.fields, ...c.literals.map((l) => `'${l}'`)].join(", ") || "what it names"}</span>.
                                {chk.deterministic.errors.length > 0 && <ul className="text-rejected ml-4 list-disc">{chk.deterministic.errors.map((e) => <li key={e}>{e}</li>)}</ul>}</span>
                              </div>
                              {chk.judge && <div className="flex gap-2"><Tick ok={chk.judge.supported} /><span>An AI reviewer read only those lines and agreed: {chk.judge.reason}</span></div>}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                </div>
              ))}
              {attempts > 1 && <RetryNote rule={rule} />}
            </section>

            <section className="box min-w-0 overflow-hidden self-start xl:sticky xl:top-4" aria-label="COBOL source">
              <div className="box-header !py-0 flex items-center gap-1 text-[13px] overflow-x-auto">
                {files.map((f) => (
                  <button key={f} onClick={() => setFile(f)}
                    className={`relative flex items-center gap-1.5 px-2.5 h-10 font-mono text-[12.5px] whitespace-nowrap ${shownFile === f ? "text-ink font-medium" : "text-ink-soft hover:text-ink"}`}>
                    <FileCode className={shownFile === f ? "text-ink" : "text-ink-soft"} />{f}
                    {shownFile === f && <span aria-hidden className="absolute left-1.5 right-1.5 bottom-0 h-[2px] rounded-full bg-accent-bright" />}
                  </button>
                ))}
                <span className="ml-auto pl-4 text-ink-soft whitespace-nowrap">
                  {execCase ? <>Green marks: lines test {execCase.id} ran <button className="link ml-1" onClick={() => setExecFor(null)}>clear</button></>
                    : <><span className="inline-block w-3 h-3 align-[-1px] bg-marker mr-1.5 border border-marker-strong rounded-[2px]" />cited by this rule</>}
                </span>
              </div>
              <div className="h-[70vh]">
                <SourceView file={shownFile} spans={spans} active={activeClause?.source ?? null}
                  executed={execCase && shownFile === progFile ? execCase.executed_lines : undefined} />
              </div>
            </section>
          </div>

          <div className="mt-8 max-w-[1000px]" id="checks">
            <ChecksBox checks={[
                { name: "Sourced", state: sourced ? "pass" : "fail", result: `${passedClauses} of ${plural(allClauses.length, "sentence")} backed by their lines`,
                  detail: attempts > 1 ? "Passed after one retry. Open any sentence below to see the evidence." : "Open any sentence below to see the evidence." },
                { name: "Rebuilt", state: fns.length ? "pass" : "pending", result: fns.length ? "Written in Python from the rule alone" : "Not yet",
                  detail: fns.length ? `As ${fns.join(", ")}. The AI that wrote it never saw the COBOL.` : "Only sourced rules are rebuilt." },
                { name: "Tested", state: !rule.tests_total ? "pending" : testsOk ? "pass" : "fail",
                  result: rule.tests_total ? `${rule.tests_passed} of ${plural(rule.tests_total, "test")} match the original` : "No tests yet",
                  detail: "The original COBOL and the Python rebuild ran on the same inputs.",
                  action: rule.tests_total ? <button className="link text-[13px]" onClick={() => setTab("tests")}>View tests</button> : undefined },
                { name: "Signed off", state: signedOff ? "approved" : rejected ? "fail" : "pending",
                  result: signedOff ? `Approved by ${rule.review.by ?? rule.edit?.divergence?.by}` : rejected ? `Rejected by ${rule.review.by}` : "Review required",
                  detail: signedOff || rejected ? (rule.review.note ? `“${rule.review.note}”` : "Recorded in the history.") : "Read the rule beside its code, then approve or reject it here." },
              ]} footer={<ReviewBox rule={rule} onChange={setRule} />} />
          </div>
        </>
      )}

      {tab === "tests" && (
        <div className="mt-6 grid gap-6">
          {rule.sample && (
            <section className="box" aria-label="CardDemo's own data">
              <div className="flex items-start gap-3 px-4 py-3.5">
                <span className="mt-[3px]"><StateIcon state={rule.sample.match ? "pass" : "fail"} /></span>
                <div>
                  <div className="font-semibold flex items-center gap-2"><Database className="text-ink-soft" />CardDemo&apos;s own data, whole program:{" "}
                    <span className={rule.sample.match ? "text-verified font-normal" : "text-rejected font-normal"}>{rule.sample.match ? "identical results" : differ(rule.sample.difference_count)}</span></div>
                  <p className="text-[13px] text-ink-soft mt-0.5">{Object.entries(rule.sample.files).map(([f, v]) => `${v.legacy_records} ${fileName(f)}`).join(", ")}. This data was not written from the rules, so it can catch behavior they missed. It covers the whole program, not just this rule.</p>
                  {!rule.sample.match && <div className="mt-2"><DiffTable diffs={rule.sample.differences.slice(0, 12)} total={rule.sample.difference_count} /></div>}
                </div>
              </div>
            </section>
          )}
          <section className="box" aria-label="Tests">
            <div className="box-header">
              <div className="flex items-center gap-2">
                <StateIcon state={!rule.tests_total ? "pending" : testsOk ? "pass" : "fail"} />
                <h2 className="font-semibold">{rule.tests_total ? `${rule.tests_passed} of ${plural(rule.tests_total, "test")} match the original COBOL` : "No tests yet"}</h2>
              </div>
              <p className="text-[13px] text-ink-soft mt-1">Each test feeds the same input files to the unchanged COBOL and to the Python rebuild, then compares every output field. Clock timestamps are ignored.</p>
            </div>
            {rule.cases.length === 0 && <p className="px-4 py-4 text-ink-soft">Tests are written only for rules whose sentences all passed the source check.</p>}
            <ul>
              {rule.cases.map((c) => (
                <CaseRow key={c.id} c={c} open={openCase === c.id} onToggle={() => setOpenCase(openCase === c.id ? null : c.id)}
                  onShowLines={() => { setExecFor(c.id); setFile(progFile); setTab("rule"); }} />
              ))}
            </ul>
          </section>
        </div>
      )}

      {tab === "history" && <Timeline rule={rule} />}
    </div>
  );
}

function SideItem({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-rule pb-4">
      <h3 className="text-[12.5px] font-semibold text-ink-soft mb-1.5">{title}</h3>
      {children}
    </section>
  );
}

function RetryNote({ rule }: { rule: Rule }) {
  const first = rule.verification.attempts[0];
  return (
    <details className="text-[13px] text-ink-soft border-t border-rule px-4 py-3">
      <summary className="cursor-pointer">The first draft failed the source check on {plural(first.failures.length, "sentence")} and was sent back once</summary>
      <ul className="mt-1 list-disc ml-5">
        {first.clauses.filter((c) => !c.passed).map((c) => (
          <li key={c.clause}><span className="font-mono text-[12px]">{c.clause}</span>: {c.deterministic.errors.join("; ") || c.judge?.reason}</li>
        ))}
      </ul>
    </details>
  );
}

function CaseRow({ c, open, onToggle, onShowLines }: { c: CaseResult; open: boolean; onToggle: () => void; onShowLines: () => void }) {
  return (
    <li className="box-row">
      <button onClick={onToggle} aria-expanded={open} className="w-full text-left grid grid-cols-[16px_1fr_auto] gap-3 px-4 py-3 hover:bg-sheet items-start">
        <span className="mt-[3px]"><Tick ok={c.match} /></span>
        <span className="min-w-0">
          <span className="block font-medium">{c.title} <span className="font-mono text-[12px] text-ink-soft font-normal">{c.id}</span></span>
          <span className="block text-[13px] text-ink-soft">{c.condition}</span>
        </span>
        <span className={`text-[13px] whitespace-nowrap ${c.match ? "text-verified" : "text-rejected"}`}>{c.match ? "Same result" : differ(c.difference_count)}</span>
      </button>
      {open && (
        <div className="pl-[44px] pr-4 pb-4 grid gap-3 text-[13.5px]">
          <p className="text-ink-soft">What the test writer expected (for reference only; the comparison decides pass or fail): {c.expectation}</p>
          <div className="overflow-x-auto">
            <table className="text-[13px] w-full max-w-[680px]">
              <thead><tr className="text-ink-soft text-left border-b border-rule"><th className="font-medium py-1.5 pr-4">Output</th><th className="font-medium pr-4">Original COBOL</th><th className="font-medium pr-4">Python rebuild</th><th className="font-medium">Differences</th></tr></thead>
              <tbody>
                <tr className="border-b border-rule"><td className="py-1.5 pr-4">How the run ended</td><td className="pr-4">{outcomeText(c.outcome.legacy)}</td><td className="pr-4">{outcomeText(c.outcome.port)}</td><td>{c.outcome.legacy === c.outcome.port ? <span className="text-ink-soft">none</span> : <span className="text-rejected">differs</span>}</td></tr>
                {Object.entries(c.files).map(([f, v]) => (
                  <tr key={f} className="border-b border-rule"><td className="py-1.5 pr-4">{fileName(f)}</td><td className="pr-4">{plural(v.legacy_records, "record")}</td><td className="pr-4">{plural(v.port_records, "record")}</td><td className={v.differences ? "text-rejected" : "text-ink-soft"}>{v.differences || "none"}{v.masked.length ? <span className="text-ink-soft"> (timestamps ignored)</span> : null}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          {!c.match && <DiffTable diffs={c.differences} total={c.difference_count} />}
          <OutputPeek c={c} />
          <div className="flex gap-4 flex-wrap">
            <button onClick={onShowLines} className="link">Show the {c.executed_lines.length} COBOL lines this test ran</button>
            <details><summary className="cursor-pointer link">Input records</summary>
              <pre className="mt-2 text-[12px] font-mono bg-sheet border border-rule rounded-md p-2 overflow-x-auto max-h-[300px]">{JSON.stringify(Object.fromEntries(Object.entries(c.fixture).map(([f, recs]) => [f, recs.map((r) => Object.fromEntries(r.values.map((v) => [v.field, v.value])))])), null, 1)}</pre>
            </details>
          </div>
        </div>
      )}
    </li>
  );
}

function OutputPeek({ c }: { c: CaseResult }) {
  const names = Object.keys(c.files).filter((f) => (c.legacy.files[f]?.length ?? 0) + (c.port.files[f]?.length ?? 0) > 0);
  const [f, setF] = useState(names[0] ?? "");
  if (!f) return null;
  const L = c.legacy.files[f] ?? [], P = c.port.files[f] ?? [];
  const diffFields = new Set(c.differences.filter((d) => d.file === f).map((d) => `${d.record}:${d.field}`));
  const cols = Object.keys(L[0] ?? P[0] ?? {}).slice(0, 40);
  return (
    <details>
      <summary className="cursor-pointer link">Output records, original and rebuild side by side</summary>
      <div className="flex gap-1.5 mt-2 text-[12.5px]">{names.map((n) => <button key={n} onClick={() => setF(n)} className={`px-2 h-6 rounded-md border ${n === f ? "border-ink-soft bg-sheet" : "border-rule text-ink-soft"}`}>{fileName(n)}</button>)}</div>
      <div className="overflow-x-auto mt-2 border border-rule rounded-md max-h-[340px]">
        <table className="text-[12px] font-mono whitespace-pre">
          <thead className="bg-sheet sticky top-0"><tr><th className="px-2 py-1 text-left font-medium text-ink-soft">#</th><th className="px-2 text-left font-medium text-ink-soft">side</th>{cols.map((k) => <th key={k} className="px-2 text-left font-medium text-ink-soft">{k}</th>)}</tr></thead>
          <tbody>
            {Array.from({ length: Math.max(L.length, P.length) }).flatMap((_, i) => [
              <tr key={`l${i}`} className="border-t border-rule"><td className="px-2">{i}</td><td className="px-2 text-ink-soft">original</td>{cols.map((k) => <td key={k} className={`px-2 ${diffFields.has(`${i}:${k}`) ? "bg-rejected-wash" : ""}`}>{fmt(L[i]?.[k])}</td>)}</tr>,
              <tr key={`p${i}`}><td className="px-2"></td><td className="px-2 text-ink-soft">rebuild</td>{cols.map((k) => <td key={k} className={`px-2 ${diffFields.has(`${i}:${k}`) ? "bg-rejected-wash" : ""}`}>{fmt(P[i]?.[k])}</td>)}</tr>,
            ])}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function fmt(v: unknown) {
  if (v === undefined) return "—";
  if (typeof v === "string") return v.replace(/\s+$/, "") || "␠";
  return JSON.stringify(v);
}

// Sits in the checks box footer, like the review controls in a pull request's merge box.
function ReviewBox({ rule, onChange }: { rule: Rule; onChange: (r: Rule) => void }) {
  const [by, setBy] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  async function decide(decision: string) {
    setErr(null);
    try { onChange(await post<Rule>(`/api/rules/${rule.id}/review`, { decision, by, note: note || null })); setNote(""); }
    catch (e) { setErr(String(e)); }
  }
  const rv = rule.review;
  if (rv.decision) {
    return (
      <div className="px-4 py-3 bg-sheet rounded-b-lg flex items-center gap-3 flex-wrap text-[13.5px]" id="review">
        <StatusMark status={rv.decision} />
        <span>by <span className="font-medium">{rv.by}</span> on {rv.at?.replace("T", " ").slice(0, 16)}{rv.note ? `: “${rv.note}”` : ""}</span>
        <button onClick={() => decide("clear")} className="ml-auto link text-[13px]">Clear decision</button>
      </div>
    );
  }
  return (
    <div className="px-4 py-4 bg-sheet rounded-b-lg" id="review">
      <div className="font-semibold">Sign off on this rule</div>
      <p className="text-[13px] text-ink-soft">Approve it if it matches what the business intends; reject it if it doesn&apos;t. Your name and note go in the history.</p>
      <div className="mt-3 grid sm:grid-cols-[220px_1fr] gap-2 max-w-[760px]">
        <input value={by} onChange={(e) => setBy(e.target.value)} className="field" placeholder="Your name" aria-label="Your name" />
        <input value={note} onChange={(e) => setNote(e.target.value)} className="field" placeholder="Why you approve or reject (optional)" aria-label="Note" />
      </div>
      <div className="mt-3 flex gap-2">
        <button disabled={!by.trim()} onClick={() => decide("approved")} className="btn btn-primary">Approve rule</button>
        <button disabled={!by.trim()} onClick={() => decide("rejected")} className="btn btn-danger">Reject rule</button>
      </div>
      {err && <p className="text-rejected text-[13px] mt-2">{err}</p>}
    </div>
  );
}

// GitHub-style timeline: one event per line, newest last.
function Timeline({ rule }: { rule: Rule }) {
  const events = [
    ...rule.status_history.map((h) => ({ who: h.by, what: h.why, status: h.status as string, at: "" })),
    ...rule.review_history.map((h) => ({ who: h.by ?? "system", what: `${h.event.replace("review:", "review ")}${h.note ? `: “${h.note}”` : ""}`, status: h.event.includes("approved") ? "approved" : h.event.includes("rejected") ? "rejected" : h.event.includes("diverg") ? "diverged" : "stale", at: h.at.slice(0, 16).replace("T", " ") })),
  ];
  return (
    <ol className="mt-6 relative max-w-[860px]">
      <span aria-hidden className="absolute left-[15px] top-2 bottom-2 w-[2px] bg-rule" />
      {events.map((e, i) => (
        <li key={i} className="relative grid grid-cols-[32px_1fr] gap-3 py-2.5 items-start">
          <span className="relative z-10 h-8 w-8 rounded-full bg-sheet border border-rule flex items-center justify-center">
            <StateIcon state={e.status === "verified" || e.status === "traced" ? "pass" : e.status === "flagged" || e.status === "rejected" ? "fail" : e.status === "approved" ? "approved" : e.status === "diverged" ? "changed" : "pending"} />
          </span>
          <div className="pt-1.5 text-[14px]">
            <span className="font-semibold">{e.who}</span> <span className="text-ink-soft">{e.what}</span>
            {e.at && <span className="text-[12.5px] text-ink-soft"> at {e.at}</span>}
            <span className="ml-2 align-middle"><StatusMark status={e.status} /></span>
          </div>
        </li>
      ))}
    </ol>
  );
}
