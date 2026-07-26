import type { LineDiff } from "@/lib/diff";

const OP_CLASS: Record<LineDiff[number]["op"], string> = {
  add: "bg-brand/15 text-foreground",
  del: "bg-destructive/10 text-destructive line-through",
  eq: "text-foreground",
};

const OP_PREFIX: Record<LineDiff[number]["op"], string> = {
  add: "+",
  del: "-",
  eq: " ",
};

export function VersionDiff({ diff }: { diff: LineDiff }) {
  return (
    <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-xl bg-muted p-3 font-mono text-caption leading-relaxed">
      {diff.map((line, i) => (
        <div key={i} className={`px-1 ${OP_CLASS[line.op]}`}>
          <span className="select-none text-muted-foreground">{OP_PREFIX[line.op]} </span>
          {line.text}
        </div>
      ))}
    </pre>
  );
}
