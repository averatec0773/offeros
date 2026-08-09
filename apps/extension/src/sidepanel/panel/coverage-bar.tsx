import type { Coverage } from "@offeros/autofill";

// Submit-readiness bar: required fields we have a value for / total.
export function CoverageBar({ coverage }: { coverage: Coverage }) {
  return (
    <div className="mb-3">
      <div className="mb-1 flex items-center justify-between text-caption">
        <span className="font-medium text-text-primary">
          {coverage.requiredBasis
            ? `${coverage.filled}/${coverage.total} required fields ready`
            : `${coverage.filled}/${coverage.total} fields ready`}
        </span>
        <span className="text-text-tertiary">{coverage.percent}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-bg-base">
        <div className="h-full rounded-full bg-brand" style={{ width: `${coverage.percent}%` }} />
      </div>
    </div>
  );
}
