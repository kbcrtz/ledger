"use client";
import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import { get, post, Rule, Clause, Part, CaseResult, ClauseCheck } from "@/lib/api";
import SourceView from "@/components/SourceView";
import { StatusMark, Tick } from "@/components/Status";
import DiffTable from "@/components/DiffTable";
import ProofChain, { stateOf } from "@/components/ProofChain";
import { PROGRAM_NAME, fileName, outcomeText, plural } from "@/lib/labels";

const PARTS: Part[] = ["given", "when", "then"];
const PART_LABEL: Record<Part, string> = { given: "Given", when: "When", then: "Then" };
const PART_HINT: Record<Part, string> = { given: "the starting situation", when: "what triggers the rule", then: "what the program does" };

export default function RuleDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [rule, setRule] = useState<Rule | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<{ part: Part; index: number } | null>(null);
  const [openCase, setOpenCase] = useState<string | null>(null);
  const [execFor, setExecFor] = useState<string | null>(null);
  const [file, setFile] = useState<string | null>(null);

  useEffect(() => { get<Rule>(`/api/rules/${id}`).then(setRule).catch((e) => setError(String(e))); }, [id]);

  // Deep link from the home page's findings: /rules/<id>?clause=then[3] opens that sentence.
  useEffect(() => {
    if (!rule) return;
    const m = /^(given|when|then)\[(\d+)\]$/.exec(new URLSearchParams(window.location.search).get("clause") ?? "");
    if (m && rule.scenario[m[1] as Part][Number(m[2])]) setActive({ part: m[1] as Part, index: Number(m[2]) });
  }, [rule]);

  const checks = useMemo(() => {
    const last = rule?.verification.attempts.at(-1);
    const m: Record<string, ClauseCheck> = {};
    last?.clauses.forEach((c) => { m[c.clause] = c; });
    return m;
  }, [rule]);

  if (error) return <div className="p-10 text-ink-soft">Could not load {id}: {error}</div>;
  if (!rule) return <div className="p-10 text-ink-soft">Loading {id}</div>;

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

  return (
    <div className="mx-auto max-w-[1500px] px-5 py-6">
      <div className="text-[13px] text-ink-soft"><Link href="/" className="hover:text-ink underline-offset-2 hover:underline">All rules</Link> / {PROGRAM_NAME[rule.program] ?? rule.program}</div>
      <div className="mt-3">
        <div className="min-w-0">
          <h1 className="font-serif text-[30px] leading-[1.18] font-semibold max-w-[40ch]">{rule.title}</h1>
          <p className="text-[16px] leading-relaxed mt-2.5 max-w-[72ch]">{rule.summary}</p>
          <div className="mt-3 flex items-center gap-3 flex-wrap text-[13px] text-ink-soft">
            <StatusMark status={rule.status} large />
            <span>Rule {rule.id.replace("BR-", "")}, from paragraph {rule.paragraph} of {rule.program}.cbl</span>
            <Link href={`/rules/${rule.id}/impact`} className="text-traced underline underline-offset-2 decoration-rule hover:decoration-current">Change this rule</Link>
          </div>
        </div>
        <div className="mt-6 border-t border-b border-rule py-5">
          <ProofChain compact steps={[
            { title: "Sourced", state: sourced ? "done" : "partial",
              value: `${passedClauses} of ${plural(allClauses.length, "sentence")} checked`,
              detail: attempts > 1 ? "Passed after one retry. Click a sentence to see why." : "Click a sentence to see why it passed." },
            { title: "Rebuilt", state: fns.length ? "done" : "todo",
              value: fns.length ? "In Python" : "Not yet", detail: fns.length ? `As ${fns.join(", ")}, written without seeing the COBOL.` : "Only sourced rules are rebuilt." },
            { title: "Tested", state: rule.tests_total ? stateOf(rule.tests_passed, rule.tests_total) : "todo", href: "#tests",
              value: rule.tests_total ? `${rule.tests_passed} of ${plural(rule.tests_total, "test")} match` : "No tests yet",
              detail: "Original COBOL and Python rebuild, same inputs." },
            { title: "Signed off", state: signedOff ? "done" : "todo", href: "#review",
              value: signedOff ? `By ${rule.review.by ?? rule.edit?.divergence?.by}` : "Not yet",
              detail: signedOff ? "A person approved this rule." : "Read the rule, then approve or reject it below." },
          ]} />
        </div>
      </div>

      <div className="mt-8 grid lg:grid-cols-[minmax(0,44fr)_minmax(0,56fr)] gap-6">
        <section aria-label="What the rule says" className="min-w-0">
          <div className="flex items-baseline gap-3 flex-wrap mb-3">
            <h2 className="font-serif text-[22px] font-semibold">What the rule says</h2>
            <span className="text-[13px] text-ink-soft">Click a sentence to see the COBOL it comes from.</span>
          </div>
          {PARTS.map((part) => (
            <div key={part} className="mb-5">
              <h3 className="border-b border-ink pb-1 flex items-baseline gap-2"><span className="font-serif text-[18px] font-semibold">{PART_LABEL[part]}</span><span className="text-[13px] text-ink-soft">{PART_HINT[part]}</span></h3>
              <ol>
                {rule.scenario[part].map((c, i) => {
                  const key = `${part}[${i}]`;
                  const chk = checks[key];
                  const isActive = active?.part === part && active.index === i;
                  return (
                    <li key={key} className={`border-b border-rule ${isActive ? "bg-marker/50" : ""}`}>
                      <button onClick={() => { setActive(isActive ? null : { part, index: i }); setFile(null); }}
                        className="w-full text-left grid grid-cols-[22px_1fr] gap-2 py-2.5 px-1 hover:bg-sheet">
                        <span className="pt-[3px] text-[15px]">
                          <Tick ok={chk ? chk.passed : null} title={chk ? (chk.passed ? "Backed by the cited COBOL lines" : "Not backed by the cited lines") : "Not checked"} />
                        </span>
                        <span>
                          <span className="font-serif text-[16px] leading-[1.55] block">{c.text}</span>
                          <span className="text-[12.5px] text-ink-soft mt-1 flex flex-wrap gap-x-3">
                            {[c.source, ...(c.also ?? [])].map((s, k) => (
                              <span key={k}>{s.file} {s.lines[1] !== s.lines[0] ? `lines ${s.lines[0]}–${s.lines[1]}` : `line ${s.lines[0]}`}</span>
                            ))}
                          </span>
                        </span>
                      </button>
                      {isActive && chk && (
                        <div className="ml-[30px] mb-3 mr-2 text-[13.5px] grid gap-1.5 border-l-2 border-marker-strong pl-3">
                          <div className="text-ink-soft">Why this sentence counts as sourced:</div>
                          <div><Tick ok={chk.deterministic.passed} /> The highlighted lines contain {[...c.fields, ...c.literals.map((l) => `'${l}'`)].join(", ") || "what it names"}.
                            {chk.deterministic.errors.length > 0 && <ul className="text-rejected ml-4 list-disc">{chk.deterministic.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
                          </div>
                          {chk.judge && <div><Tick ok={chk.judge.supported} /> An AI reviewer read only those lines and agreed: {chk.judge.reason}</div>}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
          {rule.notes && rule.notes.length > 0 && (
            <div className="mb-5">
              <h3 className="font-serif text-[18px] font-semibold border-b border-ink pb-1">Notes for the reviewer</h3>
              <p className="text-[12.5px] text-ink-soft mt-1">Observations no single line can prove, so they are not checked and not used to build the Python version.</p>
              <ul className="mt-1.5 list-disc ml-5 text-[14.5px] leading-[1.5] grid gap-1">
                {rule.notes.map((n, i) => <li key={i}>{n}</li>)}
              </ul>
            </div>
          )}
          {attempts > 1 && <RetryNote rule={rule} />}
        </section>

        <section aria-label="COBOL source" className="min-w-0">
          <div className="lg:sticky lg:top-4">
            <div className="flex items-center gap-1 text-[13px] border-b border-rule">
              {files.map((f) => (
                <button key={f} onClick={() => setFile(f)}
                  className={`px-3 py-1.5 border-b-2 -mb-px ${shownFile === f ? "border-ink text-ink" : "border-transparent text-ink-soft hover:text-ink"}`}>{f}</button>
              ))}
              <span className="ml-auto text-ink-soft pr-1">
                {execCase ? <>Green marks: lines test {execCase.id} ran <button className="underline ml-1" onClick={() => setExecFor(null)}>clear</button></> : <><span className="inline-block w-3 h-3 align-[-1px] bg-marker mr-1.5 border border-marker-strong" />lines this rule cites</>}
              </span>
            </div>
            <div className="h-[68vh] border border-t-0 border-rule bg-sheet">
              <SourceView file={shownFile} spans={spans} active={activeClause?.source ?? null}
                executed={execCase && shownFile === progFile ? execCase.executed_lines : undefined} />
            </div>
          </div>
        </section>
      </div>

      <section className="mt-10 scroll-mt-4" aria-label="Tests" id="tests">
        <div className="border-b border-ink pb-1.5">
          <h2 className="font-serif text-[22px] font-semibold">Tests: original COBOL against the Python rebuild</h2>
          <p className="text-[14px] text-ink-soft mt-0.5 max-w-[90ch]">Each test feeds the same input files to the unchanged COBOL and to the Python version built from the rules, then compares every output field. Clock timestamps are ignored.</p>
        </div>
        {rule.cases.length === 0 && <p className="py-4 text-[14px] text-ink-soft">No tests yet. Tests are written only for rules whose sentences all passed the source check.</p>}
        <ul>
          {rule.cases.map((c) => (
            <CaseRow key={c.id} c={c} open={openCase === c.id} onToggle={() => setOpenCase(openCase === c.id ? null : c.id)}
              onShowLines={() => { setExecFor(c.id); setFile(progFile); }} />
          ))}
        </ul>
        {rule.sample && (
          <div className="mt-4 text-[14px] border border-rule bg-sheet px-4 py-3">
            <div className="flex gap-3 items-baseline flex-wrap">
              <span className="font-medium">CardDemo&apos;s own data, whole program</span>
              <span className={rule.sample.match ? "text-verified" : "text-flagged"}>
                {rule.sample.match ? "✓ Identical results" : `${plural(rule.sample.difference_count, "field")} differ`}
              </span>
              <span className="text-ink-soft">{Object.entries(rule.sample.files).map(([f, v]) => `${v.legacy_records} ${fileName(f)}`).join(", ")}</span>
            </div>
            {!rule.sample.match && <div className="mt-2"><DiffTable diffs={rule.sample.differences.slice(0, 12)} total={rule.sample.difference_count} /></div>}
            <p className="text-[12.5px] text-ink-soft mt-2">This data was not written from the rules, so it can catch behavior they missed. It covers the whole program, not just this rule.</p>
          </div>
        )}
      </section>

      <div className="mt-8 grid md:grid-cols-2 gap-8">
        <ReviewBox rule={rule} onChange={setRule} />
        <Trail rule={rule} />
      </div>
    </div>
  );
}

function RetryNote({ rule }: { rule: Rule }) {
  const first = rule.verification.attempts[0];
  return (
    <details className="text-[13px] text-ink-soft border-l-2 border-flagged pl-3">
      <summary className="cursor-pointer">The first draft failed verification on {first.failures.length} clause(s) and was sent back to the extractor once</summary>
      <ul className="mt-1 list-disc ml-4">
        {first.clauses.filter((c) => !c.passed).map((c) => (
          <li key={c.clause}>{c.clause}: {c.deterministic.errors.join("; ") || c.judge?.reason}</li>
        ))}
      </ul>
    </details>
  );
}

function CaseRow({ c, open, onToggle, onShowLines }: { c: CaseResult; open: boolean; onToggle: () => void; onShowLines: () => void }) {
  return (
    <li className="border-b border-rule">
      <button onClick={onToggle} className="w-full text-left grid grid-cols-[22px_64px_1fr_auto] gap-3 py-2.5 px-1 hover:bg-sheet items-baseline">
        <Tick ok={c.match} />
        <span className="text-[13.5px] font-medium">{c.id}</span>
        <span className="text-[14.5px]">{c.title}<span className="block text-[12.5px] text-ink-soft">{c.condition}</span></span>
        <span className={`text-[13px] ${c.match ? "text-verified" : "text-rejected"}`}>
          {c.match ? "Same result" : `${plural(c.difference_count, "field")} differ`}
        </span>
      </button>
      {open && (
        <div className="pl-[34px] pr-2 pb-4 grid gap-3 text-[13.5px]">
          <p className="text-ink-soft">What the test writer expected (for reference only; the comparison decides pass or fail): {c.expectation}</p>
          <table className="text-[13px] w-full max-w-[640px]">
            <thead><tr className="text-ink-soft text-left border-b border-rule"><th className="font-normal py-1">Output</th><th className="font-normal">Original COBOL</th><th className="font-normal">Python rebuild</th><th className="font-normal">Differing fields</th></tr></thead>
            <tbody>
              <tr className="border-b border-rule/60"><td className="py-1">How the run ended</td><td>{outcomeText(c.outcome.legacy)}</td><td>{outcomeText(c.outcome.port)}</td><td>{c.outcome.legacy === c.outcome.port ? "" : <span className="text-rejected">differs</span>}</td></tr>
              {Object.entries(c.files).map(([f, v]) => (
                <tr key={f} className="border-b border-rule/60"><td className="py-1">{fileName(f)}</td><td>{v.legacy_records} records</td><td>{v.port_records} records</td><td className={v.differences ? "text-rejected" : "text-ink-soft"}>{v.differences || "none"}{v.masked.length ? <span className="text-ink-soft"> (timestamps ignored)</span> : null}</td></tr>
              ))}
            </tbody>
          </table>
          {!c.match && <DiffTable diffs={c.differences} total={c.difference_count} />}
          <OutputPeek c={c} />
          <div className="flex gap-4">
            <button onClick={onShowLines} className="text-traced hover:underline">Show the {c.executed_lines.length} COBOL lines this test ran</button>
            <details><summary className="cursor-pointer text-traced">Input records</summary>
              <pre className="mt-2 text-[12px] bg-sheet border border-rule p-2 overflow-x-auto max-h-[300px]">{JSON.stringify(Object.fromEntries(Object.entries(c.fixture).map(([f, recs]) => [f, recs.map((r) => Object.fromEntries(r.values.map((v) => [v.field, v.value])))])), null, 1)}</pre>
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
      <summary className="cursor-pointer text-traced">Output records, original and rebuild side by side</summary>
      <div className="flex gap-2 mt-2 text-[12.5px]">{names.map((n) => <button key={n} onClick={() => setF(n)} className={`px-2 border rounded-sm ${n === f ? "border-ink" : "border-rule text-ink-soft"}`}>{n}</button>)}</div>
      <div className="overflow-x-auto mt-2 border border-rule max-h-[340px]">
        <table className="text-[12px] whitespace-pre">
          <thead className="bg-sheet sticky top-0"><tr><th className="px-2 py-1 text-left font-normal text-ink-soft">#</th><th className="px-2 text-left font-normal text-ink-soft">side</th>{cols.map((k) => <th key={k} className="px-2 text-left font-normal text-ink-soft">{k}</th>)}</tr></thead>
          <tbody>
            {Array.from({ length: Math.max(L.length, P.length) }).flatMap((_, i) => [
              <tr key={`l${i}`} className="border-t border-rule"><td className="px-2">{i}</td><td className="px-2 text-ink-soft">original</td>{cols.map((k) => <td key={k} className={`px-2 ${diffFields.has(`${i}:${k}`) ? "bg-[#f6dcd8]" : ""}`}>{fmt(L[i]?.[k])}</td>)}</tr>,
              <tr key={`p${i}`}><td className="px-2"></td><td className="px-2 text-ink-soft">rebuild</td>{cols.map((k) => <td key={k} className={`px-2 ${diffFields.has(`${i}:${k}`) ? "bg-[#f6dcd8]" : ""}`}>{fmt(P[i]?.[k])}</td>)}</tr>,
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
  return (
    <section aria-label="Sign off" id="review" className="scroll-mt-4">
      <h2 className="font-serif text-[22px] font-semibold border-b border-ink pb-1">Sign off</h2>
      {rv.decision ? (
        <p className="mt-3 text-[14.5px]">
          <StatusMark status={rv.decision} /> by <span className="font-medium">{rv.by}</span> on {rv.at?.replace("T", " ")}{rv.note ? `: “${rv.note}”` : ""}
          <button onClick={() => decide("clear")} className="ml-3 text-[13px] text-ink-soft underline">Clear decision</button>
        </p>
      ) : <p className="mt-3 text-[14px] text-ink-soft max-w-[60ch]">Nobody has signed off yet. Read the rule beside its code, then approve it if it matches what the business intends, or reject it if it doesn&apos;t.</p>}
      <div className="mt-3 grid gap-2 max-w-[520px]">
        <label className="text-[13px] text-ink-soft">Your name
          <input value={by} onChange={(e) => setBy(e.target.value)} className="mt-1 w-full border border-rule bg-sheet px-2 py-1.5 text-[14px] text-ink" placeholder="Your name" />
        </label>
        <label className="text-[13px] text-ink-soft">Note
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="mt-1 w-full border border-rule bg-sheet px-2 py-1.5 text-[14px] text-ink" placeholder="Why you approve or reject" />
        </label>
        <div className="flex gap-2">
          <button disabled={!by.trim()} onClick={() => decide("approved")} className="px-3 py-1.5 bg-verified text-white text-[14px] rounded-sm disabled:opacity-40">Approve rule</button>
          <button disabled={!by.trim()} onClick={() => decide("rejected")} className="px-3 py-1.5 border border-rejected text-rejected text-[14px] rounded-sm disabled:opacity-40">Reject rule</button>
        </div>
        {err && <p className="text-rejected text-[13px]">{err}</p>}
      </div>
    </section>
  );
}

function Trail({ rule }: { rule: Rule }) {
  return (
    <section aria-label="History">
      <h2 className="font-serif text-[22px] font-semibold border-b border-ink pb-1">History</h2>
      <ol className="mt-2 text-[13.5px]">
        {rule.status_history.map((h, i) => (
          <li key={`s${i}`} className="py-1.5 border-b border-rule/60 grid grid-cols-[96px_1fr] gap-3">
            <StatusMark status={h.status} />
            <span><span className="text-ink-soft">{h.by}:</span> {h.why}</span>
          </li>
        ))}
        {rule.review_history.map((h, i) => (
          <li key={`r${i}`} className="py-1.5 border-b border-rule/60 grid grid-cols-[96px_1fr] gap-3">
            <span className="text-ink-soft">{h.at.slice(0, 16).replace("T", " ")}</span>
            <span>{h.event.replace("review:", "review: ")} by {h.by ?? "system"}{h.note ? `: “${h.note}”` : ""}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
