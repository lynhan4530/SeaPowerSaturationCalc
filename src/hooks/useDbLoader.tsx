import { useEffect, useState, createContext, useContext, type ReactNode } from 'react';
import { db } from '../lib/db';
import { DEFAULT_SEA_SKIM_ALT_FT } from '../lib/calc';
import type { PresetsJson, SourceInfo, Missile } from '../types';

type DbLoaderContextValue = {
  loading: boolean;
  error: string | null;
  syncDate: string | null;
  sources: SourceInfo[];
  dbMissiles: Missile[];
  syncDatabase: (presets: PresetsJson) => Promise<void>;
};

const DbLoaderContext = createContext<DbLoaderContextValue | null>(null);

const mapPresetToMissile = (p: any): Missile => {
  return {
    id: p.id,
    name: p.name,
    speedKnots: p.speedKnots ?? 500,
    maxRangeNm: p.maxRangeNm ?? 60,
    platform: p.role === 'ASW' ? 'submarine' : 'surface_ship',
    // Sea-skimmers fly low → radar-horizon limited; others are treated as high.
    altitudeFt: p.seaSkimming ? (p.seaSkimmingAltFt ?? DEFAULT_SEA_SKIM_ALT_FT) : null,
  };
};

export function DbLoaderProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncDate, setSyncDate] = useState<string | null>(null);
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [dbMissiles, setDbMissiles] = useState<Missile[]>([]);

  const loadAndSeed = async () => {
    try {
      setLoading(true);
      const shipCount = await db.ships.count();
      const lastSync = localStorage.getItem('sea-power-db-sync-date');

      if (shipCount === 0) {
        const res = await fetch('./presets.json');
        if (!res.ok) {
          throw new Error('Failed to fetch default presets.json');
        }
        const data: PresetsJson = await res.json();
        await seedDb(data);
      } else {
        const dbSources = await db.sources.toArray();
        setSources(dbSources);
        
        const presets = await db.missiles.toArray();
        setDbMissiles(presets.map(mapPresetToMissile));
        
        setSyncDate(lastSync);
      }
    } catch (err: any) {
      console.error('Database load error:', err);
      setError(err.message || 'Unknown database error');
    } finally {
      setLoading(false);
    }
  };

  const seedDb = async (data: PresetsJson) => {
    await db.transaction('rw', [db.missiles, db.launchers, db.illuminators, db.ships, db.sources], async () => {
      await db.missiles.clear();
      await db.launchers.clear();
      await db.illuminators.clear();
      await db.ships.clear();
      await db.sources.clear();

      await db.missiles.bulkAdd(data.missiles);
      await db.launchers.bulkAdd(data.launchers);
      await db.illuminators.bulkAdd(data.illuminators);
      await db.ships.bulkAdd(data.ships);
      await db.sources.bulkAdd(data.sources);
    });

    const now = new Date().toLocaleString();
    localStorage.setItem('sea-power-db-sync-date', now);
    setSyncDate(now);
    setSources(data.sources);
    setDbMissiles(data.missiles.map(mapPresetToMissile));
  };

  const syncDatabase = async (presets: PresetsJson) => {
    try {
      setLoading(true);
      await seedDb(presets);
    } catch (err: any) {
      console.error('Database sync error:', err);
      setError(err.message || 'Sync failed');
      throw err;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAndSeed();
  }, []);

  return (
    <DbLoaderContext.Provider value={{ loading, error, syncDate, sources, dbMissiles, syncDatabase }}>
      {children}
    </DbLoaderContext.Provider>
  );
}

export function useDbLoader() {
  const ctx = useContext(DbLoaderContext);
  if (!ctx) throw new Error('useDbLoader must be used inside DbLoaderProvider');
  return ctx;
}
