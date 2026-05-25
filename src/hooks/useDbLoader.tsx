import { useEffect, useState, createContext, useContext, type ReactNode } from 'react';
import { db } from '../lib/db';
import type { PresetsJson, SourceInfo } from '../types';

type DbLoaderContextValue = {
  loading: boolean;
  error: string | null;
  syncDate: string | null;
  sources: SourceInfo[];
  syncDatabase: (presets: PresetsJson) => Promise<void>;
};

const DbLoaderContext = createContext<DbLoaderContextValue | null>(null);

export function DbLoaderProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncDate, setSyncDate] = useState<string | null>(null);
  const [sources, setSources] = useState<SourceInfo[]>([]);

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
    <DbLoaderContext.Provider value={{ loading, error, syncDate, sources, syncDatabase }}>
      {children}
    </DbLoaderContext.Provider>
  );
}

export function useDbLoader() {
  const ctx = useContext(DbLoaderContext);
  if (!ctx) throw new Error('useDbLoader must be used inside DbLoaderProvider');
  return ctx;
}
