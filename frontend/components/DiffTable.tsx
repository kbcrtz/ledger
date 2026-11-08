import { Diff } from "@/lib/api";

function show(v: unknown) {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v.replace(/\s+$/, "") || "(spaces)";
  if (typeof v === "object" && v && "invalid" in (v as object)) return `invalid: ${(v as { invalid: string }).invalid}`;
  return String(v);
}

export default function DiffTable({ diffs, total }: { diffs: Diff[]; total: number }) {
  return (
    <div className="overflow-x-auto">
      <table className="text-[13px] min-w-[560px]">
        <thead>
          <tr className="text-left text-ink-soft border-b border-rule">
            <th className="font-normal py-1 pr-4">File</th><th className="font-normal pr-4">Record</th>
            <th className="font-normal pr-4">Field</th><th className="font-normal pr-4">Original COBOL</th><th className="font-normal">Python rebuild</th>
          </tr>
        </thead>
        <tbody>
          {diffs.map((d, i) => (
            <tr key={i} className="border-b border-rule/60 align-top">
              <td className="py-1 pr-4">{d.file}</td>
              <td className="pr-4 text-ink-soft">{d.key ?? (d.record ?? "")}</td>
              <td className="pr-4 font-mono text-[12.5px]">{d.field}</td>
              <td className="pr-4 whitespace-pre-wrap font-mono text-[12.5px]">{show(d.legacy)}</td>
              <td className="whitespace-pre-wrap text-rejected font-mono text-[12.5px]">{show(d.port)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {total > diffs.length && <p className="text-[12.5px] text-ink-soft mt-1">{total - diffs.length} more not shown</p>}
    </div>
  );
}
