/**
 * Launcher parser for `systems/weapons.ini`. Vendored from the
 * SeaPowerDataExtraction parser (src/parsers/weapons.ts).
 *
 * One section per launcher id (e.g. [MK13], [AK630]). CIWS sections carry a
 * literal Pk (`MissileInterceptChance`). Divider sections are dropped by the
 * tokenizer; we still skip sections with no launcher-ish fields.
 */
import { getValue, getNumber, type IniSection } from '../ini';
import type { LauncherPreset } from '../../../types';

/** Readable fallback name; replaced by the localized name later if available. */
function prettifyId(id: string): string {
  return id.replace(/_/g, ' ');
}

/** Parse one weapons.ini section, or null if it isn't a real launcher/mount. */
export function parseLauncher(
  section: IniSection,
  source: string,
): LauncherPreset | null {
  const kind = getValue(section, 'ModuleType') ?? 'Unknown';

  return {
    id: section.name,
    name: prettifyId(section.name),
    kind,
    reloadTimeS: getNumber(section, 'ReloadTime') ?? null,
    fireRatePerMin: getNumber(section, 'FireRate') ?? null,
    horizontalDegPerSec: getNumber(section, 'HorizontalDegreesPerSecond') ?? null,
    verticalDegPerSec: getNumber(section, 'VerticalDegreesPerSecond') ?? null,
    missileInterceptChance: getNumber(section, 'MissileInterceptChance') ?? null,
    aircraftInterceptChance: getNumber(section, 'AircraftInterceptChance') ?? null,
    source,
  };
}
