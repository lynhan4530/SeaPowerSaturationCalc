export type Platform = 'submarine' | 'surface_ship' | 'aircraft';

export type Missile = {
  id: string;
  name: string;
  speedKnots: number;
  maxRangeNm: number;
  platform: Platform;
};

export type Salvo = {
  id: string;
  missileId: string;
  count: number;
  rangeToTargetNm: number;
  bearingToTargetDeg: number;
  targetId: string;
};

export type FriendlyShip = {
  id: string;
  name: string;
  speedKnots: number;
  magazineSize: number;
  salvos: Salvo[];
  notes?: string;
};

export type DefenseLayer = {
  id: string;
  name: string;
  interceptsPerWindow: number;
  windowS: number;
  minRangeNm?: number;
  maxRangeNm?: number;
};

export type TargetShip = {
  id: string;
  name: string;
  speedKnots: number;
  headingDeg: number;
  defenseLayers: DefenseLayer[];
};

export type Scenario = {
  id: string;
  name: string;
  notes?: string;
  simultaneityToleranceS: number;
  repositionWarningThresholdS: number;
  friendlyShips: FriendlyShip[];
  targetShips: TargetShip[];
};

export type AppState = {
  scenarios: Scenario[];
  activeScenarioId: string | null;
  missileLibrary: Missile[];
};
