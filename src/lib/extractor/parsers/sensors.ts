/**
 * Illuminator/director parser for `systems/sensors.ini`. Vendored from the
 * SeaPowerDataExtraction parser (src/parsers/sensors.ts).
 *
 * We emit only sensors that define `WeaponChannels` — the count of missiles a
 * director can guide simultaneously, i.e. THE saturation cap. Search-only
 * radars, sonar, ESM, and non-sensor blocks are skipped.
 *
 * Ranges in sensors.ini are in km; we keep km and also expose nm so the app can
 * compare against missile ranges (which are nm).
 */
import { getValue, getNumber, type IniSection } from '../ini';
import { kmToNm } from '../units';
import type { IlluminatorPreset } from '../../../types';

/** Readable fallback name; replaced by the localized name later if available. */
function prettifyId(id: string): string {
  return id.replace(/_/g, ' ');
}

/** Parse a channel-bearing sensor, or null if it can't guide weapons. */
export function parseIlluminator(
  section: IniSection,
  source: string,
): IlluminatorPreset | null {
  const weaponChannels = getNumber(section, 'WeaponChannels');
  if (weaponChannels === undefined) return null;

  const maxRangeKm = getNumber(section, 'MaxRange') ?? null;

  return {
    id: section.name,
    name: prettifyId(section.name),
    kind: getValue(section, 'Kind') ?? null,
    type: getValue(section, 'Type') ?? null,
    mode: getValue(section, 'Mode') ?? null,
    weaponChannels,
    targetChannels: getNumber(section, 'TargetChannels') ?? null,
    maxRangeKm,
    maxRangeNm: maxRangeKm !== null ? kmToNm(maxRangeKm) : null,
    source,
  };
}
