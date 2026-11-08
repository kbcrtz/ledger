export const API = process.env.NEXT_PUBLIC_LEDGER_API ?? "http://localhost:8000";

export async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${API}${path}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}

export async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!r.ok) {
    let msg = await r.text();
    try { msg = JSON.parse(msg).detail ?? msg; } catch {}
    throw new Error(msg);
  }
  return r.json();
}

export type Clause = {
  text: string;
  source: { file: string; lines: number[] };
  also?: { file: string; lines: number[] }[];
  fields: string[];
  literals: string[];
  edited?: boolean;
  original_text?: string;
};
export type Part = "given" | "when" | "then";
export type ClauseCheck = {
  clause: string;
  passed: boolean;
  deterministic: { passed: boolean; errors: string[] };
  judge: { supported: boolean; reason: string } | null;
};
export type Diff = { file: string; record: number | null; key: string | null; field: string; legacy: unknown; port: unknown };
export type CaseResult = {
  id: string;
  rule_id: string;
  title: string;
  condition: string;
  expectation: string;
  match: boolean;
  difference_count: number;
  differences: Diff[];
  files: Record<string, { legacy_records: number; port_records: number; differences: number; masked: string[] }>;
  outcome: { legacy: string; port: string };
  legacy: { files: Record<string, Record<string, unknown>[] | null>; counts: Record<string, number | null>; outcome: string };
  port: { files: Record<string, Record<string, unknown>[] | null>; counts: Record<string, number | null>; outcome: string };
  fixture: Record<string, { values: { field: string; value: string }[] }[]>;
  executed_lines: number[];
  warnings: string[];
};
export type RuleSummary = {
  id: string; title: string; program: string; paragraph: string; summary: string;
  status: string; status_why: string; pipeline_status: string;
  tests_passed: number; tests_total: number; port_function: string | null;
};
export type Edit = {
  by: string; note: string | null; at: string;
  scenario: Record<Part, Clause[]>;
  changes: { clause: string; before: string; after: string }[];
  stale: Impact;
  reverify: null | {
    module: string; mismatch_count: number; mismatched_cases: string[]; changed_vs_baseline: string[];
    port_diff: string; gaps: string[]; at: string;
    verifier: { passed: boolean; clauses: ClauseCheck[] };
    cases: Record<string, { match: boolean; difference_count: number; differences: Diff[]; rule_id: string | null; outcome: { legacy: string; port: string } }>;
  };
  divergence: null | { by: string; note: string; at: string; expected_mismatches: string[] };
};
export type Impact = {
  lines: { file: string; lines: number[] }[];
  fields: string[];
  tests_direct: string[];
  tests_executing_cited_lines: string[];
  sample_executes_cited_lines: boolean;
  port_functions: string[];
  rules_sharing_lines: { id: string; title: string; shared_lines: number[]; shared_fields: string[] }[];
};
export type Rule = RuleSummary & {
  scenario: Record<Part, Clause[]>;
  status_history: { status: string; why: string; by: string }[];
  verification: { attempts: { passed: boolean; clauses: ClauseCheck[]; failures: unknown[] }[] };
  port_functions?: string[];
  tests: string[];
  cases: CaseResult[];
  impact: Impact;
  review: { by: string | null; decision: string | null; note: string | null; at: string | null };
  review_history: { event: string; by?: string; note?: string | null; at: string }[];
  edit: Edit | null;
  sample: null | { match: boolean; difference_count: number; differences: Diff[]; files: CaseResult["files"]; outcome: { legacy: string; port: string } };
};
export type LogEvent = { ts: string; program: string | null; agent: string; step: string; message: string };
