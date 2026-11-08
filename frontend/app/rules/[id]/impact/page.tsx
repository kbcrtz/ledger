"use client";
import Link from "next/link";
import { use, useEffect, useState } from "react";
import { get, post, Rule, Part } from "@/lib/api";
import { StatusMark, StateIcon } from "@/components/Status";
import DiffTable from "@/components/DiffTable";
import ProofChain from "@/components/ProofChain";
import { FileCode } from "@/components/Icons";
import { PROGRAM_NAME, differ, lineRange, plural } from "@/lib/labels";

const PARTS: Part[] = ["given", "when", "then"];
const LABEL: Record<Part, string> = { given: "Given", when: "When", then: "Then" };

export default function Impact({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [rule, setRule] = useState<Rule | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [by, setBy] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [divBy, setDivBy] = useState("");
  const [divNote, setDivNote] = useState("");

  function load(r: Rule) {
    setRule(r);
    const sc = r.edit?.scenario ?? r.scenario;
    const d: Record<string, string> = {};
    PARTS.forEach((p) => sc[p].forEach((c, i) => { d[`${p}[${i}]`] = c.text; }));
    setDraft(d);
  }
  useEffect(() => { get<Rule>(`/api/rules/${id}`).then(load).catch((e) => setErr(String(e))); }, [id]);

  if (!rule) return <div className="mx-auto max-w-[1600px] px-6 py-10 text-ink-soft">{err ?? `Loading ${id}…`}</div>;
  const edit = rule.edit;
  const rv = edit?.reverify;
  const imp = edit?.stale ?? rule.impact;
  const changedKeys = PARTS.flatMap((p) => rule.scenario[p].map((c, i) => ({ k: `${p}[${i}]`, p, i, before: c.text })))
    .filter((x) => draft[x.k] !== undefined && draft[x.k] !== x.before);
  const pendingChange = changedKeys.length > 0 && !edit;

  async function run(label: string, fn: () => Promise<Rule>) {
    setErr(null); setBusy(label);
    try { load(await fn()); } catch (e) { setErr(String(e)); } finally { setBusy(null); }
  }
  const saveEdit = () => run("Saving the change", () => post<Rule>(`/api/rules/${id}/edit`, {
    by, note: note || null, clauses: changedKeys.map((x) => ({ part: x.p, index: x.i, text: draft[x.k] })),
  }));
  const reverify = () => run("Rebuilding the Python code from the changed rule and re-running every test against the original COBOL", () => post<Rule>(`/api/rules/${id}/reverify`, {}));
  const approve = () => run("Recording your approval", () => post<Rule>(`/api/rules/${id}/approve-divergence`, { by: divBy, note: divNote }));
  const discard = () => run("Discarding the change", () => post<Rule>(`/api/rules/${id}/discard-edit`, {}));
  const stale = !!edit && !rv;
  const changedCases = rv ? Object.entries(rv.cases).filter(([, c]) => !c.match)
    .sort(([a], [b]) => Number(b.startsWith("SAMPLE-")) - Number(a.startsWith("SAMPLE-"))) : [];

  return (
    <div className="mx-auto max-w-[1600px] px-6 pt-6 pb-16">
      <div className="text-[13px] text-ink-soft">
        <Link href="/" className="link">Rules</Link> / {PROGRAM_NAME[rule.program] ?? rule.program} / <Link href={`/rules/${id}`} className="link font-mono text-[12.5px]">{id.replace("BR-", "")}</Link> / change
      </div>
      <div className="mt-2 flex items-center gap-3 flex-wrap">
        <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.015em]">Change what this rule does</h1>
        <StatusMark status={rule.status} large />
      </div>
      <p className="text-[15px] mt-1.5 max-w-[80ch]">{rule.title}</p>
      <p className="text-[14px] text-ink-soft mt-1 max-w-[80ch]">Modernizing means some behavior should change on purpose. Edit the rule, and Ledger shows what that touches, rebuilds the Python code, and re-runs every test so a person can approve the differences.</p>

      <div className="mt-6 box px-5 py-5">
        <ProofChain compact steps={[
          { title: "Edit", state: edit || pendingChange ? "done" : "todo", value: edit ? "Sentence changed" : pendingChange ? "Unsaved change" : "Not started", detail: "Rewrite a sentence to describe the behavior you want." },
          { title: "Save", state: edit ? "done" : "todo", value: edit ? `Saved by ${edit.by}` : "Not yet", detail: "Everything linked to the rule is marked out of date." },
          { title: "Rebuild and re-test", state: rv ? "done" : "todo", value: rv ? `${plural(rv.mismatch_count, "test")} now differ` : "Not yet", detail: "The Python code is rebuilt from the changed rule and every test runs again." },
          { title: "Approve", state: edit?.divergence ? "done" : "todo", value: edit?.divergence ? `By ${edit.divergence.by}` : "Not yet", detail: "A person accepts the differences as intended, with a reason." },
        ]} />
      </div>

      <div className="mt-6 grid lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] gap-6 items-start">
        <div className="grid gap-6 min-w-0">
          <section className="box" aria-label="Edit the rule">
            <div className="box-header flex items-center gap-2">
              <FileCode className="text-ink-soft" />
              <h2 className="font-semibold">Rule sentences</h2>
              <span className="font-mono text-[12px] text-ink-soft">{id.replace("BR-", "")}</span>
              {edit && <span className="ml-auto text-[12.5px] text-flagged">Locked while the change is pending</span>}
            </div>
            {PARTS.map((p) => (
              <div key={p}>
                <h3 className="px-4 pt-3 pb-1 font-semibold border-t border-rule first:border-t-0">{LABEL[p]}</h3>
                {(edit?.scenario ?? rule.scenario)[p].map((c, i) => {
                  const k = `${p}[${i}]`;
                  const changed = edit ? !!c.edited : draft[k] !== rule.scenario[p][i].text;
                  return (
                    <div key={k} className={`px-4 py-2 ${changed ? "bg-flagged-wash shadow-[inset_3px_0_0_var(--color-flagged)]" : ""}`}>
                      <textarea value={draft[k] ?? ""} disabled={!!edit} rows={Math.max(2, Math.ceil((draft[k]?.length ?? 0) / 80))}
                        onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} aria-label={`${LABEL[p]} sentence ${i + 1}`}
                        className="field !bg-transparent text-[15px] leading-[1.55] resize-y disabled:!border-transparent disabled:px-0" />
                      <div className="text-[12px] text-ink-soft mt-1 font-mono flex flex-wrap gap-x-3">
                        {[c.source, ...(c.also ?? [])].map((s, j) => <span key={j}>{lineRange(s.file, s.lines)}</span>)}
                      </div>
                      {changed && c.original_text && <div className="text-[12.5px] text-flagged mt-1">Was: “{c.original_text}”</div>}
                    </div>
                  );
                })}
              </div>
            ))}
          </section>

          {!edit ? (
            <section className="box" aria-label="Propose the change">
              <div className="box-header"><h2 className="font-semibold">Save the change</h2></div>
              <div className="px-4 py-4 grid gap-3 max-w-[640px]">
                <label className="grid gap-1 text-[13px] font-medium">Your name
                  <input value={by} onChange={(e) => setBy(e.target.value)} className="field font-normal" />
                </label>
                <label className="grid gap-1 text-[13px] font-medium">Why this change
                  <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="field font-normal" placeholder="For example: interest must post to every account, including the last one" />
                </label>
                <div className="flex items-center gap-3">
                  <button disabled={!pendingChange || !by.trim() || !!busy} onClick={saveEdit} className="btn btn-primary">Save change</button>
                  <span className="text-[13px] text-ink-soft">{!pendingChange ? "Edit a sentence above to start." : !by.trim() ? "Add your name to save." : `${plural(changedKeys.length, "sentence")} changed.`}</span>
                </div>
              </div>
            </section>
          ) : (
            <p className="text-[13.5px] text-ink-soft">Changed by <span className="text-ink font-medium">{edit.by}</span> at {edit.at.replace("T", " ").slice(0, 16)}{edit.note ? `: “${edit.note}”` : ""}.
              <button onClick={discard} disabled={!!busy} className="ml-3 link">Discard change</button></p>
          )}
        </div>

        <section className="box" aria-label="Connected to this rule">
          <div className="box-header">
            <h2 className="font-semibold">Connected to this rule</h2>
            <p className="text-[12.5px] text-ink-soft mt-0.5">{stale ? "All of this is out of date until you rebuild and re-test." : rv ? "Rebuilt and re-tested against the changed rule." : "Changing the rule affects everything listed here."}</p>
          </div>
          <div className="px-4 pb-4">
            <Group title="COBOL lines it cites" stale={stale}>
              {imp.lines.map((l, i) => <Item key={i} stale={stale}><span className="font-mono text-[12.5px]">{lineRange(l.file, l.lines)}</span></Item>)}
            </Group>
            <Group title="Data fields" stale={stale}><Item stale={stale}><span className="font-mono text-[12px] break-words">{imp.fields.join(", ")}</span></Item></Group>
            <Group title="Python functions" stale={stale}>
              {imp.port_functions.length ? imp.port_functions.map((f) => <Item key={f} stale={stale}><span className="font-mono text-[12.5px]">{f}</span></Item>) : <Item stale={false}>Not rebuilt yet</Item>}
            </Group>
            <Group title="Its own tests" stale={stale}><Item stale={stale}>{imp.tests_direct.join(", ") || "none"}</Item></Group>
            <Group title="Other tests that run these lines" stale={stale}>
              <Item stale={stale}>{imp.tests_executing_cited_lines.join(", ") || "none"}{imp.sample_executes_cited_lines ? ", plus CardDemo's own data" : ""}</Item>
            </Group>
            {imp.rules_sharing_lines.length > 0 && (
              <Group title="Other rules that cite the same lines" stale={false}>
                {imp.rules_sharing_lines.map((o) => <Item key={o.id} stale={false}><Link href={`/rules/${o.id}`} className="link font-mono text-[12.5px]">{o.id.replace("BR-", "")}</Link> {o.title}</Item>)}
              </Group>
            )}
            {edit && !rv && (
              <button onClick={reverify} disabled={!!busy} className="mt-4 btn btn-accent">Rebuild and re-test</button>
            )}
          </div>
        </section>
      </div>

      {busy && <p className="mt-6 text-[14px] text-accent flex items-center gap-2" role="status"><span className="h-2 w-2 rounded-full bg-accent-bright animate-pulse" />{busy}…</p>}
      {err && <p className="mt-4 text-[14px] text-rejected">{err}</p>}

      {rv && (
        <section className="mt-8 box" aria-label="What changed">
          <div className="box-header flex items-center gap-3 flex-wrap">
            <StateIcon state="changed" />
            <h2 className="font-semibold text-[15px]">{plural(rv.mismatch_count, "test")} now differ from the original COBOL</h2>
            <span className="text-[12.5px] text-ink-soft">Python rebuilt from the changed rule; every {PROGRAM_NAME[rule.program] ?? rule.program} test re-run at {rv.at.replace("T", " ").slice(0, 16)}</span>
            <button onClick={reverify} disabled={!!busy} className="ml-auto link text-[13px]">Run again</button>
          </div>
          <div className="px-4 py-4 grid md:grid-cols-3 gap-6 text-[13.5px] border-b border-rule">
            <div><div className="text-ink-soft">Tests that now differ</div><div className="text-[28px] font-semibold tracking-tight">{rv.mismatch_count}</div></div>
            <div><div className="text-ink-soft">Caused by this change</div><div className="text-[28px] font-semibold tracking-tight">{rv.changed_vs_baseline.length}</div></div>
            <div><div className="text-ink-soft">The changed sentences against the COBOL</div>
              <div className="mt-1.5">{rv.verifier.passed ? <span className="text-verified">Still what the COBOL does</span> : <span className="text-flagged">No longer what the COBOL does. That is expected: you changed the behavior.</span>}</div></div>
          </div>
          <ul>
            {changedCases.map(([cid, c]) => {
              const caused = rv.changed_vs_baseline.includes(cid);
              const accounts = cid.startsWith("SAMPLE-") ? Array.from(new Set(c.differences.map((d) => d.key))).filter(Boolean) : [];
              return (
                <li key={cid} className="box-row">
                  <details>
                    <summary className="cursor-pointer px-4 py-2.5 flex items-center gap-2.5 hover:bg-sheet text-[14px]">
                      <StateIcon state={caused ? "changed" : "fail"} />
                      {cid.startsWith("SAMPLE-") ? <span className="font-semibold">CardDemo&apos;s own data</span> : <span>Test <span className="font-mono text-[12.5px]">{cid}</span></span>}
                      <span className="text-ink-soft">{differ(c.difference_count)}{caused ? ", caused by this change" : ", already differed before the change"}{accounts.length ? ` (only ${accounts.map((k) => `account ${k}`).join(", ")})` : ""}</span>
                    </summary>
                    <div className="px-4 pb-3 pl-[42px]"><DiffTable diffs={c.differences} total={c.difference_count} /></div>
                  </details>
                </li>
              );
            })}
          </ul>
          <details className="border-t border-rule">
            <summary className="cursor-pointer px-4 py-2.5 link text-[14px]">What changed in the Python code</summary>
            <pre className="mx-4 mb-4 text-[12px] leading-[1.5] font-mono bg-paper border border-rule rounded-md p-3 overflow-x-auto max-h-[460px]">
              {rv.port_diff.split("\n").map((l, i) => <div key={i} className={l.startsWith("+") && !l.startsWith("+++") ? "bg-verified-wash text-[#aff5b4]" : l.startsWith("-") && !l.startsWith("---") ? "bg-rejected-wash text-[#ffdcd7]" : l.startsWith("@@") ? "text-accent" : ""}>{l || " "}</div>)}
            </pre>
          </details>

          <div className="border-t border-rule bg-sheet rounded-b-lg px-4 py-4">
            <h3 className="font-semibold">Approve the new behavior</h3>
            {edit?.divergence ? (
              <p className="mt-2 text-[14px] flex items-center gap-2 flex-wrap"><StatusMark status="diverged" /> by <span className="font-medium">{edit.divergence.by}</span> at {edit.divergence.at.replace("T", " ").slice(0, 16)}: “{edit.divergence.note}”</p>
            ) : (
              <div className="grid gap-2 mt-1 max-w-[760px]">
                <p className="text-[13px] text-ink-soft">The {plural(rv.mismatch_count, "difference")} will be recorded as intended, with your name and reason, instead of as failures.</p>
                <div className="grid sm:grid-cols-[220px_1fr] gap-2">
                  <input value={divBy} onChange={(e) => setDivBy(e.target.value)} className="field" placeholder="Your name" aria-label="Your name" />
                  <input value={divNote} onChange={(e) => setDivNote(e.target.value)} className="field" placeholder="Reason" aria-label="Reason" />
                </div>
                <button disabled={!divBy.trim() || !divNote.trim() || !!busy} onClick={approve} className="justify-self-start btn btn-accent">Approve the change</button>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function Group({ title, stale, children }: { title: string; stale: boolean; children: React.ReactNode }) {
  return (
    <div className="mt-3.5">
      <div className="text-[12.5px] font-semibold text-ink-soft flex gap-2">{title}{stale && <span className="text-flagged font-normal">out of date</span>}</div>
      <ul className="mt-1">{children}</ul>
    </div>
  );
}
function Item({ stale, children }: { stale: boolean; children: React.ReactNode }) {
  return <li className={`text-[13.5px] py-0.5 pl-2.5 border-l-2 ${stale ? "border-flagged" : "border-rule-strong"}`}>{children}</li>;
}
