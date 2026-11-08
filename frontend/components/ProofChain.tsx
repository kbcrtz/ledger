// The four checkpoints every rule passes, in order. Used for the whole run on the
// home page and for a single rule on its detail page.

export type Step = {
  title: string;
  value: string;      // e.g. "12 of 12 rules" or "5 of 5 tests match"
  detail: string;     // one plain sentence: what this checkpoint means
  state: "done" | "partial" | "todo";
  href?: string;
};

const RING: Record<Step["state"], string> = {
  done: "bg-verified text-white border-verified",
  partial: "bg-sheet text-flagged border-flagged",
  todo: "bg-sheet text-ink-soft border-rule",
};

export default function ProofChain({ steps, compact = false }: { steps: Step[]; compact?: boolean }) {
  return (
    <ol className={`grid gap-y-5 ${compact ? "sm:grid-cols-4" : "md:grid-cols-4"}`}>
      {steps.map((s, i) => (
        <li key={s.title} className="relative pr-5">
          {/* connector to the next step */}
          {i < steps.length - 1 && (
            <span aria-hidden className={`hidden ${compact ? "sm:block" : "md:block"} absolute top-[15px] left-[38px] right-0 h-px ${s.state === "done" ? "bg-verified" : "bg-rule"}`} />
          )}
          <span aria-hidden className={`relative z-10 inline-flex h-[31px] w-[31px] items-center justify-center rounded-full border-2 text-[14px] font-semibold ${RING[s.state]}`}>
            {s.state === "done" ? "✓" : i + 1}
          </span>
          <div className={`mt-2.5 font-serif font-semibold leading-tight ${compact ? "text-[17px]" : "text-[20px]"}`}>{s.title}</div>
          <div className={`mt-1 ${compact ? "text-[14px]" : "text-[15.5px]"} ${s.state === "done" ? "text-verified" : s.state === "partial" ? "text-flagged" : "text-ink-soft"}`}>
            {s.href ? <a href={s.href} className="underline underline-offset-2 decoration-rule hover:decoration-current">{s.value}</a> : s.value}
          </div>
          <p className={`mt-1 text-ink-soft max-w-[34ch] break-words ${compact ? "text-[12.5px] leading-snug" : "text-[13.5px] leading-snug"}`}>{s.detail}</p>
        </li>
      ))}
    </ol>
  );
}

export function stateOf(n: number, total: number): Step["state"] {
  return total > 0 && n === total ? "done" : n > 0 ? "partial" : "todo";
}
