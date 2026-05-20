import type {
  DefenseLayer,
  FriendlyShip,
  Missile,
  Salvo,
  Scenario,
  TargetShip,
} from '../types';
import { bearingTo, distance, projectPosition } from './geo';

export type InterceptResult = {
  shipId: string;
  salvoId: string;
  targetId: string;
  converged: boolean;
  iterations: number;
  repositionTimeS: number;
  optimalHeadingDeg: number;
  waitTimeS: number;
  fireTimeS: number;
  flightTimeS: number;
  arrivalTimeS: number;
  firingRangeNm: number;
  repositionWarning: boolean;
};

export type GroupResult = {
  targetId: string;
  synchronizedArrivalTimeS: number;
  shipResults: InterceptResult[];
  repositionWarnings: string[];
  nonConvergedWarnings: string[];
};

export type LayerResult = {
  layerName: string;
  incoming: number;
  intercepted: number;
  leakers: number;
};

export type BearingCluster = {
  centerDeg: number;
  count: number;
};

export type SaturationResult = {
  totalIncoming: number;
  bearingClusters: BearingCluster[];
  layerResults: LayerResult[];
  hullImpacts: number;
  saturated: boolean;
};

const MAX_ITERATIONS = 20;
const CONVERGE_EPSILON_S = 1;

const toRad = (deg: number): number => (deg * Math.PI) / 180;

function normalizeBearing(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

// Closing speed of the target along the line from target back to ship.
// Positive => target approaching ship origin.
function computeTargetClosingSpeed(target: TargetShip, salvo: Salvo): number {
  const bearingFromTargetToShip = normalizeBearing(salvo.bearingToTargetDeg + 180);
  const delta = normalizeBearing(target.headingDeg - bearingFromTargetToShip);
  // signed angle in (-180, 180]
  const signed = delta > 180 ? delta - 360 : delta;
  return target.speedKnots * Math.cos(toRad(signed));
}

type IterativeState = {
  converged: boolean;
  iterations: number;
  repositionTimeS: number;
  optimalHeadingDeg: number;
  flightTimeS: number;
  firingRangeNm: number;
};

function iterativeSolve(
  startRangeNm: number,
  startBearingDeg: number,
  ship: FriendlyShip,
  missile: Missile,
  target: TargetShip,
): IterativeState {
  let est = (startRangeNm / missile.speedKnots) * 3600;
  let last: IterativeState = {
    converged: false,
    iterations: 0,
    repositionTimeS: 0,
    optimalHeadingDeg: startBearingDeg,
    flightTimeS: est,
    firingRangeNm: startRangeNm,
  };

  for (let iter = 1; iter <= MAX_ITERATIONS; iter++) {
    const targetTravel = (target.speedKnots * est) / 3600;
    const targetPos = projectPosition(
      startRangeNm,
      startBearingDeg,
      targetTravel,
      target.headingDeg,
    );
    const optimalHeading = bearingTo(0, 0, targetPos.rangeNm, targetPos.bearingDeg);

    let repositionTimeS: number;
    let firingRangeNm: number;
    if (ship.speedKnots > 0) {
      const closingDist = Math.max(0, targetPos.rangeNm - missile.maxRangeNm);
      repositionTimeS = (closingDist / ship.speedKnots) * 3600;
      const shipTravel = (ship.speedKnots * repositionTimeS) / 3600;
      const shipFiringPos = projectPosition(0, 0, shipTravel, optimalHeading);
      firingRangeNm = distance(
        shipFiringPos.rangeNm,
        shipFiringPos.bearingDeg,
        targetPos.rangeNm,
        targetPos.bearingDeg,
      );
    } else {
      // Stationary ship — fire from origin, no reposition.
      repositionTimeS = 0;
      firingRangeNm = targetPos.rangeNm;
    }

    const flightTimeS = (firingRangeNm / missile.speedKnots) * 3600;
    const newArrival = repositionTimeS + flightTimeS;

    last = {
      converged: false,
      iterations: iter,
      repositionTimeS,
      optimalHeadingDeg: optimalHeading,
      flightTimeS,
      firingRangeNm,
    };

    if (Math.abs(newArrival - est) < CONVERGE_EPSILON_S) {
      last.converged = true;
      return last;
    }
    est = newArrival;
  }

  return last;
}

export function solveIntercept(
  ship: FriendlyShip,
  salvo: Salvo,
  missile: Missile,
  target: TargetShip,
  repositionWarningThresholdS: number,
): InterceptResult {
  const base = (overrides: Partial<InterceptResult> = {}): InterceptResult => ({
    shipId: ship.id,
    salvoId: salvo.id,
    targetId: target.id,
    converged: false,
    iterations: 0,
    repositionTimeS: 0,
    optimalHeadingDeg: salvo.bearingToTargetDeg,
    waitTimeS: 0,
    fireTimeS: 0,
    flightTimeS: 0,
    arrivalTimeS: 0,
    firingRangeNm: salvo.rangeToTargetNm,
    repositionWarning: false,
    ...overrides,
  });

  if (missile.speedKnots <= 0) return base();

  // Deviation #3: stationary ship + target closing + salvo outside missile range.
  if (ship.speedKnots <= 0 && salvo.rangeToTargetNm > missile.maxRangeNm) {
    const closingSpeed = computeTargetClosingSpeed(target, salvo);
    if (closingSpeed > 0) {
      const waitTimeS =
        ((salvo.rangeToTargetNm - missile.maxRangeNm) / closingSpeed) * 3600;
      const r = iterativeSolve(
        missile.maxRangeNm,
        salvo.bearingToTargetDeg,
        ship,
        missile,
        target,
      );
      return base({
        converged: r.converged,
        iterations: r.iterations,
        repositionTimeS: 0,
        optimalHeadingDeg: r.optimalHeadingDeg,
        waitTimeS,
        fireTimeS: waitTimeS,
        flightTimeS: r.flightTimeS,
        arrivalTimeS: waitTimeS + r.flightTimeS,
        firingRangeNm: r.firingRangeNm,
        repositionWarning: false,
      });
    }
    // Target not closing — stationary ship cannot ever fire.
    return base();
  }

  const r = iterativeSolve(
    salvo.rangeToTargetNm,
    salvo.bearingToTargetDeg,
    ship,
    missile,
    target,
  );

  return base({
    converged: r.converged,
    iterations: r.iterations,
    repositionTimeS: r.repositionTimeS,
    optimalHeadingDeg: r.optimalHeadingDeg,
    waitTimeS: 0,
    // Deviation #2: fireTimeS = repositionTimeS + waitTimeS (waitTimeS=0 here).
    fireTimeS: r.repositionTimeS,
    flightTimeS: r.flightTimeS,
    arrivalTimeS: r.repositionTimeS + r.flightTimeS,
    firingRangeNm: r.firingRangeNm,
    repositionWarning: r.repositionTimeS > repositionWarningThresholdS,
  });
}

export function solveGroup(
  ships: FriendlyShip[],
  salvos: Salvo[],
  missiles: Missile[],
  target: TargetShip,
  scenario: Scenario,
): GroupResult {
  const shipBySalvoId = new Map<string, FriendlyShip>();
  for (const ship of ships) {
    for (const salvo of ship.salvos) {
      shipBySalvoId.set(salvo.id, ship);
    }
  }
  const missileById = new Map(missiles.map((m) => [m.id, m]));

  const shipResults: InterceptResult[] = [];
  const repositionWarnings: string[] = [];
  const nonConvergedWarnings: string[] = [];

  for (const salvo of salvos) {
    const ship = shipBySalvoId.get(salvo.id);
    const missile = missileById.get(salvo.missileId);
    if (!ship || !missile) continue;
    const result = solveIntercept(
      ship,
      salvo,
      missile,
      target,
      scenario.repositionWarningThresholdS,
    );
    shipResults.push(result);
    if (result.repositionWarning && !repositionWarnings.includes(ship.name)) {
      repositionWarnings.push(ship.name);
    }
    if (!result.converged && !nonConvergedWarnings.includes(ship.name)) {
      nonConvergedWarnings.push(ship.name);
    }
  }

  const synchronizedArrivalTimeS = shipResults.reduce(
    (max, r) => (r.arrivalTimeS > max ? r.arrivalTimeS : max),
    0,
  );

  for (const r of shipResults) {
    const delta = synchronizedArrivalTimeS - r.arrivalTimeS;
    r.waitTimeS += delta;
    // Deviation #2: reposition first, then wait at firing point.
    r.fireTimeS = r.repositionTimeS + r.waitTimeS;
    r.arrivalTimeS = synchronizedArrivalTimeS;
  }

  return {
    targetId: target.id,
    synchronizedArrivalTimeS,
    shipResults,
    repositionWarnings,
    nonConvergedWarnings,
  };
}

// Deviation #1: 8 fixed 45° buckets centered at 0, 45, 90, ... 315.
// Bucket N (center 0°) covers 337.5°–22.5°.
export function clusterBearings(bearings: number[]): BearingCluster[] {
  const counts = new Map<number, number>();
  for (const b of bearings) {
    const normalized = normalizeBearing(b);
    const bucket = Math.floor(((normalized + 22.5) % 360) / 45);
    const center = bucket * 45;
    counts.set(center, (counts.get(center) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort(([a], [b]) => a - b)
    .map(([centerDeg, count]) => ({ centerDeg, count }));
}

// Deviation #4 (sliding window from first arrival in each layer) and
// Deviation #5 (envelope check at arrival, range ≈ 0).
export function computeLayerBreakdown(
  salvos: Salvo[],
  arrivalTimes: number[],
  layers: DefenseLayer[],
): LayerResult[] {
  // Expand salvos into per-missile arrival times.
  let pool: number[] = [];
  for (let i = 0; i < salvos.length; i++) {
    const at = arrivalTimes[i] ?? 0;
    for (let j = 0; j < salvos[i].count; j++) pool.push(at);
  }
  pool.sort((a, b) => a - b);

  const results: LayerResult[] = [];

  for (const layer of layers) {
    const incoming = pool.length;
    const minR = layer.minRangeNm ?? Number.NEGATIVE_INFINITY;
    const maxR = layer.maxRangeNm ?? Number.POSITIVE_INFINITY;
    const engages = minR <= 0 && maxR >= 0;

    if (!engages || incoming === 0) {
      results.push({
        layerName: layer.name,
        incoming,
        intercepted: 0,
        leakers: incoming,
      });
      continue;
    }

    const survivors: number[] = [];
    let intercepted = 0;
    let i = 0;
    while (i < pool.length) {
      const windowStart = pool[i];
      const windowEnd = windowStart + layer.windowS;
      const inWindow: number[] = [];
      while (i < pool.length && pool[i] < windowEnd) {
        inWindow.push(pool[i]);
        i++;
      }
      const killed = Math.min(inWindow.length, layer.interceptsPerWindow);
      intercepted += killed;
      for (let k = killed; k < inWindow.length; k++) survivors.push(inWindow[k]);
    }

    results.push({
      layerName: layer.name,
      incoming,
      intercepted,
      leakers: survivors.length,
    });
    pool = survivors;
  }

  return results;
}

export function computeSaturation(
  groupResult: GroupResult,
  salvos: Salvo[],
  target: TargetShip,
): SaturationResult {
  const bearings: number[] = [];
  let totalIncoming = 0;
  for (const salvo of salvos) {
    for (let i = 0; i < salvo.count; i++) bearings.push(salvo.bearingToTargetDeg);
    totalIncoming += salvo.count;
  }

  const bearingClusters = clusterBearings(bearings);

  const arrivalBySalvoId = new Map<string, number>();
  for (const r of groupResult.shipResults) {
    arrivalBySalvoId.set(r.salvoId, r.arrivalTimeS);
  }
  const arrivalTimes = salvos.map((s) => arrivalBySalvoId.get(s.id) ?? 0);

  const layerResults = computeLayerBreakdown(
    salvos,
    arrivalTimes,
    target.defenseLayers,
  );

  const hullImpacts =
    layerResults.length === 0
      ? totalIncoming
      : layerResults[layerResults.length - 1].leakers;

  return {
    totalIncoming,
    bearingClusters,
    layerResults,
    hullImpacts,
    saturated: hullImpacts > 0,
  };
}
