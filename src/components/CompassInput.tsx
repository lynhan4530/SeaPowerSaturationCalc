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
        className="w-16 rounded border border-panelBorder bg-navy px-2 py-1 text-right text-sm text-textPrimary outline-none focus:border-greenAccent"
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
          fill="#0A0F1E"
          stroke="#1F2937"
          strokeWidth={1}
        />
        <text x={cx} y={labelFont + 1} textAnchor="middle" fontSize={labelFont} fill="#9CA3AF">
          N
        </text>
        <text x={size - labelFont * 0.5} y={cy + labelFont * 0.35} textAnchor="end" fontSize={labelFont} fill="#9CA3AF">
          E
        </text>
        <text x={cx} y={size - 2} textAnchor="middle" fontSize={labelFont} fill="#9CA3AF">
          S
        </text>
        <text x={labelFont * 0.5} y={cy + labelFont * 0.35} textAnchor="start" fontSize={labelFont} fill="#9CA3AF">
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
