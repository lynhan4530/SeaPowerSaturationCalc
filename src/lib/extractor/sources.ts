/**
 * Source enumeration + file indexing with provenance. Ported from the
 * SeaPowerDataExtraction parser (src/sources.ts) with `node:fs`/`node:path`
 * replaced by the injected {@link Vfs}; the last-writer-wins logic is unchanged.
 *
 * A "source" is the base game, the local user overrides, or a workshop mod —
 * each a directory laid out like StreamingAssets (ammunition/, systems/, …).
 * Files are indexed last-writer-wins by filename, with a collisions report.
 */
import { parseIni, getValues, type IniSection } from './ini';
import type { Vfs } from './vfs';
import type { SourceInfo } from '../../types';
import type { ModLoadEntry } from './modconfig';

export type Source = SourceInfo & {
  /** Directory containing the category folders (ammunition/, systems/, …). */
  root: string;
};

/** A resolved file: which path won, plus the full override chain (low→high). */
export type IndexedFile = {
  id: string;
  path: string;
  source: string;
  /** Sources that also defined this id but lost (in priority order). */
  overridden: string[];
};

function streamingAssets(vfs: Vfs, gamePath: string): string {
  return vfs.join(gamePath, 'Sea Power_Data', 'StreamingAssets');
}

/** Read a mod's `_info.ini` → display name + [DEPRECATED] flag. */
function readModInfo(vfs: Vfs, root: string, id: string): { name: string; deprecated: boolean } {
  const infoPath = vfs.join(root, '_info.ini');
  if (!vfs.exists(infoPath)) return { name: id, deprecated: false };
  try {
    const doc = parseIni(vfs.readText(infoPath));
    const names = doc.sections.flatMap((s) => getValues(s, 'Name'));
    const name = names[0] ?? id;
    const deprecated = names.some((n) => /\[DEPRECATED\]/i.test(n));
    return { name, deprecated };
  } catch {
    return { name: id, deprecated: false };
  }
}

/**
 * Enumerate sources in override priority order (low → high):
 * base game → workshop mods → user overrides win last.
 *
 *  - **load-order mode** (`loadOrder` given): only the player's *enabled* mods,
 *    in their chosen load order; missing dirs reported via `missingEnabled`.
 *  - **fallback** (`loadOrder` null/empty): every installed mod, sorted by id.
 */
export function enumerateSources(
  vfs: Vfs,
  gamePath: string,
  modsPath: string | null,
  loadOrder?: ModLoadEntry[] | null,
): { sources: Source[]; missingEnabled: ModLoadEntry[] } {
  const sa = streamingAssets(vfs, gamePath);
  const sources: Source[] = [
    {
      id: 'base',
      kind: 'base',
      name: 'Base game',
      deprecated: false,
      enabled: true,
      order: null,
      root: vfs.join(sa, 'original'),
    },
  ];
  const missingEnabled: ModLoadEntry[] = [];

  if (modsPath && vfs.exists(modsPath)) {
    const enabledInOrder = loadOrder?.filter((e) => e.enabled) ?? null;
    if (enabledInOrder && enabledInOrder.length > 0) {
      // Load-order mode: enabled mods only, in ascending (low→high) order.
      for (const entry of enabledInOrder) {
        const root = vfs.join(modsPath, entry.id);
        if (!vfs.exists(root)) {
          missingEnabled.push(entry); // enabled but not under the workshop dir
          continue;
        }
        const info = readModInfo(vfs, root, entry.id);
        sources.push({
          id: entry.id,
          kind: 'mod',
          name: info.name,
          deprecated: info.deprecated,
          enabled: true,
          order: entry.order,
          root,
        });
      }
    } else {
      // Fallback: every installed mod, sorted by id (the original behavior).
      const modIds = vfs
        .readDir(modsPath)
        .filter((d) => vfs.isDir(vfs.join(modsPath, d)))
        .sort();
      for (const id of modIds) {
        const root = vfs.join(modsPath, id);
        const info = readModInfo(vfs, root, id);
        sources.push({
          id,
          kind: 'mod',
          name: info.name,
          deprecated: info.deprecated,
          enabled: true,
          order: null,
          root,
        });
      }
    }
  }

  const userRoot = vfs.join(sa, 'user');
  if (vfs.exists(userRoot)) {
    sources.push({
      id: 'user',
      kind: 'user',
      name: 'User overrides',
      deprecated: false,
      enabled: true,
      order: null,
      root: userRoot,
    });
  }
  return { sources, missingEnabled };
}

/** List `*.ini` files (shallow) in `<source.root>/<category>`. */
function listCategoryFiles(vfs: Vfs, source: Source, category: string): string[] {
  const dir = vfs.join(source.root, category);
  if (!vfs.exists(dir)) return [];
  return vfs
    .readDir(dir)
    .filter((f) => f.toLowerCase().endsWith('.ini'))
    .map((f) => vfs.join(dir, f));
}

/**
 * Index one category across all (non-deprecated) sources, last-writer-wins by
 * filename. `sources` must already be in override priority order (low → high).
 */
export function indexCategory(
  vfs: Vfs,
  sources: Source[],
  category: string,
): { files: IndexedFile[]; collisions: IndexedFile[] } {
  const byId = new Map<string, IndexedFile>();
  for (const source of sources) {
    if (source.deprecated) continue; // skip deprecated mods entirely
    for (const path of listCategoryFiles(vfs, source, category)) {
      const id = vfs.basename(path).replace(/\.ini$/i, '');
      const prev = byId.get(id);
      byId.set(id, {
        id,
        path,
        source: source.id,
        overridden: prev ? [...prev.overridden, prev.source] : [],
      });
    }
  }
  const files = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  const collisions = files.filter((f) => f.overridden.length > 0);
  return { files, collisions };
}

// --- Shared single-file categories (systems/weapons.ini, sensors.ini) --------
// These aren't one-file-per-entity: every source ships a (often partial) copy
// of the same file, and the game merges their sections additively. So override
// resolution is per-SECTION, not per-file (last-writer-wins by section id).

export type MergedSection = {
  id: string;
  section: IniSection;
  source: string;
  /** Sources that also defined this section id but lost (priority order). */
  overridden: string[];
};

/**
 * Merge a specific relative file (e.g. `systems/weapons.ini`) across all
 * non-deprecated sources, last-writer-wins by section id. `sources` must be in
 * override priority order (low → high). Returns sections sorted by id.
 */
export function mergeSections(
  vfs: Vfs,
  sources: Source[],
  relPath: string,
): { sections: MergedSection[]; collisions: MergedSection[] } {
  const byId = new Map<string, MergedSection>();
  for (const source of sources) {
    if (source.deprecated) continue;
    const path = vfs.join(source.root, relPath);
    if (!vfs.exists(path)) continue;
    const doc = parseIni(vfs.readText(path));
    for (const section of doc.sections) {
      const prev = byId.get(section.name);
      byId.set(section.name, {
        id: section.name,
        section,
        source: source.id,
        overridden: prev ? [...prev.overridden, prev.source] : [],
      });
    }
  }
  const sections = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  const collisions = sections.filter((s) => s.overridden.length > 0);
  return { sections, collisions };
}
