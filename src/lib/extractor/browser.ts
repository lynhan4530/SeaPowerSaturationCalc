/**
 * Browser adapter: read a Sea Power install straight from the user's disk via
 * the File System Access API (Chromium desktop), gather the relevant `.ini`
 * files into an in-memory tree, and run the pure extraction pipeline — no Node,
 * no separate CLI, no presets.json file to shuffle around.
 *
 * Only the handful of category folders the parser needs are read (ammunition/,
 * systems/, vessels/, ships/, language_en/), so we never enumerate unrelated
 * Steam content.
 */
import { MemVfs } from './vfs';
import { extractPresets, type ExtractResult } from './orchestrate';
import { buildNameTables } from './names';

// --- Minimal File System Access typings (avoid relying on lib.dom / `any`) ---
interface FsaFileHandle {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
}
interface FsaDirectoryHandle {
  kind: 'directory';
  name: string;
  getDirectoryHandle(name: string): Promise<FsaDirectoryHandle>;
  getFileHandle(name: string): Promise<FsaFileHandle>;
  entries(): AsyncIterableIterator<[string, FsaFileHandle | FsaDirectoryHandle]>;
}
type DirectoryPicker = (options?: {
  id?: string;
  mode?: 'read' | 'readwrite';
}) => Promise<FsaDirectoryHandle>;

function getPicker(): DirectoryPicker | undefined {
  return (window as unknown as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker;
}

/** True when the browser exposes the directory picker (Chrome/Edge desktop). */
export function isFileSystemAccessSupported(): boolean {
  return typeof getPicker() === 'function';
}

/** Category folders that hold one `.ini` per entity. */
const FILE_CATEGORIES = ['ammunition', 'vessels', 'ships'] as const;
/** The two shared, section-merged system files. */
const SYSTEM_FILES = ['weapons.ini', 'sensors.ini'] as const;
/** The three localization files (game `original` root only). */
const LANGUAGE_FILES = {
  ammunition: 'ammunition_names.ini',
  vessels: 'vessel_names.ini',
  systems: 'systemgroups.ini',
} as const;

const STEAMAPPS_REL = 'Sea Power_Data/StreamingAssets';
const WORKSHOP_REL = 'workshop/content/1286220';

/** Walk a POSIX-relative path of subdirectories, or null if any segment is absent. */
async function getSubdir(
  dir: FsaDirectoryHandle,
  rel: string,
): Promise<FsaDirectoryHandle | null> {
  let current = dir;
  for (const seg of rel.split('/').filter((s) => s !== '')) {
    try {
      current = await current.getDirectoryHandle(seg);
    } catch {
      return null;
    }
  }
  return current;
}

/** Read a single file's text, or null if it's missing. */
async function readFileText(dir: FsaDirectoryHandle, name: string): Promise<string | null> {
  try {
    const fh = await dir.getFileHandle(name);
    return await (await fh.getFile()).text();
  } catch {
    return null;
  }
}

/** Snapshot the shallow `.ini` files of `<root>/<category>` into the file map. */
async function snapshotCategory(
  root: FsaDirectoryHandle,
  category: string,
  mountPrefix: string,
  files: Map<string, string>,
): Promise<void> {
  const dir = await getSubdir(root, category);
  if (!dir) return;
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === 'file' && name.toLowerCase().endsWith('.ini')) {
      const text = await readFileText(dir, name);
      if (text !== null) files.set(`${mountPrefix}/${category}/${name}`, text);
    }
  }
}

/**
 * Snapshot one source root (a base/user/mod directory laid out like
 * StreamingAssets) into the file map under `mountPrefix`.
 */
async function snapshotRoot(
  root: FsaDirectoryHandle,
  mountPrefix: string,
  files: Map<string, string>,
): Promise<void> {
  for (const category of FILE_CATEGORIES) {
    await snapshotCategory(root, category, mountPrefix, files);
  }
  const systems = await getSubdir(root, 'systems');
  if (systems) {
    for (const name of SYSTEM_FILES) {
      const text = await readFileText(systems, name);
      if (text !== null) files.set(`${mountPrefix}/systems/${name}`, text);
    }
  }
}

/** Locate the game directory (the one containing `Sea Power_Data/StreamingAssets`). */
async function locateGameDir(root: FsaDirectoryHandle): Promise<FsaDirectoryHandle | null> {
  const candidates = ['', 'common/Sea Power', 'steamapps/common/Sea Power'];
  for (const rel of candidates) {
    const dir = rel === '' ? root : await getSubdir(root, rel);
    if (dir && (await getSubdir(dir, `${STEAMAPPS_REL}/original`))) return dir;
  }
  return null;
}

/** Locate the workshop mods directory, if the pick reaches it. */
async function locateModsDir(root: FsaDirectoryHandle): Promise<FsaDirectoryHandle | null> {
  for (const rel of [WORKSHOP_REL, `steamapps/${WORKSHOP_REL}`]) {
    const dir = await getSubdir(root, rel);
    if (dir) return dir;
  }
  return null;
}

/** Best-effort game version from changelog.txt (first version-looking token). */
async function readGameVersion(gameDir: FsaDirectoryHandle): Promise<string | null> {
  const text = await readFileText(gameDir, 'changelog.txt');
  if (text === null) return null;
  const m = text.slice(0, 2000).match(/v?\d+\.\d+(?:\.\d+)?[a-z]?/i);
  return m?.[0] ?? null;
}

/**
 * Extract presets from an already-picked directory handle. Exposed separately so
 * tests / callers can supply a handle without invoking the picker.
 */
export async function extractFromDirectory(root: FsaDirectoryHandle): Promise<ExtractResult> {
  const gameDir = await locateGameDir(root);
  if (!gameDir) {
    throw new Error(
      "Couldn't find a Sea Power install in that folder. Pick your Steam library folder (the one containing 'steamapps'), the 'steamapps' folder, or the 'Sea Power' game folder.",
    );
  }
  const originalDir = await getSubdir(gameDir, `${STEAMAPPS_REL}/original`);
  if (!originalDir) {
    throw new Error('Found the game folder but not Sea Power_Data/StreamingAssets/original.');
  }

  const files = new Map<string, string>();
  const gamePrefix = `game/${STEAMAPPS_REL}`;
  await snapshotRoot(originalDir, `${gamePrefix}/original`, files);

  // Localization (game `original` root only).
  const langDir = await getSubdir(originalDir, 'language_en');
  const nameTexts = {
    ammunition: langDir ? await readFileText(langDir, LANGUAGE_FILES.ammunition) : null,
    vessels: langDir ? await readFileText(langDir, LANGUAGE_FILES.vessels) : null,
    systems: langDir ? await readFileText(langDir, LANGUAGE_FILES.systems) : null,
  };

  // Local user overrides (sibling of `original`).
  const userDir = await getSubdir(gameDir, `${STEAMAPPS_REL}/user`);
  if (userDir) await snapshotRoot(userDir, `${gamePrefix}/user`, files);

  // Workshop mods (every installed mod — load order lives outside the pick).
  const warnings: string[] = [];
  const modsDir = await locateModsDir(root);
  let modsPath: string | null = null;
  if (modsDir) {
    modsPath = 'mods';
    for await (const [modId, handle] of modsDir.entries()) {
      if (handle.kind !== 'directory') continue;
      const info = await readFileText(handle, '_info.ini');
      if (info !== null) files.set(`mods/${modId}/_info.ini`, info);
      await snapshotRoot(handle, `mods/${modId}`, files);
    }
  } else {
    warnings.push(
      'No workshop mods folder reached from this pick — base game only. To include mods, pick your Steam library or "steamapps" folder.',
    );
  }

  const vfs = new MemVfs(files);
  const result = extractPresets(vfs, {
    gamePath: 'game',
    modsPath,
    loadOrder: null, // usersettings.ini lives in AppData, outside the pick → all installed mods
    names: buildNameTables(nameTexts),
    gameVersion: await readGameVersion(gameDir),
    resolvedPaths: {
      gamePath: `${root.name}/…/Sea Power`,
      modsPath: modsDir ? `${root.name}/…/${WORKSHOP_REL}` : null,
    },
  });
  return { presets: result.presets, warnings: [...warnings, ...result.warnings] };
}

/** Show the directory picker, then extract. Throws if the API is unavailable. */
export async function pickAndExtract(): Promise<ExtractResult> {
  const picker = getPicker();
  if (!picker) {
    throw new Error(
      'This browser cannot open folders. Use Chrome or Edge on desktop, or the "Sync Game Data" upload instead.',
    );
  }
  const root = await picker({ id: 'sea-power-install', mode: 'read' });
  return extractFromDirectory(root);
}
