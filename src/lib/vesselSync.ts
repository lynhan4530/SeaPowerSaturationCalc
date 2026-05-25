import { db } from './db';
import type { ShipPreset, DefenseLayer, WeaponSystem, MissilePreset, GuidanceType } from '../types';

export function getMagazineSizeForShip(ship: ShipPreset, loadoutName: string): number {
  const loadout = ship.loadouts.find((l) => l.name.toLowerCase() === loadoutName.toLowerCase()) || ship.loadouts[0];
  if (!loadout) return 0;
  // Sum count of all items that are missiles
  return loadout.ammo.reduce((sum, entry) => {
    if (entry.isMissile) {
      return sum + (entry.count ?? 0);
    }
    return sum;
  }, 0);
}

export async function getMissilesForShip(ship: ShipPreset, loadoutName: string): Promise<MissilePreset[]> {
  const loadout = ship.loadouts.find((l) => l.name.toLowerCase() === loadoutName.toLowerCase()) || ship.loadouts[0];
  if (!loadout) return [];
  
  const missileIds = loadout.ammo
    .filter((entry) => entry.isMissile)
    .map((entry) => entry.ammoId);

  if (missileIds.length === 0) return [];

  // Query DB for these missiles
  const presets = await db.missiles.where('id').anyOf(missileIds).toArray();
  return presets;
}

export async function buildDefenseLayersForShip(ship: ShipPreset, loadoutName: string): Promise<DefenseLayer[]> {
  const loadout = ship.loadouts.find((l) => l.name.toLowerCase() === loadoutName.toLowerCase()) || ship.loadouts[0];
  if (!loadout) return [];

  const areaSystems: WeaponSystem[] = [];
  const pointSystems: WeaponSystem[] = [];
  const innerSystems: WeaponSystem[] = [];

  // 1. Calculate base targeting channels
  // Targeting directors represent terminal illumination (e.g. SPG-62 for Standard Missiles)
  const targetingDirectors = ship.directors.filter((d) => d.type?.toLowerCase() === 'targeting' && d.resolved);
  const totalIlluminatorChannels = targetingDirectors.reduce((sum, d) => sum + (d.weaponChannels ?? 0), 0) || 2; // Default to 2 if none

  // 2. Map missile launchers
  const missileAmmo = loadout.ammo.filter((a) => a.isMissile);
  for (const entry of missileAmmo) {
    const missile = await db.missiles.get(entry.ammoId);
    if (!missile || missile.role !== 'AAW') continue; // Only AAW missiles are defensive systems

    // Find mounts that can fire this missile type or group them
    const matchingMounts = ship.mounts.filter((m) => m.weaponType?.toLowerCase() === 'missile');
    if (matchingMounts.length === 0) continue;

    // Resolve guidance type: both ARH and IR are treated as fire-and-forget (ARH)
    let guidance: GuidanceType = 'SARH';
    if (missile.guidance === 'ARH' || missile.guidance === 'IR') {
      guidance = 'ARH';
    }

    // Determine channels
    // For SARH, channels are shared across terminal directors (Targeting type).
    // For ARH/IR (fire-and-forget), we check tracking directors (DirectedSearch + Targeting),
    // and exclude utility systems with unreasonably high placeholder channels (like GPS with 5000).
    let channels = 8;
    if (guidance === 'SARH') {
      channels = totalIlluminatorChannels;
    } else {
      const trackingDirectors = ship.directors.filter(
        (d) =>
          (d.type?.toLowerCase() === 'targeting' ||
            d.type?.toLowerCase() === 'directedsearch') &&
          d.resolved
      );
      const validDirectors = trackingDirectors.filter((d) => (d.weaponChannels ?? 0) < 500);
      const sumTracking = validDirectors.reduce((sum, d) => sum + (d.weaponChannels ?? 0), 0);
      channels = sumTracking > 0 ? sumTracking : 8;
    }

    const maxRange = missile.maxRangeNm ?? 15;
    const pk = missile.killProbability ?? 0.8;

    const sys: WeaponSystem = {
      id: crypto.randomUUID(),
      name: `${missile.name} (${guidance})`,
      guidance,
      channels,
      engagementsPerChannel: 1, // Default re-engagement cap
      pk,
      minRangeNm: missile.minRangeNm ?? undefined,
      maxRangeNm: missile.maxRangeNm ?? undefined,
      speedKnots: missile.speedKnots ?? undefined,
    };

    if (maxRange >= 15) {
      areaSystems.push(sys);
    } else {
      pointSystems.push(sys);
    }
  }

  // 3. Map CIWS and AAW Guns from mounts
  // Group mounts by launcherId to count physical CIWS systems (e.g. two Phalanx mounts = 2 channels)
  const ciwsMountGroups: Record<string, number> = {};
  for (const mount of ship.mounts) {
    if (mount.weaponType?.toLowerCase() === 'ciws') {
      ciwsMountGroups[mount.launcherId] = (ciwsMountGroups[mount.launcherId] || 0) + 1;
    }
  }

  for (const [launcherId, mountCount] of Object.entries(ciwsMountGroups)) {
    const launcher = await db.launchers.get(launcherId);
    const pk = launcher?.missileInterceptChance ? launcher.missileInterceptChance / 100 : 0.7; // Convert percent to 0..1

    innerSystems.push({
      id: crypto.randomUUID(),
      name: launcher?.name || launcherId.replace(/_/g, ' ').toUpperCase(),
      guidance: 'gun',
      channels: mountCount, // One independent channel per physical mount
      engagementsPerChannel: 1,
      pk,
      minRangeNm: 0,
      maxRangeNm: 1.5, // Close-in envelope
    });
  }

  // Compile layers
  const layers: DefenseLayer[] = [];

  if (areaSystems.length > 0) {
    layers.push({
      id: crypto.randomUUID(),
      name: 'Area Air Defense (SAM)',
      windowS: 15,
      weaponSystems: areaSystems,
    });
  }

  if (pointSystems.length > 0) {
    layers.push({
      id: crypto.randomUUID(),
      name: 'Point Defense (SAM)',
      windowS: 10,
      weaponSystems: pointSystems,
    });
  }

  if (innerSystems.length > 0) {
    layers.push({
      id: crypto.randomUUID(),
      name: 'Close-In Weapon Systems (CIWS)',
      windowS: 5,
      weaponSystems: innerSystems,
    });
  }

  return layers;
}
