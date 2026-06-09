/**
 * Reader for Sea Power's enabled-mods list + load order. Vendored from the
 * SeaPowerDataExtraction parser (src/modconfig.ts), keeping only the pure
 * `parseLoadOrder` — the `fs`/`os` discovery of usersettings.ini lives outside
 * the Steam library (in the Unity persistent-data dir) and is not reachable from
 * a single browser folder pick, so the browser adapter passes `null` load order
 * and falls back to "all installed mods" (the parser's documented fallback).
 *
 * The relevant section of usersettings.ini:
 *
 *   [LoadOrder]
 *   Mod1Directory=3380210757,True      // <dir>,<enabledBool>
 *   Mod2Directory=3606134711,True
 *   ...
 *
 * Later entries (higher N) load last and override earlier ones.
 */
import { parseIni } from './ini';

/** One mod-manager entry, in load order. */
export type ModLoadEntry = {
  /** Workshop folder id (numeric) or local mod folder name. */
  id: string;
  enabled: boolean;
  /** 1-based load-order index (the `Mod<order>Directory` key). */
  order: number;
};

/**
 * Parse the `[LoadOrder]` section of a usersettings.ini body into load-ordered
 * entries (ascending order = load order = low→high priority). Returns
 * `undefined` when the section is absent or has no `Mod<N>Directory` entries.
 */
export function parseLoadOrder(text: string): ModLoadEntry[] | undefined {
  const doc = parseIni(text);
  const section = doc.byName.get('LoadOrder');
  if (!section) return undefined;

  const entries: ModLoadEntry[] = [];
  for (const key of section.keys) {
    const m = /^Mod(\d+)Directory$/.exec(key);
    if (!m) continue; // skip NumberOfModFiles and any stray keys
    const order = Number(m[1]);
    const raw = section.values[key]?.[0];
    if (raw === undefined) continue;
    // Value is "<dir>,<enabledBool>". A workshop id / folder name never contains
    // a comma, so split on the LAST comma to isolate the flag defensively.
    const comma = raw.lastIndexOf(',');
    if (comma === -1) continue;
    const id = raw.slice(0, comma).trim();
    const flag = raw.slice(comma + 1).trim().toLowerCase();
    if (id === '') continue;
    entries.push({ id, enabled: flag === 'true', order });
  }
  if (entries.length === 0) return undefined;
  entries.sort((a, b) => a.order - b.order);
  return entries;
}
