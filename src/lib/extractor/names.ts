/**
 * Localized display-name parsers for Sea Power's language_* files. Vendored from
 * the SeaPowerDataExtraction parser (src/names.ts), keeping only the pure
 * parse/apply functions — the `fs`-based `loadNames` is replaced by the browser
 * adapter, which reads the three files and builds the NameTables itself.
 *
 * Three source files (in <game>/Sea Power_Data/StreamingAssets/original/language_en/):
 *   ammunition_names.ini  – missiles
 *   vessel_names.ini      – ships
 *   systemgroups.ini      – launchers + illuminators
 */
import { parseIni } from './ini';
import type { PresetsJson } from '../../types';

export type NameEntry = { name: string; nickname: string | null; category: string | null };
export type NameTables = {
  missiles: Map<string, NameEntry>;
  ships: Map<string, NameEntry>;
  /** id → name for both launchers and illuminators. */
  systems: Map<string, string>;
};

/**
 * Parse `ammunition_names.ini`.
 * Format: single `[AmmunitionNames]` section; each line is
 *   id=name,nickname,category,description
 * (description may contain commas — we take only the first three fields).
 * Empty nickname/category → null.
 */
export function parseAmmunitionNames(text: string): Map<string, NameEntry> {
  const doc = parseIni(text);
  const section = doc.byName.get('AmmunitionNames');
  if (!section) return new Map();

  const result = new Map<string, NameEntry>();
  for (const key of section.keys) {
    const raw = section.values[key]?.[0];
    if (raw === undefined) continue;
    const parts = raw.split(',');
    const name = parts[0]?.trim() ?? '';
    const nickname = parts[1]?.trim() || null;
    const category = parts[2]?.trim() || null;
    if (name) result.set(key, { name, nickname, category });
  }
  return result;
}

/**
 * Parse `vessel_names.ini`.
 * Format: one section per ship id; within each:
 *   Default=ClassName,Nickname  (nickname may be absent or empty → null)
 *   Type=Category               (optional; `Type=M,Mine` → last comma-field = "Mine")
 * Sections without a `Default` key are skipped.
 */
export function parseVesselNames(text: string): Map<string, NameEntry> {
  const doc = parseIni(text);
  const result = new Map<string, NameEntry>();

  for (const section of doc.sections) {
    const defaultVal = section.values['Default']?.[0];
    if (!defaultVal) continue;

    const parts = defaultVal.split(',');
    const name = parts[0]?.trim() ?? '';
    const nickname = parts[1]?.trim() || null;

    const typeVal = section.values['Type']?.[0];
    let category: string | null = null;
    if (typeVal) {
      const typeParts = typeVal.split(',');
      // `Type=M,Mine` — take the last field as the human-readable category name
      category = typeParts[typeParts.length - 1]?.trim() || null;
    }

    if (name) result.set(section.name, { name, nickname, category });
  }
  return result;
}

/**
 * Parse `systemgroups.ini`.
 * Two sections hold display names, both with the same line format:
 *   id=Name
 *   id=Name|Description            (pipe-delimited; only the name before `|` is kept)
 *   id=Name|Nickname|Description   (some guns use a 3-field form — still take part[0])
 *
 * `[SystemNames]` holds the real weapons.ini launcher ids and sensors.ini
 * illuminator ids — the source the saturation app needs. `[LanguageResources]`
 * holds generic `SG_*` labels. `[SystemNames]` wins on a key collision.
 */
export function parseSystemNames(text: string): Map<string, string> {
  const doc = parseIni(text);
  const result = new Map<string, string>();

  const collect = (sectionName: string) => {
    const section = doc.byName.get(sectionName);
    if (!section) return;
    for (const key of section.keys) {
      const raw = section.values[key]?.[0];
      if (!raw) continue;
      const name = raw.split('|')[0]?.trim();
      if (name) result.set(key, name);
    }
  };

  collect('LanguageResources');
  collect('SystemNames'); // authoritative — overrides LanguageResources on collision

  return result;
}

/** Combine the three (optional) language-file texts into name tables. */
export function buildNameTables(texts: {
  ammunition?: string | null;
  vessels?: string | null;
  systems?: string | null;
}): NameTables {
  return {
    missiles: texts.ammunition ? parseAmmunitionNames(texts.ammunition) : new Map(),
    ships: texts.vessels ? parseVesselNames(texts.vessels) : new Map(),
    systems: texts.systems ? parseSystemNames(texts.systems) : new Map(),
  };
}

/**
 * Overwrite fallback names on all presets in-place using the loaded name tables.
 * Fields not present in the tables are left unchanged.
 */
export function applyNames(presets: PresetsJson, names: NameTables): void {
  for (const m of presets.missiles) {
    const e = names.missiles.get(m.id);
    if (e) {
      m.name = e.name || m.name;
      m.nickname = e.nickname;
      m.category = e.category;
    }
  }
  for (const s of presets.ships) {
    const e = names.ships.get(s.id);
    if (e) {
      s.name = e.name || s.name;
      s.nickname = e.nickname;
      s.category = e.category;
    }
  }
  for (const l of presets.launchers) {
    const n = names.systems.get(l.id);
    if (n) l.name = n;
  }
  for (const i of presets.illuminators) {
    const n = names.systems.get(i.id);
    if (n) i.name = n;
  }
}
