type MatchScoreRingProps = {
  score: number; // 0..100
  size?: number;
};

export function MatchScoreRing({ score, size = 44 }: MatchScoreRingProps) {
  const value = Math.max(0, Math.min(100, Math.round(score)));
  const stroke = 4;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const dash = (value / 100) * circumference;
  const center = size / 2;

  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      aria-label={`Match score ${value} percent`}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="var(--muted)"
          strokeWidth={stroke}
        />
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="var(--brand)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-body font-semibold leading-none tabular-nums">{value}</span>
        <span className="mt-[1px] text-[10px] font-semibold leading-none text-muted-foreground">
          %
        </span>
      </div>
    </div>
  );
}
