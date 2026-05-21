import type {
  DefenseLayer,
  FriendlyShip,
  GuidanceType,
  Missile,
  Salvo,
  Scenario,
  TargetShip,
  WeaponSystem,
} from '../types';
import { bearingTo, distance, projectPosition } from './geo';

/** Default leak-probability threshold for the SATURATED verdict / inverse solver. */
export const DEFAULT_SATURATION_CONFIDENCE = 0.5;

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
  // All three are *expected* values (Σ per-missile survival probability), so they
  // are fractional in general and exact integers when every pk = 1.
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
  // Expected missiles reaching the hull (Σ final survival probability).
  hullImpacts: number;
  // P(at least one missile reaches the hull) = 1 − Π(1 − survival_i).
  saturationProbability: number;
  // saturationProbability ≥ confidence.
  saturated: boolean;
};

export type WeaponSystemCapacity = {
  systemName: string;
  guidance: GuidanceType;
  engages: boolean;
  // channels × engagementsPerChannel (clamped ≥ 0), 0 when not engaging.
  shots: number;
  pk: number;
};

export type LayerCapacity = {
  layerName: string;
  engages: boolean;
  // Σ engaging shots in one window.
  shots: number;
  // Σ engaging shots × pk — expected kills. Equals `shots` when every pk = 1.
  // (Name kept for the threshold card; it is the legacy "effective capacity".)
  effectiveCapacity: number;
  systems: WeaponSystemCapacity[];
};

export type InverseSaturationResult = {
  targetId: string;
  // Confidence used to derive minSaturatingSalvo.
  confidence: number;
  // Σ effectiveCapacity over engaging layers — expected kills in one window.
  // Reduces to the old integer intercept capacity when every pk = 1.
  interceptCapacity: number;
  // Smallest synchronized salvo whose saturationProbability ≥ confidence.
  minSaturatingSalvo: number;
  layerCapacities: LayerCapacity[];
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

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

// A weapon system engages iff its envelope contains the arrival range ≈ 0
// (deviation #5). minR/maxR default to ±∞.
function systemEngages(ws: WeaponSystem): boolean {
  const minR = ws.minRangeNm ?? Number.NEGATIVE_INFINITY;
  const maxR = ws.maxRangeNm ?? Number.POSITIVE_INFINITY;
  return minR <= 0 && maxR >= 0;
}

// One window's worth of shots for a layer: each engaging system contributes
// channels × engagementsPerChannel shots tagged with its pk. Sorted pk-desc so
// allocation deals the best shots first. Counts are floored & clamped ≥ 0 so a
// malformed system never produces negative or fractional shots.
function layerShots(layer: DefenseLayer): number[] {
  const shots: number[] = [];
  for (const ws of layer.weaponSystems) {
    if (!systemEngages(ws)) continue;
    const n =
      Math.max(0, Math.floor(ws.channels)) *
      Math.max(0, Math.floor(ws.engagementsPerChannel));
    const pk = clamp01(ws.pk);
    for (let i = 0; i < n; i++) shots.push(pk);
  }
  return shots.sort((a, b) => b - a);
}

type SimResult = { layerResults: LayerResult[]; finalSurvival: number[] };

// Core probabilistic defense simulation. Each missile carries a survival
// probability q (1 = certain hit on hull). Layers apply in order; within a
// layer the still-live missiles (q > 0) are grouped into sliding windows
// (deviation #4) and each window is dealt the layer's shot pool, one shot per
// live missile per pass (even spread — the defender can't tell which contacts
// are already dead). A shot of probability p multiplies that missile's q by
// (1 − p). At pk = 1 this reduces exactly to the old integer model: an engaged
// missile's q snaps to 0, so per-layer expected counts are whole numbers.
function simulateDefense(arrivalPool: number[], layers: DefenseLayer[]): SimResult {
  const n = arrivalPool.length;
  const survival = new Array<number>(n).fill(1);
  const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
  const layerResults: LayerResult[] = [];

  for (const layer of layers) {
    const incoming = sum(survival);
    const shots = layerShots(layer);

    if (shots.length === 0 || incoming === 0) {
      layerResults.push({
        layerName: layer.name,
        incoming,
        intercepted: 0,
        leakers: incoming,
      });
      continue;
    }

    // Live missiles, ordered by arrival, for windowing.
    const live: number[] = [];
    for (let i = 0; i < n; i++) if (survival[i] > 0) live.push(i);
    live.sort((a, b) => arrivalPool[a] - arrivalPool[b]);

    let i = 0;
    while (i < live.length) {
      const windowStart = arrivalPool[live[i]];
      const windowEnd = windowStart + layer.windowS;
      const windowIdx: number[] = [];
      while (i < live.length && arrivalPool[live[i]] < windowEnd) {
        windowIdx.push(live[i]);
        i++;
      }
      // Deal shots round-robin: pass after pass, one per missile.
      let s = 0;
      while (s < shots.length) {
        for (let k = 0; k < windowIdx.length && s < shots.length; k++) {
          survival[windowIdx[k]] *= 1 - shots[s];
          s++;
        }
      }
    }

    const leakers = sum(survival);
    layerResults.push({
      layerName: layer.name,
      incoming,
      intercepted: incoming - leakers,
      leakers,
    });
  }

  return { layerResults, finalSurvival: survival };
}

function expandPool(salvos: Salvo[], arrivalTimes: number[]): number[] {
  const pool: number[] = [];
  for (let i = 0; i < salvos.length; i++) {
    const at = arrivalTimes[i] ?? 0;
    for (let j = 0; j < salvos[i].count; j++) pool.push(at);
  }
  return pool;
}

// P(at least one missile reaches the hull) given per-missile survival probs.
function leakProbability(survival: number[]): number {
  let allKilled = 1;
  for (const q of survival) allKilled *= 1 - q;
  return 1 - allKilled;
}

// Deviation #4 (sliding window from first arrival in each layer) and
// Deviation #5 (envelope check at arrival, range ≈ 0).
export function computeLayerBreakdown(
  salvos: Salvo[],
  arrivalTimes: number[],
  layers: DefenseLayer[],
): LayerResult[] {
  return simulateDefense(expandPool(salvos, arrivalTimes), layers).layerResults;
}

// Inverse of the forward model under perfect synchronization. The app drives
// every salvo to one synchronizedArrivalTimeS, so all missiles fall in a single
// window at every layer. minSaturatingSalvo is the smallest synchronized salvo
// whose leak probability reaches `confidence`, found by evaluating the forward
// per-window model at increasing N (bounded: once N exceeds the total shot
// count some missile is guaranteed unengaged, forcing leak probability to 1).
// At pk = 1 this collapses to the Phase-1 result, (Σ engaging shots) + 1.
export function solveInverseSaturation(
  target: TargetShip,
  confidence: number = DEFAULT_SATURATION_CONFIDENCE,
): InverseSaturationResult {
  const conf = clamp01(confidence);
  const layerCapacities: LayerCapacity[] = target.defenseLayers.map((layer) => {
    const systems: WeaponSystemCapacity[] = layer.weaponSystems.map((ws) => {
      const engages = systemEngages(ws);
      const shots = engages
        ? Math.max(0, Math.floor(ws.channels)) *
          Math.max(0, Math.floor(ws.engagementsPerChannel))
        : 0;
      return {
        systemName: ws.name,
        guidance: ws.guidance,
        engages,
        shots,
        pk: clamp01(ws.pk),
      };
    });
    const shots = systems.reduce((sum, s) => sum + s.shots, 0);
    const effectiveCapacity = systems.reduce((sum, s) => sum + s.shots * s.pk, 0);
    return {
      layerName: layer.name,
      engages: systems.some((s) => s.engages),
      shots,
      effectiveCapacity,
      systems,
    };
  });

  const interceptCapacity = layerCapacities.reduce(
    (sum, l) => sum + l.effectiveCapacity,
    0,
  );
  const totalShots = layerCapacities.reduce((sum, l) => sum + l.shots, 0);

  // Search 1..totalShots+1; the upper bound always saturates (pigeonhole).
  let minSaturatingSalvo = totalShots + 1;
  for (let nSalvo = 1; nSalvo <= totalShots + 1; nSalvo++) {
    const pool = new Array<number>(nSalvo).fill(0);
    const { finalSurvival } = simulateDefense(pool, target.defenseLayers);
    if (leakProbability(finalSurvival) >= conf) {
      minSaturatingSalvo = nSalvo;
      break;
    }
  }

  return {
    targetId: target.id,
    confidence: conf,
    interceptCapacity,
    minSaturatingSalvo,
    layerCapacities,
  };
}

export function computeSaturation(
  groupResult: GroupResult,
  salvos: Salvo[],
  target: TargetShip,
  confidence: number = DEFAULT_SATURATION_CONFIDENCE,
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

  const { layerResults, finalSurvival } = simulateDefense(
    expandPool(salvos, arrivalTimes),
    target.defenseLayers,
  );

  const hullImpacts = finalSurvival.reduce((a, b) => a + b, 0);
  const saturationProbability = leakProbability(finalSurvival);

  return {
    totalIncoming,
    bearingClusters,
    layerResults,
    hullImpacts,
    saturationProbability,
    saturated: saturationProbability >= clamp01(confidence),
  };
}
