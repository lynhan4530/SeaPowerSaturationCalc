/**
 * Virtual filesystem abstraction. The original parser's discovery layer
 * (`sources.ts`) used `node:fs`/`node:path` directly; we inject this small
 * synchronous interface instead so the exact same last-writer-wins logic runs
 * unchanged over an in-memory tree gathered from the browser's folder handles.
 *
 * All paths are POSIX-style ('/'-separated), normalized (no leading slash, no
 * trailing slash, no empty segments). The root directory is the empty string.
 */
export interface Vfs {
  join(...parts: string[]): string;
  basename(p: string): string;
  /** True if `p` is a known file or directory. */
  exists(p: string): boolean;
  isDir(p: string): boolean;
  /** Immediate child entry names (files + subdirectories) of directory `p`. */
  readDir(p: string): string[];
  /** File contents; throws if `p` is not a known file. */
  readText(p: string): string;
}

function normalize(p: string): string {
  return p
    .split('/')
    .filter((seg) => seg !== '' && seg !== '.')
    .join('/');
}

/**
 * In-memory Vfs built from a flat `path → contents` map. Ancestor directories
 * and the parent→children index are derived from the file keys.
 */
export class MemVfs implements Vfs {
  private files = new Map<string, string>();
  private dirs = new Set<string>(['']);
  private children = new Map<string, Set<string>>();

  constructor(files: Map<string, string>) {
    for (const [rawPath, contents] of files) {
      const path = normalize(rawPath);
      if (path === '') continue;
      this.files.set(path, contents);
      this.registerAncestors(path);
    }
  }

  private registerAncestors(path: string): void {
    const segments = path.split('/');
    let parent = '';
    for (let i = 0; i < segments.length; i++) {
      const name = segments[i]!;
      const full = parent === '' ? name : `${parent}/${name}`;
      this.addChild(parent, name);
      // Every segment except the last is a directory.
      if (i < segments.length - 1) this.dirs.add(full);
      parent = full;
    }
  }

  private addChild(dir: string, name: string): void {
    let set = this.children.get(dir);
    if (!set) {
      set = new Set<string>();
      this.children.set(dir, set);
    }
    set.add(name);
  }

  join(...parts: string[]): string {
    return normalize(parts.join('/'));
  }

  basename(p: string): string {
    const norm = normalize(p);
    const idx = norm.lastIndexOf('/');
    return idx === -1 ? norm : norm.slice(idx + 1);
  }

  exists(p: string): boolean {
    const norm = normalize(p);
    return this.files.has(norm) || this.dirs.has(norm);
  }

  isDir(p: string): boolean {
    return this.dirs.has(normalize(p));
  }

  readDir(p: string): string[] {
    const norm = normalize(p);
    if (!this.dirs.has(norm)) return [];
    return [...(this.children.get(norm) ?? [])].sort();
  }

  readText(p: string): string {
    const norm = normalize(p);
    const text = this.files.get(norm);
    if (text === undefined) throw new Error(`ENOENT: no such file '${norm}'`);
    return text;
  }
}
