import { useMemo, useState } from 'react';
import { useScenario } from '../hooks/useScenario';
import { useDbLoader } from '../hooks/useDbLoader';
import {
  computeSaturation,
  solveGroup,
  solveInverseSaturation,
  type GroupResult,
  type InterceptResult,
  type InverseSaturationResult,
  type SaturationResult,
} from '../lib/calc';
import {
  SHIP_PALETTE,
  formatDuration,
  formatTime,
  pad3,
  parseHHMMSS,
} from '../lib/format';
import type { FriendlyShip, Missile, Scenario, TargetShip } from '../types';

type ShipStatus = {
  text: string;
  badgeClass: string;
  borderClass: string;
};

const STATUS_BADGE_BASE =
  'shrink-0 rounded-sm border px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest';

// Whole numbers print clean; fractional expected values get one decimal.
const fmtNum = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const fmtPct = (p: number): string => `${(p * 100).toFixed(p >= 0.995 || p === 0 ? 0 : 1)}%`;

function shipStatus(r: InterceptResult): ShipStatus {
  if (!r.converged) {
    return {
      text: 'Non-converged',
      badgeClass: `${STATUS_BADGE_BASE} animate-pulse border-redAccent/40 bg-redAccent/10 text-redAccent`,
      borderClass: 'border-l-redAccent',
    };
  }
  if (r.repositionTimeS > 0) {
    return {
      text: 'Reposition req',
      badgeClass: `${STATUS_BADGE_BASE} border-amberAccent/40 bg-amberAccent/10 text-amberAccent${
        r.repositionWarning ? ' animate-pulse' : ''
      }`,
      borderClass: 'border-l-amberAccent',
    };
  }
  return {
    text: 'In range',
    badgeClass: `${STATUS_BADGE_BASE} border-greenAccent/40 bg-greenAccent/10 text-greenAccent`,
    borderClass: 'border-l-greenAccent',
  };
}

export function ResultsPanel() {
  const { activeScenario, state, dispatch } = useScenario();
  const { dbMissiles } = useDbLoader();

  const allMissiles = useMemo(() => {
    const seen = new Set(state.missileLibrary.map((m) => m.id));
    return [
      ...state.missileLibrary,
      ...dbMissiles.filter((m) => !seen.has(m.id)),
    ];
  }, [state.missileLibrary, dbMissiles]);

  if (!activeScenario) {
    return (
      <div className="p-4 text-sm italic text-textSecondary">No active scenario.</div>
    );
  }

  const hHourBase = activeScenario.hHour ? parseHHMMSS(activeScenario.hHour) : null;
  const hHourValid = !activeScenario.hHour || hHourBase !== null;

  const shipColorById = new Map<string, string>(
    activeScenario.friendlyShips.map((s, i) => [s.id, SHIP_PALETTE[i % SHIP_PALETTE.length]]),
  );

  return (
    <div className="space-y-4 p-4">
      <header className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-bold uppercase tracking-widest text-textSecondary">
          Results
        </h2>
        <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-textSecondary" title="Leak-probability threshold for the SATURATED verdict and the saturation threshold figure">
          Confidence
          <input
            type="number"
            min={1}
            max={100}
            step={5}
            value={Math.round(activeScenario.saturationConfidence * 100)}
            onChange={(e) => {
              const pct = Number(e.target.value);
              const clamped = Math.min(100, Math.max(1, Number.isFinite(pct) ? pct : 50));
              dispatch({
                type: 'UPDATE_SCENARIO',
                id: activeScenario.id,
                patch: { saturationConfidence: clamped / 100 },
              });
            }}
            className="w-16 rounded border border-panelBorder bg-navy px-2 py-1 text-right font-mono text-textPrimary outline-none focus:border-skyAccent focus:ring-1 focus:ring-skyAccent/20"
          />
          <span className="font-mono">%</span>
        </label>
        <label className="flex items-center gap-2 text-xs text-textSecondary">
          H-hour
          <input
            type="text"
            inputMode="numeric"
            placeholder="HH:MM:SS"
            value={activeScenario.hHour ?? ''}
            onChange={(e) =>
              dispatch({
                type: 'UPDATE_SCENARIO',
                id: activeScenario.id,
                patch: { hHour: e.target.value },
              })
            }
            className={`w-28 rounded border bg-navy px-2 py-1 text-right font-mono text-textPrimary outline-none focus:border-skyAccent focus:ring-1 focus:ring-skyAccent/20 ${
              hHourValid ? 'border-panelBorder' : 'border-redAccent'
            }`}
          />
        </label>
        </div>
      </header>
      {!hHourValid && (
        <p className="text-xs text-redAccent">H-hour must be HH:MM:SS (e.g. 14:30:00).</p>
      )}

      {activeScenario.targetShips.length === 0 ? (
        <p className="text-sm italic text-textSecondary">
          No target ships. Add one in the left panel to see a solution.
        </p>
      ) : (
        activeScenario.targetShips.map((target) => (
          <TargetResultSection
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
    </div>
  );
}

type SectionProps = {
  target: TargetShip;
  ships: FriendlyShip[];
  missiles: Missile[];
  scenario: Scenario;
  hHourBase: number | null;
  shipColorById: Map<string, string>;
};

function TargetResultSection({
  target,
  ships,
  missiles,
  scenario,
  hHourBase,
  shipColorById,
}: SectionProps) {
  const [showSaturation, setShowSaturation] = useState(false);

  const missileById = useMemo(
    () => new Map(missiles.map((m) => [m.id, m])),
    [missiles],
  );
  const shipBySalvoId = useMemo(() => {
    const map = new Map<string, FriendlyShip>();
    for (const ship of ships) {
      for (const salvo of ship.salvos) map.set(salvo.id, ship);
    }
    return map;
  }, [ships]);

  // Salvos aimed at this target that have a resolvable missile.
  const salvos = useMemo(
    () =>
      ships
        .flatMap((s) => s.salvos)
        .filter((sv) => sv.targetId === target.id && missileById.has(sv.missileId)),
    [ships, target.id, missileById],
  );

  const group: GroupResult | null = useMemo(() => {
    if (salvos.length === 0) return null;
    return solveGroup(ships, salvos, missiles, target, scenario);
  }, [ships, salvos, missiles, target, scenario]);

  const saturation: SaturationResult | null = useMemo(() => {
    if (!group) return null;
    return computeSaturation(group, salvos, target, scenario.saturationConfidence);
  }, [group, salvos, target, scenario.saturationConfidence]);

  // Inverse solver — depends only on the target's defenses, so it's a planning
  // figure that's meaningful even before any salvo is assigned.
  const inverse = useMemo(
    () => solveInverseSaturation(target, scenario.saturationConfidence),
    [target, scenario.saturationConfidence],
  );
  const plannedIncoming = useMemo(
    () => salvos.reduce((sum, sv) => sum + sv.count, 0),
    [salvos],
  );

  return (
    <section className="rounded border border-panelBorder bg-panel">
      <div className="border-b border-panelBorder px-3 py-2">
        <h3 className="text-sm font-bold uppercase tracking-wide text-textPrimary">
          {target.name}
        </h3>
        <p className="font-mono text-xs text-textSecondary">
          {target.speedKnots.toFixed(1)} kts, heading {pad3(target.headingDeg)}&deg; &middot;{' '}
          {target.defenseLayers.length} defense layer
          {target.defenseLayers.length === 1 ? '' : 's'}
        </p>
      </div>

      <div className="px-3 pt-3">
        <SaturationThresholdCard inverse={inverse} plannedIncoming={plannedIncoming} />
      </div>

      {!group || salvos.length === 0 ? (
        <p className="px-3 py-3 text-xs italic text-textSecondary">
          No salvos directed at this target.
        </p>
      ) : (
        <div className="space-y-3 p-3">
          {group.shipResults.map((r) => (
            <SolutionBlock
              key={r.salvoId}
              result={r}
              ship={shipBySalvoId.get(r.salvoId)}
              missile={missileBySalvo(r, salvos, missileById)}
              count={countBySalvo(r, salvos)}
              scenario={scenario}
              hHourBase={hHourBase}
            />
          ))}

          <ArrivalTable
            group={group}
            shipBySalvoId={shipBySalvoId}
            salvos={salvos}
            missileById={missileById}
            toleranceS={scenario.simultaneityToleranceS}
            hHourBase={hHourBase}
          />

          {saturation && (
            <div className="rounded border border-panelBorder">
              <button
                onClick={() => setShowSaturation((v) => !v)}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-bold uppercase tracking-widest text-textSecondary hover:text-textPrimary"
              >
                <span>Saturation analysis</span>
                <span>{showSaturation ? '−' : '+'}</span>
              </button>
              {showSaturation && (
                <SaturationSection
                  saturation={saturation}
                  group={group}
                  salvos={salvos}
                  shipBySalvoId={shipBySalvoId}
                  shipColorById={shipColorById}
                  hHourBase={hHourBase}
                />
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function missileBySalvo(
  r: InterceptResult,
  salvos: SectionProps['ships'][number]['salvos'],
  missileById: Map<string, Missile>,
): Missile | undefined {
  const salvo = salvos.find((s) => s.id === r.salvoId);
  return salvo ? missileById.get(salvo.missileId) : undefined;
}

function countBySalvo(
  r: InterceptResult,
  salvos: SectionProps['ships'][number]['salvos'],
): number {
  return salvos.find((s) => s.id === r.salvoId)?.count ?? 0;
}

function SaturationThresholdCard({
  inverse,
  plannedIncoming,
}: {
  inverse: InverseSaturationResult;
  plannedIncoming: number;
}) {
  const engaging = inverse.layerCapacities.filter((l) => l.engages);
  const nonEngaging = inverse.layerCapacities.filter((l) => !l.engages);
  const meets = plannedIncoming >= inverse.minSaturatingSalvo;
  const deficit = inverse.minSaturatingSalvo - plannedIncoming;

  return (
    <div className="rounded border border-skyAccent/30 bg-skyAccent/5 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-xs font-bold uppercase tracking-widest text-skyAccent">
          Saturation threshold
        </h4>
        <span className="font-mono text-2xl font-bold leading-none text-textPrimary">
          {inverse.minSaturatingSalvo}
        </span>
      </div>
      <p className="mt-1 font-mono text-[11px] text-textSecondary">
        Min synchronized arrivals for ≥{fmtPct(inverse.confidence)} leak probability
      </p>

      <p className="mt-2 font-mono text-[11px] text-textSecondary">
        Expected intercept capacity:{' '}
        <span className="text-textPrimary">{fmtNum(inverse.interceptCapacity)}</span>
        {engaging.length > 0 && (
          <>
            {' '}
            ({engaging.map((l) => `${l.layerName} ×${fmtNum(l.effectiveCapacity)}`).join(' + ')})
          </>
        )}
      </p>
      {nonEngaging.length > 0 && (
        <p className="mt-1 font-mono text-[10px] italic text-textSecondary/70">
          Out of envelope at arrival, excluded:{' '}
          {nonEngaging.map((l) => l.layerName).join(', ')}
        </p>
      )}

      {plannedIncoming > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2 font-mono text-[11px]">
          <span className="text-textSecondary">Planned</span>
          <span className="text-textPrimary">
            {plannedIncoming} / {inverse.minSaturatingSalvo}
          </span>
          {meets ? (
            <span className="rounded-sm border border-redAccent/40 bg-redAccent/10 px-2 py-0.5 text-[10px] uppercase tracking-widest text-redAccent">
              Saturates
              {plannedIncoming > inverse.minSaturatingSalvo
                ? ` (+${plannedIncoming - inverse.minSaturatingSalvo})`
                : ''}
            </span>
          ) : (
            <span className="rounded-sm border border-amberAccent/40 bg-amberAccent/10 px-2 py-0.5 text-[10px] uppercase tracking-widest text-amberAccent">
              Need {deficit} more
            </span>
          )}
        </div>
      )}
    </div>
  );
}

type SolutionBlockProps = {
  result: InterceptResult;
  ship: FriendlyShip | undefined;
  missile: Missile | undefined;
  count: number;
  scenario: Scenario;
  hHourBase: number | null;
};

function SolutionBlock({
  result: r,
  ship,
  missile,
  count,
  scenario,
  hHourBase,
}: SolutionBlockProps) {
  const status = shipStatus(r);

  const segments: string[] = [];
  if (r.repositionTimeS > 0) {
    segments.push(`Head: ${pad3(Math.round(r.optimalHeadingDeg))}° for ${formatDuration(r.repositionTimeS)}`);
  }
  if (r.waitTimeS > 0) {
    segments.push(`Wait: ${Math.round(r.waitTimeS)}s`);
  }
  segments.push(`Fire at: ${formatTime(r.fireTimeS, hHourBase)}`);
  segments.push(`Flight: ${Math.round(r.flightTimeS)}s`);
  segments.push(`Arrives: ${formatTime(r.arrivalTimeS, hHourBase)}`);

  return (
    <div
      className={`rounded border border-l-4 border-panelBorder bg-navy/40 p-2 text-xs ${status.borderClass}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-textPrimary">
          {ship?.name ?? 'Unknown ship'}
          {missile ? ` — ${missile.name}` : ''}
          {count ? ` ×${count}` : ''}
        </span>
        <span className={status.badgeClass}>{status.text}</span>
      </div>
      <p className="mt-1 font-mono text-textSecondary">
        {r.converged ? '' : 'Best estimate: '}
        {segments.join(' | ')}
      </p>
      <p className="mt-0.5 font-mono text-textSecondary">
        Firing range: {r.firingRangeNm.toFixed(1)} nm
      </p>
      {r.repositionWarning && (
        <p className="mt-1 inline-block rounded-sm border border-amberAccent/30 bg-amberAccent/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-amberAccent">
          {'⚠'} Reposition exceeds{' '}
          {formatDuration(scenario.repositionWarningThresholdS)}
        </p>
      )}
    </div>
  );
}

type ArrivalTableProps = {
  group: GroupResult;
  shipBySalvoId: Map<string, FriendlyShip>;
  salvos: SectionProps['ships'][number]['salvos'];
  missileById: Map<string, Missile>;
  toleranceS: number;
  hHourBase: number | null;
};

function ArrivalTable({
  group,
  shipBySalvoId,
  salvos,
  missileById,
  toleranceS,
  hHourBase,
}: ArrivalTableProps) {
  return (
    <div className="overflow-x-auto rounded border border-panelBorder">
      <table className="w-full border-collapse text-xs [&_td]:border-r [&_td]:border-panelBorder/40 [&_td:last-child]:border-r-0 [&_th]:border-r [&_th]:border-panelBorder/40 [&_th:last-child]:border-r-0">
        <thead>
          <tr className="bg-surfaceAlt/50 text-left font-bold uppercase tracking-wider text-textSecondary">
            <th className="px-2 py-1.5">Ship</th>
            <th className="px-2 py-1.5">Missile</th>
            <th className="px-2 py-1.5 text-right">Count</th>
            <th className="px-2 py-1.5 text-right">Wait</th>
            <th className="px-2 py-1.5">Fire at</th>
            <th className="px-2 py-1.5">Arrives</th>
            <th className="px-2 py-1.5 text-right">Delta</th>
          </tr>
        </thead>
        <tbody>
          {group.shipResults.map((r) => {
            const salvo = salvos.find((s) => s.id === r.salvoId);
            const missile = salvo ? missileById.get(salvo.missileId) : undefined;
            const delta = Math.round(group.synchronizedArrivalTimeS - r.arrivalTimeS);
            const withinTol = Math.abs(delta) <= toleranceS;
            const deltaText =
              delta === 0 ? '0s' : `${delta > 0 ? '+' : '−'}${Math.abs(delta)}s`;
            return (
              <tr key={r.salvoId} className="text-textPrimary odd:bg-surfaceAlt/20">
                <td className="px-2 py-1">{shipBySalvoId.get(r.salvoId)?.name ?? '—'}</td>
                <td className="px-2 py-1">{missile?.name ?? '—'}</td>
                <td className="px-2 py-1 text-right font-mono">{salvo?.count ?? 0}</td>
                <td className="px-2 py-1 text-right font-mono">{Math.round(r.waitTimeS)}s</td>
                <td className="px-2 py-1 font-mono">{formatTime(r.fireTimeS, hHourBase)}</td>
                <td className="px-2 py-1 font-mono">{formatTime(r.arrivalTimeS, hHourBase)}</td>
                <td
                  className={`px-2 py-1 text-right font-mono ${
                    withinTol ? 'text-greenAccent' : 'text-redAccent'
                  }`}
                >
                  <span className="inline-flex items-center justify-end gap-1.5">
                    {deltaText}
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        withinTol
                          ? 'bg-greenAccent shadow-[0_0_6px_#10B981]'
                          : 'bg-redAccent shadow-[0_0_6px_#EF4444]'
                      }`}
                    />
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

type SaturationSectionProps = {
  saturation: SaturationResult;
  group: GroupResult;
  salvos: SectionProps['ships'][number]['salvos'];
  shipBySalvoId: Map<string, FriendlyShip>;
  shipColorById: Map<string, string>;
  hHourBase: number | null;
};

function SaturationSection({
  saturation,
  group,
  salvos,
  shipBySalvoId,
  shipColorById,
  hHourBase,
}: SaturationSectionProps) {
  // Approach vectors for the compass rose: one line per salvo, colored by ship.
  const vectors = salvos.map((sv) => ({
    id: sv.id,
    bearingDeg: sv.bearingToTargetDeg,
    color: shipColorById.get(shipBySalvoId.get(sv.id)?.id ?? '') ?? '#9CA3AF',
  }));

  // Missiles-per-arrival-window histogram (group salvos by rounded arrival time).
  const arrivalBuckets = useMemo(() => {
    const arrivalBySalvo = new Map(group.shipResults.map((r) => [r.salvoId, r.arrivalTimeS]));
    const byTime = new Map<number, number>();
    for (const sv of salvos) {
      const t = Math.round(arrivalBySalvo.get(sv.id) ?? 0);
      byTime.set(t, (byTime.get(t) ?? 0) + sv.count);
    }
    return Array.from(byTime.entries())
      .sort(([a], [b]) => a - b)
      .map(([timeS, count]) => ({ timeS, count }));
  }, [group, salvos]);

  const maxBucket = arrivalBuckets.reduce((m, b) => Math.max(m, b.count), 0) || 1;

  return (
    <div className="space-y-4 border-t border-panelBorder p-3 text-xs">
      <div className="flex flex-wrap gap-6">
        <CompassRose vectors={vectors} />
        <div className="min-w-[180px] flex-1">
          <h4 className="mb-2 font-bold uppercase tracking-wider text-textSecondary">
            Missiles per arrival window
          </h4>
          <div className="space-y-1">
            {arrivalBuckets.map((b) => (
              <div key={b.timeS} className="flex items-center gap-2">
                <span className="w-28 shrink-0 font-mono text-textSecondary">
                  {formatTime(b.timeS, hHourBase)}
                </span>
                <div className="h-3 flex-1 rounded-sm border border-panelBorder bg-navy">
                  <div
                    className="h-full rounded-sm bg-gradient-to-r from-skyAccent to-sky-600 shadow-[0_0_8px_rgba(56,189,248,0.45)]"
                    style={{ width: `${(b.count / maxBucket) * 100}%` }}
                  />
                </div>
                <span className="w-6 shrink-0 text-right font-mono text-textPrimary">
                  {b.count}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div>
        <h4 className="mb-1 font-bold uppercase tracking-wider text-textSecondary">
          Layer breakdown
        </h4>
        <div className="overflow-hidden rounded border border-panelBorder">
          <table className="w-full border-collapse [&_td]:border-r [&_td]:border-panelBorder/40 [&_td:last-child]:border-r-0 [&_th]:border-r [&_th]:border-panelBorder/40 [&_th:last-child]:border-r-0">
            <thead>
              <tr className="bg-surfaceAlt/50 text-left font-bold uppercase tracking-wider text-textSecondary">
                <th className="px-2 py-1.5">Layer</th>
                <th className="px-2 py-1.5 text-right">Incoming</th>
                <th className="px-2 py-1.5 text-right">Intercepted</th>
                <th className="px-2 py-1.5 text-right">Leakers</th>
              </tr>
            </thead>
            <tbody>
              {saturation.layerResults.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-2 py-1 italic text-textSecondary">
                    No defense layers configured.
                  </td>
                </tr>
              ) : (
                saturation.layerResults.map((l, i) => (
                  <tr key={`${l.layerName}-${i}`} className="text-textPrimary odd:bg-surfaceAlt/20">
                    <td className="px-2 py-1">{l.layerName}</td>
                    <td className="px-2 py-1 text-right font-mono">{fmtNum(l.incoming)}</td>
                    <td className="px-2 py-1 text-right font-mono text-greenAccent">
                      {fmtNum(l.intercepted)}
                    </td>
                    <td className="px-2 py-1 text-right font-mono">{fmtNum(l.leakers)}</td>
                  </tr>
                ))
              )}
              <tr className="border-t border-panelBorder bg-surfaceAlt/40 font-bold uppercase tracking-wider text-textPrimary">
                <td className="px-2 py-1.5" colSpan={3}>
                  Expected hull impacts
                </td>
                <td
                  className={`px-2 py-1.5 text-right font-mono ${
                    saturation.hullImpacts > 0 ? 'text-redAccent' : 'text-greenAccent'
                  }`}
                >
                  {fmtNum(saturation.hullImpacts)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <VerdictCard saturation={saturation} />
    </div>
  );
}

function CompassRose({
  vectors,
}: {
  vectors: { id: string; bearingDeg: number; color: string }[];
}) {
  const size = 120;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 8;
  const labelFont = 11;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      <circle cx={cx} cy={cy} r={r} fill="#070C14" stroke="#1E2E4A" strokeWidth={1} />
      <text x={cx} y={labelFont} textAnchor="middle" fontSize={labelFont} fill="#8195AE">N</text>
      <text x={size - 2} y={cy + 4} textAnchor="end" fontSize={labelFont} fill="#8195AE">E</text>
      <text x={cx} y={size - 2} textAnchor="middle" fontSize={labelFont} fill="#8195AE">S</text>
      <text x={2} y={cy + 4} textAnchor="start" fontSize={labelFont} fill="#8195AE">W</text>
      {vectors.map((v) => {
        const rad = (((v.bearingDeg % 360) + 360) % 360 * Math.PI) / 180;
        const x = cx + Math.sin(rad) * (r - 4);
        const y = cy - Math.cos(rad) * (r - 4);
        return (
          <line
            key={v.id}
            x1={cx}
            y1={cy}
            x2={x}
            y2={y}
            stroke={v.color}
            strokeWidth={2}
            strokeLinecap="round"
            opacity={0.85}
          />
        );
      })}
      <circle cx={cx} cy={cy} r={2} fill="#8195AE" />
    </svg>
  );
}

function VerdictCard({ saturation }: { saturation: SaturationResult }) {
  const leak = fmtPct(saturation.saturationProbability);
  const expected = fmtNum(saturation.hullImpacts);
  if (saturation.saturated) {
    return (
      <div className="flex items-center gap-2 rounded-sm border border-redAccent/50 bg-redAccent/15 px-3 py-2 font-mono text-sm font-bold uppercase tracking-widest text-redAccent shadow-[0_0_12px_rgba(239,68,68,0.3)]">
        <span className="h-2 w-2 animate-pulse rounded-full bg-redAccent shadow-[0_0_8px_#EF4444]" />
        SATURATED &mdash; {leak} leak probability ({expected} expected on hull)
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 rounded-sm border border-greenAccent/50 bg-greenAccent/15 px-3 py-2 font-mono text-sm font-bold uppercase tracking-widest text-greenAccent shadow-[0_0_12px_rgba(16,185,129,0.25)]">
      <span className="h-2 w-2 rounded-full bg-greenAccent shadow-[0_0_8px_#10B981]" />
      DEFENDED &mdash; {leak} leak probability ({expected} expected on hull)
    </div>
  );
}
