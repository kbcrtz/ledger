// Plain-language names used across the UI. One word per idea, everywhere.

export const PROGRAM_NAME: Record<string, string> = {
  CBTRN02C: "Daily transaction posting",
  CBACT04C: "Monthly interest",
};

export const PROGRAM_BLURB: Record<string, string> = {
  CBTRN02C: "Checks each day's card transactions, rejects the bad ones with a reason code, and posts the rest to account balances.",
  CBACT04C: "Works out each account's monthly interest by spending category and adds it to the balance.",
};

export const STATUS_LABEL: Record<string, string> = {
  verified: "Verified",
  traced: "Sourced",
  flagged: "Needs review",
  approved: "Signed off",
  rejected: "Rejected",
  diverged: "Changed on purpose",
  stale: "Out of date",
  extracted: "Drafted",
};

export const STATUS_HELP: Record<string, string> = {
  verified: "Every sentence is backed by its COBOL lines, and the Python rebuild matched the original on every test.",
  traced: "Every sentence is backed by its COBOL lines. Tests have not run yet.",
  flagged: "A check failed. A person should read this rule.",
  approved: "A person read the rule and signed off on it.",
  rejected: "A person read the rule and rejected it.",
  diverged: "A person changed this rule on purpose and approved the new behaviour.",
  stale: "The rule, its COBOL lines or its Python code changed since it was verified.",
  extracted: "Drafted by the AI, not checked yet.",
};

const FILE_NAME: Record<string, string> = {
  DALYREJS: "rejected transactions",
  TRANSACT: "transactions written",
  ACCOUNT: "accounts",
  TCATBAL: "category balances",
};

export function fileName(f: string) {
  return FILE_NAME[f] ?? f;
}

export function outcomeText(o: string) {
  const m = /^rc=(\d+)$/.exec(o);
  if (!m) return o;
  if (m[1] === "0") return "finished normally (code 0)";
  if (m[1] === "4") return "finished with rejects (code 4)";
  return `return code ${m[1]}`;
}

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

// Things Ledger found in the code. Each points at the rule sentence that states it;
// the sentence itself (with its cited lines) is the evidence.
export const FINDINGS: { rule: string; clause: string; headline: string }[] = [
  { rule: "BR-CBACT04C-002", clause: "then[3]", headline: "The last account in the file never gets its interest added." },
  { rule: "BR-CBTRN02C-004", clause: "then[1]", headline: "When a transaction is both over the limit and expired, only “expired” is recorded." },
  { rule: "BR-CBTRN02C-003", clause: "given[2]", headline: "The credit-limit check can silently drop digits on very large balances." },
  { rule: "BR-CBTRN02C-007", clause: "then[4]", headline: "Reason code 109 is set after a transaction has already been posted, so it is never acted on." },
];
