import type {
  AppState,
  DefenseLayer,
  GuidanceType,
  Missile,
  Scenario,
  WeaponSystem,
} from '../types';

const STORAGE_KEY = 'sps:state';
const HISTORY_KEY = 'sps:history';

const DEFAULT_SATURATION_CONFIDENCE = 0.5;
const DEFAULT_RADAR_HEIGHT_FT = 50;
const VALID_GUIDANCE: GuidanceType[] = ['SARH', 'ARH', 'gun'];

// ───────── Phase 2 migration ─────────
// Pre-Phase-2 scenarios stored a flat `interceptsPerWindow` (+ optional
// min/maxRange) on each layer and no `saturationConfidence`. We upgrade those in
// place on load/import: each legacy layer becomes one synthesized SARH weapon
// system with pk = 1, which reproduces the old binary verdict exactly until the
// user edits it. Raw JSON is read through loose shapes since its keys predate the
// current types.

type RawWeaponSystem = {
  id?: string;
  name?: string;
  guidance?: string;
  channels?: number;
  engagementsPerChannel?: number;
  pk?: number;
  minRangeNm?: number;
  maxRangeNm?: number;
  speedKnots?: number;
};

type RawLayer = {
  id?: string;
  name?: string;
  windowS?: number;
  weaponSystems?: RawWeaponSystem[];
  // legacy fields
  interceptsPerWindow?: number;
  minRangeNm?: number;
  maxRangeNm?: number;
};

const uuid = (): string => crypto.randomUUID();

function migrateWeaponSystem(raw: RawWeaponSystem): WeaponSystem {
  const guidance: GuidanceType = VALID_GUIDANCE.includes(raw.guidance as GuidanceType)
    ? (raw.guidance as GuidanceType)
    : 'SARH';
  return {
    id: raw.id ?? uuid(),
    name: raw.name ?? 'Weapon system',
    guidance,
    channels: raw.channels ?? 0,
    engagementsPerChannel: raw.engagementsPerChannel ?? 1,
    pk: raw.pk ?? 1,
    minRangeNm: raw.minRangeNm,
    maxRangeNm: raw.maxRangeNm,
    speedKnots: raw.speedKnots,
  };
}

function migrateLayer(raw: RawLayer): DefenseLayer {
  const id = raw.id ?? uuid();
  const name = raw.name ?? 'Layer';
  const windowS = raw.windowS ?? 10;
  if (raw.weaponSystems && raw.weaponSystems.length > 0) {
    return { id, name, windowS, weaponSystems: raw.weaponSystems.map(migrateWeaponSystem) };
  }
  // Legacy flat layer → one SARH system, pk = 1 (behaviour-preserving anchor).
  return {
    id,
    name,
    windowS,
    weaponSystems: [
      {
        id: uuid(),
        name,
        guidance: 'SARH',
        channels: raw.interceptsPerWindow ?? 0,
        engagementsPerChannel: 1,
        pk: 1,
        minRangeNm: raw.minRangeNm,
        maxRangeNm: raw.maxRangeNm,
      },
    ],
  };
}

export function migrateScenario(raw: Scenario): Scenario {
  return {
    ...raw,
    saturationConfidence: raw.saturationConfidence ?? DEFAULT_SATURATION_CONFIDENCE,
    radarHeightFt: raw.radarHeightFt ?? DEFAULT_RADAR_HEIGHT_FT,
    targetShips: (raw.targetShips ?? []).map((t) => ({
      ...t,
      defenseLayers: (t.defenseLayers ?? []).map((l) => migrateLayer(l as RawLayer)),
    })),
  };
}

function migrateState(state: AppState): AppState {
  return {
    ...state,
    scenarios: (state.scenarios ?? []).map(migrateScenario),
  };
}

export function loadState(): AppState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return migrateState(JSON.parse(raw) as AppState);
  } catch {
    return null;
  }
}

export function saveState(state: AppState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore quota errors
  }
}

export function loadHistory(): { past: AppState[]; future: AppState[] } | null {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as { past: AppState[]; future: AppState[] };
  } catch {
    return null;
  }
}

export function saveHistory(history: { past: AppState[]; future: AppState[] }): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {
    // ignore
  }
}

export function exportScenario(scenario: Scenario, missileLibrary: Missile[]): string {
  const referencedMissileIds = new Set<string>();
  for (const ship of scenario.friendlyShips) {
    for (const salvo of ship.salvos) {
      referencedMissileIds.add(salvo.missileId);
    }
  }
  const bundledMissiles = missileLibrary.filter((m) => referencedMissileIds.has(m.id));
  const payload: AppState = {
    scenarios: [scenario],
    activeScenarioId: scenario.id,
    missileLibrary: bundledMissiles,
  };
  return JSON.stringify(payload, null, 2);
}

export function downloadScenarioJson(scenario: Scenario, missileLibrary: Missile[]): void {
  const json = exportScenario(scenario, missileLibrary);
  const slug = scenario.name.replace(/[^a-z0-9]+/gi, '_').toLowerCase() || 'scenario';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `scenario_${slug}_${timestamp}.json`;

  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function uniqueMissileName(desired: string, existing: Missile[]): string {
  const names = new Set(existing.map((m) => m.name));
  if (!names.has(desired)) return desired;
  let n = 2;
  while (names.has(`${desired} (${n})`)) n += 1;
  return `${desired} (${n})`;
}

export type ImportResult = {
  scenarios: Scenario[];
  missileLibrary: Missile[];
  renamedMissiles: Array<{ from: string; to: string }>;
};

export function importScenarios(
  json: string,
  existing: { scenarios: Scenario[]; missileLibrary: Missile[] },
): ImportResult {
  const parsed = JSON.parse(json) as Partial<AppState>;
  const incomingScenarios = parsed.scenarios ?? [];
  const incomingMissiles = parsed.missileLibrary ?? [];

  const mergedMissiles: Missile[] = [...existing.missileLibrary];
  const renamedMissiles: Array<{ from: string; to: string }> = [];
  const idRemap = new Map<string, string>();

  for (const incoming of incomingMissiles) {
    const matchByContent = mergedMissiles.find(
      (m) =>
        m.name === incoming.name &&
        m.speedKnots === incoming.speedKnots &&
        m.maxRangeNm === incoming.maxRangeNm &&
        m.platform === incoming.platform,
    );
    if (matchByContent) {
      idRemap.set(incoming.id, matchByContent.id);
      continue;
    }
    const newName = uniqueMissileName(incoming.name, mergedMissiles);
    if (newName !== incoming.name) {
      renamedMissiles.push({ from: incoming.name, to: newName });
    }
    const newMissile: Missile = { ...incoming, name: newName };
    mergedMissiles.push(newMissile);
    idRemap.set(incoming.id, newMissile.id);
  }

  const remappedScenarios: Scenario[] = incomingScenarios.map((s) =>
    migrateScenario({
      ...s,
      friendlyShips: s.friendlyShips.map((ship) => ({
        ...ship,
        salvos: ship.salvos.map((salvo) => ({
          ...salvo,
          missileId: idRemap.get(salvo.missileId) ?? salvo.missileId,
        })),
      })),
    }),
  );

  return {
    scenarios: [...existing.scenarios, ...remappedScenarios],
    missileLibrary: mergedMissiles,
    renamedMissiles,
  };
}
