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

// How a weapon system guides to the target. SARH needs an illuminator locked
// through terminal homing (channels = illuminator WeaponChannels); ARH is
// fire-and-forget; gun = CIWS. Guidance is descriptive metadata today — the
// saturation math depends only on channels/engagements/pk.
export type GuidanceType = 'SARH' | 'ARH' | 'gun';

export type WeaponSystem = {
  id: string;
  name: string;
  guidance: GuidanceType;
  /** Simultaneous guidance channels. */
  channels: number;
  /** Re-engagements available to one channel within a single window. */
  engagementsPerChannel: number;
  /** Single-shot kill probability, 0..1. */
  pk: number;
  minRangeNm?: number;
  maxRangeNm?: number;
};

export type DefenseLayer = {
  id: string;
  name: string;
  /** Saturation interval — see deviation #4. */
  windowS: number;
  weaponSystems: WeaponSystem[];
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
  /** Optional H-hour, "HH:MM:SS". When set, T+Xs values also show clock time. */
  hHour?: string;
  simultaneityToleranceS: number;
  repositionWarningThresholdS: number;
  /** Leak-probability threshold for the SATURATED verdict and inverse solver, 0..1. */
  saturationConfidence: number;
  friendlyShips: FriendlyShip[];
  targetShips: TargetShip[];
};

export type AppState = {
  scenarios: Scenario[];
  activeScenarioId: string | null;
  missileLibrary: Missile[];
};
