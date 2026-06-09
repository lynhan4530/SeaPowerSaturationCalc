// Preset → Saturation-Planner consuming adapter (pure; no React/DOM/Dexie).
//
// Implements the derivation documented in the SeaPowerDataExtraction repo
// (INTEGRATION.md, SAMPLE_USAGE.md):
//
//   flightTimeS          = (interceptRangeNm / samSpeedKnots) × 3600
//   cycleS               = reloadTimeS ?? (60 / fireRatePerMin)
//   timePerEngagementS   = flightTimeS + cycleS
//   engagementsPerChannel = floor(raidWindowS / timePerEngagementS)        (≥ 1)
//   totalIntercepts       = channels × engagementsPerChannel × pk
//   leakers               = max(0, inbound − round(totalIntercepts))
//
// `engagementsPerChannel` is *app-derived* — it depends on the planner's raid
// window (attack geometry), not on any field in presets.json. `weaponChannels`
// is pre-computed by the parser and is read directly (never re-summed) per the
// agreed design decision; we still cross-check it against the Targeting-director
// sum and warn on a mismatch. DirectedSearch directors (e.g. SPY-1A) are
// excluded from the headline channel count but remain in the preset data for
// command-guidance modeling.
//
// See PRESET_ADAPTER.md for the documented assumptions and the doc mismatches
// this adapter reconciles.

import type {
  DatabaseGuidanceType,
  LauncherPreset,
  MissilePreset,
  ShipPreset,
} from '../types';

/**
 * Default raid window (s) used to derive `engagementsPerChannel` when no attack
 * geometry is available (e.g. when a preset is first linked, before salvos are
 * placed). Conservative: long-flight area SAMs collapse to a single engagement,
 * while fast/short-range point-defense missiles still earn multiple. Override
 * with real geometry via `raidWindowFromGeometry` once salvos exist.
 */
export const DEFAULT_RAID_WINDOW_S = 300;

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * Fallback single-shot Pk by guidance family, used only when a missile's
 * `killProbability` is null (never assume zero — null means "unknown"). Values
 * are deliberate planning placeholders, not game-extracted truth.
 */
export function defaultPkForGuidance(guidance: DatabaseGuidanceType): number {
  switch (guidance) {
    case 'IR':
      return 0.8;
    case 'ARH':
      return 0.8;
    case 'SARH':
      return 0.75;
    case 'Laser':
      return 0.7;
    case 'ARM':
    case 'TV':
      return 0.6;
    case 'ActiveSonar':
    case 'PassiveSonar':
    case 'WakeHoming':
      return 0.5;
    case 'None':
    case 'Unknown':
    default:
      return 0.5;
  }
}

/** Resolve a missile's Pk, falling back to a guidance-family default (warned). */
export function resolvePk(
  missile: Pick<MissilePreset, 'name' | 'guidance' | 'killProbability'>,
  warnings?: string[],
): number {
  if (missile.killProbability != null) return clamp01(missile.killProbability);
  const fallback = defaultPkForGuidance(missile.guidance);
  warnings?.push(
    `${missile.name}: killProbability is null → default Pk ${fallback} for ${missile.guidance}.`,
  );
  return fallback;
}

/** Interceptor flight time (s) to the chosen intercept range. Null if speed unusable. */
export function flightTimeS(
  interceptRangeNm: number,
  samSpeedKnots: number | null | undefined,
): number | null {
  if (samSpeedKnots == null || samSpeedKnots <= 0) return null;
  if (interceptRangeNm < 0) return null;
  return (interceptRangeNm / samSpeedKnots) * 3600;
}

/**
 * Per-channel re-engagement cycle (s): prefer the launcher's `reloadTimeS`,
 * else derive from `fireRatePerMin`. Null if neither is usable.
 */
export function cycleTimeS(
  launcher: Pick<LauncherPreset, 'reloadTimeS' | 'fireRatePerMin'> | null | undefined,
): number | null {
  if (!launcher) return null;
  if (launcher.reloadTimeS != null && launcher.reloadTimeS > 0) return launcher.reloadTimeS;
  if (launcher.fireRatePerMin != null && launcher.fireRatePerMin > 0) {
    return 60 / launcher.fireRatePerMin;
  }
  return null;
}

export interface EngagementTimingParams {
  interceptRangeNm: number;
  samSpeedKnots: number | null | undefined;
  launcher?: Pick<LauncherPreset, 'reloadTimeS' | 'fireRatePerMin'> | null;
}

/**
 * Time to complete one engagement = flight time + reload/re-aim cycle. Returns
 * null when flight time is unresolvable (no usable interceptor speed); a missing
 * launcher cycle is treated as 0 with a warning (flight time dominates).
 */
export function timePerEngagementS(
  params: EngagementTimingParams,
  warnings?: string[],
): number | null {
  const ft = flightTimeS(params.interceptRangeNm, params.samSpeedKnots);
  if (ft == null) {
    warnings?.push('time-per-engagement: interceptor speed is null/≤0 → unresolvable.');
    return null;
  }
  const cyc = cycleTimeS(params.launcher);
  if (cyc == null) {
    warnings?.push('time-per-engagement: launcher reload/fire-rate is null → cycle treated as 0s.');
  }
  return ft + (cyc ?? 0);
}

export interface EngagementsParams extends EngagementTimingParams {
  raidWindowS: number;
}

/**
 * engagementsPerChannel = floor(raidWindowS / timePerEngagementS), clamped to a
 * minimum of 1 (a channel always gets at least one shot). Falls back to 1 with a
 * warning when timing is unresolvable — the documented single-shot default.
 */
export function deriveEngagementsPerChannel(
  params: EngagementsParams,
  warnings?: string[],
): number {
  const tpe = timePerEngagementS(params, warnings);
  if (tpe == null || tpe <= 0 || params.raidWindowS <= 0) {
    warnings?.push('engagementsPerChannel: timing unresolvable → fallback 1 (single shot).');
    return 1;
  }
  return Math.max(1, Math.floor(params.raidWindowS / tpe));
}

export interface RaidGeometry {
  /** Range (nm) at which the defender first detects/contacts the raid. */
  contactRangeNm: number;
  /** Range (nm) at which the interceptor meets the inbound raid. */
  interceptRangeNm: number;
  /** Inbound raid closing speed (kts) toward the defender. */
  attackerSpeedKnots: number;
  /** Defender's own speed (kts) closing the gap; optional. */
  shipSpeedKnots?: number;
}

/**
 * Raid window (s): how long the inbound raid spends inside the engageable band,
 * i.e. the time to traverse from contact range to intercept range at the combined
 * closing speed. Mirrors the SAMPLE_USAGE worked example.
 */
export function raidWindowFromGeometry(geo: RaidGeometry): number {
  const closingKts = geo.attackerSpeedKnots + (geo.shipSpeedKnots ?? 0);
  const traverseNm = Math.max(0, geo.contactRangeNm - geo.interceptRangeNm);
  if (closingKts <= 0) return 0;
  return (traverseNm / closingKts) * 3600;
}

export interface InterceptCapacityParams {
  channels: number;
  engagementsPerChannel: number;
  pk: number;
}

/** totalIntercepts = channels × engagementsPerChannel × pk (expected kills). */
export function estimateIntercepts(p: InterceptCapacityParams): number {
  return Math.max(0, p.channels) * Math.max(0, p.engagementsPerChannel) * clamp01(p.pk);
}

/** leakers = max(0, inbound − round(totalIntercepts)). */
export function estimateLeakers(p: InterceptCapacityParams & { inbound: number }): number {
  return Math.max(0, p.inbound - Math.round(estimateIntercepts(p)));
}

/**
 * Headline simultaneous-guidance channel count. The parser pre-computes
 * `ship.weaponChannels`; we read it directly (per the design decision) and only
 * fall back to summing resolved Targeting directors when it is null. Either way
 * DirectedSearch directors are excluded. A mismatch between the pre-computed
 * value and the Targeting-director sum is surfaced as a warning.
 */
export function targetingChannels(ship: ShipPreset, warnings?: string[]): number {
  const directorSum = ship.directors
    .filter((d) => d.resolved && d.type?.toLowerCase() === 'targeting')
    .reduce((sum, d) => sum + (d.weaponChannels ?? 0), 0);

  if (ship.weaponChannels != null) {
    if (directorSum > 0 && directorSum !== ship.weaponChannels) {
      warnings?.push(
        `${ship.name}: pre-computed weaponChannels ${ship.weaponChannels} ≠ Targeting-director sum ${directorSum}; using pre-computed.`,
      );
    }
    return ship.weaponChannels;
  }
  return directorSum;
}

/**
 * The AAW missiles in a loadout, resolved against a missile lookup, longest
 * range first. The first element is the "headline" area SAM.
 */
export function aawMissilesInLoadout(
  ship: ShipPreset,
  loadoutName: string | undefined,
  missilesById: Map<string, MissilePreset>,
): MissilePreset[] {
  const loadout =
    ship.loadouts.find((l) => l.name.toLowerCase() === (loadoutName ?? '').toLowerCase()) ??
    ship.loadouts[0];
  if (!loadout) return [];
  return loadout.ammo
    .filter((a) => a.isMissile)
    .map((a) => missilesById.get(a.ammoId))
    .filter((m): m is MissilePreset => !!m && m.role === 'AAW')
    .sort((a, b) => (b.maxRangeNm ?? 0) - (a.maxRangeNm ?? 0));
}

/** The launcher feeding the ship's missile mount(s), if resolvable. */
export function primaryMissileLauncher(
  ship: ShipPreset,
  launchersById: Map<string, LauncherPreset>,
): LauncherPreset | null {
  const mount = ship.mounts.find(
    (m) => m.weaponType?.toLowerCase() === 'missile',
  );
  if (!mount) return null;
  return launchersById.get(mount.launcherId) ?? null;
}

export interface ShipSaturationEstimate {
  shipName: string;
  loadoutName: string;
  /** Headline area SAM used for the estimate (null if the ship has no AAW SAM). */
  samName: string | null;
  channels: number;
  pk: number;
  samSpeedKnots: number | null;
  interceptRangeNm: number;
  raidWindowS: number;
  flightTimeS: number | null;
  cycleTimeS: number | null;
  timePerEngagementS: number | null;
  engagementsPerChannel: number;
  /** Expected kills: channels × engagementsPerChannel × pk. */
  totalIntercepts: number;
  /** max(0, inbound − round(totalIntercepts)). */
  leakers: number;
  warnings: string[];
}

export interface ShipSaturationOptions {
  loadoutName?: string;
  /** Number of inbound missiles in the raid. */
  inbound: number;
  /** Attack geometry; when given, derives raidWindowS and interceptRangeNm. */
  geometry?: RaidGeometry;
  /** Explicit raid window (s); overrides geometry. Defaults to DEFAULT_RAID_WINDOW_S. */
  raidWindowS?: number;
  /** Explicit intercept range (nm); overrides geometry/SAM maxRange. */
  interceptRangeNm?: number;
}

/**
 * End-to-end headline estimate for one ship preset: resolves channels, the
 * area SAM and its Pk, derives engagementsPerChannel from the raid window and
 * launcher/interceptor timing, then totals intercepts and leakers. Pure — caller
 * supplies the missile/launcher lookup maps (from IndexedDB or a presets bundle).
 */
export function estimateShipSaturation(
  ship: ShipPreset,
  lookups: { missilesById: Map<string, MissilePreset>; launchersById: Map<string, LauncherPreset> },
  opts: ShipSaturationOptions,
): ShipSaturationEstimate {
  const warnings: string[] = [];
  const loadout =
    ship.loadouts.find((l) => l.name.toLowerCase() === (opts.loadoutName ?? '').toLowerCase()) ??
    ship.loadouts[0];
  const loadoutName = loadout?.name ?? '(none)';

  const channels = targetingChannels(ship, warnings);
  const sams = aawMissilesInLoadout(ship, opts.loadoutName, lookups.missilesById);
  const sam = sams[0] ?? null;
  const launcher = primaryMissileLauncher(ship, lookups.launchersById);

  if (!sam) {
    warnings.push(`${ship.name}: no AAW SAM in loadout "${loadoutName}" → no intercept capacity.`);
    return {
      shipName: ship.name,
      loadoutName,
      samName: null,
      channels,
      pk: 0,
      samSpeedKnots: null,
      interceptRangeNm: 0,
      raidWindowS: opts.raidWindowS ?? (opts.geometry ? raidWindowFromGeometry(opts.geometry) : DEFAULT_RAID_WINDOW_S),
      flightTimeS: null,
      cycleTimeS: cycleTimeS(launcher),
      timePerEngagementS: null,
      engagementsPerChannel: 1,
      totalIntercepts: 0,
      leakers: opts.inbound,
      warnings,
    };
  }

  const interceptRangeNm =
    opts.interceptRangeNm ?? opts.geometry?.interceptRangeNm ?? sam.maxRangeNm ?? 0;
  const raidWindowS =
    opts.raidWindowS ??
    (opts.geometry ? raidWindowFromGeometry(opts.geometry) : DEFAULT_RAID_WINDOW_S);

  const pk = resolvePk(sam, warnings);
  const ft = flightTimeS(interceptRangeNm, sam.speedKnots);
  const cyc = cycleTimeS(launcher);
  const tpe = timePerEngagementS({ interceptRangeNm, samSpeedKnots: sam.speedKnots, launcher }, warnings);
  const engagementsPerChannel = deriveEngagementsPerChannel(
    { raidWindowS, interceptRangeNm, samSpeedKnots: sam.speedKnots, launcher },
    // timing warnings already collected above; avoid duplicates
    [],
  );

  const capacity = { channels, engagementsPerChannel, pk };
  return {
    shipName: ship.name,
    loadoutName,
    samName: sam.name,
    channels,
    pk,
    samSpeedKnots: sam.speedKnots,
    interceptRangeNm,
    raidWindowS,
    flightTimeS: ft,
    cycleTimeS: cyc,
    timePerEngagementS: tpe,
    engagementsPerChannel,
    totalIntercepts: estimateIntercepts(capacity),
    leakers: estimateLeakers({ ...capacity, inbound: opts.inbound }),
    warnings,
  };
}
