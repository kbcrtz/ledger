"use client";
import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import { get, post, Rule, Clause, Part, CaseResult, ClauseCheck } from "@/lib/api";
import SourceView from "@/components/SourceView";
import { StatusMark, Tick } from "@/components/Status";
import DiffTable from "@/components/DiffTable";

const PARTS: Part[] = ["given", "when", "then"];
const PART_LABEL: Record<Part, string> = { given: "Given", when: "When", then: "Then" };

export default function RuleDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [rule, setRule] = useState<Rule | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<{ part: Part; index: number } | null>(null);
  const [openCase, setOpenCase] = useState<string | null>(null);
  const [execFor, setExecFor] = useState<string | null>(null);
  const [file, setFile] = useState<string | null>(null);

  useEffect(() => { get<Rule>(`/api/rules/${id}`).then(setRule).catch((e) => setError(String(e))); }, [id]);

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

  return (
    <div className="mx-auto max-w-[1500px] px-5 py-6">
      <div className="text-[13px] text-ink-soft"><Link href="/" className="hover:text-ink">Rules</Link> / {rule.program}</div>
      <div className="mt-2 flex items-start gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[15px] font-medium">{rule.id}</span>
            <StatusMark status={rule.status} large />
            {rule.status !== rule.pipeline_status && <span className="text-[13px] text-ink-soft">pipeline status: {rule.pipeline_status}</span>}
          </div>
          <h1 className="font-serif text-[28px] leading-tight font-semibold mt-2 max-w-[48ch]">{rule.title}</h1>
          <p className="text-[14px] text-ink-soft mt-1.5 max-w-[90ch]">{rule.status_why}</p>
        </div>
        <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1 text-[13.5px] border-l border-rule pl-4">
          <dt className="text-ink-soft">Paragraph</dt><dd>{rule.paragraph}</dd>
          <dt className="text-ink-soft">Port function</dt><dd className="break-all">{rule.port_functions?.join(", ") || rule.port_function || "not ported"}</dd>
          <dt className="text-ink-soft">Cases</dt>
          <dd>{rule.tests_total ? <span className={rule.tests_passed === rule.tests_total ? "text-verified" : "text-flagged"}>{rule.tests_passed} of {rule.tests_total} match legacy</span> : "none (only traced rules get tests)"}</dd>
          <dt className="text-ink-soft">Citations</dt><dd>{attempts === 0 ? "not checked" : attempts === 1 ? "checked once" : "checked, then re-checked after one retry"}</dd>
          <dd className="col-span-2 pt-1"><Link href={`/rules/${rule.id}/impact`} className="text-traced hover:underline">Edit this rule and see its impact</Link></dd>
        </dl>
      </div>

      <div className="mt-6 grid lg:grid-cols-[minmax(0,44fr)_minmax(0,56fr)] gap-6">
        <section aria-label="Scenario" className="min-w-0">
          {PARTS.map((part) => (
            <div key={part} className="mb-5">
              <h2 className="font-serif text-[18px] font-semibold border-b border-ink pb-1">{PART_LABEL[part]}</h2>
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
                          <Tick ok={chk ? chk.passed : null} title={chk ? (chk.passed ? "citation and meaning verified" : "failed verification") : "not verified"} />
                        </span>
                        <span>
                          <span className="font-serif text-[16px] leading-[1.55] block">{c.text}</span>
                          <span className="text-[12.5px] text-ink-soft mt-1 flex flex-wrap gap-x-3">
                            {[c.source, ...(c.also ?? [])].map((s, k) => (
                              <span key={k} className="text-ink underline decoration-rule underline-offset-2">{s.file} {s.lines[0]}{s.lines[1] !== s.lines[0] ? `–${s.lines[1]}` : ""}</span>
                            ))}
                            {c.fields.length > 0 && <span>{c.fields.join(", ")}</span>}
                            {c.literals.length > 0 && <span>{c.literals.map((l) => `'${l}'`).join(", ")}</span>}
                          </span>
                        </span>
                      </button>
                      {isActive && chk && (
                        <div className="ml-[30px] mb-3 mr-2 text-[13px] grid gap-1">
                          <div><Tick ok={chk.deterministic.passed} /> Cited lines contain every listed field and literal
                            {chk.deterministic.errors.length > 0 && <ul className="text-rejected ml-4 list-disc">{chk.deterministic.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
                          </div>
                          {chk.judge && <div><Tick ok={chk.judge.supported} /> Judge: {chk.judge.reason}</div>}
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

        <section aria-label="COBOL source" className="min-w-0">
          <div className="lg:sticky lg:top-4">
            <div className="flex items-center gap-1 text-[13px] border-b border-rule">
              {files.map((f) => (
                <button key={f} onClick={() => setFile(f)}
                  className={`px-3 py-1.5 border-b-2 -mb-px ${shownFile === f ? "border-ink text-ink" : "border-transparent text-ink-soft hover:text-ink"}`}>{f}</button>
              ))}
              <span className="ml-auto text-ink-soft pr-1">
                {execCase ? <>Green ticks in the gutter: lines {execCase.id} executed <button className="underline ml-1" onClick={() => setExecFor(null)}>clear</button></> : "Highlighted: lines this rule cites"}
              </span>
            </div>
            <div className="h-[68vh] border border-t-0 border-rule bg-sheet">
              <SourceView file={shownFile} spans={spans} active={activeClause?.source ?? null}
                executed={execCase && shownFile === progFile ? execCase.executed_lines : undefined} />
            </div>
          </div>
        </section>
      </div>

      <section className="mt-8" aria-label="Test cases">
        <div className="flex items-baseline gap-4 border-b border-ink pb-1">
          <h2 className="font-serif text-[20px] font-semibold">Legacy against port</h2>
          <span className="text-[13.5px] text-ink-soft">Each case runs the unchanged COBOL under GnuCOBOL and the Python port on the same input files. Timestamps written from the clock are masked.</span>
        </div>
        {rule.cases.length === 0 && <p className="py-4 text-[14px] text-ink-soft">No generated cases. Tests are written only for rules whose every clause passed verification.</p>}
        <ul>
          {rule.cases.map((c) => (
            <CaseRow key={c.id} c={c} open={openCase === c.id} onToggle={() => setOpenCase(openCase === c.id ? null : c.id)}
              onShowLines={() => { setExecFor(c.id); setFile(progFile); }} />
          ))}
        </ul>
        {rule.sample && (
          <div className="mt-4 text-[14px] border border-rule bg-sheet px-4 py-3">
            <div className="flex gap-3 items-baseline flex-wrap">
              <span className="font-medium">CardDemo sample data, whole program</span>
              <span className={rule.sample.match ? "text-verified" : "text-flagged"}>
                {rule.sample.match ? "legacy and port match" : `${rule.sample.difference_count} difference${rule.sample.difference_count === 1 ? "" : "s"}`}
              </span>
              <span className="text-ink-soft">{Object.entries(rule.sample.files).map(([f, v]) => `${f}: ${v.legacy_records} records, ${v.differences} differing`).join("; ")}</span>
            </div>
            {!rule.sample.match && <div className="mt-2"><DiffTable diffs={rule.sample.differences.slice(0, 12)} total={rule.sample.difference_count} /></div>}
            <p className="text-[12.5px] text-ink-soft mt-2">Not generated from the rules, so it can expose behaviour the extractor missed. Reported per program, not counted toward a single rule.</p>
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
          {c.match ? "match" : `${c.difference_count} differing field${c.difference_count === 1 ? "" : "s"}`}
        </span>
      </button>
      {open && (
        <div className="pl-[34px] pr-2 pb-4 grid gap-3 text-[13.5px]">
          <p className="text-ink-soft">Rule expectation (a note, not the oracle): {c.expectation}</p>
          <table className="text-[13px] w-full max-w-[640px]">
            <thead><tr className="text-ink-soft text-left border-b border-rule"><th className="font-normal py-1">Output</th><th className="font-normal">Legacy COBOL</th><th className="font-normal">Python port</th><th className="font-normal">Differing fields</th></tr></thead>
            <tbody>
              <tr className="border-b border-rule/60"><td className="py-1">Run outcome</td><td>{c.outcome.legacy}</td><td>{c.outcome.port}</td><td>{c.outcome.legacy === c.outcome.port ? "" : <span className="text-rejected">differs</span>}</td></tr>
              {Object.entries(c.files).map(([f, v]) => (
                <tr key={f} className="border-b border-rule/60"><td className="py-1">{f}</td><td>{v.legacy_records} records</td><td>{v.port_records} records</td><td className={v.differences ? "text-rejected" : "text-ink-soft"}>{v.differences || "none"}{v.masked.length ? <span className="text-ink-soft"> (masked {v.masked.join(", ")})</span> : null}</td></tr>
              ))}
            </tbody>
          </table>
          {!c.match && <DiffTable diffs={c.differences} total={c.difference_count} />}
          <OutputPeek c={c} />
          <div className="flex gap-4">
            <button onClick={onShowLines} className="text-traced hover:underline">Show the {c.executed_lines.length} COBOL lines this case executed</button>
            <details><summary className="cursor-pointer text-traced">Input fixture</summary>
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
      <summary className="cursor-pointer text-traced">Output records side by side</summary>
      <div className="flex gap-2 mt-2 text-[12.5px]">{names.map((n) => <button key={n} onClick={() => setF(n)} className={`px-2 border rounded-sm ${n === f ? "border-ink" : "border-rule text-ink-soft"}`}>{n}</button>)}</div>
      <div className="overflow-x-auto mt-2 border border-rule max-h-[340px]">
        <table className="text-[12px] whitespace-pre">
          <thead className="bg-sheet sticky top-0"><tr><th className="px-2 py-1 text-left font-normal text-ink-soft">#</th><th className="px-2 text-left font-normal text-ink-soft">side</th>{cols.map((k) => <th key={k} className="px-2 text-left font-normal text-ink-soft">{k}</th>)}</tr></thead>
          <tbody>
            {Array.from({ length: Math.max(L.length, P.length) }).flatMap((_, i) => [
              <tr key={`l${i}`} className="border-t border-rule"><td className="px-2">{i}</td><td className="px-2 text-ink-soft">legacy</td>{cols.map((k) => <td key={k} className={`px-2 ${diffFields.has(`${i}:${k}`) ? "bg-[#f6dcd8]" : ""}`}>{fmt(L[i]?.[k])}</td>)}</tr>,
              <tr key={`p${i}`}><td className="px-2"></td><td className="px-2 text-ink-soft">port</td>{cols.map((k) => <td key={k} className={`px-2 ${diffFields.has(`${i}:${k}`) ? "bg-[#f6dcd8]" : ""}`}>{fmt(P[i]?.[k])}</td>)}</tr>,
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
    <section aria-label="Review">
      <h2 className="font-serif text-[20px] font-semibold border-b border-ink pb-1">Review</h2>
      {rv.decision ? (
        <p className="mt-3 text-[14.5px]">
          <StatusMark status={rv.decision} /> by <span className="font-medium">{rv.by}</span> on {rv.at?.replace("T", " ")}{rv.note ? `: “${rv.note}”` : ""}
          <button onClick={() => decide("clear")} className="ml-3 text-[13px] text-ink-soft underline">Clear decision</button>
        </p>
      ) : <p className="mt-3 text-[14px] text-ink-soft">No decision yet. A named reviewer approves or rejects the rule as written.</p>}
      <div className="mt-3 grid gap-2 max-w-[520px]">
        <label className="text-[13px] text-ink-soft">Reviewer
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
    <section aria-label="Audit trail">
      <h2 className="font-serif text-[20px] font-semibold border-b border-ink pb-1">Audit trail</h2>
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
