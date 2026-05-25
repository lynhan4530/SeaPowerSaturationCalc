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
  presetId?: string;
  loadout?: string;
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
  presetId?: string;
  loadout?: string;
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

/** --- Sea Power Game Preset Schema Types --- */

export type SourceKind = 'base' | 'user' | 'mod';

export type MissileRole = 'AAW' | 'ASuW' | 'ASW' | 'Other';

export type DatabaseGuidanceType =
  | 'None'
  | 'IR'
  | 'SARH'
  | 'ARH'
  | 'ARM'
  | 'Laser'
  | 'TV'
  | 'ActiveSonar'
  | 'PassiveSonar'
  | 'WakeHoming'
  | 'Unknown';

export type SourceInfo = {
  id: string;
  kind: SourceKind;
  name: string;
  deprecated: boolean;
  enabled: boolean;
  order: number | null;
};

export type MissilePreset = {
  id: string;
  name: string;
  nickname: string | null;
  category: string | null;
  role: MissileRole;
  speedKnots: number | null;
  maxRangeNm: number | null;
  minRangeNm: number | null;
  guidance: DatabaseGuidanceType;
  seaSkimming: boolean;
  seaSkimmingAltFt: number | null;
  rcs: number | null;
  seekerActiveRangeNm: number | null;
  seekerPassiveRangeNm: number | null;
  antiCountermeasuresBonus: number | null;
  antiJammerBonus: number | null;
  killProbability: number | null;
  source: string;
};

export type LauncherPreset = {
  id: string;
  name: string;
  kind: string;
  reloadTimeS: number | null;
  fireRatePerMin: number | null;
  horizontalDegPerSec: number | null;
  verticalDegPerSec: number | null;
  missileInterceptChance: number | null;
  aircraftInterceptChance: number | null;
  source: string;
};

export type IlluminatorPreset = {
  id: string;
  name: string;
  kind: string | null;
  type: string | null;
  mode: string | null;
  weaponChannels: number | null;
  targetChannels: number | null;
  maxRangeKm: number | null;
  maxRangeNm: number | null;
  source: string;
};

export type ShipDirector = {
  sensorSystem: string;
  illuminatorId: string;
  resolved: boolean;
  type: string | null;
  mode: string | null;
  weaponChannels: number | null;
  maxRangeNm: number | null;
};

export type ShipMount = {
  index: number;
  weaponType: string;
  launcherId: string;
  resolved: boolean;
};

export type ShipLoadoutEntry = {
  ammoId: string;
  count: number | null;
  isMissile: boolean;
};

export type ShipLoadout = {
  name: string;
  ammo: ShipLoadoutEntry[];
};

export type ShipPreset = {
  id: string;
  name: string;
  nickname: string | null;
  category: string | null;
  source: string;
  unitType: string | null;
  role: string | null;
  displacementTons: number | null;
  maxSpeedKnots: number | null;
  weaponChannels: number | null;
  directors: ShipDirector[];
  mounts: ShipMount[];
  loadouts: ShipLoadout[];
};

export type PresetsJson = {
  generatedAt: string;
  gameVersion: string | null;
  resolvedPaths: {
    gamePath: string;
    modsPath: string | null;
  };
  sources: SourceInfo[];
  missiles: MissilePreset[];
  launchers: LauncherPreset[];
  illuminators: IlluminatorPreset[];
  ships: ShipPreset[];
  stats: Record<string, number>;
};

