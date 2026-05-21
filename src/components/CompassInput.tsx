type Props = {
  value: number;
  onChange: (deg: number) => void;
  size?: number;
  label?: string;
};

const clamp = (v: number): number => {
  if (!Number.isFinite(v)) return 0;
  return ((Math.round(v) % 360) + 360) % 360;
};

export function CompassInput({ value, onChange, size = 56, label }: Props) {
  const normalized = clamp(value);
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 2;
  const rad = (normalized * Math.PI) / 180;
  const arrowX = cx + Math.sin(rad) * (r - 6);
  const arrowY = cy - Math.cos(rad) * (r - 6);
  const labelFont = Math.max(8, Math.floor(size * 0.18));

  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        min={0}
        max={359}
        value={normalized}
        onChange={(e) => onChange(clamp(Number(e.target.value)))}
        aria-label={label ?? 'Bearing'}
        className="w-16 rounded border border-panelBorder bg-navy px-2 py-1 text-right font-mono text-sm text-textPrimary outline-none focus:border-skyAccent focus:ring-1 focus:ring-skyAccent/20"
      />
      <span className="text-xs text-textSecondary">&deg;</span>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="shrink-0"
      >
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="#070C14"
          stroke="#1E2E4A"
          strokeWidth={1}
        />
        <text x={cx} y={labelFont + 1} textAnchor="middle" fontSize={labelFont} fill="#8195AE">
          N
        </text>
        <text x={size - labelFont * 0.5} y={cy + labelFont * 0.35} textAnchor="end" fontSize={labelFont} fill="#8195AE">
          E
        </text>
        <text x={cx} y={size - 2} textAnchor="middle" fontSize={labelFont} fill="#8195AE">
          S
        </text>
        <text x={labelFont * 0.5} y={cy + labelFont * 0.35} textAnchor="start" fontSize={labelFont} fill="#8195AE">
          W
        </text>
        <line
          x1={cx}
          y1={cy}
          x2={arrowX}
          y2={arrowY}
          stroke="#F59E0B"
          strokeWidth={2}
          strokeLinecap="round"
        />
        <circle cx={arrowX} cy={arrowY} r={2.5} fill="#F59E0B" />
      </svg>
    </div>
  );
}
