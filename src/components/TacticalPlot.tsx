import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useScenario } from '../hooks/useScenario';
import { useDbLoader } from '../hooks/useDbLoader';
import { solveGroup, type GroupResult, type InterceptResult } from '../lib/calc';
import { radarHorizonNm } from '../lib/geo';
import { SHIP_PALETTE, formatDuration, formatTime, pad3, parseHHMMSS } from '../lib/format';
import type {
  FriendlyShip,
  GuidanceType,
  Missile,
  Salvo,
  Scenario,
  TargetShip,
} from '../types';

const PLOT_HEIGHT = 420;
const EDGE_PAD = 36;

const GUIDANCE_COLORS: Record<GuidanceType, string> = {
  SARH: '#F59E0B',
  ARH: '#38BDF8',
  gun: '#EF4444',
};

const COLOR_GRID = '#1E2E4A';
const COLOR_LABEL = '#8195AE';
const COLOR_HOSTILE = '#EF4444';
const COLOR_HORIZON = '#E6EDF7';

const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v));

type Vec = { x: number; y: number };

// Polar (nm, deg true) → north-up cartesian nm (x east, y north).
function polarToVec(rangeNm: number, bearingDeg: number): Vec {
  const r = (bearingDeg * Math.PI) / 180;
  return { x: rangeNm * Math.sin(r), y: rangeNm * Math.cos(r) };
}

function niceStep(raw: number): number {
  const steps = [0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200];
  for (const s of steps) if (s >= raw) return s;
  return Math.ceil(raw / 500) * 500;
}

function formatNm(nm: number): string {
  return Number.isInteger(nm) ? `${nm}` : nm.toFixed(1);
}

export function TacticalPlot() {
  const { activeScenario, state } = useScenario();
  const { dbMissiles } = useDbLoader();

  const allMissiles = useMemo(() => {
    const seen = new Set(state.missileLibrary.map((m) => m.id));
    return [
      ...state.missileLibrary,
      ...dbMissiles.filter((m) => !seen.has(m.id)),
    ];
  }, [state.missileLibrary, dbMissiles]);

  if (!activeScenario) return null;

  const hHourBase = activeScenario.hHour ? parseHHMMSS(activeScenario.hHour) : null;
  const shipColorById = new Map<string, string>(
    activeScenario.friendlyShips.map((s, i) => [
      s.id,
      SHIP_PALETTE[i % SHIP_PALETTE.length],
    ]),
  );

  return (
    <div className="space-y-4 p-4">
      <header className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-bold uppercase tracking-widest text-textSecondary">
          Tactical Plot
        </h2>
        <Legend />
      </header>

      {activeScenario.targetShips.length === 0 ? (
        <p className="text-sm italic text-textSecondary">
          No targets to plot. Add a target ship to see its defense envelope.
        </p>
      ) : (
        activeScenario.targetShips.map((target) => (
          <TargetPlot
            key={target.id}
            target={target}
            ships={activeScenario.friendlyShips}
            missiles={allMissiles}
            scenario={activeScenario}
            hHourBase={hHourBase}
            shipColorById={shipColorById}
          />
        ))
      )}
      <p className="text-xs italic text-textSecondary">
        Target-anchored, north-up, relative geometry (no real coordinates). Wheel
        to zoom, drag to pan. Hover a marker for details.
      </p>
    </div>
  );
}

function Legend() {
  return (
    <div className="flex items-center gap-3 font-mono text-xs uppercase tracking-wider text-textSecondary">
      <span className="flex items-center gap-1">
        <svg width="12" height="12" viewBox="0 0 12 12">
          <circle cx="6" cy="6" r="4" fill="none" stroke="#3B82F6" strokeWidth="2" />
        </svg>
        Friendly
      </span>
      <span className="flex items-center gap-1">
        <svg width="12" height="12" viewBox="0 0 12 12">
          <rect x="2.5" y="2.5" width="7" height="7" fill="none" stroke={COLOR_HOSTILE} strokeWidth="2" transform="rotate(45 6 6)" />
        </svg>
        Target
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block h-0.5 w-3" style={{ backgroundColor: GUIDANCE_COLORS.SARH }} />
        SAM
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block h-0.5 w-3" style={{ backgroundColor: GUIDANCE_COLORS.gun }} />
        CIWS
      </span>
    </div>
  );
}

type Ring = { radiusNm: number; names: string[]; color: string };

type Track = {
  salvo: Salvo;
  ship: FriendlyShip;
  missile: Missile;
  result: InterceptResult | undefined;
  /** Current position in target-anchored nm (x east, y north). */
  pos: Vec;
  /** Firing point after any reposition leg. */
  firingPos: Vec;
  color: string;
};

type Tooltip = { x: number; y: number; lines: string[]; warn: boolean };

type TargetPlotProps = {
  target: TargetShip;
  ships: FriendlyShip[];
  missiles: Missile[];
  scenario: Scenario;
  hHourBase: number | null;
  shipColorById: Map<string, string>;
};

function TargetPlot({
  target,
  ships,
  missiles,
  scenario,
  hHourBase,
  shipColorById,
}: TargetPlotProps) {
  const missileById = useMemo(() => new Map(missiles.map((m) => [m.id, m])), [missiles]);

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

  const tracks: Track[] = useMemo(() => {
    const shipBySalvoId = new Map<string, FriendlyShip>();
    for (const ship of ships) for (const s of ship.salvos) shipBySalvoId.set(s.id, ship);
    const resultBySalvoId = new Map<string, InterceptResult>(
      (group?.shipResults ?? []).map((r) => [r.salvoId, r]),
    );
    const out: Track[] = [];
    for (const salvo of salvos) {
      const ship = shipBySalvoId.get(salvo.id);
      const missile = missileById.get(salvo.missileId);
      if (!ship || !missile) continue;
      const result = resultBySalvoId.get(salvo.id);
      // Ship sits at the reciprocal of its bearing-to-target, target at origin.
      const pos = polarToVec(
        salvo.rangeToTargetNm,
        salvo.bearingToTargetDeg + 180,
      );
      let firingPos = pos;
      if (result && result.repositionTimeS > 0 && ship.speedKnots > 0) {
        const travelNm = (ship.speedKnots * result.repositionTimeS) / 3600;
        const d = polarToVec(travelNm, result.optimalHeadingDeg);
        firingPos = { x: pos.x + d.x, y: pos.y + d.y };
      }
      out.push({
        salvo,
        ship,
        missile,
        result,
        pos,
        firingPos,
        color: shipColorById.get(ship.id) ?? '#8195AE',
      });
    }
    return out;
  }, [salvos, ships, missileById, group, shipColorById]);

  // Defense envelope rings, deduped by guidance + radius (e.g. two identical layers).
  const defenseRings: Ring[] = useMemo(() => {
    const byKey = new Map<string, Ring>();
    for (const layer of target.defenseLayers) {
      for (const ws of layer.weaponSystems) {
        const maxR = ws.maxRangeNm;
        if (maxR == null || maxR <= 0) continue;
        const key = `${ws.guidance}:${maxR.toFixed(1)}`;
        const existing = byKey.get(key);
        if (existing) {
          if (!existing.names.includes(ws.name)) existing.names.push(ws.name);
        } else {
          byKey.set(key, {
            radiusNm: maxR,
            names: [ws.name],
            color: GUIDANCE_COLORS[ws.guidance],
          });
        }
      }
    }
    return Array.from(byKey.values()).sort((a, b) => b.radiusNm - a.radiusNm);
  }, [target.defenseLayers]);

  // Radar horizon rings against any sea-skimming attackers in the plot.
  const horizonRadii: number[] = useMemo(() => {
    const alts = new Set<number>();
    for (const t of tracks) {
      if (t.missile.altitudeFt != null) alts.add(t.missile.altitudeFt);
    }
    return Array.from(alts)
      .map((alt) => radarHorizonNm(scenario.radarHeightFt, alt))
      .filter((r) => r > 0)
      .sort((a, b) => a - b);
  }, [tracks, scenario.radarHeightFt]);

  const sync = group?.synchronizedArrivalTimeS ?? 0;
  // Target position at synchronized impact, in the T=0 target-anchored frame.
  const impact: Vec | null =
    group && target.speedKnots > 0 && sync > 0
      ? polarToVec((target.speedKnots * sync) / 3600, target.headingDeg)
      : null;

  const fitRadius = useMemo(() => {
    let r = 5;
    for (const t of tracks) {
      r = Math.max(
        r,
        Math.hypot(t.pos.x, t.pos.y),
        Math.hypot(t.firingPos.x, t.firingPos.y),
      );
    }
    for (const ring of defenseRings) r = Math.max(r, ring.radiusNm);
    if (impact) r = Math.max(r, Math.hypot(impact.x, impact.y));
    return r * 1.1;
  }, [tracks, defenseRings, impact]);

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

  const [zoom, setZoom] = useState<number | null>(null); // px per nm; null = auto-fit
  const [pan, setPan] = useState<Vec>({ x: 0, y: 0 });
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; startPan: Vec } | null>(null);

  const uid = useId().replace(/:/g, '');
  const glowId = `plot-glow-${uid}`;

  const plotWidth = Math.max(width, 320);
  const cx = plotWidth / 2;
  const cy = PLOT_HEIGHT / 2;
  const basePx = (Math.min(plotWidth, PLOT_HEIGHT) / 2 - EDGE_PAD) / fitRadius;
  const pxPerNm = zoom ?? basePx;

  // Target-anchored nm → screen px (north up).
  const sx = (v: Vec): number => cx + pan.x + v.x * pxPerNm;
  const sy = (v: Vec): number => cy + pan.y - v.y * pxPerNm;

  const ringStep = niceStep(fitRadius / 4);
  const ringRadii: number[] = [];
  for (let r = ringStep; r <= fitRadius * 1.05 && ringRadii.length < 8; r += ringStep) {
    ringRadii.push(r);
  }
  const outerNm = ringRadii.length > 0 ? ringRadii[ringRadii.length - 1] : fitRadius;

  const onWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    // Screen-space nm under the cursor (uy positive = south; consistent both sides).
    const ux = (mx - cx - pan.x) / pxPerNm;
    const uy = (my - cy - pan.y) / pxPerNm;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const next = clamp(pxPerNm * factor, basePx * 0.25, basePx * 40);
    setZoom(next);
    setPan({ x: mx - cx - ux * next, y: my - cy - uy * next });
  };

  const onBgPointerDown = (e: React.PointerEvent<SVGRectElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, startPan: pan };
  };
  const onBgPointerMove = (e: React.PointerEvent<SVGRectElement>) => {
    if (!dragRef.current) return;
    setPan({
      x: dragRef.current.startPan.x + (e.clientX - dragRef.current.startX),
      y: dragRef.current.startPan.y + (e.clientY - dragRef.current.startY),
    });
  };
  const onBgPointerUp = (e: React.PointerEvent<SVGRectElement>) => {
    dragRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const showTrackTooltip = (
    t: Track,
    evt: React.MouseEvent<SVGCircleElement>,
  ): void => {
    const lines: string[] = [
      `${t.ship.name} — ${t.missile.name} ×${t.salvo.count}`,
      `LOS ${t.salvo.rangeToTargetNm.toFixed(1)} nm, brg ${pad3(Math.round(t.salvo.bearingToTargetDeg))}° to target`,
    ];
    if (t.result) {
      if (t.result.repositionTimeS > 0) {
        lines.push(
          `Reposition: head ${pad3(Math.round(t.result.optimalHeadingDeg))}° for ${formatDuration(t.result.repositionTimeS)}`,
        );
      }
      if (t.result.waitTimeS > 0) lines.push(`Wait: ${formatDuration(t.result.waitTimeS)}`);
      lines.push(`Fires at ${t.result.firingRangeNm.toFixed(1)} nm — ${formatTime(t.result.fireTimeS, hHourBase)}`);
      lines.push(`Impact: ${formatTime(t.result.arrivalTimeS, hHourBase)}`);
    }
    const rect = wrapRef.current?.getBoundingClientRect();
    setTooltip({
      x: evt.clientX - (rect?.left ?? 0) + 12,
      y: evt.clientY - (rect?.top ?? 0) + 12,
      lines,
      warn: t.result ? !t.result.converged : false,
    });
  };

  const showTargetTooltip = (evt: React.MouseEvent<SVGGElement>): void => {
    const systems = target.defenseLayers.flatMap((l) => l.weaponSystems);
    const lines: string[] = [
      target.name,
      `Hdg ${pad3(Math.round(target.headingDeg))}° at ${target.speedKnots.toFixed(1)} kts`,
      `${target.defenseLayers.length} defense layer${target.defenseLayers.length === 1 ? '' : 's'}, ${systems.length} weapon system${systems.length === 1 ? '' : 's'}`,
    ];
    const rect = wrapRef.current?.getBoundingClientRect();
    setTooltip({
      x: evt.clientX - (rect?.left ?? 0) + 12,
      y: evt.clientY - (rect?.top ?? 0) + 12,
      lines,
      warn: false,
    });
  };

  const center: Vec = { x: 0, y: 0 };
  // Velocity leader: distance the target covers in 6 minutes (standard plot convention).
  const leaderTip: Vec | null =
    target.speedKnots > 0
      ? polarToVec(target.speedKnots / 10, target.headingDeg)
      : null;

  return (
    <section className="rounded border border-panelBorder bg-panel">
      <div className="border-b border-panelBorder px-3 py-2">
        <h3 className="text-sm font-bold uppercase tracking-wide text-textPrimary">
          {target.name}
        </h3>
        <p className="font-mono text-xs text-textSecondary">
          {tracks.length} salvo{tracks.length === 1 ? '' : 's'} inbound · ring spacing {formatNm(ringStep)} nm
          {group ? ` · sync impact ${formatTime(sync, hHourBase)}` : ''}
        </p>
      </div>
      <div ref={wrapRef} className="relative">
        <svg
          width={plotWidth}
          height={PLOT_HEIGHT}
          onWheel={onWheel}
          className="block select-none"
          style={{ touchAction: 'none' }}
        >
          <defs>
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
            height={PLOT_HEIGHT}
            fill="#070C14"
            style={{ cursor: dragRef.current ? 'grabbing' : 'grab' }}
            onPointerDown={onBgPointerDown}
            onPointerMove={onBgPointerMove}
            onPointerUp={onBgPointerUp}
          />

          {/* Bearing spokes every 45° + labels at the outer ring */}
          {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
            const tip = polarToVec(outerNm, deg);
            const lbl = polarToVec(outerNm * 1.0, deg);
            return (
              <g key={deg} pointerEvents="none">
                <line
                  x1={sx(center)}
                  y1={sy(center)}
                  x2={sx(tip)}
                  y2={sy(tip)}
                  stroke={COLOR_GRID}
                  strokeWidth={1}
                  strokeDasharray="2 5"
                  opacity={0.7}
                />
                <text
                  x={sx(lbl) + (Math.sin((deg * Math.PI) / 180) * 12)}
                  y={sy(lbl) - (Math.cos((deg * Math.PI) / 180) * 12) + 3}
                  textAnchor="middle"
                  fontSize={9}
                  fontFamily="'JetBrains Mono', ui-monospace, monospace"
                  fill={COLOR_LABEL}
                >
                  {pad3(deg)}
                </text>
              </g>
            );
          })}

          {/* Range rings + labels (labels along the NNE radial to dodge the spokes) */}
          {ringRadii.map((r) => (
            <g key={r} pointerEvents="none">
              <circle
                cx={sx(center)}
                cy={sy(center)}
                r={r * pxPerNm}
                fill="none"
                stroke={COLOR_GRID}
                strokeWidth={1}
              />
              <text
                x={sx(polarToVec(r, 22.5))}
                y={sy(polarToVec(r, 22.5)) - 3}
                textAnchor="middle"
                fontSize={9}
                fontFamily="'JetBrains Mono', ui-monospace, monospace"
                fill={COLOR_LABEL}
              >
                {formatNm(r)}
              </text>
            </g>
          ))}

          {/* Radar horizon vs sea-skimmers */}
          {horizonRadii.map((r) => (
            <g key={`hz-${r}`} pointerEvents="none">
              <circle
                cx={sx(center)}
                cy={sy(center)}
                r={r * pxPerNm}
                fill="none"
                stroke={COLOR_HORIZON}
                strokeWidth={1}
                strokeDasharray="1 4"
                opacity={0.55}
              />
              <text
                x={sx(polarToVec(r, 202.5))}
                y={sy(polarToVec(r, 202.5)) + 10}
                textAnchor="middle"
                fontSize={8}
                fontFamily="'JetBrains Mono', ui-monospace, monospace"
                fill={COLOR_HORIZON}
                opacity={0.55}
              >
                HORIZON {formatNm(Math.round(r * 10) / 10)}
              </text>
            </g>
          ))}

          {/* Defense envelope rings */}
          {defenseRings.map((ring) => (
            <g key={`${ring.color}-${ring.radiusNm}`} pointerEvents="none">
              <circle
                cx={sx(center)}
                cy={sy(center)}
                r={ring.radiusNm * pxPerNm}
                fill={ring.color}
                fillOpacity={0.04}
                stroke={ring.color}
                strokeWidth={1.2}
                strokeDasharray="6 4"
                opacity={0.8}
              />
              <text
                x={sx(polarToVec(ring.radiusNm, 135))}
                y={sy(polarToVec(ring.radiusNm, 135)) + 10}
                textAnchor="middle"
                fontSize={8}
                fontFamily="'JetBrains Mono', ui-monospace, monospace"
                fill={ring.color}
                opacity={0.9}
              >
                {`${truncate(ring.names.join(' / '), 28)} ${formatNm(Math.round(ring.radiusNm * 10) / 10)}`}
              </text>
            </g>
          ))}

          {/* Per-salvo geometry: reposition leg, firing point, flight path */}
          {tracks.map((t) => {
            const opacity = t.result && !t.result.converged ? 0.4 : 0.95;
            const impactPoint = impact ?? center;
            const hasRepo = t.firingPos !== t.pos;
            return (
              <g key={t.salvo.id} opacity={opacity}>
                {hasRepo && (
                  <>
                    <line
                      x1={sx(t.pos)}
                      y1={sy(t.pos)}
                      x2={sx(t.firingPos)}
                      y2={sy(t.firingPos)}
                      stroke="#F59E0B"
                      strokeWidth={1.4}
                      strokeDasharray="5 3"
                      pointerEvents="none"
                    />
                    <rect
                      x={sx(t.firingPos) - 3}
                      y={sy(t.firingPos) - 3}
                      width={6}
                      height={6}
                      fill="none"
                      stroke="#F59E0B"
                      strokeWidth={1.4}
                      pointerEvents="none"
                    />
                  </>
                )}
                <line
                  x1={sx(t.firingPos)}
                  y1={sy(t.firingPos)}
                  x2={sx(impactPoint)}
                  y2={sy(impactPoint)}
                  stroke="#38BDF8"
                  strokeWidth={1.2}
                  strokeDasharray="2 4"
                  pointerEvents="none"
                />
              </g>
            );
          })}

          {/* Synchronized impact point (target's future position) */}
          {impact && (
            <g pointerEvents="none">
              <line
                x1={sx(center)}
                y1={sy(center)}
                x2={sx(impact)}
                y2={sy(impact)}
                stroke={COLOR_HOSTILE}
                strokeWidth={1}
                strokeDasharray="4 3"
                opacity={0.7}
              />
              <g filter={`url(#${glowId})`}>
                <line x1={sx(impact) - 4} y1={sy(impact) - 4} x2={sx(impact) + 4} y2={sy(impact) + 4} stroke={COLOR_HOSTILE} strokeWidth={2} />
                <line x1={sx(impact) - 4} y1={sy(impact) + 4} x2={sx(impact) + 4} y2={sy(impact) - 4} stroke={COLOR_HOSTILE} strokeWidth={2} />
              </g>
              <text
                x={sx(impact) + 8}
                y={sy(impact) - 6}
                fontSize={9}
                fontFamily="'JetBrains Mono', ui-monospace, monospace"
                fill={COLOR_HOSTILE}
              >
                {`IMPACT T+${Math.round(sync)}s`}
              </text>
            </g>
          )}

          {/* Target marker (hostile diamond) + velocity leader */}
          <g
            onMouseEnter={showTargetTooltip}
            onMouseMove={showTargetTooltip}
            onMouseLeave={() => setTooltip(null)}
          >
            {leaderTip && (
              <line
                x1={sx(center)}
                y1={sy(center)}
                x2={sx(leaderTip)}
                y2={sy(leaderTip)}
                stroke={COLOR_HOSTILE}
                strokeWidth={1.6}
                pointerEvents="none"
              />
            )}
            <rect
              x={sx(center) - 5}
              y={sy(center) - 5}
              width={10}
              height={10}
              fill="#070C14"
              stroke={COLOR_HOSTILE}
              strokeWidth={2}
              transform={`rotate(45 ${sx(center)} ${sy(center)})`}
              filter={`url(#${glowId})`}
            />
            <text
              x={sx(center) + 10}
              y={sy(center) + 14}
              fontSize={10}
              fill="#E6EDF7"
              pointerEvents="none"
            >
              {truncate(target.name, 18)}
            </text>
          </g>

          {/* Friendly markers (one per salvo) */}
          {tracks.map((t) => {
            const opacity = t.result && !t.result.converged ? 0.45 : 1;
            return (
              <g key={`mk-${t.salvo.id}`} opacity={opacity}>
                <circle
                  cx={sx(t.pos)}
                  cy={sy(t.pos)}
                  r={5.5}
                  fill="#070C14"
                  stroke={t.color}
                  strokeWidth={2}
                  filter={`url(#${glowId})`}
                />
                <text
                  x={sx(t.pos) + 9}
                  y={sy(t.pos) - 7}
                  fontSize={10}
                  fill="#E6EDF7"
                  pointerEvents="none"
                >
                  {truncate(t.ship.name, 16)}
                </text>
                <text
                  x={sx(t.pos) + 9}
                  y={sy(t.pos) + 4}
                  fontSize={8}
                  fontFamily="'JetBrains Mono', ui-monospace, monospace"
                  fill={COLOR_LABEL}
                  pointerEvents="none"
                >
                  {`${truncate(t.missile.name, 12)} ×${t.salvo.count}`}
                </text>
                {/* Oversized invisible hit area for the tooltip */}
                <circle
                  cx={sx(t.pos)}
                  cy={sy(t.pos)}
                  r={11}
                  fill="transparent"
                  onMouseEnter={(e) => showTrackTooltip(t, e)}
                  onMouseMove={(e) => showTrackTooltip(t, e)}
                  onMouseLeave={() => setTooltip(null)}
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
