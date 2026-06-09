/**
 * Tokenizer for Sea Power's custom INI dialect. Vendored verbatim from the
 * SeaPowerDataExtraction parser (src/ini.ts) — pure, no Node/DOM imports.
 *
 * The game's `.ini` files violate enough INI conventions that a generic library
 * is unsafe. This tokenizer handles, specifically:
 *
 *  - Two comment styles: `//` (usually inline) and `#` / `############` (line).
 *  - Divider "sections" like `[ ---- CIWS ---- ]` that are visual separators,
 *    NOT real sections — detected by a run of 2+ punctuation chars and dropped.
 *  - Duplicate keys are legal and meaningful (e.g. `AssociatedMagazine` repeats
 *    once per weapon system). Every value is kept; nothing is overwritten.
 *  - A repeated section header merges into the existing section rather than
 *    replacing it, preserving the duplicate-key semantics above.
 *
 * Real ids may contain single dashes (`SPG-62`, `RIM-66C`), so only runs of 2+
 * punctuation chars mark a divider — a single dash never does.
 */

export type IniSection = {
  name: string;
  /** Key names in first-seen order (deduplicated). */
  keys: string[];
  /** Every key -> all values seen for it, in document order. Duplicates kept. */
  values: Record<string, string[]>;
};

export type IniDocument = {
  /** Sections in document order. */
  sections: IniSection[];
  /** Section lookup by exact name. */
  byName: Map<string, IniSection>;
  /** Key/values appearing before the first `[section]` header. */
  preamble: IniSection;
};

/** A `[ ---- ... ---- ]` style header: contains a run of 2+ of these chars. */
const DIVIDER_RUN = /[-=#*~_]{2,}/;

function makeSection(name: string): IniSection {
  return { name, keys: [], values: {} };
}

function addValue(section: IniSection, key: string, value: string): void {
  const existing = section.values[key];
  if (existing) {
    existing.push(value);
  } else {
    section.values[key] = [value];
    section.keys.push(key);
  }
}

/**
 * Strip a trailing `//` inline comment from a value. We only treat `//` as an
 * inline comment (the `#` styles are handled at the line level), and we leave
 * `//` that appears with no preceding content to the line-level check.
 */
function stripInlineComment(value: string): string {
  const idx = value.indexOf('//');
  return (idx === -1 ? value : value.slice(0, idx)).trim();
}

export function parseIni(text: string): IniDocument {
  const preamble = makeSection('');
  const sections: IniSection[] = [];
  const byName = new Map<string, IniSection>();
  let current = preamble;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '') continue;
    // Whole-line comments: `#`, `############`, or a line that opens with `//`.
    if (line.startsWith('#') || line.startsWith('//')) continue;

    if (line.startsWith('[')) {
      const close = line.indexOf(']');
      if (close === -1) continue; // malformed header; ignore defensively
      const inner = line.slice(1, close).trim();
      if (inner === '' || DIVIDER_RUN.test(inner)) continue; // divider / empty

      const existing = byName.get(inner);
      if (existing) {
        current = existing; // merge repeated header into the same section
      } else {
        const section = makeSection(inner);
        sections.push(section);
        byName.set(inner, section);
        current = section;
      }
      continue;
    }

    const eq = line.indexOf('=');
    if (eq === -1) continue; // not a key/value line; skip
    const key = line.slice(0, eq).trim();
    if (key === '') continue;
    const value = stripInlineComment(line.slice(eq + 1));
    addValue(current, key, value);
  }

  return { sections, byName, preamble };
}

/** First value for a key, or undefined. Use when duplicates aren't expected. */
export function getValue(section: IniSection, key: string): string | undefined {
  return section.values[key]?.[0];
}

/** All values for a key (empty array if absent). Use for duplicate-key fields. */
export function getValues(section: IniSection, key: string): string[] {
  return section.values[key] ?? [];
}

/** First value parsed as a finite number, or undefined. */
export function getNumber(section: IniSection, key: string): number | undefined {
  const raw = getValue(section, key);
  if (raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/** First value split on commas, trimmed, empties dropped (e.g. `AvailableLoadouts`). */
export function getList(section: IniSection, key: string): string[] {
  const raw = getValue(section, key);
  if (raw === undefined) return [];
  return splitList(raw);
}

function splitList(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

// --- Document-level lookups -------------------------------------------------
// Missile fields are spread across [General]/[Guidance]/[SensorData], so it's
// convenient to search the whole document for the first section that has a key.

/** First value for `key` across all sections in document order, or undefined. */
export function findValue(doc: IniDocument, key: string): string | undefined {
  for (const section of doc.sections) {
    const v = getValue(section, key);
    if (v !== undefined) return v;
  }
  return getValue(doc.preamble, key);
}

/** First numeric value for `key` across all sections, or undefined. */
export function findNumber(doc: IniDocument, key: string): number | undefined {
  const raw = findValue(doc, key);
  if (raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/** First comma-list value for `key` across all sections (empty if absent). */
export function findList(doc: IniDocument, key: string): string[] {
  const raw = findValue(doc, key);
  return raw === undefined ? [] : splitList(raw);
}
