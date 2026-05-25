import Dexie, { type Table } from 'dexie';
import type {
  MissilePreset,
  LauncherPreset,
  IlluminatorPreset,
  ShipPreset,
  SourceInfo,
} from '../types';

export class SeaPowerDatabase extends Dexie {
  missiles!: Table<MissilePreset, string>;
  launchers!: Table<LauncherPreset, string>;
  illuminators!: Table<IlluminatorPreset, string>;
  ships!: Table<ShipPreset, string>;
  sources!: Table<SourceInfo, string>;

  constructor() {
    super('SeaPowerPresets');
    this.version(1).stores({
      missiles: 'id, name, role, guidance',
      launchers: 'id, name, kind',
      illuminators: 'id, name',
      ships: 'id, name, unitType',
      sources: 'id, name',
    });
  }
}

export const db = new SeaPowerDatabase();
