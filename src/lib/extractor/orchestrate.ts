/**
 * Extraction pipeline. Pure port of the SeaPowerDataExtraction CLI's `main()`
 * (src/cli.ts) minus all IO: takes a {@link Vfs} plus resolved paths and the
 * loaded name tables, returns `{ presets, warnings }`. The browser adapter
 * (browser.ts) supplies the Vfs + names; a future Node adapter could too.
 */
import { parseIni } from './ini';
import { enumerateSources, indexCategory, mergeSections } from './sources';
import { parseMissile } from './parsers/ammunition';
import { parseLauncher } from './parsers/weapons';
import { parseIlluminator } from './parsers/sensors';
import { parseVessel, type VesselLinkContext } from './parsers/vessels';
import { applyNames, type NameTables } from './names';
import type { ModLoadEntry } from './modconfig';
import type { Vfs } from './vfs';
import type {
  IlluminatorPreset,
  LauncherPreset,
  MissilePreset,
  PresetsJson,
  ShipPreset,
  SourceInfo,
} from '../../types';

export type ExtractOptions = {
  /** Vfs path to the game root (containing `Sea Power_Data/StreamingAssets`). */
  gamePath: string;
  /** Vfs path to the workshop mods dir, or null when no mods are reachable. */
  modsPath: string | null;
  /** Mod load order from usersettings.ini, or null to include all installed mods. */
  loadOrder?: ModLoadEntry[] | null;
  /** Localized name tables (empty maps are fine — fields keep prettified ids). */
  names: NameTables;
  /** Human-readable provenance recorded in the output. */
  resolvedPaths?: { gamePath: string; modsPath: string | null };
  gameVersion?: string | null;
};

export type ExtractResult = { presets: PresetsJson; warnings: string[] };

export function extractPresets(vfs: Vfs, opts: ExtractOptions): ExtractResult {
  const loadOrder = opts.loadOrder ?? null;
  const { sources, missingEnabled } = enumerateSources(
    vfs,
    opts.gamePath,
    opts.modsPath,
    loadOrder,
  );
  const loadOrderApplied = loadOrder !== null && loadOrder.length > 0;
  const active = sources.filter((s) => !s.deprecated);
  const deprecated = sources.filter((s) => s.deprecated);
  const modSources = sources.filter((s) => s.kind === 'mod' && !s.deprecated);

  const warnings: string[] = [];
  for (const d of deprecated) warnings.push(`skipped deprecated mod ${d.id} (${d.name})`);
  for (const m of missingEnabled) {
    warnings.push(`enabled mod ${m.id} (load order ${m.order}) not found under mods path — skipped`);
  }

  // --- Missiles -------------------------------------------------------------
  const { files: ammoFiles, collisions } = indexCategory(vfs, active, 'ammunition');
  for (const c of collisions) {
    warnings.push(`collision: ammunition/${c.id} from ${c.source} overrides [${c.overridden.join(', ')}]`);
  }
  const missiles: MissilePreset[] = [];
  for (const file of ammoFiles) {
    try {
      const missile = parseMissile(parseIni(vfs.readText(file.path)), file.id, file.source);
      if (missile) missiles.push(missile);
    } catch (err) {
      warnings.push(`failed to parse ammunition/${file.id}: ${(err as Error).message}`);
    }
  }
  missiles.sort((a, b) => a.id.localeCompare(b.id));

  // --- Launchers (systems/weapons.ini, merged per-section) ------------------
  const weapons = mergeSections(vfs, active, 'systems/weapons.ini');
  for (const c of weapons.collisions) {
    warnings.push(`collision: weapons[${c.id}] from ${c.source} overrides [${c.overridden.join(', ')}]`);
  }
  const launchers: LauncherPreset[] = [];
  for (const s of weapons.sections) {
    const launcher = parseLauncher(s.section, s.source);
    if (launcher) launchers.push(launcher);
  }

  // --- Illuminators (systems/sensors.ini, merged per-section) ---------------
  const sensors = mergeSections(vfs, active, 'systems/sensors.ini');
  for (const c of sensors.collisions) {
    warnings.push(`collision: sensors[${c.id}] from ${c.source} overrides [${c.overridden.join(', ')}]`);
  }
  const illuminators: IlluminatorPreset[] = [];
  for (const s of sensors.sections) {
    const illum = parseIlluminator(s.section, s.source);
    if (illum) illuminators.push(illum);
  }

  // --- Ships (vessels/*.ini + mod ships/*.ini, cross-linked) ----------------
  const linkCtx: VesselLinkContext = {
    illuminators: new Map(
      illuminators.map((i) => [
        i.id,
        { type: i.type, mode: i.mode, weaponChannels: i.weaponChannels, maxRangeNm: i.maxRangeNm },
      ]),
    ),
    launcherIds: new Set(launchers.map((l) => l.id)),
    missileIds: new Set(missiles.map((m) => m.id)),
  };
  // Both folders are per-file; ships/ (mods/user) layered over vessels/ (base).
  const vesselFiles = new Map<string, ReturnType<typeof indexCategory>['files'][number]>();
  for (const category of ['vessels', 'ships']) {
    const indexed = indexCategory(vfs, active, category);
    for (const c of indexed.collisions) {
      warnings.push(`collision: ${category}/${c.id} from ${c.source} overrides [${c.overridden.join(', ')}]`);
    }
    for (const f of indexed.files) vesselFiles.set(f.id, f);
  }
  const ships: ShipPreset[] = [];
  for (const file of vesselFiles.values()) {
    try {
      const ship = parseVessel(parseIni(vfs.readText(file.path)), file.id, file.source, linkCtx);
      if (ship) ships.push(ship);
    } catch (err) {
      warnings.push(`failed to parse vessel/${file.id}: ${(err as Error).message}`);
    }
  }
  ships.sort((a, b) => a.id.localeCompare(b.id));

  const sourceInfos: SourceInfo[] = sources.map((s) => ({
    id: s.id,
    kind: s.kind,
    name: s.name,
    deprecated: s.deprecated,
    enabled: s.enabled,
    order: s.order,
  }));

  const presets: PresetsJson = {
    generatedAt: new Date().toISOString(),
    gameVersion: opts.gameVersion ?? null,
    resolvedPaths: opts.resolvedPaths ?? { gamePath: opts.gamePath, modsPath: opts.modsPath },
    sources: sourceInfos,
    missiles,
    launchers,
    illuminators,
    ships,
    stats: {
      sourcesActive: active.length,
      sourcesDeprecated: deprecated.length,
      sourcesEnabled: modSources.length,
      loadOrderApplied: loadOrderApplied ? 1 : 0,
      ammunitionFiles: ammoFiles.length,
      missiles: missiles.length,
      launchers: launchers.length,
      illuminators: illuminators.length,
      ships: ships.length,
      collisions: collisions.length + weapons.collisions.length + sensors.collisions.length,
      warnings: warnings.length,
    },
  };

  applyNames(presets, opts.names);
  return { presets, warnings };
}
