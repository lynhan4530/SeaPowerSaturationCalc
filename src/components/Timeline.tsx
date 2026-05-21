import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useScenario } from '../hooks/useScenario';
import { solveGroup, type GroupResult, type InterceptResult } from '../lib/calc';
import {
  SHIP_PALETTE,
  formatClock,
  formatDuration,
  formatTime,
  pad3,
  parseHHMMSS,
} from '../lib/format';
import type { FriendlyShip, Missile, Scenario, TargetShip } from '../types';

// Layout constants (px).
const LEFT_GUTTER = 140;
const TOP_AXIS = 26;
const LANE_HEIGHT = 28;
const BAR_HEIGHT = 12;
const RIGHT_PAD = 16;

// Fixed phase colors (PRD): reposition amber, wait slate, flight sky.
const COLOR_REPOSITION = '#F59E0B';
const COLOR_WAIT = '#64748B';
const COLOR_FLIGHT = '#38BDF8';

// Phase label text fills (legible against each segment fill).
const TEXT_ON_REPOSITION = '#1A1206';
const TEXT_ON_WAIT = '#E6EDF7';
const TEXT_ON_FLIGHT = '#06283D';

const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v));

export function Timeline() {
  const { activeScenario, state } = useScenario();
  if (!activeScenario) return null;

  const hHourBase = activeScenario.hHour ? parseHHMMSS(activeScenario.hHour) : null;
  const shipColorById = new Map<string, string>(
    activeScenario.friendlyShips.map((s, i) => [
      s.id,
      SHIP_PALETTE[i % SHIP_PALETTE.length],
    ]),
  );

  const targetsWithSalvos = activeScenario.targetShips.filter((t) =>
    activeScenario.friendlyShips.some((sh) =>
      sh.salvos.some(
        (sv) =>
          sv.targetId === t.id &&
          state.missileLibrary.some((m) => m.id === sv.missileId),
      ),
    ),
  );

  return (
    <div className="space-y-4 p-4">
      <header className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-bold uppercase tracking-widest text-textSecondary">
          Timeline
        </h2>
        <Legend />
      </header>

      {targetsWithSalvos.length === 0 ? (
        <p className="text-sm italic text-textSecondary">
          No salvos to plot. Add a target and a salvo directed at it.
        </p>
      ) : (
        targetsWithSalvos.map((target) => (
          <TargetTimeline
            key={target.id}
            target={target}
            ships={activeScenario.friendlyShips}
            missiles={state.missileLibrary}
            scenario={activeScenario}
            hHourBase={hHourBase}
            shipColorById={shipColorById}
          />
        ))
      )}
      <p className="text-xs italic text-textSecondary">
        Wheel to zoom, drag empty space to pan. Hover a bar for details.
      </p>
    </div>
  );
}

function Legend() {
  const items = [
    { label: 'Reposition', color: COLOR_REPOSITION },
    { label: 'Wait', color: COLOR_WAIT },
    { label: 'Flight', color: COLOR_FLIGHT },
  ];
  return (
    <div className="flex items-center gap-3 font-mono text-xs uppercase tracking-wider text-textSecondary">
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1">
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: it.color }}
          />
          {it.label}
        </span>
      ))}
    </div>
  );
}

type TargetTimelineProps = {
  target: TargetShip;
  ships: FriendlyShip[];
  missiles: Missile[];
  scenario: Scenario;
  hHourBase: number | null;
  shipColorById: Map<string, string>;
};

type Tooltip = { x: number; y: number; lines: string[]; warn: boolean };

function TargetTimeline({
  target,
  ships,
  missiles,
  scenario,
  hHourBase,
  shipColorById,
}: TargetTimelineProps) {
  const missileById = useMemo(() => new Map(missiles.map((m) => [m.id, m])), [missiles]);
  const shipBySalvoId = useMemo(() => {
    const map = new Map<string, FriendlyShip>();
    for (const ship of ships) for (const s of ship.salvos) map.set(s.id, ship);
    return map;
  }, [ships]);

  const salvos = useMemo(
    () =>
      ships
        .flatMap((s) => s.salvos)
        .filter((sv) => sv.targetId === target.id && missileById.has(sv.missileId)),
    [ships, target.id, missileById],
  );

  const group: GroupResult | null = useMemo(
    () => (salvos.length === 0 ? null : solveGroup(ships, salvos, missiles, target, scenario)),
    [ships, salvos, missiles, target, scenario],
  );

  // Measure available width.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      setWidth(entries[0].contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const [zoom, setZoom] = useState<number | null>(null); // null = auto-fit
  const [panS, setPanS] = useState(0);
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);
  const dragRef = useRef<{ startX: number; startPan: number } | null>(null);

  // Namespaced <defs> ids — multiple <TargetTimeline> svgs share one document.
  const uid = useId().replace(/:/g, '');
  const repoGradId = `repo-${uid}`;
  const flightGradId = `flight-${uid}`;
  const glowId = `glow-${uid}`;

  if (!group) return null;

  const lanes = group.shipResults;
  const sync = group.synchronizedArrivalTimeS;
  const totalS = Math.max(sync, 1) * 1.05 + 5;
  const tolS = scenario.simultaneityToleranceS;

  const plotWidth = Math.max(width, LEFT_GUTTER + 80);
  const visiblePx = plotWidth - LEFT_GUTTER - RIGHT_PAD;
  const fitPx = clamp(visiblePx / totalS, 1, 20);
  const pxPerS = zoom ?? fitPx;
  const visibleSpanS = visiblePx / pxPerS;
  const maxPan = Math.max(0, totalS - visibleSpanS);
  const pan = clamp(panS, 0, maxPan);

  const height = TOP_AXIS + lanes.length * LANE_HEIGHT + (hHourBase !== null ? 18 : 6);
  const lanesBottom = TOP_AXIS + lanes.length * LANE_HEIGHT;

  const x = (t: number): number => LEFT_GUTTER + (t - pan) * pxPerS;

  // Tick marks: 60s zoomed in, 300s zoomed out.
  const interval = pxPerS >= 5 ? 60 : 300;
  const ticks: number[] = [];
  for (let t = Math.ceil(pan / interval) * interval; x(t) <= plotWidth - 2; t += interval) {
    ticks.push(t);
  }

  const onWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const tAtCursor = pan + (mouseX - LEFT_GUTTER) / pxPerS;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const next = clamp(pxPerS * factor, 1, 20);
    const nextSpan = visiblePx / next;
    const nextMaxPan = Math.max(0, totalS - nextSpan);
    setZoom(next);
    setPanS(clamp(tAtCursor - (mouseX - LEFT_GUTTER) / next, 0, nextMaxPan));
  };

  const onBgPointerDown = (e: React.PointerEvent<SVGRectElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startPan: pan };
  };
  const onBgPointerMove = (e: React.PointerEvent<SVGRectElement>) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    setPanS(clamp(dragRef.current.startPan - dx / pxPerS, 0, maxPan));
  };
  const onBgPointerUp = (e: React.PointerEvent<SVGRectElement>) => {
    dragRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const tickLabel = (t: number): string =>
    t === 0 ? '0' : t % 60 === 0 ? `${t / 60}m` : `${t}s`;

  const showTooltip = (
    r: InterceptResult,
    evt: React.MouseEvent<SVGRectElement>,
  ): void => {
    const ship = shipBySalvoId.get(r.salvoId);
    const salvo = salvos.find((s) => s.id === r.salvoId);
    const missile = salvo ? missileById.get(salvo.missileId) : undefined;
    const lines: string[] = [
      `${ship?.name ?? 'Ship'}${missile ? ` — ${missile.name}` : ''}${
        salvo?.count ? ` ×${salvo.count}` : ''
      }`,
    ];
    if (r.repositionTimeS > 0) {
      lines.push(`Reposition: head ${pad3(Math.round(r.optimalHeadingDeg))}° for ${formatDuration(r.repositionTimeS)}`);
    }
    if (r.waitTimeS > 0) lines.push(`Wait: ${formatDuration(r.waitTimeS)}`);
    lines.push(`Fire: ${formatTime(r.fireTimeS, hHourBase)}`);
    lines.push(`Flight: ${formatDuration(r.flightTimeS)}`);
    lines.push(`Arrive: ${formatTime(r.arrivalTimeS, hHourBase)}`);
    const rect = wrapRef.current?.getBoundingClientRect();
    setTooltip({
      x: evt.clientX - (rect?.left ?? 0) + 12,
      y: evt.clientY - (rect?.top ?? 0) + 12,
      lines,
      warn: !r.converged,
    });
  };

  return (
    <section className="rounded border border-panelBorder bg-panel">
      <div className="border-b border-panelBorder px-3 py-2">
        <h3 className="text-sm font-bold uppercase tracking-wide text-textPrimary">
          {target.name}
        </h3>
        <p className="font-mono text-xs text-textSecondary">
          Sync arrival {formatTime(sync, hHourBase)} · ±{tolS}s tolerance
        </p>
      </div>
      <div ref={wrapRef} className="relative">
        <svg
          width={plotWidth}
          height={height}
          onWheel={onWheel}
          className="block select-none"
          style={{ touchAction: 'none' }}
        >
          <defs>
            <linearGradient id={repoGradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#FBBF24" />
              <stop offset="100%" stopColor="#D97706" />
            </linearGradient>
            <linearGradient id={flightGradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#7DD3FC" />
              <stop offset="100%" stopColor="#0EA5E9" />
            </linearGradient>
            <filter id={glowId} x="-150%" y="-150%" width="400%" height="400%">
              <feGaussianBlur stdDeviation="1.6" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Background / pan surface */}
          <rect
            x={0}
            y={0}
            width={plotWidth}
            height={height}
            fill="#070C14"
            style={{ cursor: dragRef.current ? 'grabbing' : 'grab' }}
            onPointerDown={onBgPointerDown}
            onPointerMove={onBgPointerMove}
            onPointerUp={onBgPointerUp}
          />

          {/* Tolerance band around sync time */}
          {(() => {
            const left = x(Math.max(0, sync - tolS));
            const right = x(sync + tolS);
            return (
              <rect
                x={left}
                y={TOP_AXIS}
                width={Math.max(0, right - left)}
                height={lanesBottom - TOP_AXIS}
                fill="#10B981"
                opacity={0.12}
                pointerEvents="none"
              />
            );
          })()}

          {/* Tick lines + labels */}
          {ticks.map((t) => (
            <g key={t} pointerEvents="none">
              <line
                x1={x(t)}
                y1={TOP_AXIS}
                x2={x(t)}
                y2={lanesBottom}
                stroke="#1E2E4A"
                strokeWidth={1}
                strokeDasharray="2 4"
              />
              <text
                x={x(t)}
                y={TOP_AXIS - 8}
                textAnchor="middle"
                fontSize={10}
                fontFamily="'JetBrains Mono', ui-monospace, monospace"
                fill="#8195AE"
              >
                {tickLabel(t)}
              </text>
              {hHourBase !== null && (
                <text
                  x={x(t)}
                  y={lanesBottom + 12}
                  textAnchor="middle"
                  fontSize={9}
                  fontFamily="'JetBrains Mono', ui-monospace, monospace"
                  fill="#8195AE"
                >
                  {formatClock(hHourBase, t)}
                </text>
              )}
            </g>
          ))}

          {/* Sync line */}
          <line
            x1={x(sync)}
            y1={TOP_AXIS - 4}
            x2={x(sync)}
            y2={lanesBottom}
            stroke="#EF4444"
            strokeWidth={1.5}
            strokeDasharray="4 3"
            pointerEvents="none"
          />

          {/* Lanes */}
          {lanes.map((r, i) => {
            const ship = shipBySalvoId.get(r.salvoId);
            const laneY = TOP_AXIS + i * LANE_HEIGHT;
            const barY = laneY + (LANE_HEIGHT - BAR_HEIGHT) / 2;
            const color = shipColorById.get(ship?.id ?? '') ?? '#8195AE';
            const ready = !r.converged
              ? '#EF4444'
              : r.repositionTimeS > 0
              ? '#F59E0B'
              : '#10B981';
            const repoEnd = r.repositionTimeS;
            const waitEnd = r.fireTimeS; // reposition + wait
            const flightEnd = r.arrivalTimeS;
            const seg = (
              t0: number,
              t1: number,
              fill: string,
              key: string,
              label: string,
              textFill: string,
            ) => {
              if (t1 - t0 <= 0) return null;
              const left = x(t0);
              const w = (t1 - t0) * pxPerS;
              const barW = Math.max(w, 0.5);
              return (
                <g key={key}>
                  <rect
                    x={left}
                    y={barY}
                    width={barW}
                    height={BAR_HEIGHT}
                    rx={1}
                    fill={fill}
                    opacity={r.converged ? 0.95 : 0.4}
                    onMouseEnter={(e) => showTooltip(r, e)}
                    onMouseMove={(e) => showTooltip(r, e)}
                    onMouseLeave={() => setTooltip(null)}
                  />
                  {barW >= 50 && (
                    <text
                      x={left + barW / 2}
                      y={barY + BAR_HEIGHT / 2 + 3}
                      textAnchor="middle"
                      fontSize={8}
                      fontWeight={700}
                      letterSpacing={1}
                      fontFamily="'JetBrains Mono', ui-monospace, monospace"
                      fill={textFill}
                      opacity={r.converged ? 0.9 : 0.5}
                      pointerEvents="none"
                    >
                      {label}
                    </text>
                  )}
                </g>
              );
            };
            return (
              <g key={r.salvoId}>
                {/* Ship identity stripe + readiness status dot */}
                <rect x={0} y={laneY + 5} width={2} height={LANE_HEIGHT - 10} fill={color} opacity={0.85} />
                <circle
                  cx={12}
                  cy={laneY + LANE_HEIGHT / 2}
                  r={4}
                  fill={ready}
                  filter={`url(#${glowId})`}
                />
                <text
                  x={22}
                  y={laneY + LANE_HEIGHT / 2 + 3}
                  fontSize={11}
                  fill="#E6EDF7"
                >
                  {truncate(ship?.name ?? 'Ship', 18)}
                </text>
                {/* Segments (chronological: reposition → wait → flight) */}
                {seg(0, repoEnd, `url(#${repoGradId})`, 'repo', 'REPOSITION', TEXT_ON_REPOSITION)}
                {seg(repoEnd, waitEnd, COLOR_WAIT, 'wait', 'WAIT', TEXT_ON_WAIT)}
                {seg(waitEnd, flightEnd, `url(#${flightGradId})`, 'flight', 'FLIGHT', TEXT_ON_FLIGHT)}
                {/* Transition node: firing point */}
                {flightEnd > waitEnd && (
                  <circle
                    cx={x(waitEnd)}
                    cy={barY + BAR_HEIGHT / 2}
                    r={2.5}
                    fill={COLOR_FLIGHT}
                    filter={`url(#${glowId})`}
                    pointerEvents="none"
                  />
                )}
                {/* Arrival tick + node */}
                <line
                  x1={x(flightEnd)}
                  y1={barY - 2}
                  x2={x(flightEnd)}
                  y2={barY + BAR_HEIGHT + 2}
                  stroke="#EF4444"
                  strokeWidth={2}
                  pointerEvents="none"
                />
                <circle
                  cx={x(flightEnd)}
                  cy={barY + BAR_HEIGHT / 2}
                  r={3}
                  fill="#EF4444"
                  filter={`url(#${glowId})`}
                  pointerEvents="none"
                />
              </g>
            );
          })}
        </svg>

        {tooltip && (
          <div
            className="pointer-events-none absolute z-10 max-w-xs rounded-sm border border-panelBorder bg-navy/95 px-2 py-1 text-xs text-textPrimary shadow-lg"
            style={{ left: tooltip.x, top: tooltip.y }}
          >
            {tooltip.warn && (
              <div className="font-mono uppercase tracking-wider text-redAccent">
                ⚠ Non-converged solution
              </div>
            )}
            {tooltip.lines.map((l, i) => (
              <div
                key={i}
                className={i === 0 ? 'font-medium' : 'font-mono text-textSecondary'}
              >
                {l}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
