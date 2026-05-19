import type { AppState, Missile, Scenario } from '../types';

const STORAGE_KEY = 'sps:state';
const HISTORY_KEY = 'sps:history';

export function loadState(): AppState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AppState;
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

  const remappedScenarios: Scenario[] = incomingScenarios.map((s) => ({
    ...s,
    friendlyShips: s.friendlyShips.map((ship) => ({
      ...ship,
      salvos: ship.salvos.map((salvo) => ({
        ...salvo,
        missileId: idRemap.get(salvo.missileId) ?? salvo.missileId,
      })),
    })),
  }));

  return {
    scenarios: [...existing.scenarios, ...remappedScenarios],
    missileLibrary: mergedMissiles,
    renamedMissiles,
  };
}
