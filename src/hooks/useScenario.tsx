import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type Dispatch,
  type ReactNode,
} from 'react';
import {
  loadHistory,
  loadState,
  saveHistory,
  saveState,
} from '../lib/storage';
import type {
  AppState,
  DefenseLayer,
  FriendlyShip,
  Missile,
  Salvo,
  Scenario,
  TargetShip,
} from '../types';

const HISTORY_LIMIT = 50;

const uuid = (): string => crypto.randomUUID();

function makeBlankScenario(name = 'New Scenario'): Scenario {
  return {
    id: uuid(),
    name,
    notes: '',
    simultaneityToleranceS: 10,
    repositionWarningThresholdS: 3600,
    friendlyShips: [],
    targetShips: [],
  };
}

function makeInitialState(): AppState {
  const persisted = loadState();
  if (persisted) return persisted;
  const scenario = makeBlankScenario('Scenario 1');
  return {
    scenarios: [scenario],
    activeScenarioId: scenario.id,
    missileLibrary: [],
  };
}

type Action =
  | { type: 'ADD_SCENARIO' }
  | { type: 'DUPLICATE_SCENARIO'; id: string }
  | { type: 'DELETE_SCENARIO'; id: string }
  | { type: 'RENAME_SCENARIO'; id: string; name: string }
  | { type: 'SET_ACTIVE_SCENARIO'; id: string }
  | { type: 'UPDATE_SCENARIO'; id: string; patch: Partial<Scenario> }
  | { type: 'ADD_FRIENDLY_SHIP'; scenarioId: string }
  | {
      type: 'UPDATE_FRIENDLY_SHIP';
      scenarioId: string;
      shipId: string;
      patch: Partial<FriendlyShip>;
    }
  | { type: 'DELETE_FRIENDLY_SHIP'; scenarioId: string; shipId: string }
  | { type: 'ADD_SALVO'; scenarioId: string; shipId: string }
  | {
      type: 'UPDATE_SALVO';
      scenarioId: string;
      shipId: string;
      salvoId: string;
      patch: Partial<Salvo>;
    }
  | { type: 'DELETE_SALVO'; scenarioId: string; shipId: string; salvoId: string }
  | { type: 'ADD_TARGET_SHIP'; scenarioId: string }
  | {
      type: 'UPDATE_TARGET_SHIP';
      scenarioId: string;
      targetId: string;
      patch: Partial<TargetShip>;
    }
  | { type: 'DELETE_TARGET_SHIP'; scenarioId: string; targetId: string }
  | { type: 'ADD_DEFENSE_LAYER'; scenarioId: string; targetId: string }
  | {
      type: 'UPDATE_DEFENSE_LAYER';
      scenarioId: string;
      targetId: string;
      layerId: string;
      patch: Partial<DefenseLayer>;
    }
  | { type: 'DELETE_DEFENSE_LAYER'; scenarioId: string; targetId: string; layerId: string }
  | {
      type: 'REORDER_DEFENSE_LAYERS';
      scenarioId: string;
      targetId: string;
      orderedLayerIds: string[];
    }
  | { type: 'ADD_MISSILE' }
  | { type: 'UPDATE_MISSILE'; id: string; patch: Partial<Missile> }
  | { type: 'DELETE_MISSILE'; id: string }
  | {
      type: 'IMPORT_SCENARIOS';
      scenarios: Scenario[];
      missileLibrary: Missile[];
    }
  | { type: 'UNDO' }
  | { type: 'REDO' };

export type ScenarioAction = Action;

type HistoryState = {
  past: AppState[];
  present: AppState;
  future: AppState[];
};

function mapScenario(
  state: AppState,
  scenarioId: string,
  fn: (s: Scenario) => Scenario,
): AppState {
  return {
    ...state,
    scenarios: state.scenarios.map((s) => (s.id === scenarioId ? fn(s) : s)),
  };
}

function mapShip(
  scenario: Scenario,
  shipId: string,
  fn: (s: FriendlyShip) => FriendlyShip,
): Scenario {
  return {
    ...scenario,
    friendlyShips: scenario.friendlyShips.map((s) => (s.id === shipId ? fn(s) : s)),
  };
}

function mapTarget(
  scenario: Scenario,
  targetId: string,
  fn: (t: TargetShip) => TargetShip,
): Scenario {
  return {
    ...scenario,
    targetShips: scenario.targetShips.map((t) => (t.id === targetId ? fn(t) : t)),
  };
}

function deepCloneScenario(scenario: Scenario, newName: string): Scenario {
  return {
    ...scenario,
    id: uuid(),
    name: newName,
    friendlyShips: scenario.friendlyShips.map((ship) => ({
      ...ship,
      id: uuid(),
      salvos: ship.salvos.map((salvo) => ({ ...salvo, id: uuid() })),
    })),
    targetShips: scenario.targetShips.map((t) => ({
      ...t,
      id: uuid(),
      defenseLayers: t.defenseLayers.map((l) => ({ ...l, id: uuid() })),
    })),
  };
}

function applyAction(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'ADD_SCENARIO': {
      const s = makeBlankScenario(`Scenario ${state.scenarios.length + 1}`);
      return {
        ...state,
        scenarios: [...state.scenarios, s],
        activeScenarioId: s.id,
      };
    }
    case 'DUPLICATE_SCENARIO': {
      const original = state.scenarios.find((s) => s.id === action.id);
      if (!original) return state;
      const copy = deepCloneScenario(original, `${original.name} (copy)`);
      return {
        ...state,
        scenarios: [...state.scenarios, copy],
        activeScenarioId: copy.id,
      };
    }
    case 'DELETE_SCENARIO': {
      const remaining = state.scenarios.filter((s) => s.id !== action.id);
      const activeId =
        state.activeScenarioId === action.id
          ? (remaining[0]?.id ?? null)
          : state.activeScenarioId;
      return { ...state, scenarios: remaining, activeScenarioId: activeId };
    }
    case 'RENAME_SCENARIO':
      return mapScenario(state, action.id, (s) => ({ ...s, name: action.name }));
    case 'SET_ACTIVE_SCENARIO':
      return { ...state, activeScenarioId: action.id };
    case 'UPDATE_SCENARIO':
      return mapScenario(state, action.id, (s) => ({ ...s, ...action.patch }));

    case 'ADD_FRIENDLY_SHIP':
      return mapScenario(state, action.scenarioId, (s) => ({
        ...s,
        friendlyShips: [
          ...s.friendlyShips,
          {
            id: uuid(),
            name: `Ship ${String.fromCharCode(65 + s.friendlyShips.length)}`,
            speedKnots: 25,
            magazineSize: 8,
            salvos: [],
          },
        ],
      }));
    case 'UPDATE_FRIENDLY_SHIP':
      return mapScenario(state, action.scenarioId, (s) =>
        mapShip(s, action.shipId, (ship) => ({ ...ship, ...action.patch })),
      );
    case 'DELETE_FRIENDLY_SHIP':
      return mapScenario(state, action.scenarioId, (s) => ({
        ...s,
        friendlyShips: s.friendlyShips.filter((sh) => sh.id !== action.shipId),
      }));

    case 'ADD_SALVO':
      return mapScenario(state, action.scenarioId, (s) =>
        mapShip(s, action.shipId, (ship) => ({
          ...ship,
          salvos: [
            ...ship.salvos,
            {
              id: uuid(),
              missileId: state.missileLibrary[0]?.id ?? '',
              count: 4,
              rangeToTargetNm: 50,
              bearingToTargetDeg: 0,
              targetId: s.targetShips[0]?.id ?? '',
            },
          ],
        })),
      );
    case 'UPDATE_SALVO':
      return mapScenario(state, action.scenarioId, (s) =>
        mapShip(s, action.shipId, (ship) => ({
          ...ship,
          salvos: ship.salvos.map((sv) =>
            sv.id === action.salvoId ? { ...sv, ...action.patch } : sv,
          ),
        })),
      );
    case 'DELETE_SALVO':
      return mapScenario(state, action.scenarioId, (s) =>
        mapShip(s, action.shipId, (ship) => ({
          ...ship,
          salvos: ship.salvos.filter((sv) => sv.id !== action.salvoId),
        })),
      );

    case 'ADD_TARGET_SHIP':
      return mapScenario(state, action.scenarioId, (s) => ({
        ...s,
        targetShips: [
          ...s.targetShips,
          {
            id: uuid(),
            name: `Target ${s.targetShips.length + 1}`,
            speedKnots: 20,
            headingDeg: 0,
            defenseLayers: [],
          },
        ],
      }));
    case 'UPDATE_TARGET_SHIP':
      return mapScenario(state, action.scenarioId, (s) =>
        mapTarget(s, action.targetId, (t) => ({ ...t, ...action.patch })),
      );
    case 'DELETE_TARGET_SHIP':
      return mapScenario(state, action.scenarioId, (s) => ({
        ...s,
        targetShips: s.targetShips.filter((t) => t.id !== action.targetId),
        friendlyShips: s.friendlyShips.map((ship) => ({
          ...ship,
          salvos: ship.salvos.filter((sv) => sv.targetId !== action.targetId),
        })),
      }));

    case 'ADD_DEFENSE_LAYER':
      return mapScenario(state, action.scenarioId, (s) =>
        mapTarget(s, action.targetId, (t) => ({
          ...t,
          defenseLayers: [
            ...t.defenseLayers,
            {
              id: uuid(),
              name: `Layer ${t.defenseLayers.length + 1}`,
              interceptsPerWindow: 2,
              windowS: 10,
            },
          ],
        })),
      );
    case 'UPDATE_DEFENSE_LAYER':
      return mapScenario(state, action.scenarioId, (s) =>
        mapTarget(s, action.targetId, (t) => ({
          ...t,
          defenseLayers: t.defenseLayers.map((l) =>
            l.id === action.layerId ? { ...l, ...action.patch } : l,
          ),
        })),
      );
    case 'DELETE_DEFENSE_LAYER':
      return mapScenario(state, action.scenarioId, (s) =>
        mapTarget(s, action.targetId, (t) => ({
          ...t,
          defenseLayers: t.defenseLayers.filter((l) => l.id !== action.layerId),
        })),
      );
    case 'REORDER_DEFENSE_LAYERS':
      return mapScenario(state, action.scenarioId, (s) =>
        mapTarget(s, action.targetId, (t) => {
          const byId = new Map(t.defenseLayers.map((l) => [l.id, l] as const));
          const reordered = action.orderedLayerIds
            .map((id) => byId.get(id))
            .filter((l): l is DefenseLayer => Boolean(l));
          return { ...t, defenseLayers: reordered };
        }),
      );

    case 'ADD_MISSILE':
      return {
        ...state,
        missileLibrary: [
          ...state.missileLibrary,
          {
            id: uuid(),
            name: `Missile ${state.missileLibrary.length + 1}`,
            speedKnots: 500,
            maxRangeNm: 60,
            platform: 'surface_ship',
          },
        ],
      };
    case 'UPDATE_MISSILE':
      return {
        ...state,
        missileLibrary: state.missileLibrary.map((m) =>
          m.id === action.id ? { ...m, ...action.patch } : m,
        ),
      };
    case 'DELETE_MISSILE':
      return {
        ...state,
        missileLibrary: state.missileLibrary.filter((m) => m.id !== action.id),
      };

    case 'IMPORT_SCENARIOS':
      return {
        ...state,
        scenarios: [...state.scenarios, ...action.scenarios],
        missileLibrary: action.missileLibrary,
        activeScenarioId:
          state.activeScenarioId ?? action.scenarios[0]?.id ?? null,
      };

    default:
      return state;
  }
}

function reducer(history: HistoryState, action: Action): HistoryState {
  if (action.type === 'UNDO') {
    const previous = history.past[history.past.length - 1];
    if (!previous) return history;
    return {
      past: history.past.slice(0, -1),
      present: previous,
      future: [history.present, ...history.future],
    };
  }
  if (action.type === 'REDO') {
    const next = history.future[0];
    if (!next) return history;
    return {
      past: [...history.past, history.present].slice(-HISTORY_LIMIT),
      present: next,
      future: history.future.slice(1),
    };
  }
  const next = applyAction(history.present, action);
  if (next === history.present) return history;
  return {
    past: [...history.past, history.present].slice(-HISTORY_LIMIT),
    present: next,
    future: [],
  };
}

function makeInitialHistory(): HistoryState {
  const persistedHistory = loadHistory();
  const present = makeInitialState();
  if (persistedHistory) {
    return { past: persistedHistory.past, present, future: persistedHistory.future };
  }
  return { past: [], present, future: [] };
}

type ScenarioContextValue = {
  state: AppState;
  dispatch: Dispatch<Action>;
  canUndo: boolean;
  canRedo: boolean;
  activeScenario: Scenario | null;
};

const ScenarioContext = createContext<ScenarioContextValue | null>(null);

export function ScenarioProvider({ children }: { children: ReactNode }) {
  const [history, dispatch] = useReducer(reducer, undefined, makeInitialHistory);

  useEffect(() => {
    saveState(history.present);
    saveHistory({ past: history.past, future: history.future });
  }, [history]);

  const value = useMemo<ScenarioContextValue>(() => {
    const activeScenario =
      history.present.scenarios.find((s) => s.id === history.present.activeScenarioId) ??
      null;
    return {
      state: history.present,
      dispatch,
      canUndo: history.past.length > 0,
      canRedo: history.future.length > 0,
      activeScenario,
    };
  }, [history]);

  return <ScenarioContext.Provider value={value}>{children}</ScenarioContext.Provider>;
}

export function useScenario(): ScenarioContextValue {
  const ctx = useContext(ScenarioContext);
  if (!ctx) throw new Error('useScenario must be used inside ScenarioProvider');
  return ctx;
}

export function useUndoRedo(): {
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
} {
  const { dispatch, canUndo, canRedo } = useScenario();
  const undo = useCallback(() => dispatch({ type: 'UNDO' }), [dispatch]);
  const redo = useCallback(() => dispatch({ type: 'REDO' }), [dispatch]);
  return { undo, redo, canUndo, canRedo };
}
