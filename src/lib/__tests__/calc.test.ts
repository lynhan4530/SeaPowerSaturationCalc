import { describe, expect, it } from 'vitest';
import type {
  DefenseLayer,
  FriendlyShip,
  Missile,
  Platform,
  Salvo,
  Scenario,
  TargetShip,
  WeaponSystem,
} from '../../types';
import {
  clusterBearings,
  computeLayerBreakdown,
  computeSaturation,
  solveGroup,
  solveIntercept,
  solveInverseSaturation,
} from '../calc';
import { migrateScenario } from '../storage';

let nextId = 0;
const id = (prefix: string) => `${prefix}-${++nextId}`;

const missile = (
  name: string,
  speedKnots: number,
  maxRangeNm: number,
  platform: Platform = 'surface_ship',
): Missile => ({ id: id('m'), name, speedKnots, maxRangeNm, platform });

const salvo = (
  missileId: string,
  targetId: string,
  count: number,
  rangeToTargetNm: number,
  bearingToTargetDeg: number,
): Salvo => ({
  id: id('s'),
  missileId,
  targetId,
  count,
  rangeToTargetNm,
  bearingToTargetDeg,
});

const ship = (
  name: string,
  speedKnots: number,
  salvos: Salvo[] = [],
  magazineSize = 100,
): FriendlyShip => ({
  id: id('ship'),
  name,
  speedKnots,
  magazineSize,
  salvos,
});

const target = (
  name: string,
  speedKnots: number,
  headingDeg: number,
  defenseLayers: DefenseLayer[] = [],
): TargetShip => ({
  id: id('tgt'),
  name,
  speedKnots,
  headingDeg,
  defenseLayers,
});

// Legacy-style helper: a layer with a single pk=1 SARH system. Reproduces the
// pre-Phase-2 integer model, so TC-21..46 read unchanged.
const layer = (
  name: string,
  interceptsPerWindow: number,
  windowS: number,
  opts: { minRangeNm?: number; maxRangeNm?: number } = {},
): DefenseLayer => ({
  id: id('lyr'),
  name,
  windowS,
  weaponSystems: [
    {
      id: id('ws'),
      name,
      guidance: 'SARH',
      channels: interceptsPerWindow,
      engagementsPerChannel: 1,
      pk: 1,
      ...opts,
    },
  ],
});

const ws = (
  pk: number,
  channels: number,
  engagementsPerChannel = 1,
  opts: { name?: string; minRangeNm?: number; maxRangeNm?: number } = {},
): WeaponSystem => ({
  id: id('ws'),
  name: opts.name ?? 'WS',
  guidance: 'SARH',
  channels,
  engagementsPerChannel,
  pk,
  minRangeNm: opts.minRangeNm,
  maxRangeNm: opts.maxRangeNm,
});

const sysLayer = (
  name: string,
  windowS: number,
  weaponSystems: WeaponSystem[],
): DefenseLayer => ({ id: id('lyr'), name, windowS, weaponSystems });

const scenario = (
  ships: FriendlyShip[],
  targets: TargetShip[],
  overrides: Partial<Scenario> = {},
): Scenario => ({
  id: id('sc'),
  name: 'test',
  simultaneityToleranceS: 10,
  repositionWarningThresholdS: 3600,
  saturationConfidence: 0.5,
  friendlyShips: ships,
  targetShips: targets,
  ...overrides,
});

// Run the full saturation pipeline for a single stationary in-range salvo so all
// missiles share one arrival window. Returns the SaturationResult.
const satFor = (tgt: TargetShip, count: number, confidence = 0.5) => {
  const m = missile('AShM', 500, 100);
  const s = salvo(m.id, tgt.id, count, 50, 0);
  const sh = ship('A', 0, [s]);
  const sc = scenario([sh], [tgt], { saturationConfidence: confidence });
  const g = solveGroup([sh], [s], [m], tgt, sc);
  return computeSaturation(g, [s], tgt, confidence);
};

// ───────── Solver ─────────

describe('TC-01: two ships, distinct flight times, slip later one', () => {
  it('syncs both arrivals to the latest', () => {
    const harpoon = missile('Harpoon', 537, 100);
    const exocet = missile('Exocet', 590, 100);
    const tgt = target('T', 0, 0);
    const sA = salvo(harpoon.id, tgt.id, 1, 60, 0);
    const sB = salvo(exocet.id, tgt.id, 1, 55, 0);
    const shipA = ship('A', 0, [sA]);
    const shipB = ship('B', 0, [sB]);
    const sc = scenario([shipA, shipB], [tgt]);

    const group = solveGroup([shipA, shipB], [sA, sB], [harpoon, exocet], tgt, sc);

    expect(group.synchronizedArrivalTimeS).toBeCloseTo(402.23, 0);
    const rA = group.shipResults.find((r) => r.shipId === shipA.id)!;
    const rB = group.shipResults.find((r) => r.shipId === shipB.id)!;
    expect(rA.waitTimeS).toBeCloseTo(0, 0);
    expect(rB.waitTimeS).toBeCloseTo(66.6, 0);
    expect(rA.arrivalTimeS).toBeCloseTo(rB.arrivalTimeS, 5);
    expect(rA.repositionTimeS).toBe(0);
    expect(rB.repositionTimeS).toBe(0);
  });
});

describe('TC-02: three ships, slowest sets sync', () => {
  it('A waits 89s and C waits 167s', () => {
    const mA = missile('Harpoon', 537, 100);
    const mB = missile('Heavy', 680, 100);
    const mC = missile('Slow', 420, 100);
    const tgt = target('T', 0, 0);
    const sA = salvo(mA.id, tgt.id, 1, 50, 0);
    const sB = salvo(mB.id, tgt.id, 1, 80, 0);
    const sC = salvo(mC.id, tgt.id, 1, 30, 0);
    const shipA = ship('A', 0, [sA]);
    const shipB = ship('B', 0, [sB]);
    const shipC = ship('C', 0, [sC]);
    const sc = scenario([shipA, shipB, shipC], [tgt]);

    const g = solveGroup(
      [shipA, shipB, shipC],
      [sA, sB, sC],
      [mA, mB, mC],
      tgt,
      sc,
    );

    expect(g.synchronizedArrivalTimeS).toBeCloseTo(423.5, 0);
    const rA = g.shipResults.find((r) => r.shipId === shipA.id)!;
    const rC = g.shipResults.find((r) => r.shipId === shipC.id)!;
    expect(rA.waitTimeS).toBeCloseTo(88.2, 0);
    expect(rC.waitTimeS).toBeCloseTo(166.4, 0);
  });
});

describe('TC-03: single ship in range', () => {
  it('wait 0, reposition 0, fire T+0', () => {
    const m = missile('M', 500, 100);
    const tgt = target('T', 0, 0);
    const s = salvo(m.id, tgt.id, 1, 50, 0);
    const sh = ship('Solo', 0, [s]);
    const sc = scenario([sh], [tgt]);
    const g = solveGroup([sh], [s], [m], tgt, sc);
    const r = g.shipResults[0];
    expect(r.repositionTimeS).toBe(0);
    expect(r.waitTimeS).toBe(0);
    expect(r.fireTimeS).toBe(0);
    expect(r.arrivalTimeS).toBeCloseTo(360, 0);
  });
});

describe('TC-04: two identical ships', () => {
  it('both fire at T+0, delta 0', () => {
    const m = missile('M', 500, 100);
    const tgt = target('T', 0, 0);
    const sA = salvo(m.id, tgt.id, 1, 50, 0);
    const sB = salvo(m.id, tgt.id, 1, 50, 0);
    const a = ship('A', 0, [sA]);
    const b = ship('B', 0, [sB]);
    const sc = scenario([a, b], [tgt]);
    const g = solveGroup([a, b], [sA, sB], [m], tgt, sc);
    const [rA, rB] = g.shipResults;
    expect(rA.fireTimeS).toBe(0);
    expect(rB.fireTimeS).toBe(0);
    expect(rA.arrivalTimeS).toBeCloseTo(rB.arrivalTimeS, 6);
  });
});

describe('TC-05: short-range ship repositions 2400s', () => {
  it('reposition exactly 2400s, no warning', () => {
    const tgt = target('T', 0, 0);
    const mA = missile('LongRange', 500, 100);
    const mB = missile('Short', 500, 50);
    const sA = salvo(mA.id, tgt.id, 1, 50, 0);
    const sB = salvo(mB.id, tgt.id, 1, 70, 0); // 20nm outside range
    const shipA = ship('A', 0, [sA]);
    const shipB = ship('B', 30, [sB]);
    const sc = scenario([shipA, shipB], [tgt]);
    const g = solveGroup([shipA, shipB], [sA, sB], [mA, mB], tgt, sc);
    const rB = g.shipResults.find((r) => r.shipId === shipB.id)!;
    expect(rB.repositionTimeS).toBeCloseTo(2400, 0);
    expect(rB.repositionWarning).toBe(false);
    expect(g.repositionWarnings).toHaveLength(0);
  });
});

describe('TC-06: reposition exactly 3600s, threshold strict', () => {
  it('no warning when reposition == threshold', () => {
    const tgt = target('T', 0, 0);
    const m = missile('M', 500, 50);
    const s = salvo(m.id, tgt.id, 1, 77, 0); // 27nm closing
    const sh = ship('A', 27, [s]);
    const sc = scenario([sh], [tgt]);
    const g = solveGroup([sh], [s], [m], tgt, sc);
    const r = g.shipResults[0];
    expect(r.repositionTimeS).toBeCloseTo(3600, 1);
    expect(r.repositionWarning).toBe(false);
  });
});

describe('TC-07: reposition > 3600s', () => {
  it('warning fires when reposition exceeds threshold', () => {
    const tgt = target('T', 0, 0);
    const m = missile('M', 500, 50);
    const s = salvo(m.id, tgt.id, 1, 77.01, 0);
    const sh = ship('A', 27, [s]);
    const sc = scenario([sh], [tgt]);
    const g = solveGroup([sh], [s], [m], tgt, sc);
    const r = g.shipResults[0];
    expect(r.repositionTimeS).toBeGreaterThan(3600);
    expect(r.repositionWarning).toBe(true);
    expect(g.repositionWarnings).toContain('A');
  });
});

describe('TC-08: ship slower than target — solver diverges', () => {
  it('converged=false, iterations=20, still returns result', () => {
    const m = missile('M', 500, 30);
    const tgt = target('T', 35, 90); // moving east
    const s = salvo(m.id, tgt.id, 1, 100, 90); // target to the east, moving away
    const sh = ship('Slow', 28, [s]);
    const r = solveIntercept(sh, s, m, tgt, 3600);
    expect(r.converged).toBe(false);
    expect(r.iterations).toBe(20);
    expect(Number.isFinite(r.arrivalTimeS)).toBe(true);
  });
});

describe('TC-09: A repositions 40min then waits 35min; B repositions 75min and red-flagged', () => {
  it('matches deviation #2 ordering (reposition then wait)', () => {
    const tgt = target('T', 0, 0);
    const m = missile('M', 500, 80);
    const sA = salvo(m.id, tgt.id, 1, 100, 0); // 20nm closing
    const sB = salvo(m.id, tgt.id, 1, 117.5, 0); // 37.5nm closing
    const shipA = ship('A', 30, [sA]);
    const shipB = ship('B', 30, [sB]);
    const sc = scenario([shipA, shipB], [tgt]);
    const g = solveGroup([shipA, shipB], [sA, sB], [m], tgt, sc);
    const rA = g.shipResults.find((r) => r.shipId === shipA.id)!;
    const rB = g.shipResults.find((r) => r.shipId === shipB.id)!;
    expect(rA.repositionTimeS).toBeCloseTo(2400, 0); // 40 min
    expect(rB.repositionTimeS).toBeCloseTo(4500, 0); // 75 min
    expect(rA.waitTimeS).toBeCloseTo(2100, 0); // 35 min
    expect(rB.waitTimeS).toBeCloseTo(0, 0);
    expect(rA.fireTimeS).toBeCloseTo(rA.repositionTimeS + rA.waitTimeS, 0);
    expect(rA.repositionWarning).toBe(false);
    expect(rB.repositionWarning).toBe(true);
    expect(g.repositionWarnings).toEqual(['B']);
  });
});

describe('TC-10: closing target on stationary ship — pre-check fires', () => {
  it('waitTimeS = 2160, repositionTimeS = 0', () => {
    const tgt = target('T', 25, 270); // moving west, ship is to the west
    const m = missile('M', 537, 50);
    const s = salvo(m.id, tgt.id, 1, 65, 90); // target east of ship
    const sh = ship('Static', 0, [s]);
    const r = solveIntercept(sh, s, m, tgt, 3600);
    expect(r.repositionTimeS).toBe(0);
    expect(r.waitTimeS).toBeCloseTo(2160, 0);
    expect(r.fireTimeS).toBeCloseTo(2160, 0);
    expect(r.repositionWarning).toBe(false);
  });
});

describe('TC-11: target moving away parallel to bearing', () => {
  it('effective firing range ≈ 44nm, not 40nm', () => {
    const tgt = target('T', 20, 90); // moving east
    const m = missile('M', 200, 100);
    const s = salvo(m.id, tgt.id, 1, 40, 90);
    const sh = ship('A', 0, [s]); // stationary, in range
    const r = solveIntercept(sh, s, m, tgt, 3600);
    expect(r.converged).toBe(true);
    expect(r.firingRangeNm).toBeGreaterThan(43);
    expect(r.firingRangeNm).toBeLessThan(45);
  });
});

describe('TC-12: target heading north, salvo bearing east', () => {
  it('intercept point lies northeast of target start', () => {
    const tgt = target('T', 20, 0); // moving north
    const m = missile('M', 500, 100);
    const s = salvo(m.id, tgt.id, 1, 40, 90);
    const sh = ship('A', 0, [s]);
    const r = solveIntercept(sh, s, m, tgt, 3600);
    expect(r.converged).toBe(true);
    // intercept bearing should be in NE quadrant: (0, 90)
    expect(r.optimalHeadingDeg).toBeGreaterThan(0);
    expect(r.optimalHeadingDeg).toBeLessThan(90);
  });
});

describe('TC-13: target heading directly toward ship', () => {
  it('firing range < initial range; flight shorter than naive', () => {
    const tgt = target('T', 30, 180); // moving south toward ship at origin
    const m = missile('M', 120, 100);
    const s = salvo(m.id, tgt.id, 1, 70, 0);
    const sh = ship('A', 0, [s]);
    const naiveFlight = (70 / 120) * 3600;
    const r = solveIntercept(sh, s, m, tgt, 3600);
    expect(r.converged).toBe(true);
    expect(r.firingRangeNm).toBeLessThan(70);
    expect(r.flightTimeS).toBeLessThan(naiveFlight);
  });
});

describe('TC-14: two ships, different geometries vs same heading target', () => {
  it('produces distinct reposition / heading profiles per ship', () => {
    const tgt = target('T', 20, 45); // moving NE
    const mA = missile('A', 500, 30);
    const mB = missile('B', 500, 30);
    const sA = salvo(mA.id, tgt.id, 1, 50, 90); // target east of A
    const sB = salvo(mB.id, tgt.id, 1, 50, 180); // target south of B
    const shipA = ship('A', 30, [sA]);
    const shipB = ship('B', 30, [sB]);
    const rA = solveIntercept(shipA, sA, mA, tgt, 3600);
    const rB = solveIntercept(shipB, sB, mB, tgt, 3600);
    expect(rA.converged).toBe(true);
    expect(rB.converged).toBe(true);
    expect(rA.optimalHeadingDeg).not.toBeCloseTo(rB.optimalHeadingDeg, 0);
    // both require reposition (target outside 30nm)
    expect(rA.repositionTimeS).toBeGreaterThan(0);
    expect(rB.repositionTimeS).toBeGreaterThan(0);
  });
});

describe('TC-15: stationary target, in range — single iteration', () => {
  it('converges in 1 iteration', () => {
    const tgt = target('T', 0, 0);
    const m = missile('M', 500, 100);
    const s = salvo(m.id, tgt.id, 1, 50, 0);
    const sh = ship('A', 30, [s]);
    const r = solveIntercept(sh, s, m, tgt, 3600);
    expect(r.converged).toBe(true);
    expect(r.iterations).toBe(1);
    expect(r.repositionTimeS).toBe(0);
  });
});

describe('TC-16: 15kts target, reposition needed — fast convergence', () => {
  it('converges in ≤5 iterations', () => {
    const tgt = target('T', 15, 0);
    const m = missile('M', 500, 50);
    const s = salvo(m.id, tgt.id, 1, 80, 0);
    // Fast escort closes faster than target moves; ratio Vt/Vs damps each iter.
    const sh = ship('A', 90, [s]);
    const r = solveIntercept(sh, s, m, tgt, 3600);
    expect(r.converged).toBe(true);
    expect(r.iterations).toBeLessThanOrEqual(5);
    expect(r.repositionTimeS).toBeGreaterThan(0);
  });
});

describe('TC-17: pathological non-convergence', () => {
  it('returns converged=false with a usable result', () => {
    const tgt = target('T', 40, 90);
    const m = missile('M', 500, 20);
    const s = salvo(m.id, tgt.id, 1, 200, 90);
    const sh = ship('A', 25, [s]);
    const r = solveIntercept(sh, s, m, tgt, 3600);
    expect(r.converged).toBe(false);
    expect(r.iterations).toBe(20);
    expect(r.arrivalTimeS).toBeGreaterThan(0);
  });
});

// ───────── Saturation ─────────

describe('TC-21: 8 missiles, SM-2 then CIWS, hull=0', () => {
  it('SM-2 intercepts 6, CIWS intercepts 2, hull 0', () => {
    const sm2 = layer('SM-2', 6, 30);
    const ciws = layer('CIWS', 4, 5);
    const tgt = target('T', 0, 0, [sm2, ciws]);
    const m = missile('AShM', 500, 100);
    const s = salvo(m.id, tgt.id, 8, 50, 0);
    const sh = ship('A', 0, [s]);
    const sc = scenario([sh], [tgt]);
    const g = solveGroup([sh], [s], [m], tgt, sc);
    const sat = computeSaturation(g, [s], tgt);
    expect(sat.totalIncoming).toBe(8);
    expect(sat.layerResults[0]).toMatchObject({ incoming: 8, intercepted: 6, leakers: 2 });
    expect(sat.layerResults[1]).toMatchObject({ incoming: 2, intercepted: 2, leakers: 0 });
    expect(sat.hullImpacts).toBe(0);
    expect(sat.saturated).toBe(false);
  });
});

describe('TC-22: 16 missiles, saturated', () => {
  it('SM-2 6, CIWS 4, hull 6', () => {
    const sm2 = layer('SM-2', 6, 30);
    const ciws = layer('CIWS', 4, 5);
    const tgt = target('T', 0, 0, [sm2, ciws]);
    const m = missile('AShM', 500, 100);
    const s = salvo(m.id, tgt.id, 16, 50, 0);
    const sh = ship('A', 0, [s]);
    const sc = scenario([sh], [tgt]);
    const g = solveGroup([sh], [s], [m], tgt, sc);
    const sat = computeSaturation(g, [s], tgt);
    expect(sat.layerResults[0]).toMatchObject({ incoming: 16, intercepted: 6, leakers: 10 });
    expect(sat.layerResults[1]).toMatchObject({ incoming: 10, intercepted: 4, leakers: 6 });
    expect(sat.hullImpacts).toBe(6);
    expect(sat.saturated).toBe(true);
  });
});

describe('TC-23: minRange skips SM-2 (envelope check at arrival)', () => {
  it('SM-2 with minRange 5 skips (0 ∉ [5, ∞)), passes to CIWS', () => {
    const sm2 = layer('SM-2', 6, 30, { minRangeNm: 5 });
    const ciws = layer('CIWS', 4, 5);
    const tgt = target('T', 0, 0, [sm2, ciws]);
    const m = missile('AShM', 500, 100);
    const s = salvo(m.id, tgt.id, 3, 3, 0);
    const result = computeLayerBreakdown([s], [0], [sm2, ciws]);
    expect(result[0]).toMatchObject({ incoming: 3, intercepted: 0, leakers: 3 });
    expect(result[1]).toMatchObject({ incoming: 3, intercepted: 3, leakers: 0 });
  });
});

describe('TC-24: maxRange irrelevant under arrival-based check (deviation #5)', () => {
  it('SM-2 max 80 still engages 95nm salvo (0 ∈ [-∞, 80])', () => {
    const sm2 = layer('SM-2', 6, 30, { maxRangeNm: 80 });
    const tgt = target('T', 0, 0, [sm2]);
    const m = missile('AShM', 500, 100);
    const s = salvo(m.id, tgt.id, 4, 95, 0);
    const result = computeLayerBreakdown([s], [0], [sm2]);
    expect(result[0]).toMatchObject({ incoming: 4, intercepted: 4, leakers: 0 });
  });
});

describe('TC-25: four salvos at 045°', () => {
  it('all in NE bucket — one cluster', () => {
    const clusters = clusterBearings([45, 45, 45, 45]);
    expect(clusters).toEqual([{ centerDeg: 45, count: 4 }]);
  });
});

describe('TC-26: cardinal directions', () => {
  it('produces four clusters', () => {
    const clusters = clusterBearings([0, 90, 180, 270]);
    expect(clusters).toEqual([
      { centerDeg: 0, count: 1 },
      { centerDeg: 90, count: 1 },
      { centerDeg: 180, count: 1 },
      { centerDeg: 270, count: 1 },
    ]);
  });
});

describe('TC-27: wrap-around at north', () => {
  it('344° and 16° land in the same north cluster', () => {
    const clusters = clusterBearings([344, 16]);
    expect(clusters).toEqual([{ centerDeg: 0, count: 2 }]);
  });
});

// ───────── Inverse solver ─────────

describe('TC-41: capacity is sum of engaging layers, threshold is +1', () => {
  it('SM-2 ×6 + CIWS ×4 → capacity 10, min salvo 11', () => {
    const sm2 = layer('SM-2', 6, 30);
    const ciws = layer('CIWS', 4, 5);
    const tgt = target('T', 0, 0, [sm2, ciws]);
    const inv = solveInverseSaturation(tgt);
    expect(inv.interceptCapacity).toBe(10);
    expect(inv.minSaturatingSalvo).toBe(11);
    expect(inv.layerCapacities.map((l) => l.effectiveCapacity)).toEqual([6, 4]);
  });
});

describe('TC-42: no defense layers → a single missile saturates', () => {
  it('capacity 0, min salvo 1', () => {
    const tgt = target('T', 0, 0, []);
    const inv = solveInverseSaturation(tgt);
    expect(inv.interceptCapacity).toBe(0);
    expect(inv.minSaturatingSalvo).toBe(1);
  });
});

describe('TC-43: weapon system with minRange > 0 is included in capacity', () => {
  it('SM-2 minRange 5 is included in capacity, assuming a standard outer launch range', () => {
    const sm2 = layer('SM-2', 6, 30, { minRangeNm: 5 });
    const ciws = layer('CIWS', 4, 5);
    const tgt = target('T', 0, 0, [sm2, ciws]);
    const inv = solveInverseSaturation(tgt);
    expect(inv.layerCapacities[0]).toMatchObject({ engages: true, effectiveCapacity: 6 });
    expect(inv.layerCapacities[1]).toMatchObject({ engages: true, effectiveCapacity: 4 });
    expect(inv.interceptCapacity).toBe(10);
    expect(inv.minSaturatingSalvo).toBe(11);
  });
});

describe('TC-44: maxRange irrelevant at arrival (deviation #5) — still engages', () => {
  it('SM-2 max 80 engages (0 ∈ [-∞, 80]), counts toward capacity', () => {
    const sm2 = layer('SM-2', 6, 30, { maxRangeNm: 80 });
    const tgt = target('T', 0, 0, [sm2]);
    const inv = solveInverseSaturation(tgt);
    expect(inv.layerCapacities[0].engages).toBe(true);
    expect(inv.minSaturatingSalvo).toBe(7);
  });
});

describe('TC-45: inverse is the exact dual of computeLayerBreakdown', () => {
  it('minSaturatingSalvo leaks 1 while one fewer leaks 0 (synchronized arrival)', () => {
    const sm2 = layer('SM-2', 6, 30);
    const ciws = layer('CIWS', 4, 5);
    const tgt = target('T', 0, 0, [sm2, ciws]);
    const m = missile('AShM', 500, 100);
    const n = solveInverseSaturation(tgt).minSaturatingSalvo; // 11

    // All arrive together (one window everywhere). n saturates, n-1 does not.
    const atN = computeLayerBreakdown([salvo(m.id, tgt.id, n, 50, 0)], [0], [sm2, ciws]);
    const atNminus1 = computeLayerBreakdown(
      [salvo(m.id, tgt.id, n - 1, 50, 0)],
      [0],
      [sm2, ciws],
    );
    expect(atN[atN.length - 1].leakers).toBe(1);
    expect(atNminus1[atNminus1.length - 1].leakers).toBe(0);
  });
});

describe('TC-46: negative interceptsPerWindow clamps to 0 capacity', () => {
  it('a malformed layer never lowers the threshold below baseline', () => {
    const bad = layer('Bad', -3, 10);
    const tgt = target('T', 0, 0, [bad]);
    const inv = solveInverseSaturation(tgt);
    expect(inv.interceptCapacity).toBe(0);
    expect(inv.minSaturatingSalvo).toBe(1);
  });
});

// ───────── Channel-based defense + leak probability (Phase 2) ─────────

describe('TC-47: pk=1 layer with capacity ≥ raid leaks nothing', () => {
  it('4 channels ×1 pk1 vs 4 incoming → 0 expected impacts, defended', () => {
    const tgt = target('T', 0, 0, [sysLayer('SAM', 30, [ws(1, 4)])]);
    const sat = satFor(tgt, 4);
    expect(sat.hullImpacts).toBeCloseTo(0, 6);
    expect(sat.saturationProbability).toBeCloseTo(0, 6);
    expect(sat.saturated).toBe(false);
  });
});

describe('TC-48: pk=1 raid beyond capacity saturates', () => {
  it('4 channels ×1 pk1 vs 6 incoming → 2 expected impacts, P=1', () => {
    const tgt = target('T', 0, 0, [sysLayer('SAM', 30, [ws(1, 4)])]);
    const sat = satFor(tgt, 6);
    expect(sat.hullImpacts).toBeCloseTo(2, 6);
    expect(sat.saturationProbability).toBeCloseTo(1, 6);
    expect(sat.saturated).toBe(true);
  });
});

describe('TC-49: pk<1 single shot is probabilistic', () => {
  it('1 channel pk0.8 vs 1 incoming → q=0.2 expected impacts, P=0.2', () => {
    const tgt = target('T', 0, 0, [sysLayer('SAM', 30, [ws(0.8, 1)])]);
    const sat = satFor(tgt, 1);
    expect(sat.hullImpacts).toBeCloseTo(0.2, 6);
    expect(sat.saturationProbability).toBeCloseTo(0.2, 6);
    expect(sat.saturated).toBe(false);
  });
});

describe('TC-50: legacy scenario migrates to a pk=1 system, reproducing old math', () => {
  it('synthesizes one SARH system per layer and matches the TC-22 breakdown', () => {
    const legacy = {
      id: 'sc-legacy',
      name: 'legacy',
      simultaneityToleranceS: 10,
      repositionWarningThresholdS: 3600,
      friendlyShips: [],
      targetShips: [
        {
          id: 't-legacy',
          name: 'T',
          speedKnots: 0,
          headingDeg: 0,
          defenseLayers: [
            { id: 'l1', name: 'SM-2', interceptsPerWindow: 6, windowS: 30 },
            { id: 'l2', name: 'CIWS', interceptsPerWindow: 4, windowS: 5 },
          ],
        },
      ],
    } as unknown as Scenario;

    const migrated = migrateScenario(legacy);
    expect(migrated.saturationConfidence).toBe(0.5);
    const layers = migrated.targetShips[0].defenseLayers;
    expect(layers[0].weaponSystems).toHaveLength(1);
    expect(layers[0].weaponSystems[0]).toMatchObject({
      channels: 6,
      engagementsPerChannel: 1,
      pk: 1,
      guidance: 'SARH',
    });

    const br = computeLayerBreakdown([salvo('m', 't-legacy', 16, 50, 0)], [0], layers);
    expect(br[0]).toMatchObject({ incoming: 16, intercepted: 6, leakers: 10 });
    expect(br[1]).toMatchObject({ incoming: 10, intercepted: 4, leakers: 6 });
  });
});

describe('TC-51: engagementsPerChannel multiplies a window’s shot budget', () => {
  it('2 channels ×2 pk0.5 spreads 4 shots; coverage depends on raid size', () => {
    const tgt = target('T', 0, 0, [sysLayer('SAM', 30, [ws(0.5, 2, 2)])]);
    // 4 incoming, 4 shots → one shot each → expected impacts 4 × 0.5 = 2.
    expect(satFor(tgt, 4).hullImpacts).toBeCloseTo(2, 6);
    // 2 incoming, 4 shots → two shots each → expected 2 × 0.25 = 0.5.
    expect(satFor(tgt, 2).hullImpacts).toBeCloseTo(0.5, 6);
  });
});

describe('TC-52: multiple systems in a layer pool their shots', () => {
  it('two pk0.5 single-channel systems double up on a lone missile (q=0.25)', () => {
    const two = target('T', 0, 0, [sysLayer('L', 30, [ws(0.5, 1), ws(0.5, 1)])]);
    const one = target('T', 0, 0, [sysLayer('L', 30, [ws(0.5, 1)])]);
    expect(satFor(two, 1).hullImpacts).toBeCloseTo(0.25, 6);
    expect(satFor(one, 1).hullImpacts).toBeCloseTo(0.5, 6);
  });
});

describe('TC-53: a system out of envelope at arrival but in range at launch still engages', () => {
  it('minRange 5 system engages a 50nm salvo, but is skipped for a 3nm salvo', () => {
    const tgt = target('T', 0, 0, [
      sysLayer('L', 30, [ws(1, 2), ws(1, 10, 1, { minRangeNm: 5 })]),
    ]);
    // Salvo at 50nm - both systems engage (total capacity 12)
    const br50 = computeLayerBreakdown([salvo('m', tgt.id, 3, 50, 0)], [0], tgt.defenseLayers);
    expect(br50[0]).toMatchObject({ incoming: 3, intercepted: 3, leakers: 0 });

    // Salvo at 3nm - minRange 5 system is skipped (only system 1 engages with capacity 2)
    const br3 = computeLayerBreakdown([salvo('m', tgt.id, 3, 3, 0)], [0], tgt.defenseLayers);
    expect(br3[0]).toMatchObject({ incoming: 3, intercepted: 2, leakers: 1 });
  });
});

describe('TC-54: inverse solver threshold depends on confidence', () => {
  it('pk0.5 ×2 needs 2 arrivals at 50% but 3 at 90%', () => {
    const tgt = target('T', 0, 0, [sysLayer('SAM', 30, [ws(0.5, 2)])]);
    expect(solveInverseSaturation(tgt, 0.5).minSaturatingSalvo).toBe(2);
    expect(solveInverseSaturation(tgt, 0.9).minSaturatingSalvo).toBe(3);
  });
  it('at pk=1 it collapses to (Σ shots) + 1 regardless of confidence', () => {
    const tgt = target('T', 0, 0, [sysLayer('SAM', 30, [ws(1, 2)])]);
    const inv = solveInverseSaturation(tgt, 0.5);
    expect(inv.interceptCapacity).toBe(2);
    expect(inv.minSaturatingSalvo).toBe(3);
    expect(solveInverseSaturation(tgt, 0.9).minSaturatingSalvo).toBe(3);
  });
});

describe('TC-55: survival probability compounds across layers', () => {
  it('two pk0.5 layers vs 1 missile → q = 0.25 expected on hull', () => {
    const tgt = target('T', 0, 0, [
      sysLayer('Outer', 30, [ws(0.5, 1)]),
      sysLayer('Inner', 5, [ws(0.5, 1)]),
    ]);
    const sat = satFor(tgt, 1);
    expect(sat.hullImpacts).toBeCloseTo(0.25, 6);
    expect(sat.saturationProbability).toBeCloseTo(0.25, 6);
  });
});

// ───────── Edge cases ─────────

describe('TC-35: near-zero range', () => {
  it('flight time 0.67s, no crash', () => {
    const tgt = target('T', 0, 0);
    const m = missile('M', 537, 100);
    const s = salvo(m.id, tgt.id, 1, 0.1, 0);
    const sh = ship('A', 0, [s]);
    const r = solveIntercept(sh, s, m, tgt, 3600);
    expect(r.converged).toBe(true);
    expect(r.flightTimeS).toBeCloseTo(0.67, 1);
    expect(r.firingRangeNm).toBeCloseTo(0.1, 3);
  });
});

describe('TC-36: very long flight', () => {
  it('range 990nm gives ~6637s flight, no overflow', () => {
    const tgt = target('T', 0, 0);
    const m = missile('M', 537, 1000);
    const s = salvo(m.id, tgt.id, 1, 990, 0);
    const sh = ship('A', 0, [s]);
    const r = solveIntercept(sh, s, m, tgt, 3600);
    expect(r.converged).toBe(true);
    expect(r.flightTimeS).toBeCloseTo(6637, 0);
    expect(Number.isFinite(r.arrivalTimeS)).toBe(true);
  });
});
