import { useMemo, useState } from 'react';
import { useScenario } from '../hooks/useScenario';
import {
  computeSaturation,
  solveGroup,
  type GroupResult,
  type InterceptResult,
  type SaturationResult,
} from '../lib/calc';
import type { FriendlyShip, Missile, Scenario, TargetShip } from '../types';

// Ship color palette (PRD §"Colors per ship"), cycled in friendly-ship order.
const SHIP_PALETTE = [
  '#3B82F6',
  '#10B981',
  '#F59E0B',
  '#EF4444',
  '#8B5CF6',
  '#EC4899',
  '#06B6D4',
  '#84CC16',
];

const pad2 = (n: number): string => String(n).padStart(2, '0');
const pad3 = (n: number): string => String(n).padStart(3, '0');

/** Parse "HH:MM:SS" into seconds since midnight, or null if malformed. */
function parseHHMMSS(value: string): number | null {
  const m = /^(\d{1,2}):([0-5]\d):([0-5]\d)$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  if (h > 23) return null;
  return h * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/** Format a clock time `offsetS` seconds after the H-hour base. */
function formatClock(baseSeconds: number, offsetS: number): string {
  const total = (((baseSeconds + Math.round(offsetS)) % 86400) + 86400) % 86400;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}

/** "T+Xs" plus " (HH:MM:SS)" when an H-hour base is set. */
function formatTime(seconds: number, hHourBase: number | null): string {
  const base = `T+${Math.round(seconds)}s`;
  return hHourBase === null ? base : `${base} (${formatClock(hHourBase, seconds)})`;
}

/** Human duration for reposition/wait phases, e.g. "53min" or "1h 7min". */
function formatDuration(seconds: number): string {
  const totalMin = Math.round(seconds / 60);
  if (totalMin < 1) return `${Math.round(seconds)}s`;
  if (totalMin < 60) return `${totalMin}min`;
  const h = Math.floor(totalMin / 60);
  const rem = totalMin % 60;
  return rem ? `${h}h ${rem}min` : `${h}h`;
}

type ShipStatus = {
  text: string;
  className: string;
};

function shipStatus(r: InterceptResult): ShipStatus {
  if (!r.converged) {
    return { text: '⚠️ Non-converged solution', className: 'text-redAccent' };
  }
  if (r.repositionTimeS > 0) {
    return {
      text: 'Repositioning required',
      className: r.repositionWarning ? 'text-amberAccent' : 'text-textPrimary',
    };
  }
  return { text: 'In range', className: 'text-greenAccent' };
}

export function ResultsPanel() {
  const { activeScenario, state, dispatch } = useScenario();

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
        <h2 className="text-sm font-semibold uppercase tracking-wide text-textSecondary">
          Results
        </h2>
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
            className={`w-28 rounded border bg-navy px-2 py-1 text-right text-textPrimary outline-none focus:border-greenAccent ${
              hHourValid ? 'border-panelBorder' : 'border-redAccent'
            }`}
          />
        </label>
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
            missiles={state.missileLibrary}
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
    return computeSaturation(group, salvos, target);
  }, [group, salvos, target]);

  return (
    <section className="rounded border border-panelBorder bg-panel">
      <div className="border-b border-panelBorder px-3 py-2">
        <h3 className="text-sm font-semibold text-textPrimary">{target.name}</h3>
        <p className="text-xs text-textSecondary">
          {target.speedKnots.toFixed(1)} kts, heading {pad3(target.headingDeg)}&deg; &middot;{' '}
          {target.defenseLayers.length} defense layer
          {target.defenseLayers.length === 1 ? '' : 's'}
        </p>
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
                className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-textSecondary hover:text-textPrimary"
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
    <div className="rounded border border-panelBorder bg-navy/40 p-2 text-xs">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-textPrimary">
          {ship?.name ?? 'Unknown ship'}
          {missile ? ` — ${missile.name}` : ''}
          {count ? ` ×${count}` : ''}
        </span>
        <span className={status.className}>{status.text}</span>
      </div>
      <p className="mt-1 text-textSecondary">
        {r.converged ? '' : 'Best estimate: '}
        {segments.join(' | ')}
      </p>
      <p className="mt-0.5 text-textSecondary">
        Firing range: {r.firingRangeNm.toFixed(1)} nm
      </p>
      {r.repositionWarning && (
        <p className="mt-1 inline-block rounded bg-amberAccent/20 px-2 py-0.5 text-amberAccent">
          {'⚠️'} Repositioning exceeds{' '}
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
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="text-left text-textSecondary">
            <th className="border-b border-panelBorder px-1 py-1 font-medium">Ship</th>
            <th className="border-b border-panelBorder px-1 py-1 font-medium">Missile</th>
            <th className="border-b border-panelBorder px-1 py-1 text-right font-medium">Count</th>
            <th className="border-b border-panelBorder px-1 py-1 text-right font-medium">Wait</th>
            <th className="border-b border-panelBorder px-1 py-1 font-medium">Fire at</th>
            <th className="border-b border-panelBorder px-1 py-1 font-medium">Arrives</th>
            <th className="border-b border-panelBorder px-1 py-1 text-right font-medium">Delta</th>
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
              <tr key={r.salvoId} className="text-textPrimary">
                <td className="border-b border-panelBorder/50 px-1 py-1">
                  {shipBySalvoId.get(r.salvoId)?.name ?? '—'}
                </td>
                <td className="border-b border-panelBorder/50 px-1 py-1">
                  {missile?.name ?? '—'}
                </td>
                <td className="border-b border-panelBorder/50 px-1 py-1 text-right">
                  {salvo?.count ?? 0}
                </td>
                <td className="border-b border-panelBorder/50 px-1 py-1 text-right">
                  {Math.round(r.waitTimeS)}s
                </td>
                <td className="border-b border-panelBorder/50 px-1 py-1">
                  {formatTime(r.fireTimeS, hHourBase)}
                </td>
                <td className="border-b border-panelBorder/50 px-1 py-1">
                  {formatTime(r.arrivalTimeS, hHourBase)}
                </td>
                <td
                  className={`border-b border-panelBorder/50 px-1 py-1 text-right ${
                    withinTol ? 'text-greenAccent' : 'text-redAccent'
                  }`}
                >
                  {deltaText} {withinTol ? '✓' : '✗'}
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
          <h4 className="mb-2 font-semibold text-textSecondary">Missiles per arrival window</h4>
          <div className="space-y-1">
            {arrivalBuckets.map((b) => (
              <div key={b.timeS} className="flex items-center gap-2">
                <span className="w-28 shrink-0 text-textSecondary">
                  {formatTime(b.timeS, hHourBase)}
                </span>
                <div className="h-4 flex-1 rounded bg-navy">
                  <div
                    className="h-4 rounded bg-[#3B82F6]"
                    style={{ width: `${(b.count / maxBucket) * 100}%` }}
                  />
                </div>
                <span className="w-6 shrink-0 text-right text-textPrimary">{b.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div>
        <h4 className="mb-1 font-semibold text-textSecondary">Layer breakdown</h4>
        <table className="w-full border-collapse">
          <thead>
            <tr className="text-left text-textSecondary">
              <th className="border-b border-panelBorder px-1 py-1 font-medium">Layer</th>
              <th className="border-b border-panelBorder px-1 py-1 text-right font-medium">Incoming</th>
              <th className="border-b border-panelBorder px-1 py-1 text-right font-medium">Intercepted</th>
              <th className="border-b border-panelBorder px-1 py-1 text-right font-medium">Leakers</th>
            </tr>
          </thead>
          <tbody>
            {saturation.layerResults.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-1 py-1 italic text-textSecondary">
                  No defense layers configured.
                </td>
              </tr>
            ) : (
              saturation.layerResults.map((l, i) => (
                <tr key={`${l.layerName}-${i}`} className="text-textPrimary">
                  <td className="border-b border-panelBorder/50 px-1 py-1">{l.layerName}</td>
                  <td className="border-b border-panelBorder/50 px-1 py-1 text-right">{l.incoming}</td>
                  <td className="border-b border-panelBorder/50 px-1 py-1 text-right text-greenAccent">
                    {l.intercepted}
                  </td>
                  <td className="border-b border-panelBorder/50 px-1 py-1 text-right">{l.leakers}</td>
                </tr>
              ))
            )}
            <tr className="font-bold text-textPrimary">
              <td className="px-1 py-1" colSpan={3}>
                Hull impacts
              </td>
              <td
                className={`px-1 py-1 text-right ${
                  saturation.hullImpacts > 0 ? 'text-redAccent' : 'text-greenAccent'
                }`}
              >
                {saturation.hullImpacts}
              </td>
            </tr>
          </tbody>
        </table>
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
      <circle cx={cx} cy={cy} r={r} fill="#0A0F1E" stroke="#1F2937" strokeWidth={1} />
      <text x={cx} y={labelFont} textAnchor="middle" fontSize={labelFont} fill="#9CA3AF">N</text>
      <text x={size - 2} y={cy + 4} textAnchor="end" fontSize={labelFont} fill="#9CA3AF">E</text>
      <text x={cx} y={size - 2} textAnchor="middle" fontSize={labelFont} fill="#9CA3AF">S</text>
      <text x={2} y={cy + 4} textAnchor="start" fontSize={labelFont} fill="#9CA3AF">W</text>
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
      <circle cx={cx} cy={cy} r={2} fill="#9CA3AF" />
    </svg>
  );
}

function VerdictCard({ saturation }: { saturation: SaturationResult }) {
  if (saturation.saturated) {
    return (
      <div className="rounded border border-redAccent bg-redAccent/15 px-3 py-2 font-semibold text-redAccent">
        SATURATED &mdash; {saturation.hullImpacts} missile
        {saturation.hullImpacts === 1 ? '' : 's'} reach hull
      </div>
    );
  }
  return (
    <div className="rounded border border-greenAccent bg-greenAccent/15 px-3 py-2 font-semibold text-greenAccent">
      DEFENDED &mdash; 0 missiles reach hull
    </div>
  );
}
