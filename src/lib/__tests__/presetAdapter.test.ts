import { describe, expect, it } from 'vitest';
import type {
  LauncherPreset,
  MissilePreset,
  PresetsJson,
  ShipPreset,
} from '../../types';
import {
  aawMissilesInLoadout,
  cycleTimeS,
  defaultPkForGuidance,
  deriveEngagementsPerChannel,
  estimateIntercepts,
  estimateLeakers,
  estimateShipSaturation,
  flightTimeS,
  raidWindowFromGeometry,
  resolvePk,
  targetingChannels,
  timePerEngagementS,
} from '../presetAdapter';
import sample from './fixtures/sample-presets.json';

// The fixture is the parser's `sample-presets.json` (Ticonderoga + Arleigh Burke),
// the exact data the SAMPLE_USAGE.md worked example is derived from.
const presets = sample as unknown as PresetsJson;

const missilesById = new Map<string, MissilePreset>(presets.missiles.map((m) => [m.id, m]));
const launchersById = new Map<string, LauncherPreset>(presets.launchers.map((l) => [l.id, l]));

const ticonderoga = presets.ships.find((s) => s.id === 'usn_cg_ticonderoga') as ShipPreset;
const burke = presets.ships.find((s) => s.id === 'usn_dd_arleigh-burke') as ShipPreset;
const rim66c = missilesById.get('usn_rim-66c') as MissilePreset;
const mk13 = launchersById.get('MK13') as LauncherPreset;
const ak630 = launchersById.get('AK630') as LauncherPreset;
const mk46 = missilesById.get('usn_mk46') as MissilePreset;

describe('preset adapter — primitive formulas', () => {
  it('flightTimeS = (range / speed) × 3600', () => {
    // SAMPLE_USAGE: 30 nm intercept at 600 kt → 180 s.
    expect(flightTimeS(30, 600)).toBe(180);
    expect(flightTimeS(70, 600)).toBeCloseTo(420, 5);
  });

  it('flightTimeS is null for unusable interceptor speed', () => {
    expect(flightTimeS(30, null)).toBeNull();
    expect(flightTimeS(30, 0)).toBeNull();
  });

  it('cycleTimeS prefers reloadTimeS, falls back to fire rate', () => {
    // MK13 has reloadTimeS 4.5 → used directly (not the 60/13.33 fire-rate value).
    expect(cycleTimeS(mk13)).toBe(4.5);
    // AK-630 has null reload but 4200 rpm → 60/4200.
    expect(cycleTimeS(ak630)).toBeCloseTo(60 / 4200, 6);
    expect(cycleTimeS(null)).toBeNull();
    expect(cycleTimeS({ reloadTimeS: null, fireRatePerMin: null })).toBeNull();
  });

  it('raidWindowFromGeometry matches the worked example (~374 s)', () => {
    // contact 80, intercept 30, attacker 450, ship 32 → 50 nm / 482 kt.
    const w = raidWindowFromGeometry({
      contactRangeNm: 80,
      interceptRangeNm: 30,
      attackerSpeedKnots: 450,
      shipSpeedKnots: 32,
    });
    expect(w).toBeCloseTo((50 / 482) * 3600, 3);
    // Exactly 373.4 s; the SAMPLE_USAGE walkthrough rounds this loosely to "≈374".
    expect(Math.round(w)).toBe(373);
  });

  it('timePerEngagementS = flight + cycle', () => {
    const tpe = timePerEngagementS({ interceptRangeNm: 30, samSpeedKnots: 600, launcher: mk13 });
    expect(tpe).toBe(184.5); // 180 + 4.5
  });
});

describe('preset adapter — engagementsPerChannel', () => {
  it('floors raidWindow / timePerEngagement, min 1', () => {
    // SAMPLE_USAGE close-range scenario → 2 (whether cycle is the formula 4.5 or
    // the doc walkthrough 6.5: floor(374/184.5)=2 and floor(374/186.5)=2).
    const eng = deriveEngagementsPerChannel({
      raidWindowS: 374,
      interceptRangeNm: 30,
      samSpeedKnots: 600,
      launcher: mk13,
    });
    expect(eng).toBe(2);
  });

  it('long-flight area SAM at full max range collapses to a single engagement', () => {
    // 70 nm at 600 kt → 420 s flight; one engagement barely fits a 374 s window.
    const eng = deriveEngagementsPerChannel({
      raidWindowS: 374,
      interceptRangeNm: 70,
      samSpeedKnots: 600,
      launcher: mk13,
    });
    expect(eng).toBe(1);
  });

  it('falls back to 1 with a warning when timing is unresolvable', () => {
    const warnings: string[] = [];
    const eng = deriveEngagementsPerChannel(
      { raidWindowS: 374, interceptRangeNm: 30, samSpeedKnots: null, launcher: mk13 },
      warnings,
    );
    expect(eng).toBe(1);
    expect(warnings.some((w) => w.includes('fallback 1'))).toBe(true);
  });
});

describe('preset adapter — intercepts & leakers', () => {
  it('totalIntercepts = channels × engagementsPerChannel × pk', () => {
    // SAMPLE_USAGE: 4 × 2 × 0.8 = 6.4.
    expect(estimateIntercepts({ channels: 4, engagementsPerChannel: 2, pk: 0.8 })).toBeCloseTo(6.4, 6);
  });

  it('leakers = max(0, inbound − round(totalIntercepts))', () => {
    // 12 inbound − round(6.4) = 12 − 6 = 6.
    expect(estimateLeakers({ inbound: 12, channels: 4, engagementsPerChannel: 2, pk: 0.8 })).toBe(6);
    // Over-defended raids never report negative leakers.
    expect(estimateLeakers({ inbound: 2, channels: 4, engagementsPerChannel: 2, pk: 0.8 })).toBe(0);
  });
});

describe('preset adapter — channel resolution', () => {
  it('reads pre-computed weaponChannels, excluding DirectedSearch directors', () => {
    // Ticonderoga: weaponChannels 4 (two SPG-62 Targeting directors × 2). The
    // SPY-1A DirectedSearch director (24 ch) must NOT inflate the headline.
    expect(targetingChannels(ticonderoga)).toBe(4);
    expect(burke.weaponChannels).toBe(2);
    expect(targetingChannels(burke)).toBe(2);
  });

  it('warns when pre-computed channels disagree with the Targeting-director sum', () => {
    const warnings: string[] = [];
    const tampered: ShipPreset = { ...ticonderoga, weaponChannels: 6 };
    expect(targetingChannels(tampered, warnings)).toBe(6); // trusts pre-computed
    expect(warnings.some((w) => w.includes('≠ Targeting-director sum 4'))).toBe(true);
  });
});

describe('preset adapter — null handling & defaults', () => {
  it('resolvePk uses the killProbability when present', () => {
    expect(resolvePk(rim66c)).toBe(0.8);
  });

  it('resolvePk falls back to a guidance-family default (warned) for null Pk', () => {
    const warnings: string[] = [];
    const pk = resolvePk(mk46, warnings); // MK 46: killProbability null, ActiveSonar
    expect(pk).toBe(defaultPkForGuidance('ActiveSonar'));
    expect(warnings.some((w) => w.includes('killProbability is null'))).toBe(true);
  });

  it('never assumes zero Pk for unknown values', () => {
    expect(defaultPkForGuidance('Unknown')).toBeGreaterThan(0);
    expect(defaultPkForGuidance('None')).toBeGreaterThan(0);
  });
});

describe('preset adapter — AAW SAM selection', () => {
  it('picks AAW missiles only, longest range first', () => {
    const sams = aawMissilesInLoadout(ticonderoga, 'Default', missilesById);
    expect(sams.map((m) => m.id)).toEqual(['usn_rim-66c', 'usn_aim-9x']); // 70 nm before 22 nm
  });

  it('excludes ASW torpedoes from AAW selection', () => {
    const sams = aawMissilesInLoadout(burke, 'Default', missilesById);
    // Burke Default has RIM-66C (AAW) + MK 46 (ASW); only the SAM qualifies.
    expect(sams.map((m) => m.id)).toEqual(['usn_rim-66c']);
  });
});

describe('preset adapter — Ticonderoga end-to-end (SAMPLE_USAGE walkthrough)', () => {
  it('reproduces the worked example: 4 ch, 2 eng, 6.4 kills, 6 leakers of 12', () => {
    const est = estimateShipSaturation(
      ticonderoga,
      { missilesById, launchersById },
      {
        loadoutName: 'Default',
        inbound: 12,
        interceptRangeNm: 30,
        geometry: {
          contactRangeNm: 80,
          interceptRangeNm: 30,
          attackerSpeedKnots: 450,
          shipSpeedKnots: 32,
        },
      },
    );

    expect(est.samName).toBe('RIM-66C');
    expect(est.channels).toBe(4);
    expect(est.pk).toBe(0.8);
    expect(est.flightTimeS).toBe(180);
    expect(est.cycleTimeS).toBe(4.5);
    expect(est.timePerEngagementS).toBe(184.5);
    expect(Math.round(est.raidWindowS)).toBe(373); // 373.4 s; doc rounds to ≈374
    expect(est.engagementsPerChannel).toBe(2);
    expect(est.totalIntercepts).toBeCloseTo(6.4, 6);
    expect(est.leakers).toBe(6);
    expect(est.warnings).toEqual([]);
  });

  it('uses the default raid window and SAM max range when no geometry is given', () => {
    const est = estimateShipSaturation(
      ticonderoga,
      { missilesById, launchersById },
      { loadoutName: 'Default', inbound: 12 },
    );
    // No geometry → intercept at full 70 nm, 300 s default window → single engagement.
    expect(est.interceptRangeNm).toBe(70);
    expect(est.engagementsPerChannel).toBe(1);
    expect(est.totalIntercepts).toBeCloseTo(4 * 1 * 0.8, 6);
  });
});
