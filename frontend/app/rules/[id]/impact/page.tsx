"use client";
import Link from "next/link";
import { use, useEffect, useState } from "react";
import { get, post, Rule, Part } from "@/lib/api";
import { StatusMark, Tick } from "@/components/Status";
import DiffTable from "@/components/DiffTable";

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

  if (!rule) return <div className="p-10 text-ink-soft">{err ?? `Loading ${id}`}</div>;
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
  const saveEdit = () => run("Saving the edit", () => post<Rule>(`/api/rules/${id}/edit`, {
    by, note: note || null, clauses: changedKeys.map((x) => ({ part: x.p, index: x.i, text: draft[x.k] })),
  }));
  const reverify = () => run("Re-verifying: regenerating the port from the edited rule and re-running every case against the COBOL", () => post<Rule>(`/api/rules/${id}/reverify`, {}));
  const approve = () => run("Recording the divergence", () => post<Rule>(`/api/rules/${id}/approve-divergence`, { by: divBy, note: divNote }));
  const discard = () => run("Discarding the edit", () => post<Rule>(`/api/rules/${id}/discard-edit`, {}));
  const stale = !!edit && !rv;

  return (
    <div className="mx-auto max-w-[1400px] px-5 py-6">
      <div className="text-[13px] text-ink-soft"><Link href="/" className="hover:text-ink">Rules</Link> / <Link href={`/rules/${id}`} className="hover:text-ink">{id}</Link> / change impact</div>
      <div className="mt-2 flex items-center gap-3 flex-wrap">
        <h1 className="font-serif text-[26px] font-semibold">Change a rule, see what it touches</h1>
        <StatusMark status={rule.status} large />
      </div>
      <p className="text-[14.5px] text-ink-soft mt-1 max-w-[95ch]">{rule.title}. {rule.status_why}</p>

      <div className="mt-6 grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-8">
        <section aria-label="Edit clauses">
          {PARTS.map((p) => (
            <div key={p} className="mb-4">
              <h2 className="font-serif text-[18px] font-semibold border-b border-ink pb-1">{LABEL[p]}</h2>
              {(edit?.scenario ?? rule.scenario)[p].map((c, i) => {
                const k = `${p}[${i}]`;
                const changed = edit ? !!c.edited : draft[k] !== rule.scenario[p][i].text;
                return (
                  <div key={k} className={`py-2 border-b border-rule ${changed ? "bg-marker/40" : ""}`}>
                    <textarea value={draft[k] ?? ""} disabled={!!edit} rows={Math.max(2, Math.ceil((draft[k]?.length ?? 0) / 78))}
                      onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
                      className="w-full font-serif text-[15.5px] leading-[1.5] bg-transparent border border-transparent focus:border-rule px-1 py-0.5 resize-y disabled:text-ink" />
                    <div className="text-[12px] text-ink-soft px-1">
                      {c.source.file} {c.source.lines.join("–")}
                      {changed && <span className="ml-2 text-stale">edited{c.original_text ? `, was: “${c.original_text}”` : ""}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
          {!edit && (
            <div className="grid gap-2 max-w-[560px]">
              <label className="text-[13px] text-ink-soft">Your name<input value={by} onChange={(e) => setBy(e.target.value)} className="mt-1 w-full border border-rule bg-sheet px-2 py-1.5 text-[14px] text-ink" /></label>
              <label className="text-[13px] text-ink-soft">Why this change<textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="mt-1 w-full border border-rule bg-sheet px-2 py-1.5 text-[14px] text-ink" /></label>
              <button disabled={!pendingChange || !by.trim() || !!busy} onClick={saveEdit} className="justify-self-start px-3 py-1.5 bg-ink text-white text-[14px] rounded-sm disabled:opacity-40">Save edit and mark linked items stale</button>
              {!pendingChange && <p className="text-[13px] text-ink-soft">Change a clause above to start.</p>}
            </div>
          )}
          {edit && (
            <p className="text-[13.5px]">Edited by <span className="font-medium">{edit.by}</span> at {edit.at.replace("T", " ")}{edit.note ? `: “${edit.note}”` : ""}.
              <button onClick={discard} disabled={!!busy} className="ml-3 text-ink-soft underline">Discard edit</button></p>
          )}
        </section>

        <section aria-label="Linked items">
          <h2 className="font-serif text-[18px] font-semibold border-b border-ink pb-1">Linked lines, tests and port code</h2>
          <p className="text-[13px] text-ink-soft mt-1">From the trace graph. {stale ? "Everything below is stale until the edit is re-verified." : rv ? "Re-verified against the edited rule; results below." : "These go stale when you save an edit."}</p>
          <Group title="Cited COBOL lines" stale={stale}>
            {imp.lines.map((l, i) => <Item key={i} stale={stale}>{l.file} {l.lines.join("–")}</Item>)}
          </Group>
          <Group title="Data names" stale={stale}><Item stale={stale}>{imp.fields.join(", ")}</Item></Group>
          <Group title="Port functions" stale={stale}>
            {imp.port_functions.length ? imp.port_functions.map((f) => <Item key={f} stale={stale}>{f}</Item>) : <Item stale={false}>not ported yet</Item>}
          </Group>
          <Group title="Tests generated from this rule" stale={stale}>
            <Item stale={stale}>{imp.tests_direct.join(", ") || "none"}</Item>
          </Group>
          <Group title="Other tests that execute these lines" stale={stale}>
            <Item stale={stale}>{imp.tests_executing_cited_lines.join(", ") || "none"}{imp.sample_executes_cited_lines ? "; CardDemo sample data" : ""}</Item>
          </Group>
          {imp.rules_sharing_lines.length > 0 && (
            <Group title="Rules citing the same lines" stale={false}>
              {imp.rules_sharing_lines.map((o) => <Item key={o.id} stale={false}><Link href={`/rules/${o.id}`} className="underline">{o.id}</Link> {o.title} (lines {o.shared_lines.slice(0, 6).join(", ")}{o.shared_lines.length > 6 ? "…" : ""})</Item>)}
            </Group>
          )}
          {edit && !rv && (
            <button onClick={reverify} disabled={!!busy} className="mt-4 px-3 py-1.5 bg-traced text-white text-[14px] rounded-sm disabled:opacity-40">Re-verify</button>
          )}
        </section>
      </div>

      {busy && <p className="mt-6 text-[14px] text-traced" role="status">{busy}…</p>}
      {err && <p className="mt-4 text-[14px] text-rejected">{err}</p>}

      {rv && (
        <section className="mt-8" aria-label="Re-verify results">
          <div className="flex items-baseline gap-4 border-b border-ink pb-1 flex-wrap">
            <h2 className="font-serif text-[20px] font-semibold">Re-verified {rv.at.replace("T", " ")}</h2>
            <span className="text-[13.5px] text-ink-soft">Port regenerated from the edited rule as {rv.module}; every case of {rule.program} re-run against the unchanged COBOL.</span>
            <button onClick={reverify} disabled={!!busy} className="ml-auto text-[13px] text-traced underline">Run again</button>
          </div>
          <div className="mt-3 grid md:grid-cols-3 gap-6 text-[14px]">
            <div><div className="text-ink-soft">Cases that now differ from legacy</div><div className="font-serif text-[26px]">{rv.mismatch_count}</div></div>
            <div><div className="text-ink-soft">Changed outcome compared with the verified port</div><div className="font-serif text-[26px]">{rv.changed_vs_baseline.length}</div><div className="text-[12.5px] text-ink-soft">{rv.changed_vs_baseline.join(", ")}</div></div>
            <div><div className="text-ink-soft">Edited clauses against their cited lines</div>
              <div className="mt-1">{rv.verifier.passed ? <span className="text-verified">still supported by the source</span> : <span className="text-stale">no longer what the COBOL does (expected for an intended change)</span>}</div></div>
          </div>
          <ul className="mt-4">
            {Object.entries(rv.cases).filter(([, c]) => !c.match).map(([cid, c]) => (
              <li key={cid} className="border-b border-rule py-2">
                <details>
                  <summary className="cursor-pointer text-[14px]"><Tick ok={false} /> {cid} {c.rule_id ? `(${c.rule_id})` : "(sample data)"}: {c.difference_count} differing field(s){rv.changed_vs_baseline.includes(cid) ? ", new since the edit" : ", already differed before the edit"}</summary>
                  <div className="mt-2 ml-5"><DiffTable diffs={c.differences} total={c.difference_count} /></div>
                </details>
              </li>
            ))}
          </ul>
          <details className="mt-4">
            <summary className="cursor-pointer text-[14px] text-traced">Port code change</summary>
            <pre className="mt-2 text-[12px] leading-[1.45] bg-sheet border border-rule p-3 overflow-x-auto max-h-[460px]">
              {rv.port_diff.split("\n").map((l, i) => <div key={i} className={l.startsWith("+") && !l.startsWith("+++") ? "bg-[#e3f1e6]" : l.startsWith("-") && !l.startsWith("---") ? "bg-[#f6dcd8]" : ""}>{l || " "}</div>)}
            </pre>
          </details>

          <div className="mt-6 max-w-[640px]">
            <h3 className="font-serif text-[18px] font-semibold">Approve as an intended divergence</h3>
            {edit?.divergence ? (
              <p className="mt-2 text-[14.5px]"><StatusMark status="diverged" /> Approved by <span className="font-medium">{edit.divergence.by}</span> at {edit.divergence.at.replace("T", " ")}: “{edit.divergence.note}”. Expected mismatches: {edit.divergence.expected_mismatches.join(", ")}.</p>
            ) : (
              <div className="grid gap-2 mt-2">
                <p className="text-[13.5px] text-ink-soft">The {rv.mismatch_count} differing case(s) will be recorded as expected mismatches, with your name and reason, instead of failures.</p>
                <label className="text-[13px] text-ink-soft">Approver<input value={divBy} onChange={(e) => setDivBy(e.target.value)} className="mt-1 w-full border border-rule bg-sheet px-2 py-1.5 text-[14px] text-ink" /></label>
                <label className="text-[13px] text-ink-soft">Reason<textarea value={divNote} onChange={(e) => setDivNote(e.target.value)} rows={2} className="mt-1 w-full border border-rule bg-sheet px-2 py-1.5 text-[14px] text-ink" /></label>
                <button disabled={!divBy.trim() || !divNote.trim() || !!busy} onClick={approve} className="justify-self-start px-3 py-1.5 bg-diverged text-white text-[14px] rounded-sm disabled:opacity-40">Approve divergence</button>
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
    <div className="mt-3">
      <div className="text-[13px] text-ink-soft flex gap-2">{title}{stale && <span className="text-stale">stale</span>}</div>
      <ul className="mt-1">{children}</ul>
    </div>
  );
}
function Item({ stale, children }: { stale: boolean; children: React.ReactNode }) {
  return <li className={`text-[13.5px] py-0.5 pl-2 border-l-2 ${stale ? "border-stale" : "border-rule"}`}>{children}</li>;
}
