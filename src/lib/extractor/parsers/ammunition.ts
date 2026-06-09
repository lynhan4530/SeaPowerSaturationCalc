/**
 * Missile parser for `ammunition/*.ini`. Vendored from the SeaPowerDataExtraction
 * parser (src/parsers/ammunition.ts); only the schema import is retargeted to the
 * app's own `types.ts` (whose preset types are identical to the parser's schema).
 *
 * Only `Type=Missile` is emitted; Projectile/Torpedo are skipped. Fields are
 * spread across [General]/[Guidance]/[SensorData], so we search the whole
 * document for each key.
 */
import { findValue, findNumber, type IniDocument } from '../ini';
import type {
  DatabaseGuidanceType as GuidanceType,
  MissilePreset,
  MissileRole,
} from '../../../types';

const GUIDANCE_BY_CODE: Record<number, GuidanceType> = {
  0: 'None',
  1: 'IR',
  2: 'SARH',
  3: 'ARH',
  4: 'ARM',
  5: 'Laser',
  6: 'TV',
  7: 'ActiveSonar',
  8: 'PassiveSonar',
  9: 'WakeHoming',
};

function toRole(targetType: string | undefined): MissileRole {
  switch (targetType?.toUpperCase()) {
    case 'AAW':
      return 'AAW';
    case 'ASUW':
      return 'ASuW';
    case 'ASW':
      return 'ASW';
    default:
      return 'Other';
  }
}

/** Turn `usn_rim-66c` into a readable fallback name (real names need l10n later). */
function prettifyId(id: string): string {
  return id.replace(/_/g, ' ').toUpperCase();
}

/** Parse a missile, or return null if the file isn't a `Type=Missile`. */
export function parseMissile(
  doc: IniDocument,
  id: string,
  source: string,
): MissilePreset | null {
  if (findValue(doc, 'Type')?.toLowerCase() !== 'missile') return null;

  const guidanceCode = findNumber(doc, 'GuidanceType');
  const guidance =
    guidanceCode !== undefined ? (GUIDANCE_BY_CODE[guidanceCode] ?? 'Unknown') : 'Unknown';
  const seaSkimmingAltFt = findNumber(doc, 'SeaSkimmingAlt') ?? null;

  return {
    id,
    name: prettifyId(id),
    nickname: null,
    category: null,
    role: toRole(findValue(doc, 'TargetType')),
    speedKnots: findNumber(doc, 'MaxVelocity') ?? null,
    maxRangeNm: findNumber(doc, 'MaxLaunchRange') ?? null,
    minRangeNm: findNumber(doc, 'MinLaunchRange') ?? null,
    guidance,
    seaSkimming: seaSkimmingAltFt !== null,
    seaSkimmingAltFt,
    rcs: findNumber(doc, 'RCS') ?? null,
    seekerActiveRangeNm: findNumber(doc, 'SeekerActiveRange') ?? null,
    seekerPassiveRangeNm: findNumber(doc, 'SeekerPassiveRange') ?? null,
    antiCountermeasuresBonus: findNumber(doc, 'AntiCountermeasuresBonus') ?? null,
    antiJammerBonus: findNumber(doc, 'AntiJammerBonus') ?? null,
    killProbability: findNumber(doc, 'KillProbability') ?? null,
    source,
  };
}
