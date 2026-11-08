// GitHub-style checks box: a summary header and one row per check, in order.
import { StateIcon } from "./Status";

export type Check = {
  name: string;
  state: "pass" | "fail" | "pending" | "approved";
  result: string;       // short outcome, e.g. "12 of 12 rules"
  detail: string;       // one plain sentence: what the check means
  href?: string;
  action?: React.ReactNode;
};

export default function ChecksBox({ checks, title, footer }: { checks: Check[]; title?: string; footer?: React.ReactNode }) {
  const passed = checks.filter((c) => c.state === "pass" || c.state === "approved").length;
  const failed = checks.filter((c) => c.state === "fail").length;
  const pending = checks.length - passed - failed;
  const headState = failed ? "fail" : pending ? "pending" : "pass";
  const headline = failed ? `${failed} of ${checks.length} checks failed`
    : pending ? `${passed} of ${checks.length} checks passed` : `All ${checks.length} checks passed`;
  const sub = failed ? "A person should read this rule before it is used."
    : pending ? checks.find((c) => c.state === "pending")?.name === "Signed off" ? "Waiting for a person to sign off." : "Some checks have not run yet."
    : "Sourced, rebuilt, tested and signed off.";
  return (
    <section className="box" aria-label={title ?? "Checks"}>
      <div className="flex items-start gap-3 px-4 py-3.5 border-b border-rule">
        <span className="mt-0.5 scale-125 origin-top-left"><StateIcon state={headState} /></span>
        <div className="ml-1">
          <h2 className="text-[16px] font-semibold leading-tight">{title ? `${title}: ` : ""}{headline}</h2>
          <p className="text-[13px] text-ink-soft mt-0.5">{sub}</p>
        </div>
      </div>
      <ol>
        {checks.map((c, i) => (
          <li key={c.name} className="box-row grid grid-cols-[16px_1fr_auto] gap-x-3 items-start px-4 py-3">
            <span className="mt-[3px]"><StateIcon state={c.state} /></span>
            <div className="min-w-0">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-[12px] text-ink-soft font-mono" aria-hidden>{i + 1}</span>
                <span className="font-semibold">{c.name}</span>
                <span className={c.state === "pass" ? "text-verified" : c.state === "fail" ? "text-rejected" : c.state === "approved" ? "text-approved" : "text-flagged"}>
                  {c.href ? <a href={c.href} className="hover:underline underline-offset-2">{c.result}</a> : c.result}
                </span>
              </div>
              <p className="text-[13px] text-ink-soft mt-0.5 max-w-[70ch]">{c.detail}</p>
            </div>
            {c.action && <div className="self-center">{c.action}</div>}
          </li>
        ))}
      </ol>
      {footer && <div className="border-t border-rule">{footer}</div>}
    </section>
  );
}
